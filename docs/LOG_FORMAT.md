# Event log format

One JSON object per line in `events.jsonl`. Write with `constant_lab.events.emit(type, **fields)`.
The viewer rebuilds everything it shows from these events, so if it isn't logged, it isn't on screen.

Common fields: `seq` (int, added by `emit`), `t` (UTC ISO time, added by `emit`), `type`, and usually `peak` (constant id, e.g. `"16a"`) and `agent` (name).
**Scores are strings** (`"2.1562255279"`), never floats, so digits survive.

| type | fields | meaning |
|---|---|---|
| `PEAK` | `peak, name, constant, direction` (`maximize`/`minimize`), `record, record_source, start, blurb` | A constant the lab is attacking. `record` = bound to beat. `start` = the lab's starting score (altitude 0). |
| `AGENT` | `agent, peak, role` (`breaker`/`researcher`/`verifier`), `approach, steps[]` | An agent joins a peak with a plain-language approach. |
| `APPROACH` | `agent, approach, steps[]` | The agent changed its approach. |
| `KEEP` | `agent, peak, score, summary, cost_s` | An attempt improved the exact score and was kept. |
| `REVERT` | `agent, peak, summary, cost_s` | An attempt was thrown away, with the reason. |
| `MEMORY_WRITE` | `agent, peak, note_id, kind` (`trick`/`dead_end`/`bug`/`insight`), `claim` | The agent saved a note to shared memory (past.dev). |
| `MEMORY_READ` | `agent, peak, note_id, author, claim, used_for` | The agent used a note; `author` is who wrote it. Reads where `author != agent` are what the past.dev challenge asks for. |
| `EXA` | `agent, peak, query, results[{title,url}], used_for` | An Exa search in the loop, its sources, and what the lab did with them. |
| `DECIDE` | `decision, reason` | The director moved budget or agents, and why. |
| `VERIFY` | `peak, score, ok, method` | The verifier's independent check of a claimed score. |
| `SUMMIT` | `peak, score` | Verified score beats the record. Only the verifier emits this. |
| `RETIRE` | `agent, reason` | An agent stopped. |
| `BUDGET` | `spent, cap` | Running cost in dollars. |

Altitude on screen = `(best - start) / (record - start)`, direction-aware, per agent and per peak.
