"""HTTP API (FastAPI), shared by the Modal deployment (app.py) and local_server.py.

GET  /api/health                      -> {"ok": true}
POST /api/trials {city, prompt}       -> {trial_id, mode, primary}
GET  /api/trials/{id}/events?since=N  -> {events, done}
POST /api/trials/{id}/stop            -> {ok}
"""
from __future__ import annotations

import os
import uuid
from typing import Callable

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from events import EventStore
from policy import classify, primary

DEFAULT_ORIGINS = "http://localhost:8000,http://127.0.0.1:8000"
VERCEL_REGEX = r"https://.*\.vercel\.app"
MAX_ACTIVE = int(os.environ.get("MAX_ACTIVE_TRIALS", "3"))


ALLOWED_OPTIONS = {"exa_mode": {"failure", "broad", "none"}}  # evaluation switches (Exa ablation)


class TrialRequest(BaseModel):
    city: str = Field(min_length=1, max_length=60)
    prompt: str = Field(min_length=1, max_length=500)
    options: dict | None = None


def create_app(store: EventStore, start: Callable[..., None], towns_cache=None, start_town_build: Callable[[str], None] | None = None) -> FastAPI:
    """`start(trial_id=, city=, prompt=, mode=)` launches the orchestrator (Modal spawn or a thread)."""
    app = FastAPI(title="Town Trial API")
    origins = [o.strip() for o in (os.environ.get("ALLOWED_ORIGINS") or DEFAULT_ORIGINS).split(",") if o.strip()]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_origin_regex=os.environ.get("ALLOWED_ORIGIN_REGEX", VERCEL_REGEX),
                       allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["*"])

    @app.get("/api/health")
    def health():
        return {"ok": True, "version": os.environ.get("CODE_VERSION", "local")}

    @app.get("/api/towns")
    def town(city: str):
        """Real-town spec (OSM + Census), built in the background on first request and cached."""
        from towns import lookup
        if towns_cache is None or start_town_build is None:
            raise HTTPException(501, "real-town data not configured")
        c = city.strip()
        if not c or len(c) > 80:
            raise HTTPException(400, "city must be 1-80 characters")
        return lookup(c, towns_cache, start_town_build)

    @app.post("/api/trials")
    def create_trial(req: TrialRequest):
        city, prompt = req.city.strip(), req.prompt.strip()
        # Live agents: the general town model (Bo frames the question). Without an LLM key: the scripted demo loop.
        live = bool(os.environ.get("OPENAI_API_KEY")) and not os.environ.get("TOWN_TRIAL_SCRIPTED")
        mode = "town" if live else classify(prompt)
        options = {k: v for k, v in (req.options or {}).items() if k in ALLOWED_OPTIONS and v in ALLOWED_OPTIONS[k]}
        trial_id = uuid.uuid4().hex[:12]
        store.create(trial_id, {"city": city, "prompt": prompt, "mode": mode, "options": options, "version": os.environ.get("CODE_VERSION", "local")})
        if not store.register_active(trial_id, MAX_ACTIVE):
            store.finish(trial_id, rejected="too many concurrent trials")
            raise HTTPException(429, f"Too many trials running (max {MAX_ACTIVE}). Try again in a minute.")
        start(trial_id=trial_id, city=city, prompt=prompt, mode=mode, options=options)
        P = {"key": "visits", "label": "(Bo is framing the question...)", "unit": ""} if mode == "town" else primary(mode)
        return {"trial_id": trial_id, "mode": mode, "trial_type": classify(prompt), "primary": P, "options": options, "version": os.environ.get("CODE_VERSION", "local")}

    @app.get("/api/trials/{trial_id}/events")
    def events(trial_id: str, since: int = 0):
        if store.meta(trial_id) is None:
            raise HTTPException(404, "unknown trial")
        evs, done = store.read(trial_id, since)
        return {"events": evs, "done": done}

    @app.post("/api/trials/{trial_id}/stop")
    def stop(trial_id: str):
        if store.meta(trial_id) is None:
            raise HTTPException(404, "unknown trial")
        store.stop(trial_id)
        return {"ok": True}

    return app
