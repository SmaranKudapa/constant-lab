"""OpenAI client with structured outputs and the per-trial budget guards.

One model for every agent and every baseline arm (OPENAI_MODEL, default below),
so the comparison between arms is fair.
"""
from __future__ import annotations

import json
import os
import time

MODEL = os.environ.get("OPENAI_MODEL", "gpt-5.4-mini")
MAX_EXA = int(os.environ.get("MAX_EXA_CALLS", "6"))
MAX_LLM = int(os.environ.get("MAX_LLM_CALLS", "20"))


class BudgetExceeded(Exception):
    pass


class Budget:
    def __init__(self, exa: int = MAX_EXA, llm: int = MAX_LLM):
        self.max = {"exa": exa, "llm": llm}
        self.used = {"exa": 0, "llm": 0}

    def take(self, kind: str) -> None:
        if self.used[kind] >= self.max[kind]:
            raise BudgetExceeded(f"{kind} budget used up ({self.max[kind]} calls per trial)")
        self.used[kind] += 1

    def left(self, kind: str) -> int:
        return self.max[kind] - self.used[kind]


def strict(properties: dict) -> dict:
    """JSON schema object in OpenAI strict mode: every property required, no extras."""
    return {"type": "object", "properties": properties, "required": list(properties), "additionalProperties": False}


class LLM:
    def __init__(self, budget: Budget, model: str = MODEL):
        self.budget, self.model = budget, model
        self.client = None
        if os.environ.get("OPENAI_API_KEY"):
            from openai import OpenAI
            self.client = OpenAI(timeout=60, max_retries=1)
        self.calls: list[dict] = []  # for the eval report: name, seconds, tokens

    @property
    def available(self) -> bool:
        return self.client is not None

    def json(self, name: str, schema: dict, system: str, user: str) -> dict:
        """One structured call. Raises on missing key, budget, API error or invalid JSON."""
        if not self.client:
            raise RuntimeError("OPENAI_API_KEY not set")
        self.budget.take("llm")
        t0 = time.time()
        resp = self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            response_format={"type": "json_schema", "json_schema": {"name": name, "schema": schema, "strict": True}},
            reasoning_effort="low",
        )
        msg = resp.choices[0].message
        if getattr(msg, "refusal", None):
            raise ValueError(f"model refused: {msg.refusal}")
        usage = getattr(resp, "usage", None)
        self.calls.append({"name": name, "s": round(time.time() - t0, 2), "tokens": getattr(usage, "total_tokens", None)})
        return json.loads(msg.content)
