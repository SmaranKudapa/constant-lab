# Town Trial

A test bench for local policy ideas. Type a city, get a blocky 3D town full of residents; type an idea, and a team of research agents in **Olympus** (a floating island above the town) turns it into an experiment, searches for missing facts, revises it, and reports what works, for whom, and under which assumptions.

Iterate AI Research Hackathon, Nov 14–15, 2026 · Track 4 (World Models; falls back to Track 5 Open if we don't beat a benchmark) · Exa · past.dev · Modal.

## Run it

```
cd town-trial/web && python3 -m http.server 8000
```

Open http://localhost:8000. No build step and no internet needed (three.js and fonts are vendored).
Shortcut URL params: `?city=Evart, MI&prompt=...&speed=16&view=heaven&hour=18.5` (`hour` pins the time of day).

- **Dev mode:** type `DEV67` as the city to skip the backend and run the scripted demo loop on the sample town (labelled DEV MODE).
- **Camera keys:** WASD pan, E/Q up/down, arrow keys orbit/tilt, O/I zoom out/in (mouse orbit/zoom still works).
- **Results:** 3 s after the best policy is found (while the celebration plays), a popup shows the question, key numbers (metric vs current practice, budget change, staff hours, turned away) and four tabs: *Policy* (what the policy does, and why it wins), *Residents* (how each group reacts), *Steps* (every agent action in order) and *Other experiments* (each one that wasn't picked and briefly why). Closing it ends the celebration. The **TRIALS** button reopens the popups of trials run since the page was opened (a refresh clears the list), without the celebration.
- **Resident voices:** each group's stance (helped / worse off / no change) and before/after numbers come from the simulator, computed in code; the role and one-line quote are LLM-written in live mode (`backend/agents/voices.py`) or scripted in demo mode, and always labelled as not real people.

### Deploy the frontend (Vercel)

Import the repo in Vercel and set **Root Directory = `town-trial/web`**, Framework Preset = **Other**, no build command, no output directory. It's a static site. Every push to `main` redeploys.

The frontend talks to the backend through one setting: `window.TOWN_TRIAL_API` in `web/config.js`. Leave it empty for the demo. Once the Modal backend is deployed (branch `main-backend`), put its URL there, or test with `?api=<modal url>` on any Vercel preview. The backend must allow CORS from the Vercel domain.

Simulator checks: `node town-trial/tests/sim_check.mjs` (capacity cap, nobody lost, closed library gives 0 visits, staff-hour arithmetic, deterministic replay, no outreach gives 0 awareness). Parity and backend checks: `node town-trial/tests/parity_check.mjs`, `python town-trial/tests/backend_check.py`. Trial-type classifier (perception / service / town; browser and backend must agree on 32 example questions): `node town-trial/tests/classify_check.mjs`.

### Live mode (backend on Modal)

The backend is deployed at `https://constant-lab--town-trial-api-web.us-east.modal.run`. Open the site with
`?api=https://constant-lab--town-trial-api-web.us-east.modal.run` (or set `window.TOWN_TRIAL_API` in `web/config.js`)
and the research loop runs live: Exa searches, LLM agents (OpenAI `gpt-5.4-mini`), past.dev memory, simulator
runs fanned out on Modal. With no API set, the site runs the demo loop in the browser. Deploy and local-run
instructions: [`backend/README.md`](backend/README.md).

## What's real and what's demo

| Part | Demo mode (no backend) | Live mode (backend) |
|---|---|---|
| The town | Procedural, seeded by the city name | **The real town** from OpenStreetMap: its library, schools, clinics, pharmacy, community centre, parks, sports grounds, post office, town hall, shops, workplaces, real names and street names, placed at their rough real positions on a schematic street grid; population from OSM (or the Census with `CENSUS_API_KEY`). Places OSM lacks are added only when needed and labelled synthetic. ([`backend/towns.py`](backend/towns.py)) |
| Residents | 72, model-default mix | A representative sample (60-120) sized and mixed from the town's data; each resident represents ~population/sample people |
| Simulator | `web/js/sim.js` (library hours or a notice) | **The general town model** [`web/js/townsim.js`](web/js/townsim.js): every public place has hours (real OSM opening hours when mapped), capacity, fees and staffing; residents of each group want each kind of place at labelled default rates; unmet wants build up (latent demand); people who don't know the hours get turned away; notices travel through channels at real places. Same file runs in the browser and on Modal |
| Questions | Library hours, or who hears a notice | **Any question about the town's public places**: Bo frames it (which metric, place, resident group, any budget limit you state). Policies: hours, capacity, fees, closing a place, opening a new one next to a real place, outreach. Ideas no action can test (zoning, taxes, housing) get a research brief, not a number |
| Budgets | none | Every experiment has an **annual budget**: staff hours x wage + running cost per open hour - fee revenue (scaled to the real population) + campaign cost, for the place the question is about (or the town-run places). Wages and limits come from sources Exa Dude finds (quote-checked) or labelled defaults; budget limits are enforced in code ([`backend/budget.py`](backend/budget.py)) |
| Research agents' words | Scripted (`web/js/research.js`) | LLM agents with structured outputs; scripted fallbacks are labelled `scripted: true` |
| Evidence | **FIXTURE** placeholders, labelled | Live Exa results with source URLs; a value is used only if its quote is in the returned page (checked in code) |
| Reasoning | | The **"?" button** left of every experiment shows the steps behind its outcome and which agent gave each (Bo, Exa Dude, Cy, Dee), with sources |
| past.dev | Shown as events | Real API calls: facts, handoffs, identities, rule audiences, gated notice, recall checks |
| Modal | Runs in the browser | Policies x seed chunks x held-out scenarios fanned out with `run_batch.map` |

Evaluation results (4-way comparison, Exa ablation, Modal timing, real-data anchor): [`eval/RESULTS.md`](eval/RESULTS.md).
The simulator ranks policies inside one model; its magnitudes are **not** forecasts (the real-data check found it
under-predicts the effect of longer hours: +25% for a real +52% with the town model, +4% with the old one; see the results).

## Sponsor pointers

**Exa** (main loop, every trial; `exa_py`):
- The Exa call: [`backend/agents/ada.py:49`](backend/agents/ada.py#L49) (`search_and_contents` with highlights and page text).
- Town mode (all live trials): the target place's hours [`:359`](backend/town_loop.py#L359), the town budget [`:399`](backend/town_loop.py#L399), notice channels [`:354`](backend/town_loop.py#L354), failure-guided search built from Cy's `next_question` + town + entity [`:458`](backend/town_loop.py#L458) in [`backend/town_loop.py`](backend/town_loop.py).
- Grounded extraction with quote verification in code: [`backend/agents/ada.py:68`](backend/agents/ada.py#L68), place hours [`:138`](backend/agents/ada.py#L138), budget facts [`:151`](backend/agents/ada.py#L151).
- **Exa Dude, the research god** (replaces Ada): every claim is checked against its source passage (quote), place (the page must name the town, county or state: [`ada.py:131`](backend/agents/ada.py#L131)) and date (published date kept), in [`_checked`](backend/agents/ada.py#L137).
- Town profile on a town's first live trial (budget documents, local channels, place roles/addresses; cached): [`town_profile.py:67`](backend/town_profile.py#L67), called from [`town_loop.py:448`](backend/town_loop.py#L448).
- Similar towns (including failures), quote-checked: [`comparables.py:38`](backend/agents/comparables.py#L38), searched at [`town_loop.py:488`](backend/town_loop.py#L488); Bo adapts them (`adapted_from`), unmodellable ideas become `PILOT` proposals.
- Recursive loop (up to 3 rounds): Cy names the missing fact and its type, Exa Dude searches for that type [`town_loop.py:586`](backend/town_loop.py#L586), each round logged as a `CHAIN` (failure → question → source → changed idea → new result) [`:648`](backend/town_loop.py#L648).
- On screen: each `EXA` log card shows the query, the pages found (title, passage, URL) and what the result changed; the "?" button on an experiment shows the evidence it rests on. Ablation: `eval/exa_ablation.py`.

**past.dev** (REST API, `https://api.past.dev/api/v1`):
- Client [`backend/memory.py:122`](backend/memory.py#L122): ingest [`:146`](backend/memory.py#L146), recall [`:190`](backend/memory.py#L190) / [`:194`](backend/memory.py#L194), identities [`:206`](backend/memory.py#L206) / [`:213`](backend/memory.py#L213), audiences [`:217`](backend/memory.py#L217) / [`:221`](backend/memory.py#L221), gated recall check [`:224`](backend/memory.py#L224); local fallback [`:229`](backend/memory.py#L229).
- Every write goes through [`backend/research_loop.py:138`](backend/research_loop.py#L138) and every handoff read through [`:146`](backend/research_loop.py#L146) (logged with `author`).
- Writes: Exa Dude's facts (hours, budget figures) [`:389`](backend/town_loop.py#L389) / [`:439`](backend/town_loop.py#L439); Cy's failure reasons [`:451`](backend/town_loop.py#L451); Past Dev's audience-scoped notice [`:356`](backend/research_loop.py#L356) in `research_loop.py`.
- Reads of another agent's data, and where each one is used:
  - **Bo** reads Exa Dude's facts every revision round [`town_loop.py:631`](backend/town_loop.py#L631) / [`research_loop.py:513`](backend/research_loop.py#L513). The records the read returns (claim, source URL, author, and past.dev's own recalled claims) go into Bo's revision prompt as a "From shared memory" section, built only from what memory returned ([`memory_text`, `research_loop.py:89`](backend/research_loop.py#L89); used at [`town_loop.py:641`](backend/town_loop.py#L641) / [`research_loop.py:519`](backend/research_loop.py#L519)).
  - **Past Dev** recalls the town's facts from earlier trials into this trial's sources [`research_loop.py:282`](backend/research_loop.py#L282); **Cy** recalls the evidence before reviewing [`:454`](backend/research_loop.py#L454); hours verified in an earlier trial are reused from memory as the baseline [`town_loop.py:365`](backend/town_loop.py#L365).
- **Treasurer** (budget god) reads Exa Dude's budget facts from shared memory before its funding check; sourced records not already among the trial's budget documents are added to the documents it judges funding from [`town_loop.py:547`](backend/town_loop.py#L547). Line items in code [`treasurer.py:17`](backend/agents/treasurer.py#L17), funding check from sourced documents only, `unverified` otherwise [`:55`](backend/agents/treasurer.py#L55); per proposal [`town_loop.py:535`](backend/town_loop.py#L535), for the winner [`:547`](backend/town_loop.py#L547).
- **Audience graphs**: the ▲ button on each main audience (Audiences tab) graphs membership over time per resident type from timestamped joins, with makeup, first-heard channel and experiment comparison: [`web/js/graphs.js:14`](web/js/graphs.js#L14).
- Notice trials: resident identities and rule audiences [`:327`](backend/research_loop.py#L327); watched-run replay with recall checks before/after [`:358`](backend/research_loop.py#L358) (`research_loop.py`).

**Modal** (workspace `constant-lab`, app `town-trial-api`):
- Simulator worker (Node + `sim.js`/`townsim.js`): [`backend/app.py:54`](backend/app.py#L54); fan-out with `.map`: [`:73`](backend/app.py#L73), planned as policy x seed-chunk x scenario in [`backend/sim.py:92`](backend/sim.py#L92).
- One orchestrator per trial [`:66`](backend/app.py#L66); real-town builds in the background [`:60`](backend/app.py#L60); web API [`:82`](backend/app.py#L82).
- Serial vs fanned-out wall time and cost: [`eval/modal_timing.py`](eval/modal_timing.py), results in [`eval/RESULTS.md`](eval/RESULTS.md) (21x faster at 24,576 seed-runs, identical results).

## Two kinds of trial

- **Service trial** (e.g. "extend library hours two evenings"): residents walk to the library at their free times, queue, get served or turned away. Primary metric: weekly visits by residents who can't make current hours. Constraint: staff hours.
- **Perception trial** (prompts about who hears / how people react / marketing): each resident is a past.dev identity with traits. When they hear the notice (online, paper flyers at the cafe, library and town hall, school bulletin or word of mouth), their traits update and they join the trial's `heard-<trial>` rule audience, which is what lets them recall it (in live mode this runs on past.dev, and recall is checked before and after). Primary metric: % of working parents who heard within 3 days.

## Memory: which store holds what (past.dev challenge)

| Store | Holds | Written by | Read by |
|---|---|---|---|
| **past.dev** (live mode) | Dated evidence with sources: library hours, notice channels, staffing/budget constraints (`<town>:fact-*`; metadata: author, source URL, query, trial; re-sending an id replaces the prior revision and the event logs `supersedes`) | Exa Dude (researcher) | Bo (builds and revises policies from Exa Dude's facts), Cy (recalls evidence before reviewing), Past Dev (recalls the town's facts when a new trial starts) |
| **past.dev** | Failure reasons (`<town>:failure-<trial>-<round>`) | Cy (reviewer) | Agents in later trials |
| **past.dev** | One identity per agent (`ada`, `bo`, `cy`, `dee`, `eli`) and per resident (`<town>-r01` ..., traits: town, cohort, channel, neighborhood); rule audiences `heard-<trial>` and `parents-<town>`; the notice, scoped to `heard-<trial>` so only residents who heard it can recall it | Past Dev (archivist) | Residents' recall (checked before and after the watched-run replay) |
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
