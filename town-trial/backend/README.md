# Town Trial backend

Live research loop for Town Trial. The frontend (`town-trial/web`) uses it when
`window.TOWN_TRIAL_API` is set, and falls back to demo mode otherwise.

| file | what |
|---|---|
| `app.py` | Modal app `town-trial-api`: `web` (FastAPI), `run_trial` (one orchestrator per trial), `run_batch` (Node simulator worker) |
| `api.py` | HTTP API and CORS (`ALLOWED_ORIGINS`, plus any `*.vercel.app`) |
| `orchestrator.py` | the agents' step order, written to the event log (see `docs/LOG_FORMAT.md`) |
| `sim.py` | splits experiments into seed chunks, fans them out, recombines with `runBatch`'s exact arithmetic |
| `events.py` | append-only event log per trial (`modal.Dict` "town-trial-events" on Modal) |
| `policy.py` | classify / primary metric / hours helpers; constraints are checked here, in code |
| `agents/` | agents and the labelled FIXTURE evidence used as a fallback |

All simulation numbers come from `web/js/sim.js` through `sim/run_batch.mjs`.

## Deploy

```
pip install modal
modal deploy town-trial/backend/app.py
# -> https://constant-lab--town-trial-api-web.us-east.modal.run
```
Uses the existing Modal secret `town-trial-keys` (EXA_API_KEY, PAST_DEV_API_KEY, OPENAI_API_KEY).
On Windows, set `PYTHONUTF8=1` first, or Modal's progress output fails to print.

## Run locally (no Modal)

```
pip install "fastapi[standard]"
python town-trial/backend/local_server.py            # http://localhost:8787
cd town-trial/web && python -m http.server 8000
# open http://localhost:8000/?api=http://localhost:8787
```

## Tests

```
node town-trial/tests/sim_check.mjs
node town-trial/tests/parity_check.mjs
python town-trial/tests/backend_check.py
```
