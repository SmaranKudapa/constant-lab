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
        actions = ("Supported actions: change opening hours, capacity, per-visit fees or close any public place (library, clinic, pharmacy, "
                   "community centre, sports, park, post office, town hall); open a new place of those kinds; send a notice through "
                   "online, board, bulletin, newspaper or mailer channels; every policy is costed.")
        return self.llm.json("research_brief", schema, SYSTEM, f"Town: {city}\nIdea: {prompt}\n{actions}")


# ---------- town mode (general model) ----------
TOWN_CHANGE = strict({
    "facility": {"type": "string", "description": "id of an existing public place (from the list)"},
    "hours_changes": {"type": "array", "items": HOURS_CHANGE, "description": "only the days that change; [] to keep hours"},
    "capacity": {"type": ["integer", "null"], "description": "people at once (model units), null = unchanged"},
    "fee": {"type": ["number", "null"], "description": "$ per visit, null = unchanged, 0 = free"},
    "close": {"type": "boolean", "description": "true closes this place"},
})
TOWN_NEW = strict({
    "kind": {"type": "string", "description": "kind of place to open (one of the listed kinds)"},
    "near": {"type": "string", "description": "id of an existing place it opens next to"},
    "hours_changes": {"type": "array", "items": HOURS_CHANGE, "description": "[] = the kind's default hours"},
    "capacity": {"type": ["integer", "null"]}, "fee": {"type": ["number", "null"]},
})
TOWN_ACTION = {
    "facility_changes": {"type": "array", "items": TOWN_CHANGE},
    "new_facilities": {"type": "array", "items": TOWN_NEW},
    "channels": {"type": "array", "items": {"type": "string", "enum": ["online", "board", "bulletin", "newspaper", "mailer"]},
                 "description": "outreach channels for a notice about the change; [] = none"},
}
TOWN_PROPOSAL = strict({"label": {"type": "string", "description": "short name, under 40 characters"}, **TOWN_ACTION,
                        "why": {"type": "string", "description": "one sentence: the mechanism, citing the trace or a source"},
                        "evidence_url": {"type": ["string", "null"]}})
METRICS = ["visits", "unique_visitors", "visits_restricted", "turned_away", "awareness", "net_cost"]
COHORT_ENUM = ["day-workers", "families", "seniors", "students", "night-shift", "remote"]


def town_help(town: str) -> str:
    return ("Supported actions on this real town's public places: change opening hours per day, capacity, a per-visit fee, or close a "
            "place; open a new place of a supported kind next to an existing place; send a notice through outreach channels "
            "(online = library/city website, board = paper notices at the town centre/post office/town hall/library, bulletin = school "
            "family bulletin, newspaper = local paper ad, mailer = postcard to every household). Every change has a budget: staff hours "
            "x wage + running cost per open hour - fee revenue (+ campaign cost).\nPlaces:\n" + town)


def frame(llm: LLM, city: str, prompt: str, town: str, kinds: list, facility_ids: list) -> dict:
    """Bo turns any question into: what to measure, for whom, at which place, any budget limit the user stated, and the user's own idea."""
    schema = strict({
        "representable": {"type": "boolean", "description": "false if no supported action can test the idea (e.g. zoning, taxes, housing)"},
        "claim": {"type": "string", "description": "the testable claim: action, population, metric, horizon"},
        "metric": {"type": "string", "enum": METRICS,
                   "description": "visits/unique_visitors/visits_restricted/awareness are maximised; turned_away and net_cost minimised"},
        "kind": {"type": ["string", "null"], "enum": kinds + [None], "description": "kind of place the metric is about (null = all places)"},
        "cohort": {"type": ["string", "null"], "enum": COHORT_ENUM + [None], "description": "resident group the metric is about (null = everyone)"},
        "target": {"type": ["string", "null"], "enum": facility_ids + [None], "description": "the main place the question is about"},
        "budget_limit": strict({"type": {"type": "string", "enum": ["none", "no_increase", "max_increase_usd", "cut_pct"]},
                                "value": {"type": ["number", "null"], "description": "dollars per year, or percent for cut_pct"}}),
        "user_idea": TOWN_PROPOSAL,
    })
    user = (f"Town: {city}\nUser question: {prompt}\n{town_help(town)}\nKinds of place: {kinds}\n"
            "Choose the metric that answers the question's GOAL:\n"
            "- awareness: whether people hear about / find out about / learn of ANY announcement or change (always representable with the "
            "outreach channels, even if the place in the announcement is not on the list); set cohort if a group is named.\n"
            "- visits / unique_visitors (with kind/cohort/target): getting more people (or a group) to use a place.\n"
            "Whenever the question names a group (students, seniors, working parents/families, day workers, night-shift workers, remote "
            "workers), set cohort to it.\n"
            "- visits_restricted: people who cannot make the target's current hours.\n"
            "- turned_away: people arriving when a place is closed or full.\n"
            "- net_cost ONLY when the goal itself is to save money or minimise cost (e.g. 'what is the cheapest way...').\n"
            "A cost condition on another goal ('without raising costs', 'within budget', 'cut the budget 10% while keeping visits') is "
            "NOT a net_cost goal: keep the goal metric and set budget_limit (no_increase / max_increase_usd / cut_pct) instead.\n"
            "Only set budget_limit if the user stated one. Translate the user's own idea into user_idea as faithfully as possible (do not "
            "improve it). representable=false only if no supported action (hours, capacity, fee, open/close a place, outreach) can test it; "
            "then still fill the other fields with your best guess.")
    return llm.json("frame_question", schema, SYSTEM, user)


def town_revise(llm: LLM, city: str, town: str, context: str, n: int = 2, retry_error: str | None = None) -> list:
    schema = strict({"proposals": {"type": "array", "items": TOWN_PROPOSAL, "description": f"exactly {n} proposals"}})
    user = f"Town: {city}\n{town_help(town)}\n{context}\nPropose exactly {n} revisions that address the reviewer's question and respect every constraint."
    if retry_error:
        user += f"\nYour previous answer was rejected by the validator: {retry_error}. Fix it."
    return llm.json("town_revise", schema, SYSTEM, user)["proposals"][:n]


def town_oneshot(llm: LLM, city: str, town: str, prompt: str, evidence: str, retry_error: str | None = None) -> dict:
    user = (f"Town: {city}\nGoal (from the user): {prompt}\n{town_help(town)}\nEvidence found: {evidence}\n"
            "Propose the single best policy. You get no simulation feedback.")
    if retry_error:
        user += f"\nYour previous answer was rejected by the validator: {retry_error}. Fix it."
    return llm.json("town_oneshot", TOWN_PROPOSAL, SYSTEM, user)
