# Town Trial

**A test bench for local policy ideas.** Type a city and get a blocky 3D version of the real town, full of residents. Type an idea, such as *"Extend library hours two evenings a week"* or *"Will working parents hear about the new hours if we only post online?"*, and a team of research agents living in **Olympus** (a floating island above the town) turns it into an experiment. They search the web for missing facts, run matched simulations, revise the idea when it fails, check the cost against the town's budget, and report what works, for whom, and under which assumptions.

Built at Iterate's AI Research Hackathon, San Francisco, Nov 14–15, 2026.
**Track 4: World Models** (Track 5 Open as fallback) · sponsor challenges: **Exa**, **past.dev**, **Modal**.

> **The website is in `town-trial/web/`.** The root `web/` folder is an old, abandoned project (see the end of this file).

## Research question

With the same search and simulation budget, does an agent that inspects failed runs and searches for the missing fact find better policies on **unseen** scenarios than a one-shot proposer or a simple parameter sweep? Results so far: [`town-trial/eval/RESULTS.md`](town-trial/eval/RESULTS.md).

## The agents

| Agent | Role |
|---|---|
| **Exa Dude** | Research god. Searches the web with Exa for local facts, budget records and similar towns, and checks every claim against its source passage, place and date. |
| **Athena** | Designer. Turns the idea into allowed policy actions and proposes revisions. |
| **Hephaestus** | Reviewer. Reads failure traces, names the missing fact, blocks unsupported changes, and runs the Learning Forge (what won and what failed, carried to the next trial). |
| **Hermes** | Runner. Fans experiments out to Modal workers and collects the results. |
| **Past Dev** | Memory and audiences god. Keeps the team's shared memory in past.dev, plus the residents' identities and audiences (who has heard what, and when). |
| **Apollo** | Budget god. Costs every proposal line by line and checks the winner against the town's sourced budget. Advises only. |

All agents use one OpenAI model (`gpt-5.4-mini` by default) with structured outputs. In the code and the event log they keep their original ids: `exa`, `bo` (Athena), `cy` (Hephaestus), `dee` (Hermes), `eli` (Past Dev) and `treasurer` (Apollo).

## How it works

