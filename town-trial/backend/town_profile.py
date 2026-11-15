"""Town profile (Exa Dude): the town's budget documents, communication channels and the roles/addresses of its places.

Built once per town on its first live trial and cached next to the map spec (the OpenStreetMap places stay the base:
Exa results have no coordinates). Every fact is quote-checked against the returned page, must come from a page about
this town (place check), and keeps its URL and published date. Fields no verified source states are listed as missing.
Places that only Exa found are listed as such; they are not drawn on the map.
"""
from __future__ import annotations

import time

from agents.llm import strict

PROFILE_VERSION = 3  # v3: a second, targeted budget search when the first finds no verified total
BUILD_CAP_S = 45  # max seconds a trial waits for a first-visit profile

BUDGET = strict({
    "found": {"type": "boolean"},
    "fiscal_year": {"type": ["string", "null"], "description": "e.g. 'FY2025' or '2024-25'"},
    "total_budget_usd": {"type": ["number", "null"], "description": "total adopted budget or general fund, dollars"},
    "total_kind": {"type": "string", "enum": ["adopted budget (appropriation)", "actual spending", "general fund", "not stated"]},
    "revenue_sources": {"type": "array", "items": strict({"source": {"type": "string"}, "amount_usd": {"type": ["number", "null"]}})},
    "departments": {"type": "array", "items": strict({"name": {"type": "string"}, "amount_usd": {"type": ["number", "null"]}})},
    "restricted_funds": {"type": "array", "items": strict({"name": {"type": "string"}, "amount_usd": {"type": ["number", "null"]}, "restriction": {"type": "string"}})},
    "balances": {"type": "array", "items": strict({"fund": {"type": "string"}, "amount_usd": {"type": ["number", "null"]},
                                                     "kind": {"type": "string", "enum": ["unspent balance", "reserve / fund balance", "appropriated", "not stated"]}})},
    "quote": {"type": "string", "description": "a sentence copied exactly from the source that states the main figure"},
    "url": {"type": "string"},
})
CHANNELS = strict({"found": {"type": "boolean"}, "channels": {"type": "array", "items": strict({
    "name": {"type": "string"}, "kind": {"type": "string", "enum": ["newspaper", "newsletter", "website", "social media", "radio", "school bulletin", "notice posting", "other"]},
    "quote": {"type": "string"}, "url": {"type": "string"}})}})
PLACES = strict({"found": {"type": "boolean"}, "places": {"type": "array", "items": strict({
    "name": {"type": "string"}, "role": {"type": "string", "description": "what it is / does for residents, a few words"},
    "address": {"type": ["string", "null"]}, "quote": {"type": "string"}, "url": {"type": "string"}})}})


GENERIC = {"public", "the", "of", "and", "city", "town", "village", "county", "center", "centre", "community", "hall", "school", "district",
           "elementary", "middle", "high", "area", "memorial", "municipal", "office", "building", "park"}
KIND_WORDS = {"library", "school", "hall", "park", "pool", "clinic", "pharmacy", "museum", "church", "post", "fire", "police", "center", "centre"}


def same_place(osm_name: str, exa_name: str, city: str) -> bool:
    """Do an OpenStreetMap name and a name in a source mean the same place? ("Evart Public Library" ~ "Evart Library-Museum")"""
    import re
    town = {w for w in re.findall(r"[a-z]+", city.lower()) if len(w) > 2}
    a, b = set(re.findall(r"[a-z]+", osm_name)), set(re.findall(r"[a-z]+", exa_name))
    if osm_name in exa_name or exa_name in osm_name:
        return True
    distinct = (a & b) - GENERIC - town - KIND_WORDS
    same_kind = bool((a & b) & KIND_WORDS)
    return bool(distinct) or (same_kind and bool(a & b & town))


def _key(city: str) -> str:
    import re
    return "profile:" + re.sub(r"\s+", " ", city.strip().lower())


def cached(city: str, cache) -> dict | None:
    try:
        p = cache.get(_key(city), None)
    except Exception:
        return None
    return p if p and p.get("version") == PROFILE_VERSION else None


