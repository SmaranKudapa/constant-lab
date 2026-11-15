# Town Trial

**A test bench for local policy ideas.** Type a city and get a blocky 3D town full of residents. Type an idea, such as *"Extend library hours two evenings a week"* or *"Will working parents hear about the new hours if we only post online?"*, and a team of research agents living in **Heaven** (a floating island above the town) turns it into an experiment. They search for missing facts, run matched simulations, revise the idea when it fails, and report what works, for whom, and under which assumptions.

Built at Iterate's AI Research Hackathon, San Francisco, Nov 14–15, 2026.
**Track 4: World Models** (Track 5 Open as fallback) · sponsor challenges: **Exa**, **past.dev**, **Modal**.

> **The website is in `town-trial/web/`.** The root `web/` folder is an old, abandoned project (see the end of this file).

## Research question

With the same search and simulation budget, does an agent that inspects failed runs and searches for the missing fact find better policies on **unseen** scenarios than a one-shot proposer or a simple parameter sweep?

## How it works

1. **Claim:** the designer turns the idea into one testable claim with one primary metric and a constraint.
2. **Baseline:** the researcher uses **Exa** to find current practice and saves it to **past.dev**.
3. **Runs:** the runner fans out the baseline and the idea over 16 matched seeds on **Modal**.
4. **Failure → search:** the reviewer reads the failure trace and names the missing fact. The researcher runs a failure-guided Exa search, and the designer revises using the fact (a cross-agent past.dev read).
5. **Review:** unsupported changes are rejected, and the rejections are logged.
6. **Comparison:** original idea vs. parameter sweep vs. one-shot proposer vs. iterative agent, with equal budgets. Picks are frozen, then tested on held-out towns.
7. **Brief:** the recommendation, its assumptions and a pilot plan.

Two kinds of trial share one engine:
- **Service trials** (e.g. library hours): residents queue, get served or get turned away.
- **Perception trials** (who hears a notice, marketing): each resident is a past.dev identity, and hearing the notice moves them into a past.dev audience.

## Run it locally

```
cd town-trial/web
python3 -m http.server 8000
```
Open http://localhost:8000. There's no build step, and it works offline.
Shortcuts: `?city=Evart, MI&prompt=...&speed=16&view=heaven`.
Simulator checks: `node town-trial/tests/sim_check.mjs`.

## Deploy (Vercel)

Import the repository with its root as the Vercel Root Directory and Framework Preset **Other**. No build command is needed. The root `vercel.json` sets `town-trial/web` as the output directory, so the archived root `web/` viewer is not deployed.

Connect the repository through Vercel's GitHub integration and set `main` as the production branch for automatic deployments. Without that integration, deploy `town-trial/web` manually after changes.

The frontend finds the backend through `town-trial/web/config.js` (`window.TOWN_TRIAL_API`), or with `?api=<url>` on any deploy. Leave it empty for demo mode.

## Branches

| Branch | Owner | What |
|---|---|---|
| `main` | Frontend | Production source when Vercel's GitHub integration is connected |
| `main-backend` | Backend (Claude Code) | Live agents, Exa, past.dev, Modal API. Merged into `main` by PR. Plan: `town-trial/docs/BACKEND_PLAN.md` |

## Memory: which store holds what (past.dev challenge)

| Store | Holds | Written by | Read by |
|---|---|---|---|
| **past.dev** | Dated evidence and constraints with sources, agent handoffs, resident identities and audiences | Researcher, Archivist, Reviewer | Designer (uses the Researcher's facts to revise), Reviewer, Archivist |
| **Experiment log** (`events.jsonl`) | Exact run configs, seeds, results, parent links | All agents | The frontend, comparison tables, replay |

## Status (Saturday afternoon)

| Part | Status |
|---|---|
| 3D frontend: landing, town, Heaven, logs, experiments, audiences, replay | Done |
| Simulator (`town-trial/web/js/sim.js`), 8 checks passing | Done |
| Research loop | Demo: the agents' words are scripted, but the numbers come from real batch runs. Live agents are in progress on `main-backend` |
| Exa | Demo shows placeholder results labelled **FIXTURE**. Live calls in progress |
| past.dev | Demo shows the events it will send. Live API in progress |
| Modal | Demo runs batches in the browser. Modal fan-out in progress |

## Repo map

```
town-trial/
  web/            the site (index.html, js/, vendor/three.js, fonts)
  tests/          simulator checks
  docs/           LOG_FORMAT.md (events), town-trial-outline.pdf, BACKEND_PLAN.md (on main-backend)
  README.md       details: what's real vs demo, trial types, files
```

More detail: [`town-trial/README.md`](town-trial/README.md) · outline: [`town-trial/docs/town-trial-outline.pdf`](town-trial/docs/town-trial-outline.pdf) · events: [`town-trial/docs/LOG_FORMAT.md`](town-trial/docs/LOG_FORMAT.md)

## Archived: Constant Lab (not part of the submission)

Our first direction, agents attacking Terence Tao's optimization-constants table, was dropped Saturday morning. Its files stay for reference only: `web/` (mountain viewer), `constant_lab/`, `server/`, `scripts/`, `docs/FRAMEWORK.md`, `docs/LOG_FORMAT.md`, `docs/SPONSOR_PLAN.md`. **Don't deploy root `web/`.**
