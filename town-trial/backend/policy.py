"""Policy helpers: trial classification, the primary metric, and library hours.

These mirror small pure helpers in web/js/sim.js and research.js (hoursWith,
staffHours, hoursText, classify, primary). They never compute simulation
numbers; constraints such as staff hours are checked here, in code.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def H(h: int, m: int = 0) -> int:
    return h * 60 + m


BASELINE_HOURS = [[H(10), H(18)]] * 6 + [None]

PERCEPTION_WORDS = ["hear", "aware", "perception", "notice", "market", "campaign", "opinion", "outreach", "flyer", "advert",
                    "know about", "find out", "word of mouth", "believe", "think about"]


def classify(prompt: str) -> str:
    p = prompt.lower()
    return "perception" if any(w in p for w in PERCEPTION_WORDS) else "service"


def primary(mode: str) -> dict:
    if mode == "service":
        return {"key": "restrictedVisits", "label": "visits/week by residents who can't make current hours", "unit": ""}
    return {"key": "familiesAwarePct", "label": "% of working parents who heard within 3 days", "unit": "%"}


def days_for(mode: str) -> int:
    return 7 if mode == "service" else 3


def hours_with(changes: list[tuple]) -> list:
    h = [list(x) if x else None for x in BASELINE_HOURS]
    for day, open_, close in changes:
        h[day] = None if open_ is None else [open_, close]
    return h


def staff_hours(hours: list, staff: int = 2) -> float:
    total = sum((x[1] - x[0]) / 60 for x in hours if x) * staff
    return int(total) if float(total).is_integer() else total


def _fmt(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def hours_text(hours: list) -> str:
    parts = []
    for d, x in enumerate(hours):
        base = BASELINE_HOURS[d]
        if x and (base is None or x[0] != base[0] or x[1] != base[1]):
            parts.append(f"{DAYS[d]} {_fmt(x[0])}-{_fmt(x[1])}")
    return ", ".join(parts) or "current hours"


def to_minutes(t: str) -> int:
    h, _, m = t.partition(":")
    return int(h) * 60 + int(m or 0)


def hours_from_action(action: dict) -> list:
    """Bo's action schema {"hours_changes": [{day, open, close}]} -> full week of [open, close] minutes."""
    return hours_with([(c["day"], None if c.get("open") is None else to_minutes(c["open"]),
                        None if c.get("close") is None else to_minutes(c["close"])) for c in action.get("hours_changes", [])])


def fixed(x: float, digits: int = 1) -> str:
    """Number.prototype.toFixed: exact binary value, ties away from zero (Python's format rounds ties to even)."""
    if x == 0:
        x = 0.0  # JS prints -0 as "0"
    return str(Decimal(x).quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP))
