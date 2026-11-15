"""Apollo, the budget god: what a proposal costs and whether the town can plausibly pay for it.

- Line items are computed in code from the simulator outputs and budget.py (staff, operations, fee revenue,
  outreach materials, space), split into ongoing ($/yr) and one-time costs, as the change versus current practice.
- The funding check reads only sourced budget documents (Exa Dude's verified budget facts and the town profile).
  It names a plausible funding source or a gap, and says whether a figure is an appropriation or money actually
  unspent and whether it is restricted. With no budget document the status is "unverified" (decided in code, no LLM),
  with what the town must confirm. Apollo advises; it never changes the town's budget or the simulation.
"""
from __future__ import annotations

import budget as B

from .llm import strict


def line_items(bud: dict, base: dict, policy: dict, scope_label: str) -> dict:
    d = lambda k: float(bud.get(k, 0) or 0) - float(base.get(k, 0) or 0)  # noqa: E731
    items = [
        {"item": "Staff time", "kind": "ongoing", "amount": round(d("staff")), "basis": f"{bud.get('staff_hours_week', 0):g} staff h/wk at ${bud.get('wage', 0):g}/h (was {base.get('staff_hours_week', 0):g} h)"},
        {"item": "Operations (utilities, upkeep per open hour)", "kind": "ongoing", "amount": round(d("running")), "basis": "running cost per open hour x open hours (model default unless sourced)"},
        {"item": "Fee revenue", "kind": "ongoing", "amount": -round(d("revenue")), "basis": "fees x visits, scaled to the town's population"},
        {"item": "Outreach materials", "kind": "one-time", "amount": round(float(bud.get("campaign", 0) or 0)), "basis": "flyers, newspaper ad, mailer postage (model defaults)"},
    ]
    if policy.get("add"):
        items.append({"item": "Space for the new place", "kind": "one-time", "amount": None, "basis": "not costed: needs a building or lease (town must confirm)"})
    else:
        items.append({"item": "Space", "kind": "ongoing", "amount": 0, "basis": "existing buildings, no new space"})
    items = [i for i in items if i["amount"] != 0 or i["item"].startswith("Space")]
    ongoing = sum(i["amount"] for i in items if i["kind"] == "ongoing" and i["amount"] is not None)
    one_time = sum(i["amount"] for i in items if i["kind"] == "one-time" and i["amount"] is not None)
    return {"items": items, "ongoing_delta": ongoing, "one_time": one_time, "scope": scope_label,
            "summary": f"{'+' if ongoing >= 0 else '-'}{B.fmt_usd(abs(ongoing))}/yr ongoing" + (f", {B.fmt_usd(one_time)} one-time" if one_time else "")}


SCHEMA = strict({
    "status": {"type": "string", "enum": ["funded", "gap", "unverified"],
               "description": "funded = a cited document shows money available for this; gap = documents show the money is not there (give the gap); "
                              "unverified = the documents do not establish whether funds are available"},
    "funding_source": {"type": "string", "description": "the budget line or fund that could pay, as named in the documents, or 'none identified'"},
    "gap_usd": {"type": ["number", "null"], "description": "dollars per year still unfunded, if the documents allow an estimate"},
    "appropriation_or_unspent": {"type": "string", "enum": ["appropriation", "unspent balance", "not stated"],
                                 "description": "is the cited figure money budgeted (appropriated) or money actually left unspent?"},
    "restricted": {"type": "string", "enum": ["restricted", "unrestricted", "not stated"]},
    "confirm": {"type": "array", "items": {"type": "string"}, "description": "what the town must confirm before relying on this (1-3 items)"},
    "reason": {"type": "string", "description": "one or two sentences of reasoning, citing the document"},
    "source_url": {"type": ["string", "null"]},
})
SYSTEM = ("You are Apollo, the budget god in a team testing local policy ideas. You check whether a town can plausibly pay for a "
          "proposal using ONLY the budget documents given. Never assume money is available: an appropriation is not unspent money, and "
          "restricted funds cannot pay for other things. If the documents do not settle it, say unverified. You advise; you do not "
          "change the budget.")


def funding(llm, city: str, policy_text: str, li: dict, docs: list[dict]) -> dict:
    """Funding status of one proposal. No documents -> unverified, decided in code."""
    if not docs:
        return {"status": "unverified", "funding_source": "none identified", "gap_usd": None, "appropriation_or_unspent": "not stated",
                "restricted": "not stated", "source_url": None, "by": "code",
                "reason": "No budget document for this town was found, so whether the money exists can't be established.",
                "confirm": [f"Which budget line in {city} would pay the {li['summary']}", "Whether that line has unspent, unrestricted funds this fiscal year"]}
    doc_text = "\n".join(f"- {d['statement']} (kind: {d.get('kind', 'fact')}; amount: {d.get('amount')}; published {d.get('published') or 'n/a'}) [{d['url']}]"
                         for d in docs[:8])
    out = llm.json("treasurer_funding", SCHEMA, SYSTEM,
                   f"Town: {city}\nProposal: {policy_text}\nCost vs current practice ({li['scope']}): {li['summary']}\nLine items: "
                   + "; ".join(f"{i['item']} {i['kind']} {i['amount']}" for i in li["items"]) + f"\nBudget documents:\n{doc_text}")
    urls = {d["url"] for d in docs}
    if out["status"] == "funded" and out.get("source_url") not in urls:  # "funded" must cite one of the documents
        out["status"], out["reason"] = "unverified", out["reason"] + " (No cited document confirms the funds, so this stays unverified.)"
    out["by"] = "llm"
    return out
