"""Runs the one simulator (web/js/sim.js) through Node and fans batches out.

Every number comes from `town-trial/sim/run_batch.mjs`. Python only splits
experiments into seed chunks, dispatches them (locally or with Modal `.map`),
and recombines the per-seed runs with the same mean / sd formulas as runBatch.
"""
from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable

ROOT = Path(os.environ.get("TOWN_TRIAL_ROOT") or Path(__file__).resolve().parents[1])
RUN_BATCH = ROOT / "sim" / "run_batch.mjs"
KEYS = ["visits", "restrictedVisits", "turnedAway", "uniqueVisitors", "staffHours", "awarePct", "familiesAwarePct"]


def run_jobs_local(jobs: list[dict]) -> list[dict]:
    """Run a list of jobs in one Node process. Used by Modal workers and local runs."""
    node = shutil.which("node") or "node"
    p = subprocess.run([node, str(RUN_BATCH)], input=json.dumps(jobs), capture_output=True, text=True, timeout=600)
    if p.returncode != 0:
        raise RuntimeError(f"run_batch.mjs failed: {p.stderr.strip()[-800:]}")
    return json.loads(p.stdout)


def aggregate(runs: list[dict]) -> dict:
    """Same arithmetic as sim.js runBatch (sequential sums, sd with n-1)."""
    n = len(runs)
    mean, sd = {}, {}
    for k in KEYS:
        s = 0.0
        for r in runs:
            s += r[k]
        mu = s / n
        v = 0.0
        for r in runs:
            v += (r[k] - mu) ** 2
        mean[k] = mu
        sd[k] = math.sqrt(v / max(1, n - 1))
    return {"n": n, "mean": mean, "sd": sd}


def merge_traces(traces: list[dict], n_seeds: int) -> dict:
    """Sum per-chunk trace counts; residentsByCohort is the same in every chunk."""
    out: dict = {"seeds": n_seeds}
    for t in traces:
        for k, counts in t.items():
            if k == "residentsByCohort":
                out[k] = counts
                continue
            dst = out.setdefault(k, {})
            for kk, v in counts.items():
                dst[kk] = dst.get(kk, 0) + v
    return out


Mapper = Callable[[list[list[dict]]], list[list[dict]]]


def local_mapper(max_workers: int | None = None) -> Mapper:
    def mapper(groups: list[list[dict]]) -> list[list[dict]]:
        with ThreadPoolExecutor(max_workers=max_workers or min(8, os.cpu_count() or 2)) as ex:
            return list(ex.map(run_jobs_local, groups))
    return mapper


class Runner:
    """Splits experiments into (policy x seed-chunk x scenario) jobs and fans them out.

    `mapper` takes a list of job groups (one group per worker) and returns their
    results in order. Locally that is a thread pool of Node processes; on Modal it
    is `run_batch.map`. If the primary mapper fails, the fallback runs and the
    failure is reported to the caller (so it can be logged).
    """

    def __init__(self, mapper: Mapper, where: str, chunk: int = 8, fallback: Mapper | None = None, fallback_where: str = "orchestrator (local Node)"):
        self.mapper, self.where, self.chunk = mapper, where, chunk
        self.fallback, self.fallback_where = fallback, fallback_where

    def plan(self, experiments: list[dict]) -> list[list[dict]]:
        groups = []
        for e in experiments:
            seeds = e["seeds"] if isinstance(e["seeds"], list) else list(range(e["seeds"]))
            for i in range(0, len(seeds), self.chunk):
                job = {k: v for k, v in e.items() if k not in ("seeds", "key")}
                job["seeds"] = seeds[i:i + self.chunk]
                groups.append([job])
        return groups

    def run(self, experiments: list[dict]) -> dict:
        """experiments: [{key, city, mode, policy, seeds, days?, scenario?}].
        Returns {results: {key: {n, mean, sd}}, wall_s, workers, where, error}."""
        groups = self.plan(experiments)
        t0 = time.time()
        where, error = self.where, None
        try:
            out = self.mapper(groups)
        except Exception as ex:  # fan-out failed: run in this container instead
            if not self.fallback:
                raise
            error = f"{type(ex).__name__}: {ex}"
            where = self.fallback_where
            out = self.fallback(groups)
        wall = time.time() - t0
        # recombine chunks per experiment, in seed order
        results, gi = {}, 0
        for e in experiments:
            seeds = e["seeds"] if isinstance(e["seeds"], list) else list(range(e["seeds"]))
            runs, traces = [], []
            for _ in range(0, len(seeds), self.chunk):
                runs.extend(out[gi][0]["runs"])
                if "trace" in out[gi][0]:
                    traces.append(out[gi][0]["trace"])
                gi += 1
            results[e["key"]] = aggregate(runs)
            if traces:
                results[e["key"]]["trace"] = merge_traces(traces, len(seeds))
        return {"results": results, "wall_s": round(wall, 2), "workers": len(groups), "where": where, "error": error}

    def info(self, city: str, scenario: dict | None = None) -> dict:
        return run_jobs_local([{"info": True, "city": city, "scenario": scenario}])[0]["residents"]
