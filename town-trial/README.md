# Town Trial

A test bench for local policy ideas. Type a city, get a blocky 3D town full of residents; type an idea, and a team of research agents in **Heaven** (a floating island above the town) turns it into an experiment, searches for missing facts, revises it, and reports what works, for whom, and under which assumptions.

Iterate AI Research Hackathon, Nov 14–15, 2026 · Track 4 (World Models; falls back to Track 5 Open if we don't beat a benchmark) · Exa · past.dev · Modal.

## Run it

```
cd town-trial/web && python3 -m http.server 8000
```

Open http://localhost:8000. No build step and no internet needed (three.js and fonts are vendored).
Shortcut URL params: `?city=Evart, MI&prompt=...&speed=16&view=heaven`.

### Deploy the frontend (Vercel)

Import the repo in Vercel and set **Root Directory = `town-trial/web`**, Framework Preset = **Other**, no build command, no output directory. It's a static site. Every push to `main` redeploys.

The frontend talks to the backend through one setting: `window.TOWN_TRIAL_API` in `web/config.js`. Leave it empty for the demo. Once the Modal backend is deployed (branch `main-backend`), put its URL there, or test with `?api=<modal url>` on any Vercel preview. The backend must allow CORS from the Vercel domain.

Simulator checks: `node town-trial/tests/sim_check.mjs` (capacity cap, nobody lost, closed library gives 0 visits, staff-hour arithmetic, deterministic replay, no outreach gives 0 awareness). Parity and backend checks: `node town-trial/tests/parity_check.mjs`, `python town-trial/tests/backend_check.py`.

### Live mode (backend on Modal)

The backend is deployed at `https://constant-lab--town-trial-api-web.us-east.modal.run`. Open the site with
`?api=https://constant-lab--town-trial-api-web.us-east.modal.run` (or set `window.TOWN_TRIAL_API` in `web/config.js`)
and the research loop runs live: Exa searches, LLM agents (OpenAI `gpt-5.4-mini`), past.dev memory, simulator
runs fanned out on Modal. With no API set, the site runs the demo loop in the browser. Deploy and local-run
instructions: [`backend/README.md`](backend/README.md).

## What's real and what's demo

| Part | Demo mode (no backend) | Live mode (backend) |
|---|---|---|
| Town generation | Procedural, seeded by the city name (`web/js/layout.js`, same in browser and Node) | same |
| Simulator (`web/js/sim.js`) | Real rules, runs in the browser | The same file, run with Node in Modal workers; parity-tested against the browser |
| Research agents' words | Scripted (`web/js/research.js`) | LLM agents with structured outputs; any scripted fallback is labelled `scripted: true` |
| Evidence | **FIXTURE** placeholders, labelled | Live Exa results with source URLs; a value is used only if its quote is found in the returned page (checked in code). Exa failure: labelled FIXTURE |
| past.dev | Shown as events | Real API calls: facts, handoffs, identities, rule audiences, gated notice, recall checks |
| Modal | Runs in the browser | Policies x seed chunks x held-out scenarios fanned out with `run_batch.map` |

Evaluation results (4-way comparison, Exa ablation, Modal timing, real-data anchor): [`eval/RESULTS.md`](eval/RESULTS.md).
The simulator ranks policies inside one model; its magnitudes are **not** forecasts (the real-data check found it
under-predicts the effect of longer hours about 12x; see the results).

## Sponsor pointers

**Exa** (main loop, every trial; `exa_py`):
- The Exa call: [`backend/agents/ada.py:49`](backend/agents/ada.py#L49) (`search_and_contents` with highlights and page text).
- Baseline search: [`backend/research_loop.py:272`](backend/research_loop.py#L272) (hours trials) and [`:307`](backend/research_loop.py#L307) (notice trials).
- Failure-guided search, built from Cy's `next_question` + town + entity: [`backend/research_loop.py:473`](backend/research_loop.py#L473).
- Grounded extraction and quote verification: [`backend/agents/ada.py:68`](backend/agents/ada.py#L68) (`_verify`), [`:85`](backend/agents/ada.py#L85), [`:97`](backend/agents/ada.py#L97), [`:110`](backend/agents/ada.py#L110).
- On screen: each `EXA` log card shows the query, the pages found (title, passage, URL) and what the result changed. Ablation: `eval/exa_ablation.py`.

**past.dev** (REST API, `https://api.past.dev/api/v1`):
- Client: [`backend/memory.py:124`](backend/memory.py#L124) (`PastDevMemory`): ingest [`:146`](backend/memory.py#L146), recall [`:190`](backend/memory.py#L190) / [`:194`](backend/memory.py#L194), identities [`:206`](backend/memory.py#L206) / [`:213`](backend/memory.py#L213), audiences [`:217`](backend/memory.py#L217) / [`:221`](backend/memory.py#L221), gated recall check [`:224`](backend/memory.py#L224). Local fallback: [`:229`](backend/memory.py#L229).
- Every write goes through [`backend/research_loop.py:138`](backend/research_loop.py#L138) (`remember`) and every handoff read through [`:146`](backend/research_loop.py#L146) (`read`, logged with `author`).
- Writes: Ada's facts [`:288`](backend/research_loop.py#L288), [`:314`](backend/research_loop.py#L314), [`:555`](backend/research_loop.py#L555), [`:568`](backend/research_loop.py#L568); Cy's failure reasons [`:464`](backend/research_loop.py#L464); Eli's notice (audience-scoped) [`:352`](backend/research_loop.py#L352).
- Reads of another agent's data: Eli recalls the town's facts from earlier trials [`:256`](backend/research_loop.py#L256); Bo reads Ada's facts [`:420`](backend/research_loop.py#L420), [`:484`](backend/research_loop.py#L484); Cy recalls the evidence before reviewing [`:425`](backend/research_loop.py#L425).
- Perception trials: identities and rule audiences [`:323`](backend/research_loop.py#L323); watched-run replay (trait updates, recompute, recall before/after) [`:354`](backend/research_loop.py#L354).

**Modal** (workspace `constant-lab`, app `town-trial-api`):
- Simulator worker (Node + `sim.js`): [`backend/app.py:53`](backend/app.py#L53); fan-out with `.map`: [`backend/app.py:66`](backend/app.py#L66), planned as policy x seed-chunk x scenario in [`backend/sim.py:87`](backend/sim.py#L87).
- One orchestrator per trial: [`backend/app.py:59`](backend/app.py#L59); web API: [`backend/app.py:75`](backend/app.py#L75).
- Serial vs fanned-out wall time and cost: [`eval/modal_timing.py`](eval/modal_timing.py), results in [`eval/RESULTS.md`](eval/RESULTS.md) (21x faster at 24,576 seed-runs, identical results).

## Two kinds of trial

- **Service trial** (e.g. "extend library hours two evenings"): residents walk to the library at their free times, queue, get served or turned away. Primary metric: weekly visits by residents who can't make current hours. Constraint: staff hours.
- **Perception trial** (prompts about who hears / how people react / marketing): each resident is a past.dev identity with traits. When they hear the notice (online, notice board, school bulletin or word of mouth), their traits update and they join the trial's `heard-<trial>` rule audience, which is what lets them recall it (in live mode this runs on past.dev, and recall is checked before and after). Primary metric: % of working parents who heard within 3 days.

## Memory: which store holds what (past.dev challenge)

| Store | Holds | Written by | Read by |
|---|---|---|---|
| **past.dev** (live mode) | Dated evidence with sources: library hours, notice channels, staffing/budget constraints (`<town>:fact-*`; metadata: author, source URL, query, trial; re-sending an id replaces the prior revision and the event logs `supersedes`) | Ada (researcher) | Bo (builds and revises policies from Ada's facts), Cy (recalls evidence before reviewing), Eli (recalls the town's facts when a new trial starts) |
| **past.dev** | Failure reasons (`<town>:failure-<trial>-<round>`) | Cy (reviewer) | Agents in later trials |
| **past.dev** | One identity per agent (`ada`, `bo`, `cy`, `dee`, `eli`) and per resident (`<town>-r01` ..., traits: town, cohort, channel, neighborhood); rule audiences `heard-<trial>` and `parents-<town>`; the notice, scoped to `heard-<trial>` so only residents who heard it can recall it | Eli (archivist) | Residents' recall (checked before and after the watched-run replay) |
| **Local memory** (`modal.Dict` "town-trial-memory") | The same reads and writes when past.dev fails (`store: local-fallback` in the log) | all | all |
| **Experiment log** (`modal.Dict` "town-trial-events", see `docs/LOG_FORMAT.md`) | Exact run configs, seeds, results, parent links, every agent step | Orchestrator | The viewer, the comparison tables, replay |

Cross-agent reads are logged as `MEMORY_READ` with `author != agent`.

## Files

```
web/index.html, style.css     UI shell (pixel style)
web/js/main.js                scene, camera, day/night, picking, labels, wiring
web/js/layout.js              procedural town layout (pure data; browser and Node)
web/js/town.js                renders the layout with three.js
web/js/people.js              blocky residents and researchers
web/js/heaven.js              floating island, stations, clouds, falling cubes
web/js/sim.js                 the simulator (no rendering)
web/js/research.js            demo research loop (scripted words, real runs)
web/js/live.js                live mode: polls the backend's event log
web/js/ui.js                  side panel rendering
sim/run_batch.mjs             Node entry point for the simulator (Modal workers)
backend/                      Modal app, orchestrator, agents, memory (see backend/README.md)
eval/                         evaluation scripts and results (see eval/RESULTS.md)
docs/LOG_FORMAT.md            event types
tests/                        simulator, parity and backend checks
```
