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

Simulator checks: `node town-trial/tests/sim_check.mjs` (capacity cap, nobody lost, closed library gives 0 visits, staff-hour arithmetic, deterministic replay, no outreach gives 0 awareness).

## What's real and what's demo

| Part | Status |
|---|---|
| Town generation | Procedural, seeded by the city name. OpenStreetMap streets come later. |
| Simulator (`web/js/sim.js`) | Real explicit rules. Every number in the Experiments tab comes from batch runs of it (16 matched seeds per experiment). |
| Research agents' words | Scripted in `web/js/research.js` for the demo. Their decisions follow the real framework order. |
| Exa results | **FIXTURE** placeholders, labelled on screen. The backend replaces them with live Exa calls. |
| past.dev | Shown as the events the backend will send (identities, rule audiences, writes and reads). Not yet calling the API. |
| Modal | Batch runs happen in the browser for now. The backend fans the same runs out to Modal workers. |

## Two kinds of trial

- **Service trial** (e.g. "extend library hours two evenings"): residents walk to the library at their free times, queue, get served or turned away. Primary metric: weekly visits by residents who can't make current hours. Constraint: staff hours.
- **Perception trial** (prompts about who hears / how people react / marketing): each resident is a past.dev identity with traits. When they hear the notice (online, notice board, school bulletin or word of mouth), their traits update and they join the `heard-library-notice` rule audience, which is what lets them recall it. Primary metric: % of working parents who heard within 3 days.

## Memory: which store holds what (past.dev challenge)

| Store | Holds | Written by | Read by |
|---|---|---|---|
| **past.dev** | Dated evidence (facts, constraints) with sources; agent handoffs; resident identities and audiences for perception trials | Ada (researcher), Eli (archivist), Cy (reviewer: failure reasons) | Bo (designer) uses Ada's facts to build and revise policies; Cy recalls evidence when reviewing; Eli recalls prior town facts |
| **Experiment log** (`events.jsonl`, see `docs/LOG_FORMAT.md`) | Exact run configs, seeds, results, parent links | All agents | The viewer, the comparison tables, replay |

Cross-agent reads are logged as `MEMORY_READ` with `author != agent`.

## Files

```
web/index.html, style.css     UI shell (pixel style)
web/js/main.js                scene, camera, day/night, picking, labels, wiring
web/js/town.js                procedural town
web/js/people.js              blocky residents and researchers
web/js/heaven.js              floating island, stations, clouds, falling cubes
web/js/sim.js                 the simulator (no rendering)
web/js/research.js            demo research loop (scripted words, real runs)
web/js/ui.js                  side panel rendering
docs/LOG_FORMAT.md            event types
tests/sim_check.mjs           simulator checks
```