1. **Town:** the real town is built from OpenStreetMap (places, names, streets, population). While it builds, Exa Dude researches the town's budget, local news channels and place details (cached per town).
2. **Claim:** Athena frames the question as one measurable metric, a target place and any budget limit.
3. **Baseline:** Exa Dude finds current practice (for example the place's real opening hours) and saves it to **past.dev**.
4. **Runs:** Hermes fans the baseline and your idea out over 16 matched seeds on **Modal**.
5. **Failure → search (up to 3 rounds):** Hephaestus reads the failure trace and names the missing fact. Exa Dude runs a failure-guided Exa search, and Athena revises using the facts read back from past.dev. Unsupported changes are rejected, and the rejections are logged.
6. **Comparison:** your idea vs. a 6-option parameter sweep vs. a one-shot proposer vs. the iterative agent, with equal budgets. Picks are frozen, then tested on held-out scenarios.
7. **Brief:** the recommendation, what it costs, whether the budget can pay for it, how each resident group is affected, and its assumptions.
8. **Lessons:** what won and Hephaestus's failure notes are saved to past.dev, and later town trials in the same page session read them back (a page reload starts fresh).

Three kinds of trial share one engine:
- **Town trials** (the default for broad goals and the fallback, e.g. "Make school more accessible"): every public place has hours, capacity, fees and staff; residents want each kind of place, and unmet wants build up.
- **Service trials** (e.g. library hours): residents queue, get served or get turned away.
- **Perception trials** (who hears a notice): each resident is a past.dev identity, and hearing the notice moves them into a past.dev audience.

## Where each sponsor is used

**Exa** runs in the main loop of every live trial. Exact lines are in [`town-trial/README.md`](town-trial/README.md#sponsor-pointers).
- The one Exa call: [`town-trial/backend/agents/ada.py:49`](town-trial/backend/agents/ada.py#L49) (`search_and_contents` with highlights and page text). Every search goes through it.
- In each town trial ([`town-trial/backend/town_loop.py`](town-trial/backend/town_loop.py)): the place's opening hours [`:443`](town-trial/backend/town_loop.py#L443), the town budget [`:483`](town-trial/backend/town_loop.py#L483), notice channels [`:438`](town-trial/backend/town_loop.py#L438), similar towns [`:559`](town-trial/backend/town_loop.py#L559), and the failure-guided search every round, built from Hephaestus's question [`:665`](town-trial/backend/town_loop.py#L665).
- On a town's first visit: its budget documents, channels and places ([`town-trial/backend/town_profile.py`](town-trial/backend/town_profile.py)).

**past.dev** holds the shared memory. Several agents write to it and read from it, and Athena's and Apollo's prompts are built from what their reads return (details in [`town-trial/README.md`](town-trial/README.md#memory-which-store-holds-what-pastdev-challenge)).

**Modal** runs the whole backend: the web API, one orchestrator per trial, background town builds, and the simulator fanned out as policy × seed chunk × held-out scenario with `run_batch.map` ([`town-trial/backend/app.py`](town-trial/backend/app.py)). Serial vs. fanned-out timing: 21× faster at 24,576 runs ([`town-trial/eval/RESULTS.md`](town-trial/eval/RESULTS.md)).

## Memory: which store holds what (past.dev challenge)

| Store | Holds | Written by | Read by |
|---|---|---|---|
| **past.dev** | Dated facts and constraints with sources (hours, budgets, channels, similar towns) | Exa Dude | Athena (in the revision prompt), Hephaestus (before reviewing), Apollo (funding check), Past Dev (at the start of a trial) |
| **past.dev** | Failure notes and what won | Hephaestus, Athena | Hephaestus and Athena in later trials of the same page session |
| **past.dev** | One identity per agent and per resident, rule audiences, the notice (only residents who heard it can recall it) | Past Dev | Residents' recall checks |
| **Experiment log** (`modal.Dict`) | Exact run configs, seeds, results, parent links, every agent step | Orchestrator | The frontend, comparison tables, replay |

## Status (Sunday)

| Part | Status |
|---|---|
| 3D frontend: landing, real town, Olympus, logs, experiments, audiences and graphs, results popup, replay, sound | Done |
| Simulators: `town-trial/web/js/sim.js` (library hours, notices) and `townsim.js` (whole town); same code in the browser and on Modal | Done. 8 simulator, 9 parity, 33 classifier and 36 backend checks pass |
| Live backend on Modal: research loop with LLM agents, Exa, past.dev, fan-out | Done, deployed |
| Demo mode (no backend) | Scripted agents' words, **FIXTURE** evidence (labelled), real simulator numbers |

## Run it locally

```
cd town-trial/web
python3 -m http.server 8000
```
Open http://localhost:8000. There's no build step, and it works offline (demo mode).
Live mode: add `?api=https://constant-lab--town-trial-api-web.us-east.modal.run`.
Shortcuts: `?city=Evart, MI&prompt=...&speed=16&view=heaven`. Type `DEV67` as the city for the labelled scripted demo.
Checks: `node town-trial/tests/sim_check.mjs`, `node town-trial/tests/parity_check.mjs`, `node town-trial/tests/classify_check.mjs`, `python town-trial/tests/backend_check.py`.

## Deploy (Vercel)

Import the repository with its root as the Vercel Root Directory and Framework Preset **Other**. No build command is needed. The root `vercel.json` sets `town-trial/web` as the output directory, so the archived root `web/` viewer is not deployed.

Connect the repository through Vercel's GitHub integration and set `main` as the production branch for automatic deployments. Without that integration, deploy `town-trial/web` manually after changes.

The frontend finds the backend through `town-trial/web/config.js` (`window.TOWN_TRIAL_API`), or with `?api=<url>` on any deploy. Leave it empty for demo mode.

The backend deploys with `modal deploy town-trial/backend/app.py` ([`town-trial/backend/README.md`](town-trial/backend/README.md)).

## Branches

| Branch | Owner | What |
|---|---|---|
| `main` | Frontend | Production source when Vercel's GitHub integration is connected |
| `main-backend` | Backend (Claude Code) | Live agents, Exa, past.dev, Modal API. Merged into `main` by PR. Plan: `town-trial/docs/BACKEND_PLAN.md` |

## Repo map

```
town-trial/
  web/            the site (index.html, js/, vendor/three.js, fonts)
  backend/        Modal app, orchestrator, agents, memory, towns
  sim/            Node entry point for the simulator (Modal workers)
  eval/           evaluation scripts and results
  tests/          simulator, parity, classifier and backend checks
  docs/           LOG_FORMAT.md (events), BACKEND_PLAN.md, town-trial-outline.pdf
  README.md       details: what's real vs demo, sponsor pointers with exact lines, files
```

More detail: [`town-trial/README.md`](town-trial/README.md) · outline: [`town-trial/docs/town-trial-outline.pdf`](town-trial/docs/town-trial-outline.pdf) · events: [`town-trial/docs/LOG_FORMAT.md`](town-trial/docs/LOG_FORMAT.md)

## Archived: Constant Lab (not part of the submission)

Our first direction, agents attacking Terence Tao's optimization-constants table, was dropped Saturday morning. Its files stay for reference only: `web/` (mountain viewer), `constant_lab/`, `server/`, `scripts/`, `docs/FRAMEWORK.md`, `docs/LOG_FORMAT.md`, `docs/SPONSOR_PLAN.md`. **Don't deploy root `web/`.**