def build(city: str, ada, spec: dict | None) -> dict:
    """Run the profile searches (3 Exa calls, 3 LLM extractions) and keep only checked facts."""
    prof = {"version": PROFILE_VERSION, "city": city, "built": time.strftime("%Y-%m-%d"), "budget": None, "channels": [], "places": [],
            "exa_only_places": [], "sources": [], "missing": [], "searches": []}

    def search(q: str) -> list[dict]:
        try:
            res = ada.search(q, num_results=4)
        except Exception as ex:
            prof["searches"].append({"query": q, "error": f"{type(ex).__name__}: {str(ex)[:120]}"})
            return []
        prof["searches"].append({"query": q, "results": [{"title": r["title"], "url": r["url"], "published": r.get("published"), "passage": r["passage"][:300]} for r in res]})
        return res

    def src(url: str, results: list[dict]) -> None:
        r = next((r for r in results if r["url"] == url), {})
        if url and url not in {s["url"] for s in prof["sources"]}:
            prof["sources"].append({"url": url, "title": r.get("title") or url, "published": str(r.get("published") or "")[:10] or None})

    # 1. Budget documents: a broad search, then a targeted one for the adopted total if the first has no verified figure
    for q in (f"{city} annual budget fiscal year general fund revenues expenditures departments",
              f"{city} city adopted budget total appropriations general fund million"):
        if prof["budget"]:
            break
        res = search(q)
        if not res:
            continue
        try:
            out = ada.llm.json("town_budget", BUDGET, ada.SYSTEM, f"From the sources, extract {city}'s current municipal budget. Use only stated figures; "
                               f"leave anything not stated empty or null. Distinguish money budgeted (appropriated) from money actually unspent.\n\n{ada._sources(res)}")
            chk = ada._checked(out, res)
            if chk and not chk.get("unverified"):
                prof["budget"] = {k: chk[k] for k in ("fiscal_year", "total_budget_usd", "total_kind", "revenue_sources", "departments", "restricted_funds", "balances")}
                prof["budget"].update(url=chk["url"], published=chk.get("published"), quote=chk["quote"][:300], check=chk.get("check"))
                src(chk["url"], res)
                prof["missing"] = [m for m in prof["missing"] if not m.startswith("budget")]
            elif chk:
                prof["missing"].append(f"budget ({chk.get('check')})")
        except Exception as ex:
            prof["missing"].append(f"budget (extraction failed: {type(ex).__name__})")
    if not prof["budget"]:
        if not any(m.startswith("budget") for m in prof["missing"]):
            prof["missing"].append("budget documents (no verified source)")
    else:
        b = prof["budget"]
        for f, label in (("fiscal_year", "fiscal year"), ("revenue_sources", "revenue sources"), ("departments", "department spending"),
                         ("restricted_funds", "restricted funds"), ("balances", "published remaining balances")):
            if not b.get(f):
                prof["missing"].append(label)

    # 2. Communication channels
    res = search(f"{city} local newspaper community newsletter news where residents get local news")
    if res:
        try:
            out = ada.llm.json("town_channels", CHANNELS, ada.SYSTEM, f"From the sources, list the ways residents of {city} get local news "
                               f"(local paper, newsletters, radio, the town website, school bulletins). Quote each.\n\n{ada._sources(res)}")
            for c in out.get("channels", [])[:6]:
                chk = ada._checked({"found": True, **c}, res)
                if chk and not chk.get("unverified"):
                    prof["channels"].append({"name": c["name"], "kind": c["kind"], "url": chk["url"], "published": chk.get("published")})
                    src(chk["url"], res)
        except Exception as ex:
            prof["missing"].append(f"channels (extraction failed: {type(ex).__name__})")
    if not prof["channels"]:
        prof["missing"].append("local communication channels")

    # 3. Roles and addresses of the main public places
    res = search(f"{city} public library town hall city hall schools community center address")
    if res:
        try:
            out = ada.llm.json("town_places", PLACES, ada.SYSTEM, f"From the sources, list public places in {city} (library, town/city hall, schools, "
                               f"community centre, parks) with their role and street address if stated. Quote each.\n\n{ada._sources(res)}")
            osm = [(p.get("name") or "").lower() for p in (spec or {}).get("places", [])]
            for p in out.get("places", [])[:10]:
                chk = ada._checked({"found": True, **p}, res)
                if not chk or chk.get("unverified"):
                    continue
                name = p["name"].strip()
                rec = {"name": name, "role": p["role"], "address": p.get("address"), "url": chk["url"], "published": chk.get("published")}
                hit = next((o for o in osm if o and same_place(o, name.lower(), city)), None)
                (prof["places"] if hit else prof["exa_only_places"]).append({**rec, "on_map": bool(hit)})
                src(chk["url"], res)
        except Exception as ex:
            prof["missing"].append(f"place roles (extraction failed: {type(ex).__name__})")
    if not prof["places"] and not prof["exa_only_places"]:
        prof["missing"].append("place roles and addresses")
    return prof


