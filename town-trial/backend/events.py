"""Append-only event log per trial.

One writer per trial (the orchestrator). Readers (the API) poll with `since`.
The backing store is any dict-like object with get / __setitem__: a plain dict
locally, a `modal.Dict` on Modal. The writer keeps the full list in memory and
re-puts it on every append, which is fine for a few hundred events per trial.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class EventStore:
    def __init__(self, backing):
        self.d = backing
        self._cache: dict[str, list] = {}

    # ---- writer ----
    def create(self, trial_id: str, meta: dict) -> None:
        self._cache[trial_id] = []
        self.d[f"{trial_id}:events"] = []
        self.d[f"{trial_id}:meta"] = {**meta, "created": time.time(), "done": False}

    def append(self, trial_id: str, type_: str, fields: dict) -> dict:
        events = self._cache.setdefault(trial_id, list(self.d.get(f"{trial_id}:events", [])))
        e = {"seq": len(events) + 1, "t": _now(), "type": type_, "clock": "", **fields}
        events.append(e)
        self.d[f"{trial_id}:events"] = events
        return e

    def finish(self, trial_id: str, **extra) -> None:
        meta = dict(self.d.get(f"{trial_id}:meta", {}))
        meta.update(done=True, finished=time.time(), **extra)
        self.d[f"{trial_id}:meta"] = meta

    def stopped(self, trial_id: str) -> bool:
        return bool(self.d.get(f"{trial_id}:stop", False))

    # ---- readers ----
    def meta(self, trial_id: str) -> dict | None:
        return self.d.get(f"{trial_id}:meta", None)

    def read(self, trial_id: str, since: int = 0) -> tuple[list, bool]:
        events = self.d.get(f"{trial_id}:events", [])
        meta = self.d.get(f"{trial_id}:meta", {}) or {}
        return [e for e in events if e["seq"] > since], bool(meta.get("done"))

    def stop(self, trial_id: str) -> None:
        self.d[f"{trial_id}:stop"] = True

    # ---- concurrency cap ----
    def register_active(self, trial_id: str, max_active: int, stale_s: float = 1800) -> bool:
        """Best-effort cap on concurrent trials. Returns False if the cap is reached."""
        now = time.time()
        active = [t for t in self.d.get("active", []) if self._is_live(t, now, stale_s)]
        if len(active) >= max_active:
            self.d["active"] = active
            return False
        self.d["active"] = active + [trial_id]
        return True

    def _is_live(self, trial_id: str, now: float, stale_s: float) -> bool:
        m = self.d.get(f"{trial_id}:meta", None)
        return bool(m) and not m.get("done") and now - m.get("created", 0) < stale_s
