"""Bo, the designer: turns the idea into supported actions and proposes revisions.

All outputs are JSON (structured outputs). Actions are validated in code
(policy.validate_action); an invalid action is rejected and Bo retries once
with the error, after which the orchestrator falls back to a scripted step.
"""
from __future__ import annotations

from agents.llm import LLM, strict

HOURS_CHANGE = strict({"day": {"type": "integer", "description": "0=Mon .. 6=Sun"},
                       "open": {"type": ["string", "null"], "description": "HH:MM 24h; null with close=null closes that day"},
                       "close": {"type": ["string", "null"]}})
ACTION_FIELDS = {
    "hours_changes": {"type": "array", "items": HOURS_CHANGE, "description": "service trials only; [] for perception"},
    "channels": {"type": "array", "items": {"type": "string", "enum": ["online", "board", "bulletin"]}, "description": "perception trials only; [] for service"},
}
PROPOSAL = strict({"label": {"type": "string", "description": "short name, under 40 characters"}, **ACTION_FIELDS,
                   "why": {"type": "string", "description": "one sentence: the mechanism, citing the trace or a source"},
                   "evidence_url": {"type": ["string", "null"], "description": "URL of the local source this relies on, if any"}})

ACTIONS_HELP = {
    "service": ("Supported action: change library opening hours per day. hours_changes lists only the days that change; "
                "each entry gives the full new open and close time for that day. Staff hours = 2 staff x open hours."),
    "perception": ("Supported action: choose notice channels from online (library website/social), board (paper notice on the town square), "
                   "bulletin (school family bulletin). The notice about new library hours goes out on the chosen channels."),
}
SYSTEM = ("You are Bo, the policy designer in a team testing local policy ideas in a simulated town. "
          "You may only propose the supported actions. Never change model inputs such as demand, open rates or behaviour; "
          "those come only from local sources. Keep proposals concrete and different from what was already tried.")


class Bo:
    def __init__(self, llm: LLM):
        self.llm = llm

    def translate(self, mode: str, city: str, prompt: str, baseline: str, retry_error: str | None = None) -> dict:
        schema = strict({"representable": {"type": "boolean", "description": "false if the idea cannot be expressed with the supported action"},
                         "claim": {"type": "string", "description": "the testable claim: action, population, metric, horizon"},
                         **{k: v for k, v in PROPOSAL["properties"].items()}})
        user = (f"Town: {city}\nUser's idea: {prompt}\nCurrent practice: {baseline}\n{ACTIONS_HELP[mode]}\n"
                "Translate the user's idea into the supported action, as faithfully as possible (do not improve it).")
        if retry_error:
            user += f"\nYour previous answer was rejected by the validator: {retry_error}. Fix it."
        return self.llm.json("translate_idea", schema, SYSTEM, user)

    def revise(self, mode: str, city: str, context: str, n: int = 2, retry_error: str | None = None) -> list[dict]:
        schema = strict({"proposals": {"type": "array", "items": PROPOSAL, "description": f"exactly {n} proposals"}})
        user = (f"Town: {city}\n{ACTIONS_HELP[mode]}\n{context}\n"
                f"Propose exactly {n} revisions that address the reviewer's question and respect every constraint.")
        if retry_error:
            user += f"\nYour previous answer was rejected by the validator: {retry_error}. Fix it."
        return self.llm.json("revise", schema, SYSTEM, user)["proposals"][:n]

    def oneshot(self, mode: str, city: str, prompt: str, evidence: str, retry_error: str | None = None) -> dict:
        """The one-shot baseline arm: same model and evidence, a single proposal, no run feedback."""
        user = (f"Town: {city}\nGoal (from the user): {prompt}\n{ACTIONS_HELP[mode]}\nEvidence found: {evidence}\n"
                "Propose the single best policy. You get no simulation feedback.")
        if retry_error:
            user += f"\nYour previous answer was rejected by the validator: {retry_error}. Fix it."
        return self.llm.json("oneshot", PROPOSAL, SYSTEM, user)

    def brief(self, mode: str, context: str) -> dict:
        schema = strict({"why": {"type": "string", "description": "one or two sentences on why the recommended policy wins, using only the numbers given"},
                         "assumptions": {"type": "string", "description": "the synthetic or unsourced inputs the result depends on"},
                         "pilot": {"type": "string", "description": "a small real-world pilot and what to measure"}})
        return self.llm.json("brief", schema, SYSTEM, context)

    def research_brief(self, city: str, prompt: str) -> dict:
        schema = strict({"reason": {"type": "string", "description": "why the idea cannot be simulated with the supported actions"},
                         "data_plan": {"type": "string", "description": "what data to collect, from whom, to evaluate the idea"}})
        return self.llm.json("research_brief", schema, SYSTEM, f"Town: {city}\nIdea: {prompt}\n{ACTIONS_HELP['service']}\n{ACTIONS_HELP['perception']}")
