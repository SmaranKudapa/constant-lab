"""The live research loop (M2): Exa evidence, LLM proposals and reviews, real runs.

Same event log as the scripted port (orchestrator.Trial), with these rules:
- Exa Dude's Exa calls run on every trial: a broad baseline search, then failure-guided
  searches built from Cy's next_question + town + the entity that would know.
- Extracted values must be quoted from a returned passage (checked in code).
  Nothing found -> the gap is logged and the input is labelled as an assumption.
- Bo's actions are JSON validated in code; invalid twice -> labelled scripted step.
- Constraints (staff hours) are checked in code, never by the LLM.
- Exa failure -> labelled FIXTURE evidence, dependent experiments get source "fixture".
"""
from __future__ import annotations

import json
import time

from agents import fixtures
from agents.ada import Ada
from agents.bo import Bo
from agents.cy import Cy
from agents.llm import LLM, Budget, BudgetExceeded
from memory import LocalMemory, audience_slug, town_key
from orchestrator import SEEDS, SWEEP_BUDGET, Trial
from policy import (BASELINE_HOURS, DAYS, H, apply_changes, describe_hours, fixed, hours_text, hours_with, staff_hours, to_minutes,
                    validate_action)

ROUNDS = 2  # failure -> search -> revise rounds


def _action(mode: str, p: dict) -> dict:
    return {"hours_changes": p.get("hours_changes") or []} if mode == "service" else {"channels": p.get("channels") or []}


