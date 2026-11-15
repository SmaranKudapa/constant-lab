# Town Trial

A test bench for local policy ideas. Type a city, get a blocky 3D town full of residents; type an idea, and a team of research agents in **Olympus** (a floating island above the town) turns it into an experiment, searches for missing facts, revises it, checks what it costs, and reports what works, for whom, and under which assumptions.

Iterate AI Research Hackathon, Nov 14–15, 2026 · Track 4 (World Models; falls back to Track 5 Open if we don't beat a benchmark) · Exa · past.dev · Modal.

## Run it

```
cd town-trial/web && python3 -m http.server 8000
```

Open http://localhost:8000. No build step and no internet needed (three.js and fonts are vendored).
Shortcut URL params: `?city=Evart, MI&prompt=...&speed=16&view=heaven&hour=18.5` (`hour` pins the time of day).

- **Dev mode:** type `DEV67` as the city to skip the backend and run the scripted demo loop on the sample town (labelled DEV MODE).
- **Camera keys:** WASD pan, E/Q up/down, arrow keys orbit/tilt, O/I zoom out/in (mouse orbit/zoom still works). Up/Down arrows also move forward and back. The **PX** button toggles pixel art, and **♪** mutes the sound.
- **Results:** 3 s after the best policy is found (while the celebration plays), a popup shows the question, key numbers (metric vs current practice, budget change, staff hours, turned away) and tabs: *Policy* (what the policy does, and why it wins), *Residents* (how each group reacts), *Steps* (every agent action in order), *Other experiments* (each one that wasn't picked and briefly why), plus funding, similar towns and the research chain when the trial found them. Closing it ends the celebration. The **TRIALS** button reopens the popups of trials run since the page was opened (a refresh clears the list), without the celebration.
- **Resident voices:** each group's stance (helped / worse off / no change) and before/after numbers come from the simulator, computed in code; the role and one-line quote are LLM-written in live mode (`backend/agents/voices.py`) or scripted in demo mode, and always labelled as not real people.

### Deploy the frontend (Vercel)

Import the repo in Vercel with the repository root as the Root Directory, Framework Preset **Other** and no build command. The root `vercel.json` sets `town-trial/web` as the output directory. It's a static site. Every push to `main` redeploys.

The frontend talks to the backend through one setting: `window.TOWN_TRIAL_API` in `web/config.js`. Leave it empty for the demo, or test with `?api=<modal url>` on any Vercel preview. The backend allows CORS from the Vercel domain and `localhost`.

Checks: simulator `node town-trial/tests/sim_check.mjs` (capacity cap, nobody lost, closed library gives 0 visits, staff-hour arithmetic, deterministic replay, no outreach gives 0 awareness); parity `node town-trial/tests/parity_check.mjs`; backend `python town-trial/tests/backend_check.py`; trial-type classifier (perception / service / town; browser and backend must agree on every example question in `tests/classify_cases.json`) `node town-trial/tests/classify_check.mjs`.

### Live mode (backend on Modal)

The backend is deployed at `https://constant-lab--town-trial-api-web.us-east.modal.run`. Open the site with
`?api=https://constant-lab--town-trial-api-web.us-east.modal.run` (or set `window.TOWN_TRIAL_API` in `web/config.js`)
and the research loop runs live: Exa searches, LLM agents (OpenAI `gpt-5.4-mini`), past.dev memory, simulator
runs fanned out on Modal. With no API set, the site runs the demo loop in the browser. Deploy and local-run
instructions: [`backend/README.md`](backend/README.md).

## The agents

| Agent (id in code and logs) | Role | Station in Olympus |
|---|---|---|
| **Exa Dude** (`exa`) | Research god: Exa searches for local facts, budget records and similar towns; checks every claim's quote, place and date | Exa Lookout |
| **Athena** (`bo`) | Designer: frames the question, turns ideas into allowed policy actions, proposes revisions | Design Hall |
| **Hephaestus** (`cy`) | Reviewer: reads failure traces, names the missing fact, blocks unsupported changes; runs the Learning Forge (what won and what failed, carried to later trials) | Review Court and Learning Forge |
| **Hermes** (`dee`) | Runner: fans experiments out to Modal workers | Modal Portal |
| **Past Dev** (`eli`) | Memory and audiences god: shared memory in past.dev, resident identities and audiences | Past.dev Archive |
| **Apollo** (`treasurer`) | Budget god: costs each proposal line by line, checks the winner's funding against sourced budget documents | Treasury |

The display names changed late in the event (Bo → Athena, Cy → Hephaestus, Dee → Hermes, Treasurer → Apollo); the ids in code and in the event log did not.

## What's real and what's demo

| Part | Demo mode (no backend) | Live mode (backend) |
|---|---|---|
| The town | Procedural, seeded by the city name | **The real town** from OpenStreetMap: its library, schools, clinics, pharmacy, community centre, parks, sports grounds, post office, town hall, shops, workplaces, real names and street names, placed at their rough real positions on a schematic street grid; population from OSM (or the Census with `CENSUS_API_KEY`). Places OSM lacks are added only when needed and labelled as stand-ins. ([`backend/towns.py`](backend/towns.py)) |
| Residents | 72, model-default mix | A representative sample (60-120) sized and mixed from the town's data; each resident represents ~population/sample people |
| Simulator | `web/js/sim.js` (library hours or a notice) | **The general town model** [`web/js/townsim.js`](web/js/townsim.js): every public place has hours (real OSM opening hours when mapped), capacity, fees and staffing; residents of each group want each kind of place at labelled default rates; unmet wants build up (latent demand); people who don't know the hours get turned away; notices travel through channels at real places. Same file runs in the browser and on Modal |
| Questions | Library hours, or who hears a notice | **Any question about the town's public places**: Athena frames it (which metric, place, resident group, any budget limit you state). Policies: hours, capacity, fees, closing a place, opening a new one next to a real place, outreach. Ideas no action can test (zoning, taxes, housing) get a research brief or a `PILOT` proposal, not a number |
| Budgets | none | Every experiment has an **annual budget**: staff hours x wage + running cost per open hour - fee revenue (scaled to the real population) + campaign cost, for the place the question is about (or the town-run places). Wages and limits come from sources Exa Dude finds (quote-checked) or labelled defaults; budget limits are enforced in code ([`backend/budget.py`](backend/budget.py)). Apollo checks whether the town's sourced budget can pay for the winner, or says it's unverified |
| Research agents' words | Scripted (`web/js/research.js`) | LLM agents with structured outputs; scripted fallbacks are labelled `scripted: true` |
| Evidence | **FIXTURE** placeholders, labelled | Live Exa results with source URLs; a value is used only if its quote is in the returned page and the page is about this town (checked in code) |
| Reasoning | | The **"?" button** left of every experiment shows the steps behind its outcome and which agent gave each, with sources |
| past.dev | Shown as events | Real API calls: facts, handoffs, lessons, identities, rule audiences, gated notice, recall checks |
| Modal | Runs in the browser | Policies x seed chunks x held-out scenarios fanned out with `run_batch.map` |

Evaluation results (4-way comparison, Exa ablation, Modal timing, real-data anchor): [`eval/RESULTS.md`](eval/RESULTS.md).
The simulator ranks policies inside one model; its magnitudes are **not** forecasts (the real-data check found it
under-predicts the effect of longer hours: +25% for a real +52% with the town model, +4% with the old one; see the results).

## Sponsor pointers

**Exa** (main loop, every live trial; `exa_py`):
- **The Exa call:** [`backend/agents/ada.py:49`](backend/agents/ada.py#L49) (`search_and_contents` with highlights and page text), inside `Ada.search` [`:43`](backend/agents/ada.py#L43). Every search below goes through it. Each trial's searches go through [`research_loop.py:126`](backend/research_loop.py#L126) (a failure falls back to labelled FIXTURE evidence) and are logged as `EXA` events [`:143`](backend/research_loop.py#L143).
- **Town trials** (the default) in [`backend/town_loop.py`](backend/town_loop.py):
  - notice channels [`:438`](backend/town_loop.py#L438) (notice questions);
  - the target place's opening hours [`:443`](backend/town_loop.py#L443);
  - the town budget, wages and cuts [`:483`](backend/town_loop.py#L483);
  - similar towns [`:559`](backend/town_loop.py#L559), searched for every trial [`:278`](backend/town_loop.py#L278) and again when Hephaestus asks for a comparable result [`:658`](backend/town_loop.py#L658);
  - the failure-guided search every round, built from Hephaestus's `next_question`, the town and the entity Hephaestus named [`:665`](backend/town_loop.py#L665).
- **Service and notice trials** in [`backend/research_loop.py`](backend/research_loop.py): library hours [`:302`](backend/research_loop.py#L302), notice channels [`:337`](backend/research_loop.py#L337), failure-guided search [`:507`](backend/research_loop.py#L507).
- **Town profile** on a town's first live visit (own 4-search budget, cached per town): [`town_profile.py:68`](backend/town_profile.py#L68) searches budget documents [`:93`](backend/town_profile.py#L93), local news channels [`:120`](backend/town_profile.py#L120) and place roles and addresses [`:136`](backend/town_profile.py#L136). It starts on Modal while the map is still building [`app.py:66`](backend/app.py#L66) and is loaded by the trial at [`town_loop.py:495`](backend/town_loop.py#L495).
- **Claim checks in code:** the quote must appear in the returned page [`ada.py:68`](backend/agents/ada.py#L68), the page must name the town, county or state [`:131`](backend/agents/ada.py#L131), and the published date is kept [`_checked`, `:137`](backend/agents/ada.py#L137). Extractors: place hours [`:154`](backend/agents/ada.py#L154), budget facts [`:167`](backend/agents/ada.py#L167), similar towns [`comparables.py:38`](backend/agents/comparables.py#L38).
- **On screen:** each `EXA` log card shows the query, the pages found (title, passage, URL) and what the result changed; the "?" button on an experiment shows the evidence it rests on. Ablation: [`eval/exa_ablation.py`](eval/exa_ablation.py).

**past.dev** (REST API, `https://api.past.dev/api/v1`):
- Client [`backend/memory.py:122`](backend/memory.py#L122): ingest [`:146`](backend/memory.py#L146), recall [`:190`](backend/memory.py#L190) / [`:194`](backend/memory.py#L194), identities [`:206`](backend/memory.py#L206) / [`:213`](backend/memory.py#L213), audiences [`:217`](backend/memory.py#L217) / [`:221`](backend/memory.py#L221), gated recall check [`:224`](backend/memory.py#L224); local fallback [`:229`](backend/memory.py#L229).
- Every write goes through [`research_loop.py:166`](backend/research_loop.py#L166) and every handoff read through [`:174`](backend/research_loop.py#L174) (logged as `MEMORY_READ` with `author`).
- **Writes:** Exa Dude's facts: hours [`town_loop.py:473`](backend/town_loop.py#L473), the town budget [`:550`](backend/town_loop.py#L550), similar towns [`:572`](backend/town_loop.py#L572), budget figures [`:641`](backend/town_loop.py#L641). Hephaestus's failure reasons [`:653`](backend/town_loop.py#L653). At the end of a trial, Athena saves what won and Hephaestus its failure notes [`:345`](backend/town_loop.py#L345). Past Dev's audience-scoped notice [`research_loop.py:385`](backend/research_loop.py#L385).
- **Reads of another agent's data, and where each one is used:**
  - **Athena** reads Exa Dude's facts every revision round [`town_loop.py:678`](backend/town_loop.py#L678) / [`research_loop.py:516`](backend/research_loop.py#L516). The records the reads return (claim, source URL, author, and past.dev's own recalled claims) go into Athena's revision prompt as a "From shared memory" section built only from what memory returned ([`memory_text`, `research_loop.py:92`](backend/research_loop.py#L92); used at [`town_loop.py:688`](backend/town_loop.py#L688) / [`research_loop.py:522`](backend/research_loop.py#L522)).
  - **Apollo** reads Exa Dude's budget facts before its funding check; sourced records not already among the trial's budget documents are added to the documents it judges funding from [`town_loop.py:596`](backend/town_loop.py#L596).
  - **Past Dev** recalls the town's facts from earlier trials into this trial's sources [`research_loop.py:285`](backend/research_loop.py#L285); **Hephaestus** recalls the evidence before reviewing [`:457`](backend/research_loop.py#L457); hours verified in an earlier trial are reused from memory as the baseline [`town_loop.py:411`](backend/town_loop.py#L411).
- **Learning Forge (learning between trials):** at the start of a town trial, Athena reads what won and Hephaestus reads its failure notes from earlier trials in the same page session [`town_loop.py:314`](backend/town_loop.py#L314). They go into Athena's revision prompt and Hephaestus's failure analysis, built only from what the reads returned [`:331`](backend/town_loop.py#L331), used at [`:646`](backend/town_loop.py#L646) and [`:688`](backend/town_loop.py#L688). A page reload starts fresh.
- **Audience graphs:** the ▲ button on each main audience (Audiences tab) graphs membership over time per resident type from timestamped joins, with makeup, first-heard channel and experiment comparison: [`web/js/graphs.js:14`](web/js/graphs.js#L14).
- **Notice trials:** resident identities and rule audiences [`research_loop.py:356`](backend/research_loop.py#L356); watched-run replay with recall checks before and after [`:404`](backend/research_loop.py#L404).

**Modal** (workspace `constant-lab`, app `town-trial-api`):
- Simulator worker (Node + `sim.js`/`townsim.js`): [`backend/app.py:54`](backend/app.py#L54); fan-out with `.map`: [`:86`](backend/app.py#L86), planned as policy x seed-chunk x scenario in [`backend/sim.py:92`](backend/sim.py#L92).
- One orchestrator per trial [`:79`](backend/app.py#L79); real-town builds [`:60`](backend/app.py#L60) and the town profile [`:73`](backend/app.py#L73) run in the background; web API [`:95`](backend/app.py#L95).
- Serial vs fanned-out wall time and cost: [`eval/modal_timing.py`](eval/modal_timing.py), results in [`eval/RESULTS.md`](eval/RESULTS.md) (21x faster at 24,576 seed-runs, identical results).

## Three kinds of trial

- **Town trial** (the default for broad goals and the fallback, e.g. "Make school more accessible"): the general town model, where every public place has hours, capacity, fees and staffing. Athena picks the closest measurable proxy for the goal and says so in the log.
- **Service trial** (e.g. "extend library hours two evenings"): residents walk to the library at their free times, queue, get served or turned away. Primary metric: weekly visits by residents who can't make current hours. Constraint: staff hours.
- **Perception trial** (prompts about who hears / how people react / marketing): each resident is a past.dev identity with traits. When they hear the notice (online, paper flyers at the cafe, library and town hall, school bulletin or word of mouth), their traits update and they join the trial's `heard-<trial>` rule audience, which is what lets them recall it (in live mode this runs on past.dev, and recall is checked before and after). Primary metric: % of working parents who heard within 3 days.

## Memory: which store holds what (past.dev challenge)

| Store | Holds | Written by | Read by |
|---|---|---|---|
| **past.dev** (live mode) | Dated evidence with sources: opening hours, notice channels, budget figures and constraints, the town budget, similar towns (`<town>:fact-*`, `case-*`; metadata: author, source URL, query, trial; re-sending an id replaces the prior revision and the event logs `supersedes`) | Exa Dude | Athena (in the revision prompt), Apollo (funding check), Hephaestus (before reviewing), Past Dev (when a new trial starts) |
| **past.dev** | Failure reasons per round (`failure-<trial>-<round>`), and per trial what won (`lesson-<trial>`) and Hephaestus's failure notes (`cy-notes-<trial>`) | Hephaestus, Athena | Athena and Hephaestus in later trials of the same page session (Learning Forge) |
| **past.dev** | One identity per agent (`exa`, `bo`, `cy`, `dee`, `eli`, `treasurer`) and per resident (`<town>-r01` ..., traits: town, cohort, channel, neighborhood); rule audiences `heard-<trial>` and `parents-<town>`; the notice, scoped to `heard-<trial>` so only residents who heard it can recall it | Past Dev | Residents' recall (checked before and after the watched-run replay) |
| **Local memory** (`modal.Dict` "town-trial-memory") | The same reads and writes when past.dev fails (`store: local-fallback` in the log) | all | all |
| **Experiment log** (`modal.Dict` "town-trial-events", see `docs/LOG_FORMAT.md`) | Exact run configs, seeds, results, parent links, every agent step | Orchestrator | The viewer, the comparison tables, replay |

Cross-agent reads are logged as `MEMORY_READ` with `author != agent`.

## Files

```
web/index.html, style.css     UI shell (pixel style); results.css for the popup
web/js/main.js                scene, camera, day/night, picking, labels, wiring
web/js/layout.js              town layout (pure data; browser and Node)
web/js/town.js                renders the layout with three.js
web/js/people.js              blocky residents and the gods
web/js/heaven.js              Olympus: floating island, stations, altar, Learning Forge
web/js/ritual.js              altar ritual: a beam onto the town and a scroll that lands on roofs and bounces off walls, each time a policy runs
web/js/audio.js               sound: effects and ambient music synthesised with Web Audio (no audio files); ♪ mutes
web/js/sim.js                 the library-hours / notice simulator (no rendering)
web/js/townsim.js             the general town model (no rendering)
web/js/research.js            demo research loop (scripted words, real runs)
web/js/live.js                live mode: polls the backend's event log
web/js/ui.js, popup.js        side panel and results popup
web/js/graphs.js              audience graphs
web/js/voices.js              resident voices
web/js/celebrate.js, sky.js   best-policy celebration; sky, sun and moon
sim/run_batch.mjs             Node entry point for the simulator (Modal workers)
backend/                      Modal app, orchestrator, agents, memory, towns (see backend/README.md)
eval/                         evaluation scripts and results (see eval/RESULTS.md)
docs/LOG_FORMAT.md            event types
tests/                        simulator, parity, classifier and backend checks
```
