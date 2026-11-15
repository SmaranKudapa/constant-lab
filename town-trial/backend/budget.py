"""Town budgets: the annual cost of a policy, computed in code from simulator outputs.

annual net cost = 52 x (staff hours x wage + sum over places of open hours x running cost per hour)
                  - 52 x fee revenue scaled from the resident sample to the real population
                  + one-off outreach campaign cost (reported separately and added to the first year)

Inputs and where they come from:
- staff hours, open hours and fee revenue per week: the simulator (web/js/townsim.js).
- wage per staff hour and running cost per open hour: sourced figures when Ada finds them (quoted from a
  local source, checked in code), otherwise the labelled defaults below.
- scale: real population / residents in the sample (from the town spec); 1 if the population is unknown.
"""
from __future__ import annotations

TOWN_FUNDED = {"library", "community", "park", "sports", "townhall"}  # kinds a town budget usually pays for (clinics, pharmacies: private; post office: federal)
DEFAULT_WAGE = 25.0  # $ per staff hour incl. benefits (model default, labelled; replaced by a sourced figure when found)
# One-off cost of an outreach campaign (model defaults, labelled)
OUTREACH_COST = {"online": 0.0, "board": 50.0, "bulletin": 0.0, "newspaper": 300.0, "mailer_per_household": 0.6}


def scale_of(spec: dict | None, residents: int | None) -> float:
    if spec and spec.get("population") and residents:
        return float(spec["population"]) / residents
    return 1.0


def outreach_cost(channels: list[str], spec: dict | None) -> float:
    households = None
    if spec:
        c = spec.get("census") or {}
        households = c.get("households") or ((spec.get("population") or 0) / 2.4 or None)
    cost = 0.0
    for ch in channels or []:
        if ch == "mailer":
            cost += OUTREACH_COST["mailer_per_household"] * (households or 500)
        else:
            cost += OUTREACH_COST.get(ch, 0.0)
    return round(cost, 2)


def annual(mean: dict, facilities: list[dict], policy: dict, scale: float, wage: float = DEFAULT_WAGE, spec: dict | None = None,
           scope: set | None = None) -> dict:
    """Budget of one experiment from its simulator means, for the places in `scope` (ids) plus any added places.
    facilities: baseline facility list (id, kind, opCost)."""
    op = {f["id"]: f.get("opCost", 0) for f in facilities}
    added = {a["id"]: a for a in policy.get("add", [])}
    ids = set(scope if scope is not None else op) | set(added)
    staff_week = sum(mean.get(f"staffHours.f.{i}", 0.0) for i in ids)
    running_week = sum(mean.get(f"openHours.f.{i}", 0.0) * op.get(i, added.get(i, {}).get("opCost", 20)) for i in ids)
    revenue_week = sum(mean.get(f"revenue.f.{i}", 0.0) for i in ids) * scale
    staff = 52 * staff_week * wage
    running = 52 * running_week
    revenue = 52 * revenue_week
    campaign = outreach_cost(policy.get("channels", []), spec)
    return {"staff": round(staff), "running": round(running), "revenue": round(revenue), "campaign": round(campaign),
            "net": round(staff + running - revenue + campaign), "staff_hours_week": round(staff_week, 1), "wage": wage}


def fmt_usd(x: float) -> str:
    sign = "-" if x < 0 else ""
    x = abs(x)
    return f"{sign}${x / 1e6:.2f}M" if x >= 1e6 else f"{sign}${x / 1e3:.1f}k" if x >= 1e3 else f"{sign}${x:.0f}"