def budget_docs(prof: dict | None) -> list[dict]:
    """The profile's budget figures as statements Treasurer can cite."""
    b = (prof or {}).get("budget")
    if not b:
        return []
    url, pub = b["url"], b.get("published")
    usd = lambda x: f"${x:,.0f}" if isinstance(x, (int, float)) else "amount not stated"  # noqa: E731
    out = []
    if b.get("total_budget_usd"):
        out.append({"statement": f"{b.get('fiscal_year') or 'Current'} {b['total_kind']}: {usd(b['total_budget_usd'])}", "kind": "total", "amount": b["total_budget_usd"], "url": url, "published": pub})
    for d in (b.get("departments") or [])[:6]:
        out.append({"statement": f"Department spending: {d['name']} {usd(d.get('amount_usd'))}", "kind": "department", "amount": d.get("amount_usd"), "url": url, "published": pub})
    for r in (b.get("restricted_funds") or [])[:4]:
        out.append({"statement": f"Restricted fund: {r['name']} {usd(r.get('amount_usd'))} ({r['restriction']})", "kind": "restricted", "amount": r.get("amount_usd"), "url": url, "published": pub})
    for x in (b.get("balances") or [])[:4]:
        out.append({"statement": f"{x['kind']}: {x['fund']} {usd(x.get('amount_usd'))}", "kind": x["kind"], "amount": x.get("amount_usd"), "url": url, "published": pub})
    return out


# ---------- built as soon as the town loads (so the budget is in the top bar before any trial) ----------
def _status_key(city: str) -> str:
    return _key(city) + ":status"


def public(prof: dict) -> dict:
    """The fields the browser shows (same shape as the TOWN_PROFILE event)."""
    return {"cached": True, "built": prof.get("built"), "budget": prof.get("budget") or None, "channels": prof.get("channels", []),
            "places": prof.get("places", []), "exa_only_places": prof.get("exa_only_places", []), "sources": prof.get("sources", []),
            "missing": prof.get("missing", [])}


def build_into(city: str, cache) -> None:
    """Build the profile with its own small search budget and cache it (or the error). Runs in the background."""
    try:
        if cached(city, cache):
            cache[_status_key(city)] = {"state": "ready", "t": time.time()}
            return
        from agents.ada import Ada
        from agents.llm import LLM, Budget
        from towns import norm_key
        spec = cache.get(norm_key(city), None)
        pb = Budget(exa=4, llm=4)
        ada = Ada(pb, LLM(pb))
        if not ada.available:
            raise RuntimeError("Exa search is unavailable")
        if spec and spec.get("display_name"):  # place check: town, county, state from the geocoded name
            parts = [p.strip().lower() for p in spec["display_name"].split(",")[:3] if p.strip()]
            ada.place_terms = [p.replace(" county", "") if p.endswith(" county") else p for p in parts]
        cache[_key(city)] = build(city, ada, spec)
        cache[_status_key(city)] = {"state": "ready", "t": time.time()}
    except Exception as ex:
        cache[_status_key(city)] = {"state": "error", "t": time.time(), "error": f"{type(ex).__name__}: {str(ex)[:160]}"}


def lookup(city: str, cache, start_build) -> dict:
    """Non-blocking: {"status": "ready", "profile"} | {"status": "building"} | {"status": "error", "error"}."""
    prof = cached(city, cache)
    if prof:
        return {"status": "ready", "profile": public(prof)}
    st = cache.get(_status_key(city), None) or {}
    age = time.time() - st.get("t", 0)
    if st.get("state") == "error" and age < 120:
        return {"status": "error", "error": st["error"]}
    if st.get("state") != "building" or age > 240:
        cache[_status_key(city)] = {"state": "building", "t": time.time()}
        start_build(city)
    return {"status": "building"}
