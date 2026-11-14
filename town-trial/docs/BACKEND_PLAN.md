# Town Trial backend plan

Goal: replace the scripted research loop (`web/js/research.js`) with live agents that use **Exa** for evidence, **past.dev** for shared memory and audiences, an **LLM** for proposals and reviews, and **Modal** to run the simulator in parallel. They must write the same events the frontend already renders. Deadline: Sunday 2:00 PM PT. Aim to finish features by Sunday 10:00 AM.

## Architecture

```
Vercel (main)                         Modal workspace "constant-lab"
town-trial/web  ── POST /api/trials ─▶  town-trial-api   (FastAPI, asgi_app, CORS)
   live.js     ◀─ GET  /events?since ─      │ spawns
                                            ▼
                                       orchestrator (one per trial, Python)
                                        ├─ agents: Ada (Exa), Bo (designer, LLM), Cy (reviewer, LLM),
                                        │          Dee (runner), Eli (past.dev archivist)
                                        ├─ past.dev REST  (facts, handoffs, identities, audiences)
                                        ├─ Exa (exa_py)   (baseline + failure-guided search)
                                        └─ run_batch.map(...) ─▶ sim workers (Node + sim.js), fan-out
                                       event store: one writer per trial (modal.Dict or Volume file)
```

## Milestones (check them off in this file as you go)

- [x] **M0: one simulator, callable from Node (target Sat 4 PM)**: done. `web/js/layout.js`, `sim/run_batch.mjs`, `tests/parity_check.mjs`; browser `window.__townTrial.fingerprint()` for "Evart, MI" matches Node.
  - Split `web/js/town.js` into a pure layout module (`web/js/layout.js`: buildings, ids, doors, nodes, `pathBetween`, no three.js) and the renderer, which imports it. **Keep RNG call order identical**, so the same city name gives the same town and residents in the browser and in Node.
  - Add `town-trial/sim/run_batch.mjs`: reads JSON `{city, mode, policy, seeds, days, scenario}` on stdin and prints `runBatch` JSON. Uses `layout.js`, `sim.js`, `rng.js`.
  - Add a parity test: a hash of `makeResidents(layout("Evart, MI"))` matches what the browser computes (expose it via `window.__townTrial`). Keep `tests/sim_check.mjs` passing.
- [x] **M1: end-to-end live mode with the scripted loop (target Sat 6 PM)**: done. Deployed at `https://constant-lab--town-trial-api-web.us-east.modal.run` (frontend: `?api=<url>` or `config.js`). Words scripted (`scripted: true`), evidence FIXTURE, numbers real (Modal `run_batch.map`, up to 30 workers).
  - `town-trial/backend/` (Python): `app.py` (Modal app `town-trial-api`), `orchestrator.py`, `agents/`, `events.py`.
  - Port the step order of `research.js` to Python first, with fixtures, so the frontend live mode works before any external API does.
  - Modal worker `run_batch` (image: `debian_slim` + `nodejs` + `town-trial/web/js` + `town-trial/sim`) and fan-out with `.map()` over (policy × seed-chunk × scenario).
  - Frontend: `web/js/live.js` + hook in `main.js` (see "Frontend contract" below). Demo mode unchanged when `TOWN_TRIAL_API` is empty.
  - Deploy: `modal deploy town-trial/backend/app.py`. Put the URL in the PR description. The frontend teammate sets it in `config.js` on `main`.
- [ ] **M2: live Exa + LLM agents (target Sat 9 PM)**
  - Ada: baseline search for current practice, then a **failure-guided** search built from Cy's `next_question` plus city plus the specific entity (branch, school, board). Use contents/highlights; store the passage. An LLM extracts a value or constraint **only** if the passage states it, citing the passage. If nothing is found, log the gap and use a labelled sensitivity range.
  - Bo: proposes policies as JSON validated against the action schema below (reject and retry on invalid output). Cy: reviews causal assumptions, rejects inputs not grounded in local sources, reads failure traces (turned-away log, awareness by cohort) and writes `next_question`.
  - Constraints are checked in code (e.g. staff hours), never by the LLM.
