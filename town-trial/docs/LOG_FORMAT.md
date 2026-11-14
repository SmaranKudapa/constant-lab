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
| `BRIEF` | `recommend, label, summary, assumptions, pilot` | The decision brief. |

## Town events (the run being watched)

| type | fields | meaning |
|---|---|---|
| `VISIT` | `resident, name, cohort, restricted` | Entered the library. |
| `TURNED_AWAY` | `resident, name, cohort, reason` | Library closed on arrival or while queueing. |
| `LEARN` | `resident, name, cohort, via, from?, at` | Heard the notice (perception trials). Always followed by an `AUDIENCE update_traits`. |
