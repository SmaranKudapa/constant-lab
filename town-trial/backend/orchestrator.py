"""One research trial: the agents' step order, written to the event log.

M1: this is a faithful port of web/js/research.js. The agents' words are
scripted (events carry `scripted: true`) and the evidence is FIXTURE data, but
every number comes from real simulator runs fanned out through `Runner`.
M2/M3 swap the scripted steps for live Exa, LLM and past.dev calls.
"""
from __future__ import annotations

import traceback

from agents import fixtures
from events import EventStore
from policy import BASELINE_HOURS, H, days_for, fixed, hours_text, hours_with, primary, staff_hours
from sim import Runner

SEEDS = 16        # matched seeds per experiment
SWEEP_BUDGET = 6  # runs the parameter sweep may spend
HELD_OUT_SEEDS = list(range(100, 108))
ROLE_NAME = {"baseline": "current practice", "user": "your idea", "sweep": "parameter sweep", "oneshot": "one-shot", "revision": "iterative agent"}
EXP_FIELDS = ["id", "label", "role", "parent", "policy", "change", "source", "status", "result", "best"]


class Stopped(Exception):
    pass


class Trial:
    def __init__(self, store: EventStore, trial_id: str, city: str, prompt: str, mode: str, runner: Runner):
        self.store, self.id, self.city, self.prompt, self.mode, self.runner = store, trial_id, city, prompt, mode, runner
        self.P = primary(mode)
        self.days = days_for(mode)
        self.exps: list[dict] = []
        self.constraint = None  # (text, fn(exp) -> bool)

    # ---------- logging ----------
    def emit(self, type_: str, agent: str | None = None, say: str | None = None, **fields) -> dict:
        if self.store.stopped(self.id):
            raise Stopped()
        if agent:
            fields["agent"] = agent
        if say:
            fields["say"] = say
        return self.store.append(self.id, type_, fields)

    def note(self, message: str, level: str = "warn", **extra) -> None:
        self.emit("NOTE", level=level, message=message, **extra)

    # ---------- experiments ----------
    def publish(self, x: dict) -> None:
        self.emit("EXPERIMENT", **{k: x.get(k) for k in EXP_FIELDS})

    def exp(self, **e) -> dict:
        x = {"status": "queued", "result": None, "best": False, "source": None, "parent": None, **e}
        self.exps.append(x)
        self.publish(x)
        return x

    def set(self, x: dict, **changes) -> None:
        x.update(changes)
        self.publish(x)

    def get(self, exp_id: str) -> dict | None:
        return next((x for x in self.exps if x["id"] == exp_id), None)

    def job(self, key: str, policy: dict, seeds=SEEDS, scenario: dict | None = None) -> dict:
        j = {"key": key, "city": self.city, "mode": self.mode, "policy": policy, "seeds": seeds, "days": self.days}
        if scenario:
            j["scenario"] = scenario
        return j

    def fanout(self, jobs: list[dict]) -> dict:
        out = self.runner.run(jobs)
        if out["error"]:
            self.note(f"Modal fan-out failed ({out['error']}); ran the batch in the orchestrator instead.", agent="dee")
        return out

    def run(self, xs: list[dict], say: str | None = None) -> dict:
        """RUN_START, then fan out every experiment in xs over matched seeds."""
        jobs = [self.job(x["id"], x["policy"]) for x in xs]
        for x in xs:
            self.set(x, status="running")
        self.emit("RUN_START", agent="dee", say=say, exps=[x["id"] for x in xs], seeds=SEEDS,
                  workers=len(self.runner.plan(jobs)), where=self.runner.where)
        out = self.fanout(jobs)
        for x in xs:
            res = out["results"][x["id"]]
            ok = self.constraint is None or self.constraint[1](x)
            self.set(x, result=res, status="done" if ok else "infeasible")
        return out

    def fmt(self, x: dict) -> str:
        r = x.get("result")
        if not r:
            return "-"
        k = self.P["key"]
        return f"{fixed(r['mean'][k])}{self.P['unit']} ± {fixed(r['sd'][k])}"

    def value(self, x: dict) -> float:
        return x["result"]["mean"][self.P["key"]]

    def exa(self, agent: str, query: str, kind: str, results: list[dict], used_for: str, say: str | None = None) -> None:
        self.emit("EXA", agent=agent, say=say, query=query, search=kind, results=results, used_for=used_for, fixture=True)

    # ---------- the loop ----------
    def start(self) -> None:
        if self.mode == "service":
            self.service()
        else:
            self.perception()

    def service(self) -> None:
        city, P = self.city, self.P
        proposal = hours_with([(1, H(10), H(21)), (3, H(10), H(21))])
        shift = hours_with([(1, H(13), H(21)), (3, H(13), H(21))])
        shift3 = hours_with([(1, H(13), H(21)), (3, H(13), H(21)), (5, H(12), H(20))])

        self.emit("CLAIM", agent="bo", say="Writing the testable claim", scripted=True,
                  claim=f"In {city}, opening the library until 21:00 on Tue and Thu increases weekly visits by residents who cannot use current hours.",
                  metric=P["label"], constraint="staff hours (unknown yet)", horizon=f"1 week, {SEEDS} matched seeds", prompt=self.prompt)
        self.emit("MEMORY_READ", agent="eli", say="Recalling memory for this town", query=f"{city} library", found=0,
                  note="No prior facts for this town. Starting fresh.", store="scripted")
        self.exa("ada", f"{city} public library opening hours", "broad", fixtures.library_hours(city), "Baseline hours for the simulator",
                 say="Searching: current library hours")
        self.emit("MEMORY_WRITE", agent="ada", say="Saving the baseline to shared memory", source_id="fact-library-hours", kind="fact",
                  claim="Library open Mon-Sat 10:00-18:00, closed Sun", effective="2026-09-01", supersedes=None,
                  source="fixture://library-hours", store="scripted")
        self.emit("MEMORY_READ", agent="bo", say="Reading Ada's fact, building runs", source_id="fact-library-hours", author="ada",
                  claim="Library open Mon-Sat 10:00-18:00, closed Sun", used_for="baseline policy E0", store="scripted")
        E0 = self.exp(id="E0", label="Current hours", role="baseline", policy={"hours": BASELINE_HOURS}, change="none (current practice)")
        E1 = self.exp(id="E1", label="Your idea: Tue/Thu until 21:00", role="user", parent="E0", policy={"hours": proposal}, change=hours_text(proposal))
        self.emit("PROPOSE", agent="bo", scripted=True, exp="E1", parent="E0", change=E1["change"],
                  why="The user's proposal, translated into supported actions (open/close times).")
        self.emit("REVIEW", agent="cy", say="Checking E1's assumptions", scripted=True, exp="E1", ok=True,
                  reason="Supported actions only. Flag: needs 12 more staff hours a week, and staffing is an unverified input.")

        out = self.run([E0, E1], say="Fanning E0 + E1 out to Modal")
        for x, view in ((E0, None), (E1, "E1")):
            self.emit("RUN_DONE", agent="dee", exp=x["id"], metric=P["key"], value=self.fmt(x), staff_hours=staff_hours(x["policy"]["hours"]),
                      turned_away=fixed(x['result']['mean']['turnedAway']), wall_s=out["wall_s"], workers=out["workers"], view=view)

        self.emit("FAILURE", agent="cy", say="E1 works, but can we staff it?", scripted=True, exp="E1",
                  trace=f"E1 beats E0 ({self.fmt(E1)} vs {self.fmt(E0)}), but uses {staff_hours(E1['policy']['hours'])} staff hours vs "
                        f"{staff_hours(E0['policy']['hours'])}. The ranking depends on an input nobody has checked.",
                  next_question="Is extra evening staffing allowed this fiscal year?")
        self.exa("ada", f"{city} library board meeting minutes staffing budget evening hours 2026", "failure-guided", fixtures.board_minutes(city),
                 "Adds constraint: staff hours <= current (96/week)", say="Failure-guided search: staffing")
        cap = staff_hours(BASELINE_HOURS)
        self.constraint = (f"staff hours <= {cap}/week", lambda x: staff_hours(x["policy"]["hours"]) <= cap)
        self.emit("CONSTRAINT", agent="ada", scripted=True, constraint=self.constraint[0], source="fixture://board-minutes", previous="unknown",
                  changes=["E1 is now infeasible"])
        self.emit("MEMORY_WRITE", agent="ada", source_id="fact-staffing-cap", kind="constraint", claim="No new staff hours in FY2027",
                  effective="2026-10-14", supersedes=None, source="fixture://board-minutes", store="scripted")
        self.set(E1, status="infeasible")

        self.emit("MEMORY_READ", agent="bo", say="Reading the cap, rethinking", source_id="fact-staffing-cap", author="ada",
                  claim="No new staff hours in FY2027", used_for=f"revision must keep staff hours at {cap}", store="scripted")
        E2 = self.exp(id="E2", label="Assume evening demand doubles", role="revision", parent="E1", policy={"hours": proposal}, change="E1 + assume 2x evening demand")
        self.emit("PROPOSE", agent="bo", scripted=True, exp="E2", parent="E1", change=E2["change"], why="A blog post says evening hours doubled visits elsewhere.")
        self.set(E2, status="rejected")
        self.emit("REVIEW", agent="cy", say="Rejecting E2: not local evidence", scripted=True, exp="E2", ok=False,
                  reason="Changes a demand input from an out-of-town anecdote with no local evidence. Results elsewhere are hypotheses, not model inputs.")
        E3 = self.exp(id="E3", label="Shift Tue/Thu to 13:00-21:00", role="revision", parent="E1", policy={"hours": shift}, change=hours_text(shift),
                      source="fixture://board-minutes")
        self.emit("PROPOSE", agent="bo", scripted=True, exp="E3", parent="E1", change=E3["change"],
                  why=f"Same {cap} staff hours: move the morning hours on Tue/Thu to the evening.")
        self.emit("REVIEW", agent="cy", say="E3 approved", scripted=True, exp="E3", ok=True, reason=f"Supported actions, staff hours unchanged ({cap}).")
        out = self.run([E3], say="Running E3")
        self.emit("RUN_DONE", agent="dee", exp="E3", metric=P["key"], value=self.fmt(E3), staff_hours=staff_hours(shift),
                  turned_away=fixed(E3['result']['mean']['turnedAway']), wall_s=out["wall_s"], workers=out["workers"], view="E3")
        self.emit("FAILURE", agent="cy", say="Inspecting E3's turned-away log", scripted=True, exp="E3",
                  trace="Mornings lost on Tue/Thu cost some daytime visits. Many residents who work Saturdays are still turned away.",
                  next_question="Would moving Saturday later reach them?")
        E4 = self.exp(id="E4", label="E3 + Saturday 12:00-20:00", role="revision", parent="E3", policy={"hours": shift3}, change=hours_text(shift3))
        self.emit("PROPOSE", agent="bo", say="Proposing E4: add a later Saturday", scripted=True, exp="E4", parent="E3", change=E4["change"],
                  why=f"Keeps {cap} staff hours; targets Saturday workers seen in E3's trace.")
        self.emit("REVIEW", agent="cy", scripted=True, exp="E4", ok=True, reason="Supported actions, staff hours unchanged.")
        out = self.run([E4])
        self.emit("RUN_DONE", agent="dee", exp="E4", metric=P["key"], value=self.fmt(E4), staff_hours=staff_hours(shift3),
                  turned_away=fixed(E4['result']['mean']['turnedAway']), wall_s=out["wall_s"], workers=out["workers"])

        # Baselines with matched budgets: sweep (6 configs fanned out together) and one-shot
        options = []
        for days in ([1], [3], [5], [1, 3], [2, 4], [1, 3, 5], [0, 2], [4, 5]):
            for open_ in (H(12), H(13)):
                options.append([(d, open_, open_ + H(8)) for d in days])
        sweep = [{"key": f"S{k + 1}", "hours": hours_with(c)} for k, c in enumerate(options[:SWEEP_BUDGET])]
        OS = self.exp(id="OS", label="One-shot proposal", role="oneshot", parent="E0", policy={"hours": hours_with([(5, H(12), H(20))])},
                      change="Sat 12:00-20:00 (single proposal, no feedback)")
        jobs = [self.job(s["key"], {"hours": s["hours"]}) for s in sweep] + [self.job("OS", OS["policy"])]
        self.emit("RUN_START", agent="dee", say="Running the baselines", exps=[s["key"] for s in sweep] + ["OS"], seeds=SEEDS,
                  workers=len(self.runner.plan(jobs)), where=self.runner.where)
        out = self.fanout(jobs)
        best = max(sweep, key=lambda s: out["results"][s["key"]]["mean"][P["key"]])
        ok = lambda pol: self.constraint[1]({"policy": pol})
        SW = self.exp(id="SW", label=f"Sweep best of {SWEEP_BUDGET}", role="sweep", parent="E0", policy={"hours": best["hours"]}, change=hours_text(best["hours"]))
        self.set(SW, result=out["results"][best["key"]], status="done" if ok(SW["policy"]) else "infeasible")
        self.set(OS, result=out["results"]["OS"], status="done" if ok(OS["policy"]) else "infeasible")
        self.emit("RUN_DONE", agent="dee", exp="SW", metric=P["key"], value=self.fmt(SW), note=f"best of {SWEEP_BUDGET} sweep configs",
                  wall_s=out["wall_s"], workers=out["workers"])
        self.emit("RUN_DONE", agent="dee", exp="OS", metric=P["key"], value=self.fmt(OS), wall_s=out["wall_s"], workers=out["workers"])
        agent_pick = max([E3, E4], key=self.value)
        self.held_out_and_brief([E0, E1, SW, OS, agent_pick])

    def perception(self) -> None:
        city, P = self.city, self.P
        info = self.runner.info(city)
        self.emit("CLAIM", agent="bo", say="Writing the testable claim", scripted=True,
                  claim=f"In {city}, posting the new library hours online only reaches most working parents within 3 days.",
                  metric=P["label"], constraint="no paid ads", horizon=f"3 days, {SEEDS} matched seeds", prompt=self.prompt)
        self.emit("AUDIENCE", agent="eli", say="Setting up past.dev audiences", op="bulk_replace_identities", count=info["n"],
                  note="One synthetic identity per resident with traits: cohort, channel, neighborhood.", store="scripted")
        self.emit("AUDIENCE", agent="eli", op="replace_audience", slug="heard-library-notice", kind="rule", rule="heard_library_notice = true", members=0, store="scripted")
        self.emit("AUDIENCE", agent="eli", op="replace_audience", slug="working-parents", kind="rule", rule="cohort = families",
                  members=info["byCohort"].get("families", 0), store="scripted")
        self.emit("MEMORY_WRITE", agent="eli", source_id="notice-library-hours", kind="notice", claim="New library hours notice",
                  audience="heard-library-notice", note="Only residents in this audience can recall the notice.", store="scripted")
        self.exa("ada", f"{city} library hours change announcement", "broad", fixtures.library_news(city), "Baseline channel: online post",
                 say="Searching: how this town gets news")
        P0 = self.exp(id="P0", label="Online post only", role="baseline", policy={"channels": ["online"]}, change="website + social post")
        out = self.run([P0], say="Running P0 on Modal")
        self.emit("RUN_DONE", agent="dee", exp="P0", metric=P["key"], value=self.fmt(P0), overall=fixed(P0['result']['mean']['awarePct'], 0) + "%",
                  wall_s=out["wall_s"], workers=out["workers"], view="P0")
        self.emit("FAILURE", agent="cy", say="Who did the notice miss?", scripted=True, exp="P0",
                  trace=f"Only {self.fmt(P0)} of working parents heard. Most parents are offline during the day and learn by word of mouth, if at all.",
                  next_question="What channel reaches parents during the school run?")
        self.exa("ada", f"{city} elementary school weekly family bulletin newsletter", "failure-guided", fixtures.school_bulletin(city),
                 "New channel: school bulletin reaches families at drop-off/pickup", say="Failure-guided search: school channels")
        self.emit("MEMORY_WRITE", agent="ada", source_id="fact-school-bulletin", kind="fact", claim="School sends a weekly family bulletin",
                  source="fixture://school-bulletin", supersedes=None, store="scripted")
        self.emit("MEMORY_READ", agent="bo", say="Using Ada's find: two revisions", source_id="fact-school-bulletin", author="ada",
                  claim="School sends a weekly family bulletin", used_for="revision P2", store="scripted")
        P1 = self.exp(id="P1", label="+ notice board on the square", role="revision", parent="P0", policy={"channels": ["online", "board"]}, change="online + plaza notice board")
        P2 = self.exp(id="P2", label="+ school bulletin", role="revision", parent="P0", policy={"channels": ["online", "bulletin"]}, change="online + school bulletin",
                      source="fixture://school-bulletin")
        self.emit("PROPOSE", agent="bo", scripted=True, exp="P1", parent="P0", change=P1["change"], why="Paper notice for residents who don't use the website.")
        self.emit("PROPOSE", agent="bo", scripted=True, exp="P2", parent="P0", change=P2["change"], why="Reaches parents at drop-off, per Ada's source.")
        self.emit("REVIEW", agent="cy", scripted=True, exp="P1", ok=True, reason="Supported channel.")
        self.emit("REVIEW", agent="cy", scripted=True, exp="P2", ok=True, reason="Supported channel; source is local.")
        P3 = self.exp(id="P3", label="Assume 90% open the email", role="revision", parent="P2", policy={"channels": ["online", "bulletin"]}, change="P2 + assume 90% open rate")
        self.emit("PROPOSE", agent="bo", scripted=True, exp="P3", parent="P2", change=P3["change"], why="Industry average says emails get read.")
        self.set(P3, status="rejected")
        self.emit("REVIEW", agent="cy", scripted=True, exp="P3", ok=False, reason="Open rate is not in any local source. Keep it as a labelled sensitivity range, not an input.")
        out = self.run([P1, P2], say="Running P1 + P2")
        for x, view in ((P1, None), (P2, "P2")):
            self.emit("RUN_DONE", agent="dee", exp=x["id"], metric=P["key"], value=self.fmt(x), overall=fixed(x['result']['mean']['awarePct'], 0) + "%",
                      wall_s=out["wall_s"], workers=out["workers"], view=view)

        combos = [["online", "board"], ["online", "bulletin"], ["online", "board", "bulletin"], ["board"], ["bulletin"], ["online"]][:SWEEP_BUDGET]
        OS = self.exp(id="OS", label="One-shot proposal", role="oneshot", parent="P0", policy={"channels": ["online", "board"]}, change="online + notice board (no feedback)")
        jobs = [self.job(f"S{k + 1}", {"channels": c}) for k, c in enumerate(combos)] + [self.job("OS", OS["policy"])]
        self.emit("RUN_START", agent="dee", exps=[j["key"] for j in jobs], seeds=SEEDS, workers=len(self.runner.plan(jobs)), where=self.runner.where)
        out = self.fanout(jobs)
        k_best = max(range(len(combos)), key=lambda k: out["results"][f"S{k + 1}"]["mean"][P["key"]])
        SW = self.exp(id="SW", label=f"Sweep best of {len(combos)}", role="sweep", parent="P0", policy={"channels": combos[k_best]}, change=" + ".join(combos[k_best]))
        self.set(SW, result=out["results"][f"S{k_best + 1}"], status="done")
        self.set(OS, result=out["results"]["OS"], status="done")
        self.emit("RUN_DONE", agent="dee", exp="SW", metric=P["key"], value=self.fmt(SW), note=f"best of {len(combos)} channel combos",
                  wall_s=out["wall_s"], workers=out["workers"])
        self.held_out_and_brief([P0, SW, OS, max([P1, P2], key=self.value)])

    def held_out_and_brief(self, finalists: list[dict]) -> None:
        city, P = self.city, self.P
        scenarios = [
            {"name": "Held-out A: more shift workers", "seed": city + ":A", "mix": {"night-shift": 0.2, "day-workers": 0.35}},
            {"name": "Held-out B: older town", "seed": city + ":B", "mix": {"seniors": 0.3, "students": 0.06}},
            {"name": "Held-out C: busier library", "seed": city + ":C", "interestMult": 0.7},
        ]
        jobs = [self.job(f"{i}:{f['id']}", f["policy"], seeds=HELD_OUT_SEEDS, scenario=sc) for i, sc in enumerate(scenarios) for f in finalists]
        self.emit("RUN_START", agent="dee", say="Freezing picks, testing held-out towns", exps=[f["id"] for f in finalists], seeds=len(HELD_OUT_SEEDS),
                  workers=len(self.runner.plan(jobs)), where=self.runner.where, held_out=True)
        out = self.fanout(jobs)
        table = []
        for i, sc in enumerate(scenarios):
            row = {"scenario": sc["name"]}
            for f in finalists:
                row[f["id"]] = out["results"][f"{i}:{f['id']}"]["mean"][P["key"]]
            table.append(row)
        self.emit("HELD_OUT", agent="cy", scenarios=len(scenarios), seeds=len(HELD_OUT_SEEDS), finalists=[f["id"] for f in finalists],
                  note="Policies frozen before testing. Residents and seeds not seen during search.", wall_s=out["wall_s"], workers=out["workers"])
        self.emit("HELD_OUT_TABLE", agent="cy", metric=P["label"], table=table,
                  finalists=[{"id": f["id"], "label": f["label"], "role": ROLE_NAME.get(f["role"], f["role"]), "feasible": f["status"] != "infeasible"} for f in finalists])

        feasible = [x for x in self.exps if x["result"] and x["status"] == "done"]
        best = max(feasible, key=self.value)
        self.set(best, best=True)
        base = self.exps[0]
        service = self.mode == "service"
        self.emit("BRIEF", agent="bo", say="Writing the decision brief", scripted=True, recommend=best["id"], label=best["label"],
                  summary=f"{best['label']}: {self.fmt(best)} vs {self.fmt(base)} for current practice ({P['label']}).",
                  assumptions="Arrival patterns are synthetic; staffing cap from a fixture source." if service else "Channel use and word-of-mouth rates are synthetic.",
                  pilot="Pilot for 4 weeks; count evening visitors and ask whether they could have come before 18:00." if service
                  else "Ask the school to include the notice for 2 weeks; survey parents at pickup.")


def run_trial(store: EventStore, trial_id: str, city: str, prompt: str, mode: str, runner: Runner) -> None:
    trial = Trial(store, trial_id, city, prompt, mode, runner)
    try:
        trial.start()
        store.finish(trial_id)
    except Stopped:
        store.append(trial_id, "NOTE", {"level": "info", "message": "Trial stopped by the user."})
        store.finish(trial_id, stopped=True)
    except Exception as ex:
        store.append(trial_id, "NOTE", {"level": "error", "message": f"Trial failed: {type(ex).__name__}: {ex}", "trace": traceback.format_exc()[-1500:]})
        store.finish(trial_id, error=str(ex))
