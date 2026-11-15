"""Modal report: the same simulator workload run serially (one container) vs fanned out (.map).

    modal run town-trial/eval/modal_timing.py          # writes eval/results/modal_timing.json

Workloads: 4 towns x 6 policies x N seeds of the 7-day service model, at several sizes.
Serial = one container, one Node process for every job (the best case for serial).
Fan-out = .map over chunks of seeds. The first row is the live trial's setting (4-seed
chunks); the others size chunks to roughly a second of work per call.
Both are timed inside Modal, so local network latency is not counted. Every result is
checked equal between the two modes.

Cost uses Modal's list prices (modal.com/pricing, checked 2026-11-15): $0.0000131 per
physical core-second, $0.00000222 per GiB-second, billed on max(requested, used). The
lower bound counts only execution time; the upper bound adds each container's start-up
and idle time until scale-down, which Modal also bills.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import modal

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "backend"))
from app import image  # noqa: E402  (same image as the backend: Node 22 + sim.js)

CORE_S, GIB_S = 0.0000131, 0.00000222
CPU, MEM_GIB = 1.0, 0.5  # what the functions request (cpu=1.0 core, 512 MiB)
SCALEDOWN_S = 60  # Modal's default idle window before a container stops

app = modal.App("town-trial-eval", image=image)

TOWNS = ["Evart, MI", "Marfa, TX", "Springfield, IL", "Oslo"]
H = lambda h: h * 60  # noqa: E731
BASE = [[H(10), H(18)]] * 6 + [None]


def hours(changes):
    h = [list(x) if x else None for x in BASE]
    for d, o, c in changes:
        h[d] = [o, c]
    return h


POLICIES = [hours([]), hours([(1, H(10), H(21)), (3, H(10), H(21))]), hours([(1, H(13), H(21)), (3, H(13), H(21))]),
            hours([(5, H(12), H(20))]), hours([(0, H(12), H(20)), (2, H(12), H(20))]), hours([(1, H(13), H(21)), (3, H(13), H(21)), (5, H(12), H(20))])]


CONFIGS = [(32, 4), (32, 32), (256, 64), (1024, 256)]  # (seeds per policy, seeds per call)


def workload(seeds=32, chunk=4):
    return [[{"city": t, "mode": "service", "policy": {"hours": p}, "seeds": list(range(s, s + chunk)), "days": 7}]
            for t in TOWNS for p in POLICIES for s in range(0, seeds, chunk)]


@app.function(cpu=CPU, memory=512, timeout=600)
def sim_chunk(jobs):
    import os
    from sim import run_jobs_local
    t0 = time.time()
    out = run_jobs_local(jobs)
    return {"means": [r["runs"] for r in out], "exec_s": time.time() - t0, "task": os.environ.get("MODAL_TASK_ID", "?")}


@app.function(cpu=CPU, memory=512, timeout=1800)
def sim_serial(groups):
    from sim import run_jobs_local
    t0 = time.time()
    out = run_jobs_local([g[0] for g in groups])  # one Node process, all jobs in sequence
    return {"means": [[r["runs"]] for r in out], "exec_s": time.time() - t0}


def bench_one(seeds: int, chunk: int) -> dict:
    groups = workload(seeds, chunk)
    t0 = time.time()
    ser = sim_serial.remote(groups)
    serial_wall = time.time() - t0
    t0 = time.time()
    fan = list(sim_chunk.map(groups))
    fan_wall = time.time() - t0
    same = all(f["means"] == s for f, s in zip(fan, ser["means"]))
    tasks = sorted({f["task"] for f in fan})
    exec_sum = sum(f["exec_s"] for f in fan)
    res_cost = CPU * CORE_S + MEM_GIB * GIB_S  # $ per container-second
    return {
        "seed_runs": len(TOWNS) * len(POLICIES) * seeds, "seeds_per_policy": seeds, "seeds_per_call": chunk, "calls": len(groups),
        "serial": {"wall_s": round(serial_wall, 2), "exec_s": round(ser["exec_s"], 2), "containers": 1,
                   "cost_usd_lower": round(ser["exec_s"] * res_cost, 6), "cost_usd_upper": round((serial_wall + SCALEDOWN_S) * res_cost, 6)},
        "fanout": {"wall_s": round(fan_wall, 2), "exec_s_sum": round(exec_sum, 2), "containers": len(tasks),
                   "cost_usd_lower": round(exec_sum * res_cost, 6),
                   "cost_usd_upper": round((exec_sum + len(tasks) * (fan_wall + SCALEDOWN_S)) * res_cost, 6)},
        "speedup_wall": round(serial_wall / fan_wall, 2),
        "results_identical": same,
    }


@app.function(timeout=3600)
def bench():
    rows = [bench_one(s, c) for s, c in CONFIGS]
    return {
        "workloads": rows,
        "towns": TOWNS, "policies": len(POLICIES), "days": 7,
        "prices": {"core_second_usd": CORE_S, "gib_second_usd": GIB_S, "source": "modal.com/pricing (checked 2026-11-15)",
                   "requested": {"cpu_cores": CPU, "memory_gib": MEM_GIB}, "scaledown_window_s": SCALEDOWN_S},
        "note": ("Wall times measured inside Modal; each row starts after the previous one, so later rows may reuse warm "
                 "containers. Cost lower bound = execution time only; upper bound adds start-up and the idle scale-down "
                 "window per container. One seed-run takes ~3.5 ms, so small batches are dominated by container start-up "
                 "and per-call Node start: fan-out pays off for evaluation-size sweeps, not for one 16-seed experiment."),
        "measured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


@app.local_entrypoint()
def main():
    out = bench.remote()
    path = HERE / "results" / "modal_timing.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, indent=2))
    print(json.dumps(out, indent=2))
