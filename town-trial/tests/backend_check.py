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

# Log text must round like the browser's toFixed (5.25 -> "5.3", not Python's "5.2")
from policy import fixed  # noqa: E402
check("fixed() matches JS toFixed", [fixed(5.25), fixed(-0.0), fixed(94.875), fixed(47.9, 0)] == ["5.3", "0.0", "94.9", "48"])

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

# Live loop with Exa and the LLM failing: every step must fall back (labelled) and the trial must finish.
from agents.ada import Ada  # noqa: E402
from agents.llm import LLM  # noqa: E402
from memory import LocalMemory  # noqa: E402
from research_loop import LiveTrial  # noqa: E402

def boom(*a, **k):
    raise ConnectionError("forced failure (test)")
LLM.json = boom
Ada.search = boom
for mode, prompt in (("service", "Keep the library open two late evenings"), ("perception", "Who hears about the new library hours notice?")):
    store = EventStore({})
    store.create("t2", {})
    t = LiveTrial(store, "t2", "Evart, MI", prompt, mode, runner, memory=LocalMemory({}))
    try:
        t.start(); store.finish("t2"); err = None
    except Exception as ex:
        err = f"{type(ex).__name__}: {ex}"
    evs, done = store.read("t2")
    types = Counter(e["type"] for e in evs)
    exa = [e for e in evs if e["type"] == "EXA"]
    check(f"live fallback {mode}: finishes", done and not err, err or "")
    check(f"live fallback {mode}: Exa fell back to labelled fixtures", exa and all(e["fixture"] for e in exa), str(len(exa)))
    check(f"live fallback {mode}: brief written, scripted", types["BRIEF"] == 1 and next(e for e in evs if e["type"] == "BRIEF")["scripted"])
    check(f"live fallback {mode}: fallbacks logged", types["NOTE"] >= 3, str(types["NOTE"]))

# Town mode (general model) on a real-town spec with Exa and the LLM failing: framing falls back, every experiment is costed.
import json as _json  # noqa: E402
from town_loop import TownTrial  # noqa: E402
_spec = _json.load(open(Path(__file__).resolve().parent / "fixtures" / "spec_evart.json", encoding="utf-8"))
store = EventStore({})
store.create("t3", {})
tt = TownTrial(store, "t3", "Evart, MI", "Extend library hours two evenings a week", "town", runner, memory=LocalMemory({}))
tt.spec = _spec
try:
    tt.start(); store.finish("t3"); err = None
except Exception as ex:
    err = f"{type(ex).__name__}: {ex}"
evs, done = store.read("t3")
exps = {e["id"]: e for e in evs if e["type"] == "EXPERIMENT"}
check("town fallback: finishes", done and not err, err or "")
check("town fallback: framed + briefed", any(e["type"] == "FRAME" for e in evs) and any(e["type"] == "BRIEF" for e in evs))
_v = [e for e in evs if e["type"] == "VOICES"]
check("town fallback: resident voices before the brief, one per group, labelled", len(_v) == 1 and _v[0]["scripted"] and len(_v[0]["voices"]) >= 5
      and all(v["stance"] in ("helped", "hurt", "unchanged") and v["quote"] and v["role"] for v in _v[0]["voices"])
      and evs.index(_v[0]) < next(i for i, e in enumerate(evs) if e["type"] == "BRIEF"), str([v["stance"] for v in _v[0]["voices"]]) if _v else "none")
_b = [e for e in evs if e["type"] == "BRIEF"]
check("town fallback: brief explains what the policy does and why it wins", bool(_b) and bool(_b[-1].get("what")) and bool(_b[-1].get("reasoning")), (_b[-1].get("reasoning") or "")[:120] if _b else "")
check("town fallback: every run experiment has a budget", all(x.get("budget") for x in exps.values() if x.get("result")), str(len(exps)))
# the pre-run budget estimate (used to reject proposals before running) must match the run's staff + running costs
e0 = exps["E0"]
est = tt.budget_of(tt.est_mean(e0["policy"]), e0["policy"])
check("town: pre-run budget estimate == run budget (no fees)", abs(est["net"] - e0["budget"]["net"]) <= 1, f"{est['net']} vs {e0['budget']['net']}")

sys.exit(1 if fails else 0)