- [ ] **M3: live past.dev (target Sat midnight)**
  - One past.dev identity per agent (`ada`, `bo`, `cy`, `dee`, `eli`). Facts and constraints are ingested with `source_id`, `timestamp` (effective date), `metadata` (source URL, query, trial id) and a `label`. Reusing a `source_id` replaces the prior revision, so log `supersedes`.
  - Handoffs: Bo **recalls** Ada's facts before every proposal; Cy recalls evidence before reviewing; Eli recalls prior facts for the same town when a new trial starts. Log every read with `author`.
  - Perception trials: Eli bulk-creates one identity per resident (traits: cohort, channel, neighborhood) and rule audiences `heard-library-notice` (heard_library_notice = true) and `working-parents` (cohort = families). The notice is ingested once with `audience: heard-library-notice`. For the **watched run** (seed 0 of the chosen experiment), replay LEARN events through `update traits` → `recompute audience`, and spot-check `recall` for 2–3 residents before and after. Batch runs don't call past.dev (too many calls).
  - Known from the past.dev console: `POST https://app.past.dev/api/v1/ingest` (body: `id, content, label, timestamp, identity, metadata`) and `POST https://app.past.dev/api/v1/recall` (body: `query, identity, level`), both with `Authorization: Bearer $PAST_DEV_API_KEY`. The key belongs to the project `default-project`. Use the API Explorer in the console for identity and audience endpoints.
  - Check exact endpoints in the docs (docs MCP at `https://past.dev/mcp`; Composio's toolkit page lists the operations: ingest, ingest batch, recall, replace/update identity, bulk replace identities, replace/recompute audience). Ask the past.dev mentor on site (Lazare Masset) if anything is unclear.
- [ ] **M4: evaluation (overnight)**
  - The 4-way comparison with **matched budgets**: original idea, parameter sweep (N runs), one-shot LLM proposer (same search and run budget, no feedback), iterative agent. Freeze picks, then test on held-out scenarios fixed in advance (A: more shift workers, B: older town, C: busier library; seeds 100–107).
  - Exa ablation: no search vs. broad vs. failure-guided, with equal query and time budgets. Script: `town-trial/eval/exa_ablation.py`, results to `town-trial/eval/results/*.json`.
  - Modal report: the same workload run serially (one container) vs. fanned out. Wall time and estimated cost into `eval/results/modal_timing.json`.
  - Real-data anchor: use Exa to find a library that extended evening hours and published before/after visit counts. Set up the simulator with the "before" data, compare its prediction with the real "after" numbers, and report honestly whatever happens.
  - Optional: food-rescue domain as a transfer test.
- [ ] **M5: ship (Sun 10 AM)**
  - README: sponsor pointers (exact file:line of Exa calls and past.dev reads/writes), the memory table, how to deploy. Open the PR `main-backend` → `main`.

## API contract

```
GET  /api/health                      -> {"ok": true}
POST /api/trials {city, prompt}       -> {trial_id, mode: "service"|"perception", primary: {key, label, unit}}
GET  /api/trials/{id}/events?since=N  -> {events: [...], done: bool}
POST /api/trials/{id}/stop            -> {ok}
```
- CORS: `ALLOWED_ORIGINS` env (Vercel URL, its preview URLs, `http://localhost:8000`).
- The frontend polls `/events` about every 1 s. Events are append-only with increasing `seq`.

## Events

Everything in `docs/LOG_FORMAT.md`, plus two events the live frontend needs to rebuild the Experiments tab (add them to LOG_FORMAT.md):

| type | fields | meaning |
|---|---|---|
| `EXPERIMENT` | full object: `id, label, role` (`baseline`/`user`/`revision`/`sweep`/`oneshot`), `parent, policy, change, source, status` (`queued`/`running`/`done`/`infeasible`/`rejected`), `result: {n, mean:{...}, sd:{...}}`, `best` | Upsert: the latest event for an `id` wins. |
| `HELD_OUT_TABLE` | `finalists: [{id,label,role,feasible}], table: [{scenario, <id>: value}], metric` | Feeds the held-out table. |

`result.mean` / `result.sd` use the same keys as `sim.js` `runBatch` (`visits, restrictedVisits, turnedAway, uniqueVisitors, staffHours, awarePct, familiesAwarePct`). Add `wall_s` and `workers` to `RUN_DONE`. Researcher events carry `agent` (`ada|bo|cy|dee|eli`), so Heaven animates the right person: walk to the station for that event type (EXA → lookout, MEMORY_* / AUDIENCE → archive, CLAIM/PROPOSE/BRIEF → drafting, REVIEW/FAILURE/HELD_OUT → court, RUN_* → portal).

## Policy action schema (what Bo may propose)

```json
// service (library hours): day 0=Mon..6=Sun, times "HH:MM", open=null closes that day
{"hours_changes": [{"day": 1, "open": "13:00", "close": "21:00"}]}
// perception (notice outreach)
{"channels": ["online", "board", "bulletin"]}
```
Anything else gets the research-brief path (`BRIEF` with a data-collection plan, no simulated number).

## Frontend contract (`web/js/live.js`)

- If `window.TOWN_TRIAL_API` is set, the prompt form POSTs to `/api/trials` and polls `/events`. Each event goes to the existing `emit()` path (log cards), `EXPERIMENT` / `HELD_OUT_TABLE` rebuild `research.exps`, and researcher events drive `researchers[agent].moveTo(...)` and `.say(...)`.
- Replay stays in the browser: when a new best experiment arrives, call `startReplay(exp)` with its `policy` (seed 0, same residents through `layout.js`), exactly as demo mode does.
- On any network error: toast it and offer "continue in demo mode".

## Fallbacks (the trial must always finish)

- Exa fails or times out: log it, then use the fixture labelled `FIXTURE` and mark dependent experiments `source: fixture`.
- past.dev fails: log it and fall back to a local JSON memory with the same reads and writes, noted in `MEMORY_*` events (`store: local-fallback`).
- LLM output invalid twice: use the scripted step from `research.js`, labelled `scripted: true`.
- Modal fan-out fails: run batches in the orchestrator container and log it.

## Budget guards

- Max Exa calls per trial: 6. Max LLM calls per trial: 20. Max simulator runs per arm: equal across arms (default 6 policies × 16 seeds).
- One trial at a time per client; cap concurrent trials at 3.
