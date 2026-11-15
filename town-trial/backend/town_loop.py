"""The general research loop ("town" mode): any question about a real town's public places, with budgets.

Builds on research_loop.LiveTrial (Exa search, grounded extraction, past.dev memory, reviews, labelled
fallbacks) and changes what is being decided:
- Athena frames the question first: which metric (visits, unique visitors, visits by people who can't make the
  current hours, turned away, awareness, net cost), for which place / kind of place / resident group, and any
  budget limit the user stated. Ideas no supported action can test get a research brief, not a number.
- Policies can change any public place (hours, capacity, fee, closing), open a new place next to an existing
  one, and send a notice through outreach channels. Actions are validated in code.
- Every experiment gets an annual budget (backend/budget.py): staff, running costs, fee revenue, campaign.
  Budget limits from the user's question or from sources Exa Dude finds are constraints checked in code.
"""
from __future__ import annotations

import json

import budget as B
from agents import bo as bo_mod
from agents.ada import extract_budget, extract_place_hours
from orchestrator import HELD_OUT_SEEDS, ROLE_NAME, SEEDS, SWEEP_BUDGET
from policy import DAYS, H, apply_changes, describe_town, fixed, town_policy, validate_town_action
from research_loop import LiveTrial
from agents import comparables as CMP
from agents import treasurer as TR
import town_profile as TP

KIND_LABEL = {"library": "library", "clinic": "clinic", "pharmacy": "pharmacy", "community": "community centre", "sports": "sports ground",
              "park": "park", "post_office": "post office", "townhall": "town hall"}
COHORT_LABEL = {"day-workers": "day workers", "families": "working parents", "seniors": "seniors", "students": "students",
                "night-shift": "night-shift workers", "remote": "remote workers"}
PLURAL = {"library": "libraries", "clinic": "clinics", "pharmacy": "pharmacies", "community": "community centres", "sports": "sports grounds",
          "park": "parks", "post_office": "post offices", "townhall": "town halls"}
DIRECTION = {"visits": 1, "unique_visitors": 1, "visits_restricted": 1, "awareness": 1, "turned_away": -1, "net_cost": -1}