class LiveTrial(Trial):
    def __init__(self, *a, memory: LocalMemory, budget: Budget | None = None, options: dict | None = None, **kw):
        super().__init__(*a, **kw)
        # exa_mode (evaluation): "failure" = baseline + failure-guided searches (default); "broad" = the same number of
        # searches, but generic town/library queries; "none" = no Exa calls (gaps logged, model defaults used).
        self.exa_mode = (options or {}).get("exa_mode", "failure")
        self.budget = budget or Budget()
        self.llm = LLM(self.budget)
        self.ada, self.bo, self.cy = Ada(self.budget, self.llm), Bo(self.llm), Cy(self.llm)
        self.memory = memory
        self.written: set[str] = set()  # source ids written to memory during this trial
        if hasattr(memory, "on_fallback"):
            memory.on_fallback = lambda msg: self.note(msg, agent="eli", store="local-fallback")
        self.evidence: list[dict] = []   # {claim, url, author} facts the team may rely on
        self.n = 0                       # experiment counter
        self.channels_grounded: dict[str, str] = {"online": "assumed (every library posts online)"}

    # ---------- helpers ----------
    def next_id(self) -> str:
        self.n += 1
        return f"{'E' if self.mode == 'service' else 'P'}{self.n}"

    def attempt(self, who: str, what: str, fn, validate=None):
        """Call an LLM step up to twice (the retry sees the validator error). Returns (out, None) or (None, reason)."""
        err = None
        for _ in range(2):
            try:
                out = fn(err)
            except BudgetExceeded as ex:
                return None, str(ex)
            except Exception as ex:
                err = f"{type(ex).__name__}: {str(ex)[:200]}"
                continue
            err = validate(out) if validate else None
            if not err:
                return out, None
        return None, err

    def voices(self, rows: list[dict], best: dict) -> tuple[list[dict], bool]:
        from agents import voices as V
        out, err = self.attempt("eli", "voices", lambda e: V.llm_voices(self.llm, self.city, self.prompt, best["change"], rows))
        if err:
            self.fallback_note("eli", "Resident voices", err)
            return V.scripted_voices(rows), True
        return out, False

    def fallback_note(self, agent: str, what: str, reason: str) -> None:
        self.note(f"{what}: live step failed ({reason}); using the scripted step instead.", agent=agent, scripted=True)

    def evidence_text(self) -> str:
        if not self.evidence:
            return "none yet"
        return "; ".join(f"{e['claim']} [{e['url']}]" for e in self.evidence)

    @staticmethod
    def memory_text(records: list[dict]) -> str:
        """A prompt section built only from the records a memory read returned (not from this trial's working copy).
        Shows which store answered and who wrote each record, plus past.dev's own extracted claims when it returns them."""
        recs = [r for r in records if r and r.get("claim")]
        if not recs:
            return ""
        stores = ", ".join(sorted({str(r.get("_store") or "memory") for r in recs}))
        authors = ", ".join(sorted({str(r.get("author") or "unknown") for r in recs}))
        parts = []
        for r in recs:
            s = f"{r['claim']} [{r.get('source') or 'no source'}]"
            if r.get("recalled"):
                s += f" (recalled as: {str(r['recalled'][0])[:200]})"
            parts.append(s)
        return f"From shared memory ({stores}; written by {authors}): " + "; ".join(parts) + "\n"

    def constraints_text(self) -> str:
        if self.mode == "perception":
            return ("Channel existence is handled in code for every arm: a channel with no local source still runs, labelled "
                    "'assumes <channel> exists'. Do not reject a proposal for that; judge only other real-world inputs.")
        return self.constraint[0] if self.constraint else "none known"

    def assumed(self, policy: dict) -> list[str]:
        """Channels a policy uses that no local source shows exist (perception)."""
        return [c for c in policy.get("channels", []) if c not in self.channels_grounded]

    def exp(self, **e) -> dict:
        if self.mode == "perception" and e.get("policy"):
            miss = self.assumed(e["policy"])
            if miss:
                label = f"assumes {', '.join(miss)} exists (no local source)"
                e["source"] = f"{label}; {e['source']}" if e.get("source") else label
        return super().exp(**e)

    def search(self, agent: str, query: str, kind: str, fixture_fn, say: str) -> tuple[list[dict], bool]:
        """One Exa call; on failure, labelled fixture evidence. Returns (results, live)."""
        if self.exa_mode == "none":
            return [], True
        try:
            return self.ada.search(query), True
        except Exception as ex:
            self.note(f"Exa {kind} search failed ({type(ex).__name__}: {str(ex)[:160]}); using labelled FIXTURE evidence.", agent=agent)
            return fixture_fn(self.city), False

    @staticmethod
    def published(results: list[dict], url: str) -> str | None:
        for r in results:
            if r["url"] == url and r.get("published"):
                return str(r["published"])[:10]
        return None

    def log_exa(self, agent: str, query: str, kind: str, results: list[dict], live: bool, used_for: str, say: str | None = None) -> None:
        if self.exa_mode == "none":
            return  # ablation arm: no Exa call happened, so no EXA event
        self.emit("EXA", agent=agent, say=say, query=query, search=kind, results=Ada.public(results), used_for=used_for, fixture=not live)

    def extract(self, kind: str, results: list[dict], live: bool, question: str = "") -> tuple[dict | None, str]:
        """Grounded extraction. Returns (value or None, note on how it was obtained)."""
        if not live:
            return fixtures.FIXTURE_EXTRACT.get(results[0]["url"]), "fixture"
        if not results:
            return None, "no search results" + (" (Exa disabled: ablation arm)" if self.exa_mode == "none" else "")
        fn = {"hours": lambda e: self.ada.extract_hours(self.city, results),
              "constraint": lambda e: self.ada.extract_constraint(self.city, question, results),
              "channels": lambda e: self.ada.extract_channels(self.city, question, results)}[kind]
        out, err = self.attempt("exa", f"extract {kind}", fn)
        if err:
            return None, f"extraction failed ({err})"
        if out is None:
            return None, "no source states it"
        if out.get("unverified"):
            return None, "the model's quote was not found in any passage, so it was discarded"
        return out, "verified quote"

    def remember(self, agent: str, source_id: str, claim: str, kind: str, source: str, say: str | None = None, audience: str | None = None,
                 **meta) -> None:
        w = self.memory.ingest(agent, self.city, source_id, claim, kind, source, effective=meta.get("effective"),
                               metadata={"trial": self.id, **meta}, audience=audience)
        self.written.add(source_id)
        self.emit("MEMORY_WRITE", agent=agent, say=say, source_id=source_id, kind=kind, claim=claim, source=source,
                  effective=meta.get("effective"), supersedes=w["supersedes"], store=self.memory.last_store)

    def read(self, agent: str, source_id: str, used_for: str, say: str | None = None) -> dict | None:
        f = self.memory.get(self.city, source_id, reader=agent)
        if f:
            self.emit("MEMORY_READ", agent=agent, say=say, source_id=source_id, author=f["author"], claim=f["claim"], used_for=used_for,
                      store=self.memory.last_store)
            f = {**f, "_store": self.memory.last_store}
        return f

    def trace_text(self, x: dict) -> str:
        t = x.get("_trace") or {}
        n = t.get("seeds") or 1
        per = lambda d: ", ".join(f"{k} {fixed(v / n)}" for k, v in sorted(d.items(), key=lambda kv: -kv[1])) or "none"
        if self.mode == "service":
            slots = sorted((t.get("turnedAwayByDayHour") or {}).items(), key=lambda kv: -kv[1])[:5]
            return (f"{x['id']} per week (mean of {n} seeds): turned away by cohort: {per(t.get('turnedAwayByCohort') or {})}; "
                    f"busiest turned-away slots: {', '.join(f'{k} ({fixed(v / n)})' for k, v in slots) or 'none'}; "
                    f"reasons: {per(t.get('turnedAwayByReason') or {})}; visits by residents who can't make current hours, by cohort: "
                    f"{per(t.get('restrictedVisitsByCohort') or {})}. Residents by cohort: {t.get('residentsByCohort')}.")
        aware = t.get("awareByCohort") or {}
        res = t.get("residentsByCohort") or {}
        pct = ", ".join(f"{c} {fixed(100 * aware.get(c, 0) / n / max(1, k), 0)}%" for c, k in res.items())
        return f"{x['id']} after 3 days (mean of {n} seeds): aware by cohort: {pct}; learned via: {per(t.get('learnedVia') or {})}."

    def results_text(self) -> str:
        rows = []
        for x in self.exps:
            if x.get("result"):
                extra = f", staff {staff_hours(x['policy']['hours'])} h/wk" if self.mode == "service" else ""
                rows.append(f"{x['id']} ({x['change']}): {self.fmt(x)}{extra}, status {x['status']}")
        return f"metric: {self.P['label']}. " + "; ".join(rows)

    def policy_of(self, action: dict) -> dict:
        if self.mode == "service":
            return {"hours": apply_changes(self.base_hours, action["hours_changes"])}
        return {"channels": list(dict.fromkeys(action["channels"]))}

    def change_of(self, policy: dict) -> str:
        if self.mode == "service":
            base = self.base_hours
            parts = [f"{DAYS[d]} " + (f"{x[0] // 60:02d}:{x[0] % 60:02d}-{x[1] // 60:02d}:{x[1] % 60:02d}" if x else "closed")
                     for d, x in enumerate(policy["hours"]) if x != base[d]]
            return ", ".join(parts) or "current hours"
        return " + ".join(policy["channels"])

    def feasible(self, x: dict) -> bool:
        return self.constraint is None or self.constraint[1](x)

    def review(self, x: dict, why: str, trace: str = "") -> bool:
        """Code checks first (constraint), then Cy. Rejections are kept in the log."""
        if not self.feasible(x):
            self.set(x, status="rejected")
            self.emit("REVIEW", agent="cy", exp=x["id"], ok=False, by="code",
                      reason=f"Breaks {self.constraint[0]} (checked in code): needs {staff_hours(x['policy']['hours'])} staff hours.")
            return False
        out, err = self.attempt("cy", "review", lambda e: self.cy.review(self.mode, f"{x['id']}: {x['change']}. Why: {why}",
                                                                          self.evidence_text(), self.constraints_text(), trace))
        if err:
            self.fallback_note("cy", f"Review of {x['id']}", err)
            out = {"ok": True, "reason": "Supported actions; constraint check passed in code.", "ungrounded_inputs": [], "scripted": True}
        if not out["ok"]:
            self.set(x, status="rejected")
        self.emit("REVIEW", agent="cy", exp=x["id"], ok=out["ok"], reason=out["reason"], ungrounded=out.get("ungrounded_inputs") or [],
                  assumptions=out.get("assumptions") or [],
                  scripted=bool(out.get("scripted")))
        return out["ok"]

    # ---------- the loop ----------
    def start(self) -> None:
        self.base_hours = [list(h) if h else None for h in BASELINE_HOURS]
        self.memory.ensure_agents()
        if self.exa_mode != "failure":
            self.note(f"Evaluation arm: exa_mode={self.exa_mode} " + ("(no Exa calls)." if self.exa_mode == "none" else
                      "(same number of searches, generic queries not built from the failure)."), level="info", agent="exa")
        self.recall_town()
        self.baseline_search()
        idea = self.translate()
        if idea is None:
            return  # research-brief path, already logged
        E0 = self.exp(id="E0" if self.mode == "service" else "P0", label="Current practice",
                      role="baseline", policy=self.base_policy, change="none (current practice)", source=self.base_source)
        first = [E0]
        if self.policy_of(idea) != self.base_policy:
            E1 = self.exp(id=self.next_id(), label=f"Your idea: {idea['label']}"[:60], role="user", parent=E0["id"], policy=self.policy_of(idea),
                          change=self.change_of(self.policy_of(idea)))
            self.emit("PROPOSE", agent="bo", exp=E1["id"], parent=E0["id"], change=E1["change"], why=idea["why"], scripted=bool(idea.get("scripted")))
            self.cy_check_user(E1, idea["why"])
            first.append(E1)
        else:
            self.note("The user's idea is current practice, so the baseline is also 'your idea'.", agent="bo")
            self.set(E0, label="Current practice (= your idea)")
        out = self.run(first, say=f"Fanning {' + '.join(x['id'] for x in first)} out to Modal", trace=True)
        for x in first:
            self.run_done(x, out, view=x is first[-1])
        self.user_exp = first[-1]
        best = first[-1]
        for rnd in range(ROUNDS):
            best = self.round(rnd, best)
        self.baselines()
        agent_picks = [x for x in self.exps if x["role"] == "revision" and x.get("result") and x["status"] == "done"]
        finalists = [E0] + ([first[1]] if len(first) > 1 else []) + [self.get("SW"), self.get("OS")]
        if agent_picks:
            finalists.append(max(agent_picks, key=self.value))
        self.held_out_and_brief([f for f in finalists if f])

    def run_done(self, x: dict, out: dict, view: bool = False, note: str | None = None) -> None:
        r = x["result"]["mean"]
        extra = ({"staff_hours": staff_hours(x["policy"]["hours"]), "turned_away": fixed(r["turnedAway"])} if self.mode == "service"
                 else {"overall": fixed(r["awarePct"], 0) + "%"})
        self.emit("RUN_DONE", agent="dee", exp=x["id"], metric=self.P["key"], value=self.fmt(x), wall_s=out["wall_s"], workers=out["workers"],
                  view=x["id"] if view else None, note="new best so far" if view and x["role"] == "revision" else None, **extra)

    def recall_town(self) -> None:
        prior = self.memory.recall("eli", self.city, f"{self.city} library", kinds=("fact", "constraint"))
        if not prior:
            self.emit("MEMORY_READ", agent="eli", say="Recalling memory for this town", query=f"{self.city} library", found=0,
                      note="No prior facts for this town. Starting fresh.", store=self.memory.last_store)
            return
        self.emit("MEMORY_READ", agent="eli", say="Recalling memory for this town", query=f"{self.city} library", found=len(prior),
                  note=f"{len(prior)} prior facts from earlier trials: " + "; ".join(f["claim"] for f in prior)[:300], store=self.memory.last_store)
        for f in prior:
            self.emit("MEMORY_READ", agent="eli", source_id=f["source_id"], author=f["author"], claim=f["claim"],
                      used_for="carried into this trial (re-checked by search below)", store=self.memory.last_store)
            self.evidence.append({"claim": f["claim"], "url": f["source"], "author": f["author"]})

    def baseline_search(self) -> None:
        city = self.city
        if self.mode == "service":
            q = f"{city} public library hours"
            res, live = self.search("exa", q, "broad", fixtures.library_hours, "Searching: current library hours")
            ext, how = self.extract("hours", res, live) if live else (None, "fixture")
            hours = None
            if ext:
                changes = [{"day": d["day"], "open": d["open"], "close": d["close"]} for d in ext["days"]]
                err = validate_action("service", {"hours_changes": changes}) if len({c["day"] for c in changes}) == 7 else "needs all 7 days"
                if err:
                    how = f"extracted hours rejected by the validator ({err})"
                else:
                    hours = apply_changes(BASELINE_HOURS, changes)
            if hours:
                self.base_hours, self.base_source = hours, ext["url"]
                claim = f"Library hours: {describe_hours(hours)}"
                self.log_exa("exa", q, "broad", res, live, f"Baseline hours for the simulator: {describe_hours(hours)} (quote: \"{ext['quote'][:160]}\")",
                             say="Searching: current library hours")
                self.evidence.append({"claim": claim, "url": ext["url"], "author": "exa"})
                self.remember("exa", "fact-library-hours", claim, "fact", ext["url"], say="Saving the baseline to shared memory", query=q,
                              effective=self.published(res, ext["url"]))
            else:
                self.base_source = "model default (no local source)" if live else "fixture://library-hours"
                self.log_exa("exa", q, "broad", res, live,
                             f"No usable hours ({how}). Gap logged: using the model's default hours, labelled as an assumption." if live
                             else "Baseline hours for the simulator (FIXTURE)", say="Searching: current library hours")
                if live:
                    self.note(f"Gap: no source states the {city} library's hours ({how}). Baseline uses the model default "
                              f"({describe_hours(BASELINE_HOURS)}), labelled as an assumption.", agent="exa")
                else:
                    self.remember("exa", "fact-library-hours", "Library open Mon-Sat 10:00-18:00, closed Sun (FIXTURE)", "fact", "fixture://library-hours")
            self.base_policy = {"hours": self.base_hours}
            if self.base_hours != [list(h) if h else None for h in BASELINE_HOURS]:
                self.note("Residents' 'can't make current hours' flag is defined against the model's default hours (Mon-Sat 10:00-18:00); "
                          "the baseline experiment uses the sourced hours.", level="info", agent="dee")
        else:
            self.eli_audiences()
            q = f"{city} library news how are hours changes announced"
            res, live = self.search("exa", q, "broad", fixtures.library_news, "Searching: how this town gets news")
            ext, how = self.extract("channels", res, live, "How does the library announce changes?")
            chans = ext["channels"] if ext else ["online"]
            if ext:
                for c in chans:
                    self.channels_grounded[c] = ext["url"]
                self.evidence.append({"claim": f"Announcement channels in use: {', '.join(chans)}", "url": ext["url"], "author": "exa"})
                self.remember("exa", "fact-notice-channels", f"Current announcement channels: {', '.join(chans)}", "fact", ext["url"], query=q,
                              effective=self.published(res, ext["url"]))
            else:
                self.note(f"Gap: no source shows how {city} announces library changes ({how}). Baseline assumes an online post only.", agent="exa")
            self.log_exa("exa", q, "broad", res, live, f"Baseline channels: {', '.join(chans)}" + ("" if ext else " (assumed)"),
                         say="Searching: how this town gets news")
            self.base_policy = {"channels": chans}
            self.base_source = ext["url"] if ext else "assumption (no local source)"

    def is_awareness(self) -> bool:
        return self.mode == "perception"

    def eli_audiences(self) -> None:
        """One past.dev identity per resident, rule audiences for this town, and the notice scoped to the 'heard' audience."""
        info = self.runner.info(self.city, spec=self.spec)
        tk = town_key(self.city)
        # A fresh audience and trait per trial: observed in past.dev that a resident who leaves an audience and rejoins it
        # (as happens when a town is re-run) does not regain recall of its memories, while first-time members do within ~7 s.
        self.heard_slug, parents_slug = f"heard-{self.id}", audience_slug("parents", self.city)
        self.heard_trait = f"heard_notice_{self.id}"
        self.resident_ids = {r["id"]: f"{tk}-{r['id']}" for r in info["list"]}
        rows = [{"identity": self.resident_ids[r["id"]], "traits": {"town": tk, "name": r["name"], "cohort": r["cohort"], "channel": r["channel"],
                                                                   "neighborhood": r["neighborhood"]}} for r in info["list"]]
        self.residents_info = {r["id"]: r for r in info["list"]}
        n = self.memory.put_identities(rows)
        self.emit("AUDIENCE", agent="eli", say="Setting up audiences", op="bulk_replace_identities", count=n,
                  note=f"One identity per resident ({tk}-r01 ...) with traits: town, cohort, channel, neighborhood.", store=self.memory.last_store)
        town_is = {"trait": "town", "operator": "is", "values": [tk]}
        m = self.memory.put_audience(self.heard_slug, f"{self.city}: heard the library notice",
                                     {"match": "all", "conditions": [town_is, {"trait": self.heard_trait, "operator": "is", "values": ["true"]}]})
        self.emit("AUDIENCE", agent="eli", op="replace_audience", slug=self.heard_slug, kind="rule",
                  rule=f"town = {tk} AND {self.heard_trait} = true (this trial's notice)", members=m, store=self.memory.last_store)
        m = self.memory.put_audience(parents_slug, f"{self.city}: working parents",
                                     {"match": "all", "conditions": [town_is, {"trait": "cohort", "operator": "is", "values": ["families"]}]})
        self.emit("AUDIENCE", agent="eli", op="replace_audience", slug=parents_slug, kind="rule", rule=f"town = {tk} AND cohort = families",
                  members=m, store=self.memory.last_store)
        # One notice per trial, with distinctive text for the recall spot checks. (Measured: past.dev applies late
        # rule-audience membership to a fresh source within ~7 s, but not reliably to a re-sent revision.)
        self.notice_id = f"notice-{self.id}"
        self.notice_text = (f"Library notice {self.id}: the {self.city} public library is changing its opening hours. "
                            f"Residents who received notice {self.id} can find the new times on the library website.")
        self.remember("eli", self.notice_id, self.notice_text, "notice", "town-trial:notice", audience=self.heard_slug)

    def after_brief(self, best: dict) -> None:
        """Perception: replay the watched run (seed 0 of the recommended policy) into past.dev, and spot-check recall."""
        if not self.is_awareness() or not getattr(self, "resident_ids", None):
            return
        from sim import run_jobs_local
        learn = run_jobs_local([{"city": self.city, "mode": self.mode, "policy": best["policy"], "seeds": [0], "days": self.days, "learn": True,
                                 "spec": self.spec}])[0]["learn"]
        learned = [e["resident"] for e in learn]
        fam = [r for r in learned if self.residents_info[r]["cohort"] == "families"]
        never = [r for r in self.resident_ids if r not in learned]
        spot = list(dict.fromkeys((fam[:1] or learned[:1]) + [r for r in learned if r not in fam][:1] + never[:1]))

        def check(when: str, settle: bool = False) -> None:
            for r in spot:
                ok, tries = False, 0
                while True:  # membership changes reach recall a few seconds after a recompute
                    tries += 1
                    ok = self.memory.recall_as(self.resident_ids[r], self.city, self.notice_text, self.notice_id)
                    if ok or not settle or r not in learned or tries >= 6:
                        break
                    time.sleep(4)
                info = self.residents_info[r]
                self.emit("MEMORY_READ", agent="eli", query=f"library notice {self.id}", identity=self.resident_ids[r], found=int(ok),
                          note=f"{when}: {info['name']} ({info['cohort']}, {'heard it' if r in learned else 'never heard it'} in the run) "
                               f"{'CAN' if ok else 'cannot'} recall the notice" + (f" (after {tries} tries)" if tries > 1 else ""),
                          store=self.memory.last_store)
        check("Before replay")
        for i, e in enumerate(learn[:120]):
            self.memory.update_traits(self.resident_ids[e["resident"]], {self.heard_trait: "true", "heard_library_notice": "true", "heard_via": e["via"]})
            if (i + 1) % 20 == 0 or i + 1 == len(learn[:120]):
                members = self.memory.recompute(self.heard_slug)
                self.emit("AUDIENCE", agent="eli", say="Replaying the watched run into past.dev" if i < 20 else None, op="update_traits", count=i + 1,
                          identity=self.resident_ids[e["resident"]], traits={"heard_library_notice": "true", "heard_via": e["via"]},
                          slug=self.heard_slug, members=members,
                          note=f"{best['id']} seed 0: {i + 1}/{len(learn)} residents who heard the notice updated; audience recomputed",
                          store=self.memory.last_store)
        check("After replay", settle=True)

    def translate(self) -> dict | None:
        mode, P = self.mode, self.P
        baseline = describe_hours(self.base_hours) if mode == "service" else f"notice channels: {', '.join(self.base_policy['channels'])}"

        def validate(o):
            return validate_action(mode, _action(mode, o)) if o.get("representable") else None
        out, err = self.attempt("bo", "translate", lambda e: self.bo.translate(mode, self.city, self.prompt, baseline, e), validate)
        if err:
            self.fallback_note("bo", "Translating the idea", err)
            if mode == "service":
                out = {"representable": True, "label": "Tue/Thu until 21:00", "hours_changes": [{"day": 1, "open": "10:00", "close": "21:00"},
                       {"day": 3, "open": "10:00", "close": "21:00"}], "channels": [], "why": "Scripted default idea.", "evidence_url": None,
                       "claim": f"In {self.city}, opening the library until 21:00 on Tue and Thu increases visits by residents who cannot use current hours.",
                       "scripted": True}
            else:
                out = {"representable": True, "label": "Online post only", "hours_changes": [], "channels": ["online"], "why": "Scripted default idea.",
                       "evidence_url": None, "claim": f"In {self.city}, posting the notice online only reaches most working parents within 3 days.",
                       "scripted": True}
        if not out["representable"]:
            rb, err2 = self.attempt("bo", "research brief", lambda e: self.bo.research_brief(self.city, self.prompt))
            self.emit("BRIEF", agent="bo", say="This needs data, not a simulation", recommend="none", label="Research brief (no simulation)",
                      summary=(rb or {}).get("reason", "The idea can't be expressed with the supported actions (library hours or notice channels)."),
                      assumptions="No simulated number is reported for ideas outside the supported actions.",
                      pilot=(rb or {}).get("data_plan", "Collect local data on the idea before simulating it."), scripted=bool(err2))
            return None
        self.emit("CLAIM", agent="bo", say="Writing the testable claim", claim=out["claim"], metric=P["label"],
                  constraint="staff hours (unknown yet)" if mode == "service" else "no paid ads",
                  horizon=f"{'1 week' if mode == 'service' else '3 days'}, {SEEDS} matched seeds", prompt=self.prompt, scripted=bool(out.get("scripted")))
        if mode == "service" and "fact-library-hours" in self.written:
            self.read("bo", "fact-library-hours", "baseline policy E0", say="Reading Exa Dude's fact, building runs")
        return {**out, **_action(mode, out)}

    def cy_recall(self) -> None:
        """Cy recalls the town's evidence (written by Exa Dude) before reviewing; recalled facts join the review context."""
        facts = self.memory.recall("cy", self.city, "library facts constraints sources", kinds=("fact", "constraint"))
        known = {e["claim"] for e in self.evidence}
        for f in facts:
            self.emit("MEMORY_READ", agent="cy", say="Recalling the evidence before reviewing", source_id=f["source_id"], author=f["author"],
                      claim=f["claim"], used_for="grounds for reviewing the next proposals", store=self.memory.last_store,
                      recalled=f.get("recalled") or [])
            if f["claim"] not in known:
                self.evidence.append({"claim": f["claim"], "url": f["source"], "author": f["author"]})
        if not facts:
            self.emit("MEMORY_READ", agent="cy", query=f"{self.city} library facts constraints", found=0,
                      note="No facts recalled yet; reviewing against the trace only.", store=self.memory.last_store)

    def cy_check_user(self, x: dict, why: str) -> None:
        """The user's idea is always run (it's what they asked); Cy flags concerns but doesn't block it."""
        out, err = self.attempt("cy", "review", lambda e: self.cy.review(self.mode, f"{x['id']} (the user's own idea): {x['change']}",
                                                                          self.evidence_text(), self.constraints_text()))
        if err:
            self.fallback_note("cy", f"Review of {x['id']}", err)
            out = {"ok": True, "reason": "Supported actions only; staffing is an unverified input.", "ungrounded_inputs": [], "scripted": True}
        flag = f" Needs {staff_hours(x['policy']['hours'])} staff hours/week vs {staff_hours(self.base_hours)} now." if self.mode == "service" else ""
        self.emit("REVIEW", agent="cy", say=f"Checking {x['id']}'s assumptions", exp=x["id"], ok=True, reason=(out["reason"] + flag).strip(),
                  ungrounded=out.get("ungrounded_inputs") or [], scripted=bool(out.get("scripted")), note="user's idea: always run")

    def round(self, rnd: int, best: dict) -> dict:
        mode, city = self.mode, self.city
        # 1. Cy reads the failure trace
        fail, err = self.attempt("cy", "failure", lambda e: self.cy.failure(mode, city, self.results_text(), self.trace_text(best), self.constraints_text()))
        if err:
            self.fallback_note("cy", "Reading the failure trace", err)
            fail = ({"trace": f"Best so far {best['id']} reaches {self.fmt(best)}; whether it can be staffed is unchecked.",
                     "next_question": "Is extra evening staffing allowed this fiscal year?", "entity": "library board",
                     "search_topic": "board minutes staffing budget evening hours"}
                    if mode == "service" else
                    {"trace": f"Best so far {best['id']} reaches {self.fmt(best)} of working parents.",
                     "next_question": "What channel reaches parents during the school run?", "entity": "elementary school",
                     "search_topic": "weekly family bulletin newsletter"})
            fail["scripted"] = True
        self.emit("FAILURE", agent="cy", say="Reading the failure trace", exp=best["id"], trace=fail["trace"], next_question=fail["next_question"],
                  entity=fail["entity"], scripted=bool(fail.get("scripted")))
        self.remember("cy", f"failure-{self.id}-{rnd + 1}", f"{best['id']}: {fail['trace']} Next: {fail['next_question']}", "failure", f"trial:{self.id}")

        # 2. Exa Dude's failure-guided search
        source = None
        if self.budget.left("exa") > 0:
            q = " ".join(f"{city} {fail['entity']} {fail.get('search_topic') or fail['next_question']}".split()[:16])
            if self.exa_mode == "broad":  # ablation: same number of searches, not guided by the failure
                q = [f"{city} public library", f"{city} library news"][rnd % 2]
            fx = fixtures.board_minutes if mode == "service" else fixtures.school_bulletin
            res, live = self.search("exa", q, "failure-guided", fx, "Failure-guided search")
            if mode == "service":
                source = self.apply_constraint(q, res, live, fail["next_question"])
            else:
                source = self.apply_channels(q, res, live, fail["next_question"])
        else:
            self.note("Exa budget used up; no failure-guided search this round.", agent="exa")

        # 3. Bo revises, reading Exa Dude's facts from memory
        bo_mem = [f for sid in ("fact-staffing-cap", "fact-school-bulletin", "fact-notice-board", "fact-notice-channels") if sid in self.written
                  and (f := self.read("bo", sid, f"Bo's round {rnd + 1} revision prompt", say="Reading Exa Dude's finds"))]
        self.cy_recall()
        context = (f"Current practice: {describe_hours(self.base_hours) if mode == 'service' else ', '.join(self.base_policy['channels'])}\n"
                   f"Results so far: {self.results_text()}\nFailure trace: {self.trace_text(best)}\nReviewer's question: {fail['next_question']}\n"
                   f"Constraints (enforced in code): {self.constraints_text()}\nLocal sources: {self.evidence_text()}\n"
                   + self.memory_text(bo_mem)
                   + (f"Channels with local evidence: {self.channels_grounded}\n" if mode == "perception" else "")
                   + "Already tried (don't repeat): " + "; ".join(x["change"] for x in self.exps))

        def validate(props):
            for p in props:
                e = validate_action(mode, _action(mode, p))
                if e:
                    return f"{p.get('label')}: {e}"
            return None if props else "no proposals"
        props, err = self.attempt("bo", "revise", lambda e: self.bo.revise(mode, city, context, 2, e), validate)
        if err:
            self.fallback_note("bo", f"Round {rnd + 1} revisions", err)
            props = self.scripted_revisions(rnd)
        new = []
        for p in props:
            pol = self.policy_of(_action(mode, p))
            if any(x["policy"] == pol for x in self.exps):
                self.note(f"Bo's proposal '{p['label']}' repeats an earlier experiment; skipped.", agent="bo")
                continue
            x = self.exp(id=self.next_id(), label=p["label"][:60], role="revision", parent=best["id"], policy=pol, change=self.change_of(pol),
                         source=p.get("evidence_url") or source)
            self.emit("PROPOSE", agent="bo", say=f"Proposing {x['id']}", exp=x["id"], parent=best["id"], change=x["change"], why=p["why"],
                      scripted=bool(p.get("scripted")))
            if self.review(x, p["why"], self.trace_text(best)):
                new.append(x)
        if not new:
            return best
        out = self.run(new, say=f"Running {' + '.join(x['id'] for x in new)}", trace=True)
        cands = [x for x in self.exps if x.get("result") and x["status"] == "done" and x["role"] in ("revision", "user")]
        top = max(cands, key=self.value) if cands else best
        for x in new:
            self.run_done(x, out, view=x is top)
        return top

    def apply_constraint(self, q: str, res: list[dict], live: bool, question: str) -> str | None:
        ext, how = self.extract("constraint", res, live, question)
        cap = None
        if ext and ext["kind"] in ("no_additional_staff_hours", "budget_cut"):
            cap = staff_hours(self.base_hours)
        elif ext and ext["kind"] == "staff_hours_cap" and ext.get("hours_per_week"):
            cap = ext["hours_per_week"]
        if cap is None:
            self.log_exa("exa", q, "failure-guided", res, live,
                         f"No staffing limit stated ({how if not ext else 'statement not about staff hours: ' + ext['statement']}). Gap logged.")
            if not self.constraint and not getattr(self, "_gap_noted", False):
                self._gap_noted = True
                self.note("Gap: no local source states a staffing limit. Experiments that add staff hours stay runnable but are "
                          f"flagged: they need more than the current {staff_hours(self.base_hours)} staff hours/week.", agent="exa")
            return None
        text = f"staff hours <= {fixed(cap, 0)}/week"
        if ext["kind"] == "budget_cut":
            text += " (interpreted: a budget cut read as no additional staff hours)"
        elif ext["kind"] == "no_additional_staff_hours":
            text += " (no additional staff hours)"
        if self.constraint and self.constraint[0] == text:
            self.log_exa("exa", q, "failure-guided", res, live, f"Confirms the existing constraint: {text} (quote: \"{ext['quote'][:160]}\")")
            return ext["url"]
        self.log_exa("exa", q, "failure-guided", res, live, f"Adds constraint: {text} (quote: \"{ext['quote'][:160]}\")")
        before = [x for x in self.exps if x.get("result") and x["status"] == "done"]
        self.constraint = (text, lambda x, cap=cap: "hours" not in x["policy"] or staff_hours(x["policy"]["hours"]) <= cap)
        broken = [x for x in before if not self.feasible(x)]
        self.emit("CONSTRAINT", agent="exa", constraint=text, source=ext["url"], previous="unknown",
                  changes=[f"{x['id']} is now infeasible" for x in broken] or ["no existing experiment breaks it"])
        for x in broken:
            self.set(x, status="infeasible")
        self.evidence.append({"claim": ext["statement"], "url": ext["url"], "author": "exa"})
        self.remember("exa", "fact-staffing-cap", ext["statement"], "constraint", ext["url"], query=q, effective=self.published(res, ext["url"]))
        return ext["url"]

    def apply_channels(self, q: str, res: list[dict], live: bool, question: str) -> str | None:
        ext, how = self.extract("channels", res, live, question)
        if not ext:
            self.log_exa("exa", q, "failure-guided", res, live, f"No channel evidence ({how}). Gap logged; untested channels stay labelled as assumptions.")
            return None
        for c in ext["channels"]:
            self.channels_grounded[c] = ext["url"]
        self.log_exa("exa", q, "failure-guided", res, live, f"Local evidence for channels: {', '.join(ext['channels'])} (quote: \"{ext['quote'][:160]}\")")
        self.evidence.append({"claim": ext["statement"], "url": ext["url"], "author": "exa"})
        sid = "fact-school-bulletin" if "bulletin" in ext["channels"] else "fact-notice-board" if "board" in ext["channels"] else "fact-notice-channels"
        self.remember("exa", sid, ext["statement"], "fact", ext["url"], query=q, effective=self.published(res, ext["url"]))
        return ext["url"]

    def scripted_revisions(self, rnd: int) -> list[dict]:
        if self.mode == "service":
            base = [{"day": 1, "open": "13:00", "close": "21:00"}, {"day": 3, "open": "13:00", "close": "21:00"}]
            if rnd:
                base = base + [{"day": 5, "open": "12:00", "close": "20:00"}]
            return [{"label": "Shift Tue/Thu to 13:00-21:00" + (" + Sat 12-20" if rnd else ""), "hours_changes": base, "channels": [],
                     "why": "Move morning hours to the evening at the same staff hours.", "evidence_url": None, "scripted": True}]
        return [{"label": "+ paper flyers", "hours_changes": [], "channels": ["online", "board"], "why": "Paper flyers where offline residents go.",
                 "evidence_url": None, "scripted": True},
                {"label": "+ school bulletin", "hours_changes": [], "channels": ["online", "bulletin"], "why": "Reaches parents at drop-off.",
                 "evidence_url": None, "scripted": True}]

    def baselines(self) -> None:
        """Matched-budget arms: parameter sweep (6 configs) and one-shot LLM (same model and evidence, no feedback)."""
        mode, P = self.mode, self.P
        if mode == "service":
            options = []
            for days in ([1], [3], [5], [1, 3], [2, 4], [1, 3, 5], [0, 2], [4, 5]):
                for open_ in (H(12), H(13)):
                    options.append([(d, open_, open_ + H(8)) for d in days])
            sweep = [{"key": f"S{k + 1}", "policy": {"hours": [list(o) if o else None for o in
                                                               apply_changes(self.base_hours, [{"day": d, "open": f"{a // 60:02d}:{a % 60:02d}", "close": f"{b // 60:02d}:{b % 60:02d}"} for d, a, b in c])]}}
                     for k, c in enumerate(options[:SWEEP_BUDGET])]
        else:
            combos = [["online", "board"], ["online", "bulletin"], ["online", "board", "bulletin"], ["board"], ["bulletin"], ["online"]][:SWEEP_BUDGET]
            sweep = [{"key": f"S{k + 1}", "policy": {"channels": c}} for k, c in enumerate(combos)]
        evidence = "; ".join(e["claim"] for e in self.evidence[:2]) or "none"
        os_, err = self.attempt("bo", "one-shot", lambda e: self.bo.oneshot(mode, self.city, self.prompt, evidence, e),
                                lambda o: validate_action(mode, _action(mode, o)))
        if err:
            self.fallback_note("bo", "One-shot baseline", err)
            os_ = ({"label": "Sat 12:00-20:00", "hours_changes": [{"day": 5, "open": "12:00", "close": "20:00"}], "channels": [], "scripted": True}
                   if mode == "service" else {"label": "online + board", "hours_changes": [], "channels": ["online", "board"], "scripted": True})
        os_pol = self.policy_of(_action(mode, os_))
        OS = self.exp(id="OS", label=f"One-shot: {os_['label']}"[:60], role="oneshot", parent=self.exps[0]["id"], policy=os_pol,
                      change=self.change_of(os_pol) + " (single proposal, no feedback)")
        self.emit("PROPOSE", agent="bo", exp="OS", parent=self.exps[0]["id"], change=OS["change"], scripted=bool(os_.get("scripted")),
                  why=(os_.get("why") or "One-shot baseline arm.") + " (One-shot arm: same model and evidence, no simulation feedback.)")
        jobs = [self.job(s["key"], s["policy"]) for s in sweep] + [self.job("OS", os_pol)]
        self.emit("RUN_START", agent="dee", say="Running the baselines", exps=[s["key"] for s in sweep] + ["OS"], seeds=SEEDS,
                  workers=len(self.runner.plan(jobs)), where=self.runner.where)
        out = self.fanout(jobs)
        best = max(sweep, key=lambda s: out["results"][s["key"]]["mean"][P["key"]])
        SW = self.exp(id="SW", label=f"Best of {len(sweep)} auto-tried options", role="sweep", parent=self.exps[0]["id"], policy=best["policy"],
                      change=self.change_of(best["policy"]))
        self.set(SW, result=out["results"][best["key"]], status="done" if self.feasible(SW) else "infeasible")
        self.set(OS, result=out["results"]["OS"], status="done" if self.feasible(OS) else "infeasible")
        self.emit("RUN_DONE", agent="dee", exp="SW", metric=P["key"], value=self.fmt(SW), note=f"best of {len(sweep)} sweep configs",
                  wall_s=out["wall_s"], workers=out["workers"])
        self.emit("RUN_DONE", agent="dee", exp="OS", metric=P["key"], value=self.fmt(OS), note="one-shot LLM proposal, same model, no feedback",
                  wall_s=out["wall_s"], workers=out["workers"], scripted=bool(os_.get("scripted")))

    def write_brief(self, best: dict, base: dict) -> dict:
        P = self.P
        summary = f"{best['label']}: {self.fmt(best)} vs {self.fmt(base)} for current practice ({P['label']})."
        sourced = [e for e in self.evidence if not str(e["url"]).startswith("fixture://")]
        ctx = (f"Recommended: {best['id']} {best['label']} ({best['change']}). {summary}\nAll results: {self.results_text()}\n"
               f"Held-out test: {json.dumps(self.held_out_table)}\nConstraints: {self.constraints_text()}\nLocal sources: {self.evidence_text()}\n"
               f"Effect per resident group (simulator): {self.who_text()}\n"
               f"Inputs that are synthetic: resident schedules, arrival and word-of-mouth rates (model defaults). "
               + (f"The recommended policy assumes these channels exist without a local source: {', '.join(self.assumed(best['policy']))}. "
                  if self.mode == "perception" and self.assumed(best["policy"]) else "")
               + 
               f"{'No real sources were found; evidence is FIXTURE.' if not sourced else ''}")
        out, err = self.attempt("bo", "brief", lambda e: self.bo.brief(self.mode, ctx))
        if err:
            self.fallback_note("bo", "Writing the brief", err)
            return {"summary": summary, "scripted": True, **self.scripted_explain(best, base),
                    "assumptions": f"Resident schedules and arrival/word-of-mouth rates are synthetic. Constraints: {self.constraints_text()}. "
                                   f"Sources: {self.evidence_text()}",
                    "pilot": "Pilot for 4 weeks and count who uses the change; compare with the simulated cohorts." if self.mode == "service"
                    else "Try the channel for 2 weeks and survey parents at pickup."}
        return {"summary": f"{summary} {out['why']}", "assumptions": out["assumptions"], "pilot": out["pilot"], "what": out["what"],
                "reasoning": out["reasoning"], "scripted": False}
