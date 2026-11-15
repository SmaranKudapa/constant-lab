"""Modal deployment: `modal deploy town-trial/backend/app.py`

- web:       FastAPI (api.py) behind @modal.asgi_app, with CORS.
- run_trial: one orchestrator per trial (spawned by POST /api/trials).
- run_batch: simulator worker (Node + web/js/sim.js); the orchestrator fans
             (policy x seed-chunk x scenario) jobs out with run_batch.map.
Events live in the modal.Dict "town-trial-events", one writer per trial.
"""
from __future__ import annotations

import sys
from pathlib import Path

import modal

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent  # town-trial/
sys.path.insert(0, str(HERE))
sys.path.insert(0, "/root/backend")


def _code_version() -> str:
    """Hash of the code shipped to containers. Part of the image env, so any code change forces fresh
    containers (otherwise a container still warm from before a deploy can run the old code)."""
    import hashlib
    h = hashlib.sha1()
    for d, pat in ((HERE, "**/*.py"), (ROOT / "sim", "*.mjs"), (ROOT / "web" / "js", "*.js")):
        for f in sorted(d.glob(pat)):
            if "__pycache__" not in f.parts:
                h.update(f.read_bytes())
    return h.hexdigest()[:12]


CODE_VERSION = _code_version() if HERE.joinpath("api.py").exists() and ROOT.joinpath("sim").exists() else "container"

image = (
    modal.Image.from_registry("node:22-slim", add_python="3.12")  # same Node major as local dev
    .apt_install("ca-certificates")  # node:22-slim has no CA bundle; without it OpenAI (httpx) fails TLS
    .pip_install("fastapi[standard]==0.115.12", "openai>=1.60", "exa_py>=1.8", "httpx>=0.27")
    .env({"TOWN_TRIAL_ROOT": "/root/town-trial", "PYTHONPATH": "/root/backend", "CODE_VERSION": CODE_VERSION})
    .add_local_dir(ROOT / "web" / "js", "/root/town-trial/web/js")
    .add_local_dir(ROOT / "sim", "/root/town-trial/sim")
    .add_local_dir(HERE, "/root/backend", ignore=["__pycache__", "*.pyc", ".venv"])
)

app = modal.App("town-trial-api", image=image)
events_dict = modal.Dict.from_name("town-trial-events", create_if_missing=True)
memory_dict = modal.Dict.from_name("town-trial-memory", create_if_missing=True)  # local-fallback memory
secrets = [modal.Secret.from_name("town-trial-keys")]


@app.function(cpu=1.0, memory=512, timeout=300)
def run_batch(jobs: list[dict]) -> list[dict]:
    from sim import run_jobs_local
    return run_jobs_local(jobs)


@app.function(secrets=secrets, timeout=1800)
def run_trial(trial_id: str, city: str, prompt: str, mode: str, options: dict | None = None) -> None:
    from events import EventStore
    from memory import make_memory
    from orchestrator import run_trial as run
    from sim import Runner, local_mapper

    def modal_mapper(groups):
        return list(run_batch.map(groups))

    runner = Runner(mapper=modal_mapper, where="Modal (run_batch.map)", fallback=local_mapper(2))
    run(EventStore(events_dict), trial_id, city, prompt, mode, runner, memory=make_memory(memory_dict), options=options)


@app.function(secrets=secrets)
@modal.concurrent(max_inputs=50)
@modal.asgi_app()
def web():
    from api import create_app
    from events import EventStore

    def start(**kw):
        run_trial.spawn(**kw)

    return create_app(EventStore(events_dict), start)
