"""Shared agent memory: facts, constraints, failures and notices, plus identities and audiences.

Three classes with the same interface:
- PastDevMemory: past.dev REST API (https://api.past.dev/api/v1). One identity per agent
  (ada, bo, cy, dee, eli) and per resident; facts are ingested with a stable source id
  (`<town>:<source_id>`; re-sending it replaces the prior revision), timestamp (effective
  date), label and metadata (author, source URL, query, trial). Reads are recalls as the
  reading agent, so a read of Exa Dude's fact by Bo is a real cross-agent handoff.
- LocalMemory: the same reads and writes in a dict-like store (dict or modal.Dict).
- ResilientMemory: past.dev first; on any error, logs it and uses LocalMemory
  (events then say `store: local-fallback`).
Every call sets `last_store` so the events can say where a read or write went.
"""
from __future__ import annotations

import os
import re
import time
from datetime import datetime, timezone

AGENTS = {"exa": "research god (Exa search)", "bo": "designer", "cy": "reviewer", "dee": "runner", "eli": "archivist", "treasurer": "budget god"}


def town_key(city: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", city.lower()).strip("-")[:24].strip("-") or "town"


def audience_slug(prefix: str, city: str) -> str:
    return f"{prefix}-{town_key(city)}"[:40].strip("-")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _matches(rule: dict, traits: dict) -> bool:
    res = []
    for c in rule["conditions"]:
        v, op, vals = traits.get(c["trait"]), c["operator"], c.get("values", [])
        res.append({"is": v == (vals[0] if vals else None), "is_not": v != (vals[0] if vals else None), "is_one_of": v in vals,
                    "is_not_one_of": v not in vals, "exists": v is not None, "does_not_exist": v is None}[op])
    return all(res) if rule.get("match", "all") == "all" else any(res)


class LocalMemory:
    name = "local"

    def __init__(self, backing, name: str = "local"):
        self.d = backing
        self.name = name
        self.last_store = name

    def _key(self, city: str) -> str:
        return "mem:" + town_key(city)

    # ---- facts ----
    def ingest(self, author: str, city: str, source_id: str, claim: str, kind: str, source: str, effective: str | None = None,
               metadata: dict | None = None, audience: str | None = None) -> dict:
        facts = dict(self.d.get(self._key(city), {}))
        prev = facts.get(source_id)
        rec = {"source_id": source_id, "author": author, "claim": claim, "kind": kind, "source": source, "effective": effective,
               "audience": audience, "metadata": metadata or {}, "written": time.time(), "revision": (prev["revision"] + 1) if prev else 1}
        facts[source_id] = rec
        self.d[self._key(city)] = facts
        self.last_store = self.name
        return {"supersedes": f"{source_id} r{prev['revision']}: {prev['claim']}" if prev else None, "record": rec}

    def recall(self, reader: str, city: str, query: str, kinds: tuple = ()) -> list[dict]:
        self.last_store = self.name
        return [f for f in self.d.get(self._key(city), {}).values()
                if (not kinds or f["kind"] in kinds) and self._visible(f, reader)]

    def get(self, city: str, source_id: str, reader: str = "bo") -> dict | None:
        self.last_store = self.name
        f = self.d.get(self._key(city), {}).get(source_id)
        return f if f and self._visible(f, reader) else None

    def _visible(self, f: dict, reader: str) -> bool:
        aud = f.get("audience")
        return not aud or reader in self.members(aud)

    # ---- identities and audiences ----
    def ensure_agents(self) -> None:
        self.last_store = self.name

    def put_identities(self, rows: list[dict]) -> int:
        ids = dict(self.d.get("identities", {}))
        for r in rows:
            ids[r["identity"]] = dict(r["traits"])
        self.d["identities"] = ids
        self.last_store = self.name
        return len(rows)

    def update_traits(self, identity: str, traits: dict) -> None:
        ids = dict(self.d.get("identities", {}))
        ids[identity] = {**ids.get(identity, {}), **traits}
        self.d["identities"] = ids
        self.last_store = self.name

    def put_audience(self, slug: str, name: str, rule: dict) -> int:
        auds = dict(self.d.get("audiences", {}))
        auds[slug] = {"name": name, "rule": rule}
        self.d["audiences"] = auds
        self.last_store = self.name
        return len(self.members(slug))

    def recompute(self, slug: str) -> int:
        self.last_store = self.name
        return len(self.members(slug))

    def members(self, slug: str) -> list[str]:
        aud = self.d.get("audiences", {}).get(slug)
        if not aud:
            return []
        return [i for i, t in self.d.get("identities", {}).items() if _matches(aud["rule"], t)]

    def recall_as(self, identity: str, city: str, query: str, source_id: str) -> bool:
        """Can this identity recall the given memory? (audience-gated)"""
        return self.get(city, source_id, reader=identity) is not None


class PastDevMemory:
    name = "past.dev"
    BASE = os.environ.get("PAST_DEV_BASE", "https://api.past.dev/api/v1")

    def __init__(self, key: str, mirror: LocalMemory, timeout: float = 20):
        import httpx
        self.http = httpx.Client(base_url=self.BASE, headers={"Authorization": f"Bearer {key}"}, timeout=timeout)
        self.mirror = mirror  # local copy: tracks revisions (supersedes) and recall queries for get()
        self.pending: dict[str, str] = {}  # past.dev source id -> ingestionId not yet confirmed
        self.last_store = self.name
        self.calls = 0

    def _req(self, method: str, path: str, body=None) -> dict:
        self.calls += 1
        r = self.http.request(method, path, json=body)
        if r.status_code >= 300:
            raise RuntimeError(f"past.dev {method} {path} -> {r.status_code}: {r.text[:200]}")
        self.last_store = self.name
        return r.json() if r.content else {}

    def sid(self, city: str, source_id: str) -> str:
        return f"{town_key(city)}:{source_id}"

    # ---- facts ----
    def ingest(self, author: str, city: str, source_id: str, claim: str, kind: str, source: str, effective: str | None = None,
               metadata: dict | None = None, audience: str | None = None) -> dict:
        meta = {"author": author, "kind": kind, "city": city, "town": town_key(city), "source_url": source, "source_id": source_id,
                "claim": claim, **(metadata or {})}
        body = {"id": self.sid(city, source_id), "content": f"{claim}\nSource: {source}", "label": f"{kind}: {claim[:120]}",
                "timestamp": effective or _now_iso(), "identity": author, "metadata": meta}
        if audience:
            body["audience"] = audience
        out = self._req("POST", "/ingest", body)
        if out.get("status") == "queued" and out.get("ingestionId"):
            self.pending[body["id"]] = out["ingestionId"]
        local = self.mirror.ingest(author, city, source_id, claim, kind, source, effective, metadata, audience)
        self.last_store = self.name
        return {"supersedes": local["supersedes"], "record": {**local["record"], "ingestionId": out.get("ingestionId")}}

    def wait(self, past_sid: str, max_s: float = 25) -> None:
        ing = self.pending.get(past_sid)
        t0 = time.time()
        while ing and time.time() - t0 < max_s:
            st = self._req("GET", f"/ingest/{ing}")
            if st.get("status") != "processing":
                if st.get("status") == "failed":
                    raise RuntimeError(f"past.dev ingestion failed: {st.get('failure')}")
                self.pending.pop(past_sid, None)
                return
            time.sleep(1.5)

    def _recall(self, reader: str, query: str, limit: int = 30) -> list[dict]:
        out = self._req("POST", "/recall", {"query": query, "identity": reader, "limit": limit, "level": "low"})
        return out.get("results", [])

    def _facts_from(self, results: list[dict], city: str) -> dict[str, dict]:
        facts: dict[str, dict] = {}
        for r in results:
            for s in r.get("sources", []):
                m = s.get("metadata") or {}
                if m.get("town") != town_key(city) or not m.get("source_id"):
                    continue
                f = facts.setdefault(m["source_id"], {"source_id": m["source_id"], "author": m.get("author"), "claim": m.get("claim"),
                                                      "kind": m.get("kind"), "source": m.get("source_url"), "recalled": []})
                if r.get("artifact", {}).get("kind") != "source" and len(f["recalled"]) < 3:
                    f["recalled"].append(r["content"])  # past.dev's extracted claims
        return facts

    def recall(self, reader: str, city: str, query: str, kinds: tuple = ()) -> list[dict]:
        facts = self._facts_from(self._recall(reader, f"{city} {query}"), city)
        return [f for f in facts.values() if not kinds or f["kind"] in kinds]

    def get(self, city: str, source_id: str, reader: str = "bo") -> dict | None:
        """Recall a specific memory as `reader` (waits for its ingestion if still pending)."""
        sid = self.sid(city, source_id)
        self.wait(sid)
        local = self.mirror.get(city, source_id, reader="__any__") or self.mirror.d.get(self.mirror._key(city), {}).get(source_id)
        query = f"{city} {local['claim']}" if local else f"{city} {source_id.replace('-', ' ')}"
        return self._facts_from(self._recall(reader, query), city).get(source_id)

    # ---- identities and audiences ----
    def ensure_agents(self) -> None:
        self._req("POST", "/identities/bulk", [{"identity": a, "traits": {"role": r, "kind": "agent"}} for a, r in AGENTS.items()])

    def put_identities(self, rows: list[dict]) -> int:
        n = 0
        for i in range(0, len(rows), 1000):
            n += len(self._req("POST", "/identities/bulk", rows[i:i + 1000]).get("identities", []))
        self.mirror.put_identities(rows)
        return n

    def update_traits(self, identity: str, traits: dict) -> None:
        self._req("PATCH", f"/identities/{identity}", {"traits": traits})
        self.mirror.update_traits(identity, traits)

    def put_audience(self, slug: str, name: str, rule: dict) -> int:
        self.mirror.put_audience(slug, name, rule)
        return self._req("PUT", f"/audiences/{slug}", {"kind": "rule", "name": name, "rule": rule}).get("memberCount", 0)

    def recompute(self, slug: str) -> int:
        return self._req("POST", f"/audiences/{slug}/recompute").get("memberCount", 0)

    def recall_as(self, identity: str, city: str, query: str, source_id: str) -> bool:
        self.wait(self.sid(city, source_id))
        return source_id in self._facts_from(self._recall(identity, query, limit=50), city)


class ResilientMemory:
    """past.dev with a local fallback per call. `on_fallback(message)` is called the first time each operation falls back."""

    def __init__(self, primary: PastDevMemory, fallback: LocalMemory):
        self.primary, self.fallback = primary, fallback
        self.fallback.name = "local-fallback"
        self.on_fallback = lambda msg: None
        self.failed: set[str] = set()
        self.last_store = primary.name

    @property
    def name(self) -> str:
        return self.last_store

    def __getattr__(self, op):
        p, f = getattr(self.primary, op), getattr(self.fallback, op)

        def call(*a, **k):
            if op not in self.failed:
                try:
                    out = p(*a, **k)
                    self.last_store = self.primary.name
                    return out
                except Exception as ex:
                    self.failed.add(op)
                    self.on_fallback(f"past.dev {op} failed ({type(ex).__name__}: {str(ex)[:160]}); using local memory for {op} from now on.")
            out = f(*a, **k)
            self.last_store = self.fallback.name
            return out
        return call

    def get(self, city: str, source_id: str, reader: str = "bo"):
        """A missed recall (ranking) is not a failure: say so, and use the local copy labelled as such."""
        out = self.__getattr__("get")(city, source_id, reader)
        if out is None and self.last_store == self.primary.name:
            local = self.fallback.d.get(self.fallback._key(city), {}).get(source_id)
            if local:
                self.on_fallback(f"past.dev recall as {reader} did not return {source_id} yet; using the local copy.")
                self.last_store = self.fallback.name
                return local
        return out


def make_memory(local_backing) -> LocalMemory | ResilientMemory:
    """past.dev when PAST_DEV_API_KEY is set (with local fallback), else local only."""
    key = os.environ.get("PAST_DEV_API_KEY")
    if not key:
        return LocalMemory(local_backing)
    mirror = LocalMemory(local_backing, name="local-fallback")
    return ResilientMemory(PastDevMemory(key, mirror), mirror)