def _hm(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


class TownTrial(LiveTrial):
    """mode == "town"."""

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self.fac: dict = {}
        self.places: dict = {}
        self.defaults: dict = {}
        self.target = None
        self.metric = "visits"
        self.wage, self.wage_source = B.DEFAULT_WAGE, "model default ($25/staff hour incl. benefits)"
        self.base_budget = None
        self.awareness = False
        self.cases: list[dict] = []        # verified similar-town cases (Exa Dude)
        self.budget_docs: list[dict] = []  # verified budget statements for Apollo
        self.max_rounds = 3                # research rounds, capped so a live trial stays short

    # ---------- the town ----------
    def town_text(self) -> str:
        lines = []
        for f in self.fac.values():
            hrs = ", ".join(f"{DAYS[d]} {_hm(x[0])}-{_hm(x[1])}" if x else f"{DAYS[d]} closed" for d, x in enumerate(f["hours"]))
            lines.append(f"- {f['id']} ({f['kind']}): {f['name']}; hours [{f['hoursSource']}]: {hrs}; capacity {f['capacity']}; staff/hour {f['staff']}; fee ${f['fee']}")
        others = [f"{i} ({n})" for i, n in list(self.places.items())[:25] if i not in self.fac]
        return "\n".join(lines) + "\nOther places (for 'near'): " + ", ".join(others)

    def load_info(self) -> None:
        info = self.runner.info_full(self.city, spec=self.spec)
        self.info = info
        self.fac = {f["id"]: dict(f) for f in info.get("facilities", [])}
        self.places = {p["id"]: p["name"] for p in info.get("places", [])}
        self.defaults = info.get("defaults", {})
        self.scale = B.scale_of(self.spec, info["residents"]["n"])
        c = (self.spec or {}).get("census") or {}
        self.income = (c.get("median_income") or 70000) / 70000

    # ---------- metric ----------
    def set_metric(self, fr: dict) -> None:
        m, kind, cohort, tgt = fr["metric"], fr.get("kind"), fr.get("cohort"), fr.get("target")
        if tgt not in self.fac:
            tgt = None
        if m in ("visits_restricted", "turned_away") and not tgt:
            tgt = next((f for f in self.fac if self.fac[f]["kind"] == (kind or "library")), None) or next(iter(self.fac), None)
        self.target, self.metric = tgt, m
        tname = self.fac[tgt]["name"] if tgt else None
        who = COHORT_LABEL.get(cohort, "residents") if cohort else "residents"
        where = (tname if tgt and not kind else PLURAL.get(kind, f"{kind}s") if kind else "all public places")
        if m == "visits":
            key = f"visits.kc.{kind}.{cohort}" if kind and cohort else f"visits.k.{kind}" if kind else f"visits.f.{tgt}" if tgt else (f"visits.c.{cohort}" if cohort else "visits")
            label, unit = f"visits/week by {who} to {where}", ""
        elif m == "unique_visitors":
            key, label, unit = (f"unique.k.{kind}" if kind else "unique"), f"residents (of the sample) who visit {where} in a week", ""
        elif m == "visits_restricted":
            key, label, unit = "visits.restricted", f"visits/week to {tname} by residents who can't make its current hours", ""
        elif m == "turned_away":
            key, label, unit = (f"turnedAway.f.{tgt}" if tgt else "turnedAway"), f"trips turned away at {tname or where} per week (lower is better)", ""
        elif m == "awareness":
            key, label, unit = (f"awarePct.c.{cohort}" if cohort else "awarePct"), f"% of {who} who heard the notice within 3 days", "%"
        else:
            key, label, unit = "budget.net", "net annual cost (lower is better)", ""
        self.awareness = m == "awareness"
        self.days = 3 if self.awareness else 7
        self.P = {"key": key, "label": label, "unit": unit, "dir": DIRECTION[m], "metric": m, "target": tgt, "kind": kind}

    def mval(self, mean: dict, policy: dict) -> float:
        if self.P["key"] == "budget.net":
            return float(self.budget_of(mean, policy)["net"])
        return float(mean.get(self.P["key"], 0.0))

    def fmt(self, x: dict) -> str:
        r = x.get("result")
        if not r:
            return "-"
        if self.P["key"] == "budget.net":
            return B.fmt_usd(self.mval(r["mean"], x["policy"])) + "/yr"
        return f"{fixed(r['mean'].get(self.P['key'], 0))}{self.P['unit']} ± {fixed(r['sd'].get(self.P['key'], 0))}"

    def value(self, x: dict) -> float:
        return self.P["dir"] * self.mval(x["result"]["mean"], x["policy"])

    # ---------- budgets and constraints ----------
    def budget_of(self, mean: dict, policy: dict) -> dict:
        return B.annual(mean, list(self.fac.values()), policy, self.scale, self.wage, self.spec, scope=self.scope)

    def set_scope(self, fr: dict) -> None:
        """Which places the budget covers: the target place for budget questions about it, else the town-run places."""
        bl = (fr.get("budget_limit") or {}).get("type", "none")
        if self.awareness and bl == "none":  # notice questions: only the campaign costs money
            self.scope, self.scope_label = set(), "outreach campaign cost"
            return
        if self.target and (self.metric == "net_cost" or bl in ("cut_pct", "max_increase_usd", "no_increase")):
            self.scope, self.scope_label = {self.target}, f"{self.fac[self.target]['name']} budget"
        else:
            private = ("yoga", "fitness", "gym", "crossfit", "boulder", "climbing", "studio", "club", "golf", "martial", "dance", "pilates")
            ids = {i for i, f in self.fac.items() if f["kind"] in B.TOWN_FUNDED and not any(w in f["name"].lower() for w in private)}
            self.scope, self.scope_label = ids, "budget of town-run places (" + ", ".join(sorted(self.fac[i]["name"] for i in ids))[:160] + ")"


    def est_mean(self, policy: dict) -> dict:
        """Deterministic part of a run (open and staff hours) from the policy alone, for checks before running."""
        mean, ov = {"staffHours": 0.0}, policy.get("facilities") or {}
        for f in list(self.fac.values()) + [dict(self.defaults.get(a["kind"], {}), **a) for a in policy.get("add") or []]:
            o = ov.get(f["id"], {})
            hrs = o.get("hours", f.get("hours")) or []
            oh = 0 if o.get("closed") else sum((x[1] - x[0]) / 60 for x in hrs if x)
            mean[f"openHours.f.{f['id']}"] = oh
            mean[f"staffHours.f.{f['id']}"] = oh * o.get("staff", f.get("staff", 1))  # budget.annual reads per-place staff hours
            mean["staffHours"] += mean[f"staffHours.f.{f['id']}"]
        return mean

    def set_budget_constraint(self, kind: str, value: float | None, source: str, why: str) -> None:
        base = self.base_budget or self.budget_of(self.est_mean(self.base_policy), self.base_policy)
        bn = base["net"]
        if kind == "no_increase":
            cap, text = bn + 1, f"net annual cost <= current ({B.fmt_usd(bn)})"
        elif kind == "max_increase_usd" and value:
            cap, text = bn + value, f"net annual cost <= current + {B.fmt_usd(value)} ({B.fmt_usd(bn + value)})"
        elif kind == "cut_pct" and value:
            cap, text = bn * (1 - value / 100), f"net annual cost <= current - {value:g}% ({B.fmt_usd(bn * (1 - value / 100))})"
        else:
            return
        self.constraint = (f"{text} [{why}]", lambda x, cap=cap: (x.get("budget") or self.budget_of(self.est_mean(x["policy"]), x["policy"]))["net"] <= cap)
        before = [x for x in self.exps if x.get("result") and x["status"] == "done"]
        broken = [x for x in before if not self.feasible(x)]
        self.emit("CONSTRAINT", agent="exa" if source.startswith("http") else "bo", constraint=self.constraint[0], source=source, previous="none",
                  changes=[f"{x['id']} is now infeasible" for x in broken] or ["no existing experiment breaks it"])
        for x in broken:
            self.set(x, status="infeasible")

    def constraints_text(self) -> str:
        t = self.constraint[0] if self.constraint else "no budget limit known"
        return t + ". Notice-channel existence (online/board/bulletin/newspaper/mailer) is labelled in code for every arm; do not reject a proposal for it."

    # ---------- runs ----------
    def run(self, xs: list[dict], say: str | None = None, trace: bool = False) -> dict:
        jobs = [self.job(x["id"], x["policy"]) for x in xs]
        for j in jobs:
            j["incomeFactor"] = self.income
            if trace:
                j["trace"] = True
        for x in xs:
            self.set(x, status="running")
        self.emit("RUN_START", agent="dee", say=say, exps=[x["id"] for x in xs], seeds=SEEDS, workers=len(self.runner.plan(jobs)), where=self.runner.where)
        out = self.fanout(jobs)
        for x in xs:
            res = dict(out["results"][x["id"]])
            if "trace" in res:
                x["_trace"] = res.pop("trace")
            x["budget"] = self.budget_of(res["mean"], x["policy"])
            x["result"] = res
            self.set(x, result=res, budget=x["budget"], status="done" if self.feasible(x) else "infeasible")
        return out

    def run_done(self, x: dict, out: dict, view: bool = False, note: str | None = None) -> None:
        b, m = x["budget"], x["result"]["mean"]
        d = (b["net"] - self.base_budget["net"]) if self.base_budget else 0
        extra = {"budget": f"{B.fmt_usd(b['net'])}/yr ({'+' if d >= 0 else ''}{B.fmt_usd(d)} vs now)" if self.base_budget else f"{B.fmt_usd(b['net'])}/yr"}
        if self.target and f"turnedAway.f.{self.target}" in m:
            extra["turned_away"] = fixed(m[f"turnedAway.f.{self.target}"])
        if self.awareness:
            extra["overall"] = fixed(m.get("awarePct", 0), 0) + "%"
        self.emit("RUN_DONE", agent="dee", exp=x["id"], metric=self.P["key"], value=self.fmt(x), wall_s=out["wall_s"], workers=out["workers"],
                  view=x["id"] if view else None, note=note or ("new best so far" if view and x["role"] == "revision" else None),
                  **({"tried": x["tried"], "explain": x.get("explain")} if x.get("tried") else {}), **extra)

    def job(self, key: str, policy: dict, seeds=SEEDS, scenario: dict | None = None) -> dict:
        j = super().job(key, policy, seeds, scenario)
        j["incomeFactor"] = getattr(self, "income", 1)
        return j

    # ---------- text for the agents ----------
    def results_text(self) -> str:
        rows = []
        for x in self.exps:
            if x.get("result"):
                rows.append(f"{x['id']} ({x['change']}): {self.fmt(x)}, budget {B.fmt_usd(x['budget']['net'])}/yr, status {x['status']}")
        return f"metric: {self.P['label']}. " + "; ".join(rows)

    def trace_text(self, x: dict) -> str:
        t = x.get("_trace") or {}
        n = t.get("seeds") or 1
        per = lambda d, k=6: ", ".join(f"{a} {fixed(v / n)}" for a, v in sorted((d or {}).items(), key=lambda kv: -kv[1])[:k]) or "none"  # noqa: E731
        m = (x.get("result") or {}).get("mean", {})
        if self.awareness:
            res = t.get("residentsByCohort") or {}
            aware = t.get("awareByCohort") or {}
            pct = ", ".join(f"{c} {fixed(100 * aware.get(c, 0) / n / max(1, k), 0)}%" for c, k in res.items())
            return f"{x['id']} after 3 days: aware by cohort: {pct}; learned via: {per(t.get('learnedVia'))}."
        slots = sorted((t.get("turnedAwayByDayHour") or {}).items(), key=lambda kv: -kv[1])[:5]
        fee = {k: v for k, v in m.items() if k.startswith("feeDeterred.k.")}
        return (f"{x['id']} per week (mean of {n} seeds): visits by place: {per(t.get('visitsByPlace'))}; turned away by place: "
                f"{per(t.get('turnedAwayByPlace'))}; turned away by cohort: {per(t.get('turnedAwayByCohort'))}; busiest turned-away slots: "
                f"{', '.join(f'{k} ({fixed(v / n)})' for k, v in slots) or 'none'}; deterred by fees: {fee or 'none'}; budget "
                f"{B.fmt_usd(x['budget']['net'])}/yr (staff {x['budget']['staff_hours_week']} h/wk at ${x['budget']['wage']:g}/h).")

    def policy_of(self, action: dict) -> dict:
        return town_policy(action, self.fac, self.defaults, self.target)

    def change_of(self, policy: dict) -> str:
        return describe_town(policy, self.fac, self.places)

    def _action(self, p: dict) -> dict:
        return {"facility_changes": p.get("facility_changes") or [], "new_facilities": p.get("new_facilities") or [], "channels": p.get("channels") or []}

    def validate(self, p: dict) -> str | None:
        return validate_town_action(self._action(p), self.fac, list(self.defaults), set(self.places))

    # ---------- reviews ----------
    def review(self, x: dict, why: str, trace: str = "") -> bool:
        if not self.feasible(x):
            est = self.budget_of(self.est_mean(x["policy"]), x["policy"])
            self.set(x, status="rejected")
            self.emit("REVIEW", agent="cy", exp=x["id"], ok=False, by="code",
                      reason=f"Breaks {self.constraint[0]} (checked in code): costs about {B.fmt_usd(est['net'])}/yr before fee revenue.")
            return False
        return super().review(x, why, trace)

    def feasible(self, x: dict) -> bool:
        return self.constraint is None or self.constraint[1](x)

    # ---------- the loop ----------
    def start(self) -> None:
        self.memory.ensure_agents()
        if self.exa_mode != "failure":
            self.note(f"Evaluation arm: exa_mode={self.exa_mode}.", level="info", agent="exa")
        self.recall_town()
        self.load_info()
        if not self.fac:
            self.note("This town has no mapped public places the model supports (library, clinic, pharmacy, community centre, sports, park, "
                      "post office, town hall); only outreach and new places can be tested.", agent="eli")
        self.base_policy = {"target": None}
        self.town_profile()
        fr = self.frame()
        if fr is None:
            return
        self.base_policy = {"target": self.target}
        self.learn_from_session()
        self.sourced_inputs()
        self.similar_towns(CMP.query_for(self.prompt, self.city), "broad", "Searching: similar towns")
        idea = fr["user_idea"]
        E0 = self.exp(id="E0", label="Current practice", role="baseline", policy=self.base_policy, change="none (current practice)", source=self.base_source)
        first = [E0]
        upol = self.policy_of(self._action(idea)) if not self.validate(idea) else None
        if upol and upol != self.base_policy:
            E1 = self.exp(id=self.next_id(), label=f"Your idea: {idea['label']}"[:60], role="user", parent="E0", policy=upol, change=self.change_of(upol))
            self.emit("PROPOSE", agent="bo", exp=E1["id"], parent="E0", change=E1["change"], why=idea["why"], scripted=bool(idea.get("scripted")))
            self.cy_check_user(E1, idea["why"])
            self.treasurer_check(E1)
            first.append(E1)
        else:
            self.note("The user's idea could not be turned into a different policy from current practice; the agents start from the baseline.", agent="bo")
        out = self.run(first, say=f"Fanning {' + '.join(x['id'] for x in first)} out to Modal", trace=True)
        self.base_budget = E0["budget"]
        for x in first:
            self.run_done(x, out, view=x is first[-1])
        if self.pending_limit:
            self.set_budget_constraint(*self.pending_limit)
        best = first[-1]
        for rnd in range(self.max_rounds):
            if self.budget.left("llm") < 9:
                self.note(f"Research budget nearly spent after {rnd} round(s); moving on to baselines and the brief.", level="info", agent="cy")
                break
            before = len(self.exps)
            best = self.round(rnd, best)
            if len(self.exps) == before and rnd >= 1:
                break
        self.baselines()
        picks = [x for x in self.exps if x["role"] == "revision" and x.get("result") and x["status"] == "done"]
        finalists = [E0] + ([first[1]] if len(first) > 1 else []) + [self.get("SW"), self.get("OS")]
        if picks:
            finalists.append(max(picks, key=self.value))
        self.held_out_and_brief([f for f in finalists if f])

    # ---------- learning across trials (this browser session only) ----------
    def learn_from_session(self) -> None:
        """Athena reads the winning policies and Hephaestus reads its own failure notes from earlier trials of this session, from shared
        memory (written there at the end of each trial). Only trials the page lists are read, so a reload starts fresh."""
        if not self.prior:
            return
        for p in self.prior:
            win = self.read("bo", f"lesson-{p['trial']}", "Athena's proposals: what won in an earlier trial this session", say="Recalling earlier trials",
                            city=p["city"])
            notes = self.read("cy", f"cy-notes-{p['trial']}", "Hephaestus's failure analysis: its notes from an earlier trial this session",
                              say="Recalling my earlier failure notes", city=p["city"])
            if win or notes:
                self.session_lessons.append({"trial": p["trial"], "city": p["city"], "win": win and win["claim"], "notes": notes and notes["claim"],
                                             "author_win": win and win["author"], "author_notes": notes and notes["author"]})
        n = len(self.session_lessons)
        self.note(f"Learning from {n} earlier trial{'s' if n != 1 else ''} this session: Athena starts from what won, Hephaestus from what failed."
                  if n else "No lessons from earlier trials this session were found in shared memory yet.", level="info", agent="cy" if n else "eli")

    def lessons_text(self, who: str) -> str:
        """Prompt section built only from what the session reads returned."""
        rows = []
        for l in self.session_lessons:
            if who == "bo" and l["win"]:
                rows.append(f"{l['win']} (in {l['city']}; written by {l['author_win']})")
            if l["notes"]:
                rows.append(f"Hephaestus's failure notes from that trial: {l['notes']} (written by {l['author_notes']})")
        if not rows:
            return ""
        head = ("\nEarlier trials this session (from shared memory; build on what worked, avoid repeating what failed): " if who == "bo"
                else "\nYour failure notes from earlier trials this session (from shared memory): ")
        return head + " | ".join(rows) + "\n"

    def save_lessons(self, best: dict | None, base: dict) -> None:
        """At the end of a trial: Athena saves what won, Hephaestus saves its failure notes, for later trials in this session."""
        try:
            if best:
                self.remember("bo", f"lesson-{self.id}", f"Earlier trial \"{self.prompt}\" in {self.city}: the best policy was {best['label']} "
                              f"({best['change']}), {self.fmt(best)} vs {self.fmt(base)} for current practice on {self.P['label']}.",
                              "lesson", f"trial:{self.id}", say="Saving what won for later trials")
            if self.fail_notes:
                self.remember("cy", f"cy-notes-{self.id}", f"Question \"{self.prompt}\" in {self.city}: " + " / ".join(self.fail_notes[-3:]),
                              "failure", f"trial:{self.id}", say="Saving my failure notes for later trials")
        except Exception as ex:
            self.note(f"Couldn't save this trial's lessons ({type(ex).__name__}); later trials won't see them.", agent="eli")

    def frame(self) -> dict | None:
        kinds = list(self.defaults) or list(KIND_LABEL)
        out, err = self.attempt("bo", "frame", lambda e: bo_mod.frame(self.llm, self.city, self.prompt, self.town_text(), kinds, list(self.fac)))
        if err:
            self.fallback_note("bo", "Framing the question", err)
            tgt = "library" if "library" in self.fac else next(iter(self.fac), None)
            out = {"representable": bool(tgt), "claim": f"In {self.city}, extending evening hours at {self.fac[tgt]['name'] if tgt else 'the main public place'} reaches more residents.",
                   "metric": "visits_restricted" if tgt else "visits", "kind": None, "cohort": None, "target": tgt,
                   "budget_limit": {"type": "none", "value": None}, "scripted": True,
                   "user_idea": {"label": "Two late evenings", "facility_changes": [{"facility": tgt, "hours_changes": [{"day": 1, "open": "10:00", "close": "21:00"},
                                 {"day": 3, "open": "10:00", "close": "21:00"}], "capacity": None, "fee": None, "close": False}] if tgt else [],
                                 "new_facilities": [], "channels": [], "why": "Scripted default idea.", "evidence_url": None, "scripted": True}}
        # Town trials (broad goals, the default type) always get a simulation when any proxy is measurable: if Athena found no direct
        # lever ("make school more accessible": schools aren't a modelled place), ask once more for the closest measurable proxy.
        if not err and not out.get("representable") and out.get("trial_type", "town") == "town":
            proxy_prompt = (f"{self.prompt}\n(This is a town trial. There may be no direct lever for it; choose the closest measurable proxy with "
                            "the supported places and actions, e.g. how easily the group it concerns can reach public places that serve it "
                            "(library, community centre, parks, sports) after school or work. Say in the claim that it is a proxy. Set "
                            "representable=false only if no supported place or action relates to the goal at all.)")
            out2, err2 = self.attempt("bo", "frame (proxy)", lambda e: bo_mod.frame(self.llm, self.city, proxy_prompt, self.town_text(), kinds, list(self.fac)))
            if out2 and out2.get("representable"):
                self.note(f"No direct lever for this goal in the town model; testing the closest measurable proxy instead: {out2['claim']}", agent="bo")
                out = {**out2, "trial_type": "town"}
        # Perception questions ("Will people know about the Walgreens closing?") are measured by awareness. Athena decides; code
        # enforces it when Athena or the keyword check says the question is clearly about who hears / knows.
        from policy import strong_perception
        if out.get("metric") != "awareness" and (out.get("trial_type") == "perception" or strong_perception(self.prompt)):
            why = "Athena marked it a perception question" if out.get("trial_type") == "perception" else "the question asks whether people will hear or know about something"
            self.note(f"Framed as a perception trial (awareness), because {why}; Athena's metric was {out.get('metric')}.", agent="bo")
            out["metric"], out["kind"], out["target"], out["representable"] = "awareness", None, out.get("target"), True
        # perception / service / town (the default and the fallback for anything Athena or the keywords can't place)
        tt = out.get("trial_type") if out.get("trial_type") in ("service", "town") else "town"
        self.trial_type = "perception" if out.get("metric") == "awareness" else tt
        self.set_metric(out)
        self.set_scope(out)
        if not out["representable"]:
            rb, err2 = self.attempt("bo", "research brief", lambda e: self.bo.research_brief(self.city, self.prompt))
            self.emit("BRIEF", agent="bo", say="This needs data, not a simulation", recommend="none", label="Research brief (no simulation)", no_sim=True,
                      summary=(rb or {}).get("reason", "The idea can't be expressed with the supported actions."),
                      assumptions="No simulated number is reported for ideas outside the supported actions.",
                      pilot=(rb or {}).get("data_plan", "Collect local data on the idea before simulating it."), scripted=bool(err2))
            return None
        bl = out.get("budget_limit") or {}
        self.pending_limit = (bl["type"], bl.get("value"), "your question", "from your question") if bl.get("type") not in (None, "none") else None
        self.emit("FRAME", agent="bo", say="Framing the question", trial_type=getattr(self, "trial_type", "town"), metric=self.P["metric"], key=self.P["key"], label=self.P["label"], unit=self.P["unit"],
                  budget_scope=self.scope_label,
                  direction="max" if self.P["dir"] > 0 else "min", target=self.target, target_name=self.fac.get(self.target, {}).get("name"),
                  kind=out.get("kind"), cohort=out.get("cohort"), days=self.days, budget_limit=bl, scripted=bool(out.get("scripted")))
        self.emit("CLAIM", agent="bo", claim=out["claim"], metric=self.P["label"],
                  constraint=(f"budget: {bl['type'].replace('_', ' ')}" + (f" {bl['value']:g}" if bl.get("value") else "")) if self.pending_limit else "budget limit unknown yet",
                  horizon=f"{'3 days' if self.awareness else '1 week'}, {SEEDS} matched seeds", prompt=self.prompt, scripted=bool(out.get("scripted")))
        return out

    def hours_from_memory(self, f: dict) -> dict | None:
        """Hours for this place verified by Exa Dude in an earlier trial of this town (past.dev / local memory), if any."""
        import re
        ids = [f"fact-hours-{f['id']}"] + (["fact-library-hours"] if f["kind"] == "library" else [])
        for sid in ids:
            rec = self.memory.get(self.city, sid, reader="eli")
            if not rec or not str(rec.get("source", "")).startswith("http"):
                continue
            hours = [None] * 7
            found = 0
            for d, name in enumerate(DAYS):
                m = re.search(rf"{name} (\d\d):(\d\d)-(\d\d):(\d\d)", rec["claim"])
                if m:
                    hours[d] = [int(m[1]) * 60 + int(m[2]), int(m[3]) * 60 + int(m[4])]
                    found += 1
                elif re.search(rf"{name} closed", rec["claim"]):
                    found += 1
            if found == 7 and any(hours):
                return {"hours": hours, "source": rec["source"], "claim": rec["claim"], "author": rec.get("author") or "exa", "source_id": sid}
        return None

    def sourced_inputs(self) -> None:
        """Exa Dude: the target place's real hours, and budget figures (wage, budget, cuts) for the town or place."""
        self.base_source = "OpenStreetMap" if self.spec else "model default"
        if self.awareness:
            self.eli_audiences()
            q = f"{self.city} library news how are hours changes announced"
            res, live = self.search("exa", q, "broad", __import__("agents.fixtures", fromlist=["x"]).library_news, "Searching: how this town gets news")
            self.apply_channels(q, res, live, "How does the town announce changes?") if res else None
        if self.target:
            f = self.fac[self.target]
            q = f"{f['name']} {self.city} opening hours"
            res, live = self.search("exa", q, "broad", __import__("agents.fixtures", fromlist=["x"]).library_hours, f"Searching: {f['name']} hours")
            ext, how = (None, "fixture")
            if live and res:
                ext, err = self.attempt("exa", "place hours", lambda e: extract_place_hours(self.ada, f["name"], self.city, res))
                how = err or ("no source states it" if ext is None else (ext.get("check") or "unverified quote") if ext.get("unverified") else "verified quote")
                if ext and ext.get("unverified"):
                    ext = None
            hours = None
            if ext:
                ch = [{"day": d["day"], "open": d["open"], "close": d["close"]} for d in ext["days"]]
                from policy import validate_action
                if len({c["day"] for c in ch}) == 7 and not validate_action("service", {"hours_changes": ch}):
                    hours = apply_changes([None] * 7, ch)
            mem = None
            if not hours:
                mem = self.hours_from_memory(f)
                if mem:
                    hours, ext = mem["hours"], {"url": mem["source"], "quote": mem["claim"]}
            if hours:
                f["hours"], f["hoursSource"] = hours, ext["url"]
                self.base_policy = {"target": self.target, "facilities": {self.target: {"hours": hours}}}
                self.base_source = ext["url"]
                hs = ", ".join(f"{DAYS[d]} {_hm(x[0])}-{_hm(x[1])}" if x else f"{DAYS[d]} closed" for d, x in enumerate(hours))
                if mem:
                    self.log_exa("exa", q, "broad", res, live, f"This search did not state {f['name']}'s hours ({how}); using the hours verified in an "
                                 f"earlier trial and recalled from shared memory: {hs}", say=f"Searching: {f['name']} hours")
                    self.emit("MEMORY_READ", agent="bo", source_id=mem["source_id"], author=mem["author"], claim=mem["claim"],
                              used_for="baseline policy E0 (hours from an earlier trial)", store=self.memory.last_store)
                else:
                    self.log_exa("exa", q, "broad", res, live, f"Current hours of {f['name']}: {hs} (quote: \"{ext['quote'][:140]}\")", say=f"Searching: {f['name']} hours")
                    self.remember("exa", f"fact-hours-{self.target}", f"{f['name']} hours: {hs}", "fact", ext["url"], query=q, effective=self.published(res, ext["url"]))
                    self.read("bo", f"fact-hours-{self.target}", "baseline policy E0", say="Reading Exa Dude's fact, building runs")
                self.evidence.append({"claim": f"{f['name']} hours: {hs}", "url": ext["url"], "author": "exa"})
            else:
                self.log_exa("exa", q, "broad", res, live, f"No usable hours for {f['name']} ({how}); keeping {f['hoursSource']} hours.", say=f"Searching: {f['name']} hours")
                if live:
                    self.note(f"Gap: no source states {f['name']}'s hours ({how}). Using {f['hoursSource']} hours, labelled.", agent="exa")
        # budget figures (wage / budget / cuts)
        topic = KIND_LABEL.get(self.fac[self.target]["kind"], "city") if self.target else "city"
        q = f"{self.city} {topic} budget staff wages"
        res, live = self.search("exa", q, "broad", __import__("agents.fixtures", fromlist=["x"]).board_minutes, "Searching: the town budget")
        if live and res:
            ext, err = self.attempt("exa", "budget", lambda e: extract_budget(self.ada, self.city, f"{topic} budget, staffing and wages", res))
            if ext and not ext.get("unverified"):
                self.use_budget_fact(ext, q, res, "broad")
            else:
                self.log_exa("exa", q, "broad", res, live, f"No budget figure stated ({err or ((ext.get('check') or 'unverified quote') if ext else 'no source states it')}); "
                             f"using the labelled default wage ${self.wage:g}/staff hour.", say="Searching: the town budget")
        else:
            self.log_exa("exa", q, "broad", res, live, "Budget search unavailable; using labelled defaults.", say="Searching: the town budget")

    # ---------- town profile (Exa Dude) ----------
    def town_profile(self) -> None:
        """Budget documents, channels and place roles for this town: cached per town, built on the first live visit
        with its own small search budget (3 Exa calls) so the research loop keeps its budget."""
        cache = getattr(self, "towns", None)
        prof = TP.cached(self.city, cache) if cache is not None else None
        fresh = False
        if not prof and self.ada.available and self.exa_mode == "failure":
            from agents.ada import Ada
            from agents.llm import LLM, Budget
            pb = Budget(exa=4, llm=4)
            pada = Ada(pb, LLM(pb))
            pada.place_terms = list(self.ada.place_terms)
            city, spec = self.city, self.spec

            def build_and_cache():
                p = TP.build(city, pada, spec)
                if cache is not None:
                    try:
                        cache[TP._key(city)] = p
                    except Exception:
                        pass
                return p
            # Capped so a big town's first visit can't hold up the trial: if the profile isn't ready in time, the trial goes on
            # without it, and the build finishes in the background and is cached for the next trial of this town.
            from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
            ex = ThreadPoolExecutor(1)
            fut = ex.submit(build_and_cache)
            ex.shutdown(wait=False)
            try:
                prof, fresh = fut.result(timeout=TP.BUILD_CAP_S), True
            except FutureTimeout:
                self.note(f"Exa Dude is still researching {self.city}'s budget and channels (over {TP.BUILD_CAP_S} s); continuing without the town "
                          "profile this time. It will be cached for the next trial of this town.", level="info", agent="exa")
                return
            except Exception as err:
                self.note(f"Town profile failed ({type(err).__name__}); continuing with labelled defaults.", agent="exa")
                return
        if not prof:
            self.note("No town profile: Exa search is unavailable, so the town's budget documents and channels are unknown (labelled defaults).", agent="exa")
            return
        self.profile = prof
        if fresh:
            for s in prof["searches"]:
                self.emit("EXA", agent="exa", say="Researching the town", query=s["query"], search="town profile", results=s.get("results", []),
                          used_for="Town profile: budget documents, local channels, roles and addresses of places" + (f" (error: {s['error']})" if s.get("error") else ""))
        docs = TP.budget_docs(prof)
        self.budget_docs += docs
        for d in docs[:3]:
            self.evidence.append({"claim": d["statement"], "url": d["url"], "author": "exa"})
        for c in prof["channels"][:4]:
            self.evidence.append({"claim": f"Local channel: {c['name']} ({c['kind']})", "url": c["url"], "author": "exa"})
        b = prof.get("budget") or {}
        self.emit("TOWN_PROFILE", agent="exa", say="Town profile ready", cached=not fresh, built=prof["built"], budget=b or None,
                  channels=prof["channels"], places=prof["places"], exa_only_places=prof["exa_only_places"], sources=prof["sources"], missing=prof["missing"])
        if b:
            self.remember("exa", "fact-town-budget", f"{b.get('fiscal_year') or 'Current'} budget: {b.get('total_kind')} "
                          + (f"${b['total_budget_usd']:,.0f}" if b.get("total_budget_usd") else "(total not stated)"), "fact", b["url"], effective=b.get("published"))

    # ---------- similar towns (Exa Dude) ----------
    def similar_towns(self, q: str, kind: str, say: str) -> list[dict]:
        """Search for other towns that tried something for this goal; keep quote-checked cases; unmodellable ideas become pilots."""
        if self.budget.left("exa") <= 0 or self.exa_mode == "none":
            return []
        from agents import fixtures
        res, live = self.search("exa", q, kind, fixtures.library_news, say)
        if not (live and res):
            self.log_exa("exa", q, kind, res, live, "Similar-town search unavailable; no comparable cases used.", say=say)
            return []
        got, err = self.attempt("exa", "similar towns", lambda e: CMP.find(self.ada, self.city, self.P["label"] if getattr(self, "P", None) else self.prompt, res))
        got = [c for c in (got or []) if c["town"].lower() not in {c2["town"].lower() for c2 in self.cases}]
        self.log_exa("exa", q, kind, res, live, f"{len(got)} similar-town case(s) verified against their sources" + (f" ({err})" if err else "") +
                     (": " + "; ".join(f"{c['town']} ({c['worked']})" for c in got) if got else ""), say=say)
        for c in got:
            self.cases.append(c)
            self.emit("COMPARABLE", agent="exa", say=f"Found: {c['town']}", town=c["town"], intervention=c["intervention"], outcome=c["outcome"],
                      worked=c["worked"], cost_funding=c["cost_funding"], similarity=c["similarity"], may_not_transfer=c["may_not_transfer"],
                      modellable=c["modellable"], source=c["url"], published=c.get("published"), quote=c["quote"][:300], check=c.get("check"))
            self.remember("exa", f"case-{len(self.cases)}-{self.id}", f"{c['town']}: {c['intervention']} -> {c['outcome']}", "fact", c["url"],
                          query=q, effective=c.get("published"))
            if not c["modellable"]:
                self.emit("PILOT", agent="bo", say="That one needs a pilot, not a simulation", from_town=c["town"], idea=c["intervention"],
                          why_not_simulated="The simulator's actions (hours, capacity, fees, opening/closing places, outreach) can't express it, "
                                            "so no score is given.", source=c["url"])
        return got

    # ---------- Apollo ----------
    def treasurer_check(self, x: dict) -> None:
        """Line-item cost of a proposal before it runs (pre-run estimate; fee revenue needs the run, so it is excluded here)."""
        base = self.base_budget or self.budget_of(self.est_mean(self.base_policy), self.base_policy)
        bud = self.budget_of(self.est_mean(x["policy"]), x["policy"])
        li = TR.line_items(bud, base, x["policy"], self.scope_label)
        verdict = "within the limit" if not self.constraint or self.constraint[1](x) else "over the budget limit"
        self.emit("BUDGET_CHECK", agent="treasurer", say=f"Costing {x['id']}", exp=x["id"], items=li["items"], ongoing_delta=li["ongoing_delta"],
                  one_time=li["one_time"], summary=li["summary"], scope=li["scope"], limit=verdict, final=False,
                  status="pending" if self.budget_docs else "unverified",
                  note="Pre-run estimate from the policy (staff and open hours); funding is checked for the recommendation."
                       if self.budget_docs else "No budget document found yet, so funding is unverified.")

    def treasurer_final(self, best: dict, base: dict) -> dict:
        li = TR.line_items(best["budget"], base["budget"], best["policy"], self.scope_label)
        # Apollo reads Exa Dude's budget facts from shared memory; any sourced record not already in this trial's documents joins them
        recs = [f for sid in [s for s in list(self.written) if s.startswith(("fact-budget", "fact-town-budget"))][:3]
                if (f := self.read("treasurer", sid, f"funding check for {best['id']}", say="Reading the budget records"))]
        have = {(d["statement"], d["url"]) for d in self.budget_docs}
        docs = self.budget_docs + [{"statement": f["claim"], "kind": f.get("kind") or "fact", "amount": None, "url": f["source"], "published": None}
                                   for f in recs if str(f.get("source") or "").startswith("http") and (f["claim"], f["source"]) not in have]
        fund, err = self.attempt("treasurer", "funding", lambda e: TR.funding(self.llm, self.city, f"{best['label']} ({best['change']})", li, docs))
        if err:
            self.fallback_note("treasurer", "Funding check", err)
            fund = TR.funding(None, self.city, "", li, [])
        self.emit("BUDGET_CHECK", agent="treasurer", say="Can the town pay for it?", exp=best["id"], items=li["items"], ongoing_delta=li["ongoing_delta"],
                  one_time=li["one_time"], summary=li["summary"], scope=li["scope"], final=True, status=fund["status"],
                  funding_source=fund["funding_source"], gap_usd=fund.get("gap_usd"), appropriation_or_unspent=fund["appropriation_or_unspent"],
                  restricted=fund["restricted"], confirm=fund["confirm"], reason=fund["reason"], source=fund.get("source_url"), by=fund.get("by"))
        return fund

    def applies_here(self, text: str) -> bool:
        """Does a sourced budget statement concern the budget this trial is about (the target place, its kind, or the town's general budget)?"""
        t = text.lower()
        words = {"city budget", "town budget", "general fund", "city council budget", "municipal budget"}
        if self.target:
            f = self.fac[self.target]
            words |= {f["name"].lower(), KIND_LABEL.get(f["kind"], f["kind"]).lower(), f["kind"].replace("_", " ")}
        else:
            words |= {KIND_LABEL.get(self.fac[i]["kind"], "") for i in self.scope}
        return any(w and w in t for w in words)

    def use_budget_fact(self, ext: dict, q: str, res: list, kind: str) -> None:
        k, amt = ext["kind"], ext.get("amount")
        what = f"{ext['applies_to']}: {ext['statement']}"
        if k == "hourly_wage" and amt and 8 <= amt <= 120:
            self.wage, self.wage_source = float(amt), ext["url"]
            used = f"Wage for the budget model: ${amt:g}/staff hour"
        elif k in ("budget_cut", "no_additional_staff_hours") and not self.applies_here(ext.get("applies_to", "") + " " + ext.get("statement", "")):
            used = f"Context only: this limit is about {ext.get('applies_to') or 'another budget'}, not the {self.scope_label}"
        elif k in ("budget_cut", "no_additional_staff_hours"):
            self.pending_limit = ("no_increase", None, ext["url"], "interpreted: " + ("a budget cut" if k == "budget_cut" else "no additional staff hours") + " read as no cost increase")
            used = "Adds constraint: no increase in net cost"
            if self.base_budget:
                self.set_budget_constraint(*self.pending_limit)
                self.pending_limit = None
        else:
            used = "Context for the brief (not a model input)"
        self.log_exa("exa", q, kind, res, True, f"{used} (quote: \"{ext['quote'][:140]}\"; {ext.get('check', 'quote checked')}{', published ' + ext['published'] if ext.get('published') else ''})", say="Searching: the town budget")
        self.evidence.append({"claim": what, "url": ext["url"], "author": "exa"})
        self.budget_docs.append({"statement": what, "kind": k, "amount": amt, "url": ext["url"], "published": ext.get("published")})
        self.remember("exa", f"fact-budget-{k}", what, "constraint" if k in ("budget_cut", "no_additional_staff_hours", "staff_hours_cap") else "fact",
                      ext["url"], query=q, effective=self.published(res, ext["url"]))

    def round(self, rnd: int, best: dict) -> dict:
        city = self.city
        fail, err = self.attempt("cy", "failure", lambda e: self.cy.failure("town", city, self.results_text() + self.lessons_text("cy"), self.trace_text(best), self.constraints_text()))
        if err:
            self.fallback_note("cy", "Reading the failure trace", err)
            fail = {"trace": f"Best so far {best['id']} reaches {self.fmt(best)}.", "next_question": "Is there a budget limit for this service this year?",
                    "entity": "city council", "search_topic": "budget staffing hours", "scripted": True}
        self.emit("FAILURE", agent="cy", say="Reading the failure trace", exp=best["id"], trace=fail["trace"], next_question=fail["next_question"],
                  entity=fail["entity"], scripted=bool(fail.get("scripted")))
        self.remember("cy", f"failure-{self.id}-{rnd + 1}", f"{best['id']}: {fail['trace']} Next: {fail['next_question']}", "failure", f"trial:{self.id}")
        self.fail_notes.append(f"{fail['trace']} (next question: {fail['next_question']})")
        source = None
        ftype = fail.get("fact_type") or "local_fact"
        if self.budget.left("exa") > 0 and ftype == "comparable_result" and self.exa_mode == "failure":
            got = self.similar_towns(CMP.query_for(f"{fail.get('search_topic') or ''} {fail['next_question']}", city), "failure-guided", "Failure-guided search: similar towns")
            source = got[0]["url"] if got else None
        elif self.budget.left("exa") > 0:
            q = " ".join(f"{city} {fail['entity']} {fail.get('search_topic') or fail['next_question']}".split()[:16])
            if self.exa_mode == "broad":
                q = [f"{city} news", f"{city} city services"][rnd % 2]
            from agents import fixtures
            res, live = self.search("exa", q, "failure-guided", fixtures.school_bulletin if self.awareness else fixtures.board_minutes, "Failure-guided search")
            if self.awareness:
                source = self.apply_channels(q, res, live, fail["next_question"]) if res else None
            elif live and res:
                ext, e2 = self.attempt("exa", "budget", lambda e: extract_budget(self.ada, city, fail["next_question"], res))
                if ext and not ext.get("unverified"):
                    self.use_budget_fact(ext, q, res, "failure-guided")
                    source = ext["url"]
                else:
                    self.log_exa("exa", q, "failure-guided", res, live, f"Nothing stated that changes the inputs or limits ({e2 or 'no source states it'}). Gap logged.")
            elif res:
                fx = __import__("agents.fixtures", fromlist=["x"]).FIXTURE_EXTRACT.get(res[0]["url"]) or {}
                self.log_exa("exa", q, "failure-guided", res, live, "FIXTURE evidence: " + (fx.get("statement") or "placeholder"))
        bo_mem = [f for sid in [s for s in list(self.written) if s.startswith(("fact-town-budget", "fact-budget", "fact-hours", "fact-school", "fact-notice"))][:3]
                  if (f := self.read("bo", sid, f"Athena's round {rnd + 1} revision prompt", say="Reading Exa Dude's finds"))]
        self.cy_recall()
        focus = (f"Target place: {self.target} ({self.fac[self.target]['name']}). Every proposal must change this place (or open/close a place "
                 f"of its kind, or add outreach about it); changes elsewhere do not answer the question.\n" if self.target else "")
        context = (f"Question: {self.prompt}\n{focus}Metric ({'maximise' if self.P['dir'] > 0 else 'minimise'}): {self.P['label']}\n"
                   f"Results so far: {self.results_text()}\nFailure trace: {self.trace_text(best)}\nReviewer's question: {fail['next_question']}\n"
                   f"Constraints (enforced in code): {self.constraints_text()}\nWage used: ${self.wage:g}/staff hour ({self.wage_source})\n"
                   + (f"Budget covers: {self.scope_label}. To stay within a budget limit you may offset new costs inside it (trim hours at "
                      f"another place in it, or add a modest fee).\n" if self.constraint else "")
                   + f"Local sources: {self.evidence_text()}\n" + self.memory_text(bo_mem) + self.lessons_text("bo") + f"Similar towns (verified cases; adapt a promising one and name it in adapted_from): {CMP.text(self.cases)}\n"
                   + "Already tried (don't repeat): " + "; ".join(x["change"] for x in self.exps))

        def validate(props):
            for p in props:
                e = self.validate(p)
                if e:
                    return f"{p.get('label')}: {e}"
            return None if props else "no proposals"
        props, err = self.attempt("bo", "revise", lambda e: bo_mod.town_revise(self.llm, city, self.town_text(), context, 2, e), validate)
        if err:
            self.fallback_note("bo", f"Round {rnd + 1} revisions", err)
            props = self.scripted_town_revisions(rnd)
        new = []
        for p in props:
            if self.validate(p):
                continue
            pol = self.policy_of(self._action(p))
            if any(x["policy"] == pol for x in self.exps):
                self.note(f"Athena's proposal '{p['label']}' repeats an earlier experiment; skipped.", agent="bo")
                continue
            x = self.exp(id=self.next_id(), label=p["label"][:60], role="revision", parent=best["id"], policy=pol, change=self.change_of(pol),
                         source=p.get("evidence_url") or source)
            self.emit("PROPOSE", agent="bo", say=f"Proposing {x['id']}", exp=x["id"], parent=best["id"], change=x["change"], why=p["why"],
                      adapted_from=p.get("adapted_from"), scripted=bool(p.get("scripted")))
            if self.review(x, p["why"], self.trace_text(best)):
                self.treasurer_check(x)
                new.append(x)
        chain = {"round": rnd + 1, "failure": fail["trace"], "question": fail["next_question"], "fact_type": ftype, "source": source,
                 "changed_idea": "; ".join(f"{x['id']}: {x['change']}" for x in new) or "no new idea passed review"}
        if not new:
            self.emit("CHAIN", agent="cy", say="Recording the research chain", **chain, new_result="nothing run", improved=False)
            return best
        out = self.run(new, say=f"Running {' + '.join(x['id'] for x in new)}", trace=True)
        cands = [x for x in self.exps if x.get("result") and x["status"] == "done" and x["role"] in ("revision", "user")]
        top = max(cands, key=self.value) if cands else best
        for x in new:
            self.run_done(x, out, view=x is top)
        nb = max(new, key=lambda x: self.value(x) if x.get("result") else float("-inf"))
        self.emit("CHAIN", agent="cy", say="Recording the research chain", **chain,
                  new_result=f"{nb['id']}: {self.fmt(nb)} (was {best['id']}: {self.fmt(best)})", improved=top is not best)
        return top

    def scripted_town_revisions(self, rnd: int) -> list[dict]:
        if self.awareness:
            return [{"label": "+ paper flyers", "facility_changes": [], "new_facilities": [], "channels": ["online", "board"], "why": "Paper flyers at public places.", "evidence_url": None, "scripted": True},
                    {"label": "+ school bulletin", "facility_changes": [], "new_facilities": [], "channels": ["online", "bulletin"], "why": "Reaches parents.", "evidence_url": None, "scripted": True}]
        if not self.target:
            return []
        late = [{"day": 1, "open": "13:00", "close": "21:00"}, {"day": 3, "open": "13:00", "close": "21:00"}] + ([{"day": 5, "open": "12:00", "close": "20:00"}] if rnd else [])
        return [{"label": "Shift two days later" + (" + Sat" if rnd else ""), "facility_changes": [{"facility": self.target, "hours_changes": late, "capacity": None, "fee": None, "close": False}],
                 "new_facilities": [], "channels": [], "why": "Move morning hours to the evening.", "evidence_url": None, "scripted": True}]

    def baselines(self) -> None:
        """Matched budgets: a 6-config sweep around the question, and a one-shot LLM proposal (same model and evidence, no feedback)."""
        if self.awareness:
            combos = [["online", "board"], ["online", "bulletin"], ["online", "board", "bulletin"], ["online", "newspaper"], ["online", "mailer"], ["board", "bulletin", "newspaper"]]
            sweep = [{"key": f"S{k + 1}", "policy": dict(self.base_policy, channels=c)} for k, c in enumerate(combos)]
        else:
            kind = self.P.get("kind")
            tgt = self.target or next((f for f in self.fac if self.fac[f]["kind"] == kind), None)
            sweep = []
            if not tgt and kind in self.defaults:  # the town has no such place: try opening one in six different spots
                spots = ["plaza"] + [i for i in sorted(self.places) if i != "plaza" and not i.startswith("home-")][:5]
                for k, near in enumerate(spots[:6]):
                    sweep.append({"key": f"S{k + 1}", "policy": {"target": None, "add": [{"id": f"new-{kind}-1", "kind": kind, "near": near,
                                  "hours": self.defaults[kind]["hours"], "opCost": self.defaults[kind].get("opCost", 20)}]}})
            elif not tgt:
                tgt = next(iter(self.fac), None)
            if tgt:
                h = self.fac[tgt]["hours"]
                variants = [
                    [(1, H(10), H(21)), (3, H(10), H(21))],           # two late evenings
                    [(5, H(10), H(16))],                                 # Saturday
                    [(6, H(12), H(17))],                                 # Sunday afternoon
                    [(d, (h[d] or [H(10), H(18)])[0], min(H(23), (h[d] or [H(10), H(18)])[1] + H(2))) for d in range(5)],  # weekdays +2 h
                    [(d, (h[d] or [H(10), H(18)])[0] + H(2), min(H(23), (h[d] or [H(10), H(18)])[1] + H(2))) for d in range(5)],  # weekdays shifted 2 h later
                ]
                for k, v in enumerate(variants):
                    hh = [list(x) if x else None for x in h]
                    for d, o, c in v:
                        hh[d] = [o, c]
                    sweep.append({"key": f"S{k + 1}", "policy": {"target": self.target, "facilities": {tgt: {"hours": hh}}}})
                sweep.append({"key": "S6", "policy": {"target": self.target, "facilities": {tgt: {"capacity": int(self.fac[tgt]["capacity"] * 1.5) + 1}}}})
                if self.metric == "net_cost":  # budget questions: cost-cutting variants instead
                    sweep[3] = {"key": "S4", "policy": {"target": self.target, "facilities": {tgt: {"hours": [[x[0], x[1] - H(1)] if x else None for x in h]}}}}
                    sweep[4] = {"key": "S5", "policy": {"target": self.target, "facilities": {tgt: {"hours": [x if d < 5 else None for d, x in enumerate(h)]}}}}
                    sweep[5] = {"key": "S6", "policy": {"target": self.target, "facilities": {tgt: {"fee": 2.0}}}}
        evidence = "; ".join(e["claim"] for e in self.evidence[:3]) or "none"
        os_, err = self.attempt("bo", "one-shot", lambda e: bo_mod.town_oneshot(self.llm, self.city, self.town_text(), self.prompt, evidence, e), self.validate)
        if err or not os_:
            self.fallback_note("bo", "One-shot baseline", err or "no proposal")
            os_ = (self.scripted_town_revisions(1) or [{"label": "online + board", "facility_changes": [], "new_facilities": [], "channels": ["online", "board"]}])[0]
            os_["scripted"] = True
        os_pol = self.policy_of(self._action(os_))
        OS = self.exp(id="OS", label=f"One-shot: {os_['label']}"[:60], role="oneshot", parent="E0", policy=os_pol, change=self.change_of(os_pol) + " (single proposal, no feedback)")
        self.emit("PROPOSE", agent="bo", exp="OS", parent="E0", change=OS["change"], scripted=bool(os_.get("scripted")),
                  why=(os_.get("why") or "One-shot baseline arm.") + " (One-shot arm: same model and evidence, no simulation feedback.)")
        if not sweep:
            self.note("No place to sweep for this question; the sweep arm is skipped.", agent="dee")
            out = self.run([OS], say="Running the one-shot arm")
            self.run_done(OS, out, note="one-shot LLM proposal, same model, no feedback")
            return
        jobs = [self.job(s["key"], s["policy"]) for s in sweep] + [self.job("OS", os_pol)]
        self.emit("RUN_START", agent="dee", say="Running the baselines", exps=[s["key"] for s in sweep] + ["OS"], seeds=SEEDS, workers=len(self.runner.plan(jobs)), where=self.runner.where)
        out = self.fanout(jobs)
        for s in sweep:
            s["budget"] = self.budget_of(out["results"][s["key"]]["mean"], s["policy"])
            s["ok"] = self.constraint is None or self.constraint[1]({"policy": s["policy"], "budget": s["budget"]})
        pool = [s for s in sweep if s["ok"]] or sweep
        best = max(pool, key=lambda s: self.P["dir"] * self.mval(out["results"][s["key"]]["mean"], s["policy"]))
        tried = sorted(({"key": s["key"], "change": self.change_of(s["policy"]), "score": round(self.mval(out["results"][s["key"]]["mean"], s["policy"]), 2),
                         "value": self.fmt({"result": out["results"][s["key"]], "policy": s["policy"]}), "ok": s["ok"], "best": s is best} for s in sweep),
                       key=lambda t: -self.P["dir"] * t["score"])
        explain = (f"A yardstick, not the gods' idea: Hermes automatically tried {len(sweep)} standard options with no reasoning "
                   f"and kept the best one. If the gods' own proposals beat this, their reasoning added something.")
        SW = self.exp(id="SW", label=f"Best of {len(sweep)} auto-tried options", role="sweep", parent="E0", policy=best["policy"],
                      change=self.change_of(best["policy"]), tried=tried, explain=explain)
        for x, key in ((SW, best["key"]), (OS, "OS")):
            res = out["results"][key]
            x["budget"] = self.budget_of(res["mean"], x["policy"])
            x["result"] = res
            self.set(x, result=res, budget=x["budget"], status="done" if self.feasible(x) else "infeasible")
        self.run_done(SW, out, note=f"best of {len(sweep)} auto-tried options" + ("" if best["ok"] else " (none met the budget limit)"))
        self.run_done(OS, out, note="one-shot LLM proposal, same model, no feedback")

    def held_out_and_brief(self, finalists: list[dict]) -> None:
        city = self.city
        scenarios = [
            {"name": "Held-out A: more shift workers", "seed": city + ":A", "mix": {"night-shift": 0.2, "day-workers": 0.35}},
            {"name": "Held-out B: older town", "seed": city + ":B", "mix": {"seniors": 0.3, "students": 0.06}},
            {"name": "Held-out C: less appetite for public places", "seed": city + ":C", "interestMult": 0.7},
        ]
        jobs = [self.job(f"{i}:{f['id']}", f["policy"], seeds=HELD_OUT_SEEDS, scenario=sc) for i, sc in enumerate(scenarios) for f in finalists]
        self.emit("RUN_START", agent="dee", say="Freezing picks, testing held-out towns", exps=[f["id"] for f in finalists], seeds=len(HELD_OUT_SEEDS),
                  workers=len(self.runner.plan(jobs)), where=self.runner.where, held_out=True)
        out = self.fanout(jobs)
        table = []
        for i, sc in enumerate(scenarios):
            row = {"scenario": sc["name"]}
            for f in finalists:
                row[f["id"]] = self.mval(out["results"][f"{i}:{f['id']}"]["mean"], f["policy"])
            table.append(row)
        self.held_out_table = table
        self.emit("HELD_OUT", agent="cy", scenarios=len(scenarios), seeds=len(HELD_OUT_SEEDS), finalists=[f["id"] for f in finalists],
                  note="Policies frozen before testing. Residents and seeds not seen during search.", wall_s=out["wall_s"], workers=out["workers"])
        self.emit("HELD_OUT_TABLE", agent="cy", metric=self.P["label"], table=table,
                  finalists=[{"id": f["id"], "label": f["label"], "role": ROLE_NAME.get(f["role"], f["role"]), "feasible": f["status"] != "infeasible"} for f in finalists])
        feasible = [x for x in self.exps if x.get("result") and x["status"] == "done"]
        base = self.exps[0]
        if not feasible:
            ran = [x for x in self.exps if x.get("result")]
            near = min(ran, key=lambda x: x["budget"]["net"]) if ran else base
            self.emit("BRIEF", agent="bo", say="No option met the limit", recommend="none", label="No tested option meets the constraint",
                      summary=f"None of the {len(ran)} tested policies met {self.constraint[0] if self.constraint else 'the constraint'}. Closest: {near['id']} "
                              f"({near['change']}) at {B.fmt_usd(near['budget']['net'])}/yr for the {self.scope_label}.",
                      assumptions=f"Wage ${self.wage:g}/h ({self.wage_source}); running costs per open hour are model defaults.",
                      pilot="Widen the search (e.g. combine hour cuts with fees) or revisit the limit.", scripted=False)
            self.save_lessons(None, base)
            return
        best = max(feasible, key=self.value)
        self.set(best, best=True)
        self.emit_voices(best, base)
        fund = self.treasurer_final(best, base)
        b = self.write_brief(best, base)
        d = best["budget"]["net"] - base["budget"]["net"]
        b["summary"] += (f" Budget ({self.scope_label}): {B.fmt_usd(best['budget']['net'])}/yr ({'+' if d >= 0 else ''}{B.fmt_usd(d)} vs current; "
                         f"wage ${self.wage:g}/h from {self.wage_source}).")
        self.save_lessons(best, base)
        self.emit("BRIEF", agent="bo", say="Writing the decision brief", scripted=b["scripted"], recommend=best["id"], label=best["label"],
                  summary=b["summary"], assumptions=b["assumptions"], pilot=b["pilot"], what=b["what"], reasoning=b["reasoning"],
                  budget=best["budget"], budget_delta=d, funding=fund["status"])
        self.after_brief(best)

    def is_awareness(self) -> bool:
        return self.awareness

    def next_id(self) -> str:
        self.n += 1
        return f"E{self.n}"
