"""Backend smoke test: full scripted trials in-process (no Modal, no network).
Run: python town-trial/tests/backend_check.py
"""
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from events import EventStore  # noqa: E402
from orchestrator import run_trial  # noqa: E402
from sim import Runner, local_mapper, run_jobs_local  # noqa: E402

fails = 0
def check(name, ok, info=""):
    global fails
    print(f"{'PASS' if ok else 'FAIL'} {name} {info}")
    fails += not ok

# Chunked fan-out == one runBatch over all seeds
runner = Runner(mapper=local_mapper(), where="local")
pol = {"hours": [[600, 1080]] * 6 + [None]}
fan = runner.run([{"key": "x", "city": "Evart, MI", "mode": "service", "policy": pol, "seeds": 16, "days": 7}])["results"]["x"]
one = run_jobs_local([{"city": "Evart, MI", "mode": "service", "policy": pol, "seeds": 16, "days": 7}])[0]
check("chunked mean == runBatch mean", fan["mean"] == one["mean"], str(fan["mean"]["restrictedVisits"]))
check("chunked sd == runBatch sd", fan["sd"] == one["sd"])

for mode, prompt in (("service", "Keep the library open two late evenings"), ("perception", "Who hears about the new library hours notice?")):
    store = EventStore({})
    store.create("t1", {})
    t0 = time.time()
    run_trial(store, "t1", "Evart, MI", prompt, mode, runner)
    evs, done = store.read("t1")
    types = Counter(e["type"] for e in evs)
    errors = [e["message"] for e in evs if e["type"] == "NOTE" and e.get("level") == "error"]
    check(f"{mode}: done, no errors", done and not errors, f"{time.time() - t0:.1f}s {errors[:1]}")
    need = ["CLAIM", "EXA", "MEMORY_WRITE", "MEMORY_READ", "PROPOSE", "REVIEW", "RUN_START", "RUN_DONE", "FAILURE", "HELD_OUT", "HELD_OUT_TABLE", "BRIEF", "EXPERIMENT"]
    check(f"{mode}: all event types", all(types[t] for t in need), str(dict(types)))
    check(f"{mode}: seq increasing", [e["seq"] for e in evs] == list(range(1, len(evs) + 1)))
    exps = {}
    for e in evs:
        if e["type"] == "EXPERIMENT":
            exps[e["id"]] = e
    best = [x for x in exps.values() if x["best"]]
    check(f"{mode}: one best experiment", len(best) == 1, best[0]["id"] if best else "")
    check(f"{mode}: researcher events carry agent", all(e.get("agent") for e in evs if e["type"] not in ("NOTE", "EXPERIMENT")))
    brief = next(e for e in evs if e["type"] == "BRIEF")
    print("   ", brief["summary"])

sys.exit(1 if fails else 0)
