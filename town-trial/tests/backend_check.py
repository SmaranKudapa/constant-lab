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

# Bo must use what his memory reads return: capture the context passed to his revise step (then fail it, as above).
from agents import bo as _bo_mod  # noqa: E402
from agents.bo import Bo  # noqa: E402
_bo_ctx: list = []
def _capture_revise(*a, **k):  # Bo.revise(self, mode, city, context, ...) and town_revise(llm, city, town, context, ...)
    _bo_ctx.append(a[3] if len(a) > 3 else k.get("context", ""))
    raise ConnectionError("forced failure (test)")
Bo.revise = _capture_revise
_bo_mod.town_revise = _capture_revise

def bo_used_reads(evs):
    reads = [e for e in evs if e["type"] == "MEMORY_READ" and e.get("agent") == "bo" and "revision prompt" in (e.get("used_for") or "")]
    ok = bool(reads) and all(any("From shared memory" in c and r["claim"] in c and r["author"] in c for c in _bo_ctx) for r in reads)
    return ok, f"{len(reads)} reads, {len(_bo_ctx)} prompts"

_mt = LiveTrial.memory_text([{"claim": "Library closes 18:00", "source": "https://x.test/a", "author": "exa", "_store": "past.dev",
                              "recalled": ["The library closes at 6pm"]}, None])
check("memory_text: built from returned records (store, author, source, past.dev's recalled claim)",
      all(s in _mt for s in ("past.dev", "exa", "Library closes 18:00", "https://x.test/a", "The library closes at 6pm")) and LiveTrial.memory_text([]) == "", _mt[:90])

for mode, prompt in (("service", "Keep the library open two late evenings"), ("perception", "Who hears about the new library hours notice?")):
    _bo_ctx.clear()
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
    check(f"live fallback {mode}: Bo's revision prompt contains the records his memory reads returned", *bo_used_reads(evs))

# Town mode (general model) on a real-town spec with Exa and the LLM failing: framing falls back, every experiment is costed.
import json as _json  # noqa: E402
from town_loop import TownTrial  # noqa: E402
_spec = _json.load(open(Path(__file__).resolve().parent / "fixtures" / "spec_evart.json", encoding="utf-8"))
_bo_ctx.clear()
store = EventStore({})
store.create("t3", {})
tt = TownTrial(store, "t3", "Evart, MI", "Extend library hours two evenings a week", "town", runner, memory=LocalMemory({}))
tt.spec = _spec
# offline, Exa Dude writes nothing in town mode, so seed one of his facts as if this trial had written it (Bo reads this trial's writes)
tt.memory.ingest("exa", "Evart, MI", "fact-budget-hourly_wage", "Library staff wage FY2026: $17.50/hour", "fact", "https://example.org/evart-budget")
tt.written.add("fact-budget-hourly_wage")
try:
    tt.start(); store.finish("t3"); err = None
except Exception as ex:
    err = f"{type(ex).__name__}: {ex}"
evs, done = store.read("t3")
exps = {e["id"]: e for e in evs if e["type"] == "EXPERIMENT"}
check("town fallback: finishes", done and not err, err or "")
check("town fallback: framed + briefed", any(e["type"] == "FRAME" for e in evs) and any(e["type"] == "BRIEF" for e in evs))
check("town fallback: Bo's revision prompt contains the records his memory reads returned", *bo_used_reads(evs))
_v = [e for e in evs if e["type"] == "VOICES"]
check("town fallback: resident voices before the brief, one per group, labelled", len(_v) == 1 and _v[0]["scripted"] and len(_v[0]["voices"]) >= 5
      and all(v["stance"] in ("helped", "hurt", "unchanged") and v["quote"] and v["role"] for v in _v[0]["voices"])
      and evs.index(_v[0]) < next(i for i, e in enumerate(evs) if e["type"] == "BRIEF"), str([v["stance"] for v in _v[0]["voices"]]) if _v else "none")
_b = [e for e in evs if e["type"] == "BRIEF"]
check("town fallback: brief explains what the policy does and why it wins", bool(_b) and bool(_b[-1].get("what")) and bool(_b[-1].get("reasoning")), (_b[-1].get("reasoning") or "")[:120] if _b else "")
_bc = [e for e in evs if e["type"] == "BUDGET_CHECK"]
check("town fallback: Treasurer costs proposals and checks the winner's funding (unverified without budget documents)",
      any(not e["final"] for e in _bc) and any(e["final"] and e["status"] == "unverified" and e["confirm"] for e in _bc)
      and all(isinstance(e["items"], list) and e["items"] for e in _bc), f"{len(_bc)} checks")
_ch = [e for e in evs if e["type"] == "CHAIN"]
check("town fallback: each research round records failure -> question -> source -> changed idea -> new result",
      len(_ch) >= 1 and all(k in _ch[0] for k in ("failure", "question", "source", "changed_idea", "new_result")), f"{len(_ch)} rounds")
check("town fallback: every run experiment has a budget", all(x.get("budget") for x in exps.values() if x.get("result")), str(len(exps)))
check("town fallback: Bo saves what won and Cy saves its failure notes for later trials",
      any(e["type"] == "MEMORY_WRITE" and e["source_id"] == "lesson-t3" and e["agent"] == "bo" for e in evs)
      and any(e["type"] == "MEMORY_WRITE" and e["source_id"] == "cy-notes-t3" and e["agent"] == "cy" for e in evs))

# A later trial in the same browser session lists t3: Bo and Cy read its lessons from shared memory and use them
_bo_ctx.clear()
store.create("t4", {})
t4 = TownTrial(store, "t4", "Evart, MI", "Open the library on Sundays", "town", runner, memory=tt.memory, options={"prior": [{"trial": "t3", "city": "Evart, MI"}]})
t4.spec = _spec
try:
    t4.start(); store.finish("t4"); err4 = None
except Exception as ex:
    err4 = f"{type(ex).__name__}: {ex}"
evs4, _ = store.read("t4")
_lr = [e for e in evs4 if e["type"] == "MEMORY_READ" and e.get("source_id") in ("lesson-t3", "cy-notes-t3")]
_win = next((e["claim"] for e in _lr if e["source_id"] == "lesson-t3"), "")
check("session learning: Bo reads what won and Cy reads its notes from the earlier trial (written by Bo / Cy)",
      not err4 and {(e["agent"], e["author"]) for e in _lr} == {("bo", "bo"), ("cy", "cy")}, err4 or str(len(_lr)))
check("session learning: Bo's revision prompt contains the earlier trial's lesson", bool(_win) and any(_win in c for c in _bo_ctx), f"{len(_bo_ctx)} prompts")
# the pre-run budget estimate (used to reject proposals before running) must match the run's staff + running costs
e0 = exps["E0"]
est = tt.budget_of(tt.est_mean(e0["policy"]), e0["policy"])
check("town: pre-run budget estimate == run budget (no fees)", abs(est["net"] - e0["budget"]["net"]) <= 1, f"{est['net']} vs {e0['budget']['net']}")

sys.exit(1 if fails else 0)
