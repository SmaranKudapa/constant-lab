# Constant Lab

A team of AI agents that tries to beat best-known bounds on open mathematical constants
(Terence Tao's optimization-constants table), built at Iterate's AI Research Hackathon, Nov 14–15, 2026.

## What's here so far

- `web/` — the viewer. Static files, no build step. Landing page → one mountain per constant (← → to switch) → World view of all mountains. Click a climber, the note pile (past.dev), the lookout (Exa) or base camp (director).
- `docs/LOG_FORMAT.md` — the event log every component writes and the viewer reads.
- `constant_lab/events.py` — `emit()` helper for writing events.
- `server/viewer_app.py` — Modal app that serves the viewer plus `/api/events` from the lab's Volume (not yet deployed).
- `docs/SPONSOR_PLAN.md` — loop changes for the Exa and past.dev challenges.
- `scripts/make_demo_events.py` — regenerates the sample replay in `web/demo/events.jsonl`. Its scores are made up.

## Run the viewer

Locally: `cd web && python3 -m http.server 8000`, then open http://localhost:8000. With no live lab it plays the sample replay, labelled as such.
Live: `modal deploy server/viewer_app.py`, or open the viewer with `?api=<base URL of anything serving GET /api/events?since=N>`.
