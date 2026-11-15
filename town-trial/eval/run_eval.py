"""Evaluation runner: drives the deployed backend and aggregates the results.

    python town-trial/eval/run_eval.py compare     # 4-way comparison, both trial types, several towns
    python town-trial/eval/run_eval.py ablation    # Exa ablation (see exa_ablation.py)
    python town-trial/eval/run_eval.py summarize   # re-aggregate saved trials

Every trial's full event log is saved under eval/results/trials/<trial_id>.json, so every
number in the summaries can be traced to the run that produced it.

The comparison (matched budgets, frozen picks, held-out scenarios fixed in advance):
  - current practice (baseline), your idea (the user's policy, as translated by Bo),
  - parameter sweep (6 fixed configs), one-shot LLM (same model and evidence, 1 proposal, no feedback),
  - iterative agent (best approved revision after 2 failure -> search -> revise rounds).
Each finalist is frozen, then run on held-out scenarios A (more shift workers), B (older town),
C (busier library), seeds 100-107: residents and seeds never seen during search.
"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

API = "https://constant-lab--town-trial-api-web.us-east.modal.run"
OUT = Path(__file__).resolve().parent / "results"
TRIALS = OUT / "trials"
TOWNS = ["Evart, MI", "Marfa, TX", "Ely, MN", "Hood River, OR"]
PROMPTS = {
    "service": "Extend library hours two evenings a week to reach residents who work during the day",
    "perception": "Will working parents hear about the new library hours if we only post the notice online?",
}
ARMS = {"current practice": "baseline", "your idea": "user", "parameter sweep": "sweep", "one-shot": "oneshot", "iterative agent": "agent"}


def _req(method: str, path: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def run_trial(city: str, mode: str, options: dict | None = None, tag: str = "") -> dict:
    """Start a trial (retrying while the backend's concurrency cap is full) and wait for it to finish."""
    while True:
        try:
            start = _req("POST", "/api/trials", {"city": city, "prompt": PROMPTS[mode], "options": options or {}})
            break
        except urllib.error.HTTPError as ex:
            if ex.code != 429:
                raise
            time.sleep(10)
    tid, t0 = start["trial_id"], time.time()
    while True:
        d = _req("GET", f"/api/trials/{tid}/events?since=0")
        if d["done"] or time.time() - t0 > 900:
            break
        time.sleep(4)
    rec = {"trial_id": tid, "city": city, "mode": mode, "options": options or {}, "tag": tag, "version": start.get("version"),
           "wall_s": round(time.time() - t0, 1), "done": d["done"], "events": d["events"]}
    TRIALS.mkdir(parents=True, exist_ok=True)
    (TRIALS / f"{tid}.json").write_text(json.dumps(rec, indent=1))
    print(f"  {tag:<10} {mode:<10} {city:<16} {tid} {rec['wall_s']}s done={d['done']}", flush=True)
    return rec


def run_many(specs: list[tuple]) -> list[dict]:
    with ThreadPoolExecutor(3) as ex:  # the backend caps concurrent trials at 3
        return list(ex.map(lambda s: run_trial(*s), specs))


# ---------- analysis ----------
def analyse(rec: dict) -> dict | None:
    ev = rec["events"]
    exps: dict[str, dict] = {}
    for e in ev:
        if e["type"] == "EXPERIMENT":
            exps[e["id"]] = e
    table = next((e for e in ev if e["type"] == "HELD_OUT_TABLE"), None)
    brief = next((e for e in ev if e["type"] == "BRIEF"), None)
    if not table:
        return None
    arms = {}
    for f in table["finalists"]:
        arm = ARMS.get(f["role"], f["role"])
        vals = [row[f["id"]] for row in table["table"]]
        x = exps.get(f["id"], {})
        hours = (x.get("policy") or {}).get("hours")
        arms[arm] = {"id": f["id"], "label": f["label"], "feasible": f["feasible"], "held_out_mean": sum(vals) / len(vals), "held_out": vals,
                     "search_mean": (x.get("result") or {}).get("mean", {}), "source": x.get("source"),
                     "staff_hours": sum((h[1] - h[0]) / 60 for h in hours if h) * 2 if hours else None}
    if "user" not in arms and "baseline" in arms and "your idea" in (arms["baseline"]["label"] or "").lower():
        arms["user"] = dict(arms["baseline"])  # the user's idea was current practice
    runs = {"agent": sum(1 for x in exps.values() if x["role"] == "revision" and x.get("result")),
            "agent_proposed": sum(1 for x in exps.values() if x["role"] == "revision"),
            "agent_rejected": sum(1 for x in exps.values() if x["role"] == "revision" and x["status"] == "rejected"),
            "sweep": 6, "oneshot": 1}
    exa = [e for e in ev if e["type"] == "EXA"]
    feasible = {k: v for k, v in arms.items() if v["feasible"]}
    best_arm = max(feasible, key=lambda k: feasible[k]["held_out_mean"]) if feasible else None
    return {
        "trial_id": rec["trial_id"], "city": rec["city"], "mode": rec["mode"], "options": rec["options"], "metric": table["metric"],
        "arms": arms, "runs": runs, "best_held_out_arm": best_arm, "recommended": brief and brief.get("recommend"),
        "exa_calls": len(exa), "exa_live": sum(1 for e in exa if not e.get("fixture")),
        "verified_facts": sum(1 for e in ev if e["type"] == "MEMORY_WRITE" and e.get("agent") == "ada" and not str(e.get("source", "")).startswith("fixture")),
        "constraints": [e["constraint"] for e in ev if e["type"] == "CONSTRAINT"],
        "constraint_sources": sorted({e["source"] for e in ev if e["type"] == "CONSTRAINT"}),
        "gaps": sum(1 for e in ev if e["type"] == "NOTE" and str(e.get("message", "")).startswith("Gap")),
        "scripted_fallbacks": sum(1 for e in ev if e["type"] == "NOTE" and "scripted step" in str(e.get("message", ""))),
        "memory_fallbacks": sum(1 for e in ev if e["type"] == "NOTE" and e.get("store") == "local-fallback"),
        "llm_errors": [e["message"] for e in ev if e["type"] == "NOTE" and e.get("level") == "error"],
    }


def load(tag: str) -> list[dict]:
    out = []
    for p in sorted(TRIALS.glob("*.json")):
        rec = json.loads(p.read_text())
        if rec.get("tag") == tag:
            a = analyse(rec)
            if a:
                out.append(a)
    return out


def summarize_compare() -> dict:
    rows = load("compare")
    summary = {}
    for mode in ("service", "perception"):
        rs = [r for r in rows if r["mode"] == mode]
        if not rs:
            continue
        arm_stats = {}
        for arm in ("baseline", "user", "sweep", "oneshot", "agent"):
            vals = [r["arms"][arm]["held_out_mean"] for r in rs if arm in r["arms"]]
            gains = [r["arms"][arm]["held_out_mean"] - r["arms"]["baseline"]["held_out_mean"] for r in rs if arm in r["arms"] and "baseline" in r["arms"]]
            arm_stats[arm] = {"trials": len(vals), "held_out_mean": sum(vals) / len(vals) if vals else None,
                              "gain_over_baseline": sum(gains) / len(gains) if gains else None,
                              "infeasible": sum(1 for r in rs if arm in r["arms"] and not r["arms"][arm]["feasible"]),
                              "best_on_held_out": sum(1 for r in rs if r["best_held_out_arm"] == arm)}
        summary[mode] = {"metric": rs[0]["metric"], "trials": len(rs), "towns": [r["city"] for r in rs], "arms": arm_stats,
                         "agent_runs_mean": sum(r["runs"]["agent"] for r in rs) / len(rs),
                         "agent_rejected_total": sum(r["runs"]["agent_rejected"] for r in rs)}
    out = {"suite": "4-way comparison with matched budgets; picks frozen, then held-out scenarios A/B/C x seeds 100-107",
           "summary": summary, "trials": rows,
           "budgets": {"sweep": "6 fixed configurations x 16 seeds", "oneshot": "1 LLM proposal (same model, same baseline evidence) x 16 seeds",
                       "agent": "<= 4 approved revisions over 2 rounds x 16 seeds (actual count per trial in trials[].runs)",
                       "exa": "<= 6 calls per trial (agent arm uses 3)", "llm": "<= 20 calls per trial, same model for every arm"},
           "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    (OUT / "compare.json").write_text(json.dumps(out, indent=2))
    return out


def known_caps(rows: list[dict]) -> dict:
    """Staffing caps found for each town in ANY evaluated trial (with their sources)."""
    import re
    caps = {}
    for r in rows:
        for c in r["constraints"]:
            m = re.search(r"staff hours <= ([0-9.]+)", c)
            if m:
                caps.setdefault(r["city"], {"cap": float(m.group(1)), "sources": set()})["sources"].update(r["constraint_sources"])
    return {k: {"cap": v["cap"], "sources": sorted(v["sources"])} for k, v in caps.items()}


def summarize_ablation() -> dict:
    rows = [r for r in load("compare") if r["mode"] == "service"] + load("ablation")
    caps = known_caps(rows)
    for r in rows:  # judge every arm's agent pick against the constraints found for its town in any trial
        a = r["arms"].get("agent")
        cap = caps.get(r["city"], {}).get("cap")
        r["agent_within_known_caps"] = None if not a or a.get("staff_hours") is None else (cap is None or a["staff_hours"] <= cap)
    arms = {}
    for r in rows:
        arms.setdefault(r["options"].get("exa_mode", "failure"), []).append(r)
    stats = {}
    for m, rs in arms.items():
        n = len(rs)
        stats[m] = {"trials": n, "towns": [r["city"] for r in rs],
                    "exa_calls_mean": sum(r["exa_calls"] for r in rs) / n,
                    "verified_facts_mean": sum(r["verified_facts"] for r in rs) / n,
                    "trials_with_constraint": sum(1 for r in rs if r["constraints"]),
                    "gaps_mean": sum(r["gaps"] for r in rs) / n,
                    "agent_held_out_mean": (lambda v: sum(v) / len(v) if v else None)([r["arms"]["agent"]["held_out_mean"] for r in rs if "agent" in r["arms"]]),
                    "agent_feasible": sum(1 for r in rs if "agent" in r["arms"] and r["arms"]["agent"]["feasible"]),
                    "agent_within_known_caps": sum(1 for r in rs if r.get("agent_within_known_caps")),
                    "agent_held_out_mean_within_known_caps": (lambda v: sum(v) / len(v) if v else None)(
                        [r["arms"]["agent"]["held_out_mean"] for r in rs if r.get("agent_within_known_caps")])}
    out = {"suite": "Exa ablation (service trials): none vs broad vs failure-guided, equal query budgets",
           "arms": stats, "known_caps": caps,
           "note": ("Agent picks are also judged against staffing caps found for the same town in any arm: an arm that never searched "
                    "for the cap can propose schedules a real budget rules out, which inflates its held-out score."),
           "trials": rows, "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    (OUT / "exa_ablation.json").write_text(json.dumps(out, indent=2))
    return out


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "summarize"
    if cmd == "compare":
        run_many([(t, m, {}, "compare") for m in ("service", "perception") for t in TOWNS])
    elif cmd == "ablation":
        run_many([(t, "service", {"exa_mode": em}, "ablation") for em in ("none", "broad") for t in TOWNS])
    s1, s2 = summarize_compare(), summarize_ablation()
    print(json.dumps(s1["summary"], indent=1))
    print(json.dumps(s2["arms"], indent=1))


if __name__ == "__main__":
    main()
