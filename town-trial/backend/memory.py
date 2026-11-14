"""Shared agent memory: facts, constraints and failures, keyed by town and source_id.

`LocalMemory` keeps the same reads and writes as past.dev in a dict-like store
(a dict locally, a modal.Dict on Modal). It is the M2 store and the M3
fallback when past.dev fails (`store: local-fallback` in MEMORY_* events).
Reusing a source_id replaces the prior revision; the write reports what it superseded.
"""
from __future__ import annotations

import time


class LocalMemory:
    name = "local"

    def __init__(self, backing):
        self.d = backing

    def _key(self, city: str) -> str:
        return "mem:" + city.lower().strip()

    def ingest(self, author: str, city: str, source_id: str, claim: str, kind: str, source: str, effective: str | None = None,
               metadata: dict | None = None) -> dict:
        facts = dict(self.d.get(self._key(city), {}))
        prev = facts.get(source_id)
        rec = {"source_id": source_id, "author": author, "claim": claim, "kind": kind, "source": source, "effective": effective,
               "metadata": metadata or {}, "written": time.time(), "revision": (prev["revision"] + 1) if prev else 1}
        facts[source_id] = rec
        self.d[self._key(city)] = facts
        return {"supersedes": f"{source_id}@r{prev['revision']}: {prev['claim']}" if prev else None, "record": rec}

    def recall(self, reader: str, city: str, query: str, kinds: tuple = ()) -> list[dict]:
        facts = list(self.d.get(self._key(city), {}).values())
        return [f for f in facts if not kinds or f["kind"] in kinds]

    def get(self, city: str, source_id: str) -> dict | None:
        return self.d.get(self._key(city), {}).get(source_id)
