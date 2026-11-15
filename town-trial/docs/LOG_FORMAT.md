# Town Trial event log

One JSON object per line. Every component writes it; the viewer rebuilds everything from it.
Common fields: `seq`, `t` (UTC ISO), `type`, `clock` (simulated time, e.g. `Tue 19:40`), and `agent` for research events.

## Research events (Heaven)

| type | fields | meaning |
|---|---|---|
| `CLAIM` | `claim, metric, constraint, horizon, prompt` | The testable claim, confirmed before any run. |
| `EXA` | `query, search` (`broad`/`failure-guided`), `results[{title,url,passage}], used_for` | An Exa call in the main loop and what it changed. |
| `MEMORY_WRITE` | `source_id, kind` (`fact`/`constraint`/`notice`/`failure`), `claim, source, effective, supersedes, audience?` | Written to past.dev. |
| `MEMORY_READ` | `source_id, author, claim, used_for` (or `query, found, note` for a recall) | Read from past.dev. `author != agent` is a cross-agent handoff. |
| `AUDIENCE` | `op` (`bulk_replace_identities`/`replace_audience`/`update_traits`), `slug, rule, members, identity, traits` | past.dev identity and audience changes. |
| `PROPOSE` | `exp, parent, change, why` | A new experiment and its parent. |
| `REVIEW` | `exp, ok, reason` | Reviewer approves or rejects (rejections are kept). |
| `RUN_START` | `exps[], seeds, workers, where` | Runs fanned out (Modal). |
| `RUN_DONE` | `exp, metric, value, staff_hours?, turned_away?, overall?` | Result over matched seeds (mean ± sd). |
| `FAILURE` | `exp, trace, next_question` | What the trace shows and the next question to ask. |
| `CONSTRAINT` | `constraint, source, previous, changes[]` | A sourced fact changed what's allowed. |
| `HELD_OUT` | `finalists[], scenarios, seeds, note` | Frozen picks tested on unseen scenarios. |
| `BRIEF` | `recommend, label, summary, what, reasoning, assumptions, pilot` | The decision brief. `what`: plain-language description of what the policy does and how it works; `reasoning`: concise why-it-wins (which residents it reaches and why, one headline number). The results popup shows these two; the log shows all fields. |
| `EXPERIMENT` | `id, label, role` (`baseline`/`user`/`revision`/`sweep`/`oneshot`), `parent, policy, change, source, status` (`queued`/`running`/`done`/`infeasible`/`rejected`), `result: {n, mean, sd}`, `best` | Upsert: the latest event for an `id` wins. Rebuilds the Experiments tab; not shown as a log card. |
| `VOICES` | `exp, base, voices[{cohort, label, role, stance` (`helped`/`hurt`/`unchanged`)`, quote, before, after, unit}], scripted, note` | How each group of residents would react to the recommended policy, emitted just before `BRIEF`. `stance`, `before`, `after` are simulator means computed in code; `role` and `quote` are LLM-written (or scripted if `scripted: true`). Not real residents. |
| `HELD_OUT_TABLE` | `finalists[{id,label,role,feasible}], table[{scenario, <id>: value}], metric` | Feeds the held-out table. Not shown as a log card. |
| `NOTE` | `level` (`info`/`warn`/`error`), `message` | A fallback, failure or stop, logged so nothing fails silently. |
| `FRAME` | `trial_type` (`perception`/`service`), `metric` (`visits`/`unique_visitors`/`visits_restricted`/`turned_away`/`awareness`/`net_cost`), `key, label, unit, direction` (`max`/`min`), `target, target_name, kind, cohort, days, budget_limit, budget_scope` | Town mode: how Bo framed the question. The Experiments tab ranks by `key` in `direction`. |

Optional fields on research events (backend):
- `say`: the short line the researcher says while acting the event out.
- `scripted: true`: the words come from the scripted loop (M1 port of `research.js`, or the fallback after invalid LLM output), not a live agent.
- `fixture: true` on `EXA`: placeholder evidence (titles say FIXTURE, URLs are `fixture://`).
- `store` on `MEMORY_*` / `AUDIENCE`: `past.dev`, `local-fallback`, or `scripted`.
- `wall_s, workers` on `RUN_DONE` / `HELD_OUT`: wall time of the fan-out and the number of workers.
- `view` on `RUN_DONE`: experiment id the viewer should replay now (`BRIEF` replays `recommend`).
- `budget` on `EXPERIMENT` (town mode): `{staff, running, revenue, campaign, net, staff_hours_week, wage}` in $/year for the places in `FRAME.budget_scope`; on `RUN_DONE` a text summary with the change vs current practice; on `BRIEF` the recommended policy's budget and `budget_delta`.
- `assumptions` on `REVIEW`: Cy's classification of each assumption (`simulation_result`, `model_mechanism`, `local_source`, `channel_existence`, `unsupported_real_world_input`); code rejects only the last.

## Town events (the run being watched)

| type | fields | meaning |
|---|---|---|
| `VISIT` | `resident, name, cohort, restricted`, town mode: `facility, facilityName, kind` | Entered the library (or, in town mode, any public place). |
| `TURNED_AWAY` | `resident, name, cohort, reason`, town mode: `facility, facilityName, kind` | Closed on arrival or while queueing. |
| `LEARN` | `resident, name, cohort, via, from?, at` | Heard the notice (perception trials). Always followed by an `AUDIENCE update_traits`. |
