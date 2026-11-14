# Town Trial: backend (branch `main-backend`)

You are building the **backend** for Town Trial at Iterate's AI Research Hackathon (San Francisco). **Submissions are due Sunday Nov 15, 2:00 PM PT.** Work fast, keep the demo working at every commit.

Read these first, in order:
1. `town-trial/docs/BACKEND_PLAN.md`: what to build, the API contract, milestones. **This is your task list.**
2. `town-trial/docs/LOG_FORMAT.md`: the event types. The frontend renders only what's in the log.
3. `town-trial/README.md` and `town-trial/docs/town-trial-outline.pdf`: what the project is and the research framework.
4. `town-trial/web/js/sim.js` and `town-trial/web/js/research.js`: the simulator (real) and the demo research loop (scripted words, real numbers). The backend replaces `research.js` with live agents.

## Ground rules

- **Branches.** You work on `main-backend` only. `main` belongs to the frontend teammate, who deploys `town-trial/web` to Vercel from it. Never push to `main`. To deliver, open a PR from `main-backend` into `main`.
- **Frontend changes.** Keep them minimal and additive: a new `town-trial/web/js/live.js` plus a small hook in `main.js` that uses the backend when `window.TOWN_TRIAL_API` is set and falls back to demo mode otherwise. Demo mode must keep working with no backend.
- **One simulator.** `town-trial/web/js/sim.js` is the single source of truth for simulation numbers. Run it with Node inside Modal workers. Don't port it to Python. If you must change it, keep `node town-trial/tests/sim_check.mjs` passing.
- **Honesty is a judging criterion.** Never present a fixture or synthetic number as real. Label synthetic runs. Log failures and rejections. Every Exa-derived input carries its source URL.
- The old Tao-constants code (`constant_lab/`, `server/`, root `web/`, `docs/FRAMEWORK.md`, `docs/SPONSOR_PLAN.md`) is from an abandoned direction. Reuse ideas, but don't build on it.

## Infrastructure (all already set up by the team)

- **Modal:** workspace `constant-lab`, which has the hackathon credits. Everyone uses one shared API token (`modal token set --token-id ... --token-secret ...`). Name apps `town-trial-*`, the Volume `town-trial`, and the secret `town-trial-keys`.
- **Secrets** go in the Modal secret, never in the repo: `modal secret create town-trial-keys EXA_API_KEY=... PAST_DEV_API_KEY=... ANTHROPIC_API_KEY=...`. For local runs, copy `.env.example` to `.env` (gitignored).
- **Exa:** use the `exa_py` SDK. **past.dev:** a REST API plus a docs MCP server at `https://past.dev/mcp`. Check its docs for exact endpoints before coding; the concepts are in BACKEND_PLAN.md.
- **Frontend:** Vercel, deployed from `main`. The backend must send CORS headers for the Vercel domain and `localhost`.

## Sponsor requirements that must hold (judges check them)

- **Exa:** at least one Exa call runs in the main loop (baseline search and failure-guided search, on every trial). The README points to the exact file and line. The demo shows what Exa found and how it was used.
- **past.dev:** more than one agent writes and more than one reads, and at least one agent uses data written by a different agent (log `MEMORY_READ` with `author`). The README says which memory holds what.
- **Modal (Best use):** fan out policies × seeds × held-out scenarios in parallel. Report serial vs. Modal wall time and cost.

## Commits

Small commits, each one working. End commit messages with the attribution your harness gives you. Push `main-backend` often so the team can see progress.
