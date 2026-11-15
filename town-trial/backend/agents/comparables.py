"""Similar towns: Exa Dude finds other towns that tried something for the same problem (including failures).

Each case is extracted with structured outputs and kept only if its quote appears in the returned page
(the same quote check as local facts; no place check, since these pages are about other towns). Cases record
the intervention, outcome, cost/funding if stated, the source and its date, why the town is similar and why the
result may not transfer. Whether the idea can be expressed with the simulator's supported actions is decided by
the model and used only to route it: supported ideas go to Bo; the rest become pilot proposals with no score.
"""
from __future__ import annotations

from .llm import strict

CASE = strict({
    "town": {"type": "string", "description": "the other town or city (with state/country) where it was tried"},
    "intervention": {"type": "string", "description": "what they did, one sentence"},
    "outcome": {"type": "string", "description": "what happened, one sentence, only as stated in the source"},
    "worked": {"type": "string", "enum": ["yes", "no", "mixed", "unknown"]},
    "cost_funding": {"type": "string", "description": "cost and how it was funded if the source states it, else 'not stated'"},
    "similarity": {"type": "string", "description": "why this town is comparable to the target town (size, rural/urban, the same problem)"},
    "may_not_transfer": {"type": "string", "description": "the main reason the result may not carry over to the target town"},
    "modellable": {"type": "boolean", "description": "true if the idea can be expressed as opening hours, capacity, fees, opening or closing a "
                                                     "public place, or outreach channels (online, flyers, school bulletin, newspaper, mailer)"},
    "quote": {"type": "string", "description": "a sentence copied exactly from the source that supports the outcome"},
    "url": {"type": "string"},
})
SCHEMA = strict({"cases": {"type": "array", "items": CASE}})


def query_for(prompt: str, city: str) -> str:
    """A search for other towns' experience with the same problem (the target town's name is left out on purpose)."""
    q = prompt.rstrip("?.! ")
    for w in city.replace(",", " ").split():
        if len(w) > 2:
            q = q.replace(w, "")
    return " ".join(f"small towns that tried: {q} results lessons learned".split()[:20])


def find(ada, city: str, goal: str, results: list[dict], max_cases: int = 3) -> list[dict]:
    """Verified comparable-town cases from search results (quote checked; other towns, so no place check)."""
    if not results:
        return []
    out = ada.llm.json("comparables", SCHEMA, ada.SYSTEM,
                       f"Target town: {city}. Goal: {goal}\nFrom the sources below, list up to {max_cases} OTHER towns that tried something for "
                       "this goal, including attempts that failed. Use only what the sources state; skip a case if the source does not "
                       f"state an outcome.\n\n{ada._sources(results)}")
    cases = []
    for c in out.get("cases", [])[:max_cases]:
        chk = ada._checked({"found": True, **c}, results, place_check=False)
        if chk and not chk.get("unverified"):
            cases.append(chk)
    return cases


def text(cases: list[dict]) -> str:
    return "; ".join(f"{c['town']}: {c['intervention']} -> {c['outcome']} (worked: {c['worked']}; cost: {c['cost_funding']}; "
                     f"may not transfer: {c['may_not_transfer']}) [{c['url']}]" for c in cases) or "none found"
