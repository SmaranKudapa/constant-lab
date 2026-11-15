"""Run the backend on your machine, no Modal needed (sim batches run as local Node processes).

    python town-trial/backend/local_server.py          # http://localhost:8787
    then open http://localhost:8000/?api=http://localhost:8787
"""
from __future__ import annotations

import os
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import uvicorn  # noqa: E402

from api import create_app  # noqa: E402
from events import EventStore  # noqa: E402
from memory import make_memory  # noqa: E402
from orchestrator import run_trial  # noqa: E402
from sim import Runner, local_mapper  # noqa: E402

store = EventStore({})
runner = Runner(mapper=local_mapper(), where="local Node processes (no Modal)")
memory = make_memory({})


def start(**kw):
    threading.Thread(target=run_trial, kwargs={"store": store, "runner": runner, "memory": memory, **kw}, daemon=True).start()


app = create_app(store, start)

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", "8787")))
