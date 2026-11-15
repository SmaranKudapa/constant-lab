"""Policy helpers: trial classification, the primary metric, and library hours.

These mirror small pure helpers in web/js/sim.js and research.js (hoursWith,
staffHours, hoursText, classify, primary). They never compute simulation
numbers; constraints such as staff hours are checked here, in code.
"""
from __future__ import annotations

import re

from decimal import ROUND_HALF_UP, Decimal

DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def H(h: int, m: int = 0) -> int:
    return h * 60 + m


BASELINE_HOURS = [[H(10), H(18)]] * 6 + [None]

# Trial type from the question. Keep in sync with classify() in web/js/research.js (tests/classify_cases.json checks both).
# STRONG: the question is about whether people hear / know / find out about something.
STRONG_PERCEPTION = re.compile(
    r"\b(hear|hears|heard|hearing)\b|\baware(ness)?\b|\bunaware\b|\bfind(s|ing)? out\b|\bfound out\b|\blearn(s|ed)? (about|of|that)\b"
    r"|\bknow(s|n)? (about|of|that|when|if|where|what)\b|\b(will|would|do|does|did|can|could|won't|wouldn't|don't|doesn't)\s+(\w+\s+){0,3}know\b"
    r"|\bknew\b|\bword of mouth\b|\bget the word out\b|\bspread the word\b|\bnews (of|about|spread)\b|\bwho (will )?(hears?|knows?|finds? out)\b"
    r"|\bannounce(ment|d|s)?\b|\bperception\b|\bpublici[sz]e\b|\binform(ed|ing)? (people|residents|the public|everyone)\b")
# WEAK: outreach words that can also appear in a usage question ("will flyers bring more visitors?")
WEAK_PERCEPTION = re.compile(r"\bnotice(s|d)?\b|\bcampaign\b|\boutreach\b|\bflyers?\b|\badverti[sz]\w*\b|\bmarketing\b|\bnewsletter\b"
                             r"|\bmailers?\b|\bnewspaper\b|\bopinion\b|\bbelieve\b|\bthink about\b|\bcommunicat\w*\b")
USAGE = re.compile(r"\bvisit\w*\b|\buse\b|\busage\b|\battend\w*\b|\bturn(ed)? away\b|\bcrowd\w*\b|\bwait\w*\b|\bcost\w*\b|\bbudget\b|\bsave money\b"
                   r"|\bmore people (come|go|use)\b|\bfoot traffic\b|\bbusier\b")


def strong_perception(prompt: str) -> bool:
    """True when the question's goal is clearly whether people hear about something (and not how many use a place)."""
    p = prompt.lower()
    return bool(STRONG_PERCEPTION.search(p)) and not USAGE.search(p)


def classify(prompt: str) -> str:
    p = prompt.lower()
    if STRONG_PERCEPTION.search(p) and not USAGE.search(p):
        return "perception"
    if (STRONG_PERCEPTION.search(p) or WEAK_PERCEPTION.search(p)) and not USAGE.search(p):
        return "perception"
    return "service"


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


CHANNELS = ["online", "board", "bulletin"]
_HHMM = __import__("re").compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def apply_changes(base: list, changes: list[dict]) -> list:
    """Apply Bo's hours_changes [{day, open, close}] to a full week of hours."""
    h = [list(x) if x else None for x in base]
    for c in changes:
        h[c["day"]] = None if c.get("open") is None else [to_minutes(c["open"]), to_minutes(c["close"])]
    return h


def validate_action(mode: str, action: dict) -> str | None:
    """Return an error message if Bo's action is outside the supported schema, else None. Checked in code, never by the LLM."""
    if mode == "service":
        changes = action.get("hours_changes") or []
        if not changes:
            return "hours_changes is empty"
        days = [c.get("day") for c in changes]
        if len(set(days)) != len(days):
            return "a day appears twice"
        for c in changes:
            d, o, cl = c.get("day"), c.get("open"), c.get("close")
            if not isinstance(d, int) or not 0 <= d <= 6:
                return f"day must be 0..6 (got {d})"
            if o is None and cl is None:
                continue  # closes that day
            if not (isinstance(o, str) and isinstance(cl, str) and _HHMM.match(o) and _HHMM.match(cl)):
                return f"open/close must be HH:MM or both null (day {d})"
            if not (H(6) <= to_minutes(o) < to_minutes(cl) <= H(23)):
                return f"hours must satisfy 06:00 <= open < close <= 23:00 (day {d})"
        return None
    chans = action.get("channels") or []
    if not chans:
        return "channels is empty"
    bad = [c for c in chans if c not in CHANNELS]
    if bad:
        return f"unsupported channels {bad}; allowed {CHANNELS}"
    if len(set(chans)) != len(chans):
        return "a channel appears twice"
    return None


def describe_hours(hours: list) -> str:
    return ", ".join(f"{DAYS[d]} " + (f"{_fmt(x[0])}-{_fmt(x[1])}" if x else "closed") for d, x in enumerate(hours))


# ---------- town mode (general model): actions on any public place, new places, outreach ----------
TOWN_CHANNELS = ["online", "board", "bulletin", "newspaper", "mailer"]


def validate_town_action(action: dict, facilities: dict, kinds: list[str], places: set[str]) -> str | None:
    """Error message if Bo's town action is outside the supported schema, else None. Checked in code, never by the LLM."""
    changes = action.get("facility_changes") or []
    adds = action.get("new_facilities") or []
    chans = action.get("channels") or []
    if not (changes or adds or chans):
        return "the action changes nothing"
    seen = set()
    for c in changes:
        fid = c.get("facility")
        if fid not in facilities:
            return f"unknown facility {fid!r}; choose one of {sorted(facilities)}"
        if fid in seen:
            return f"facility {fid} appears twice"
        seen.add(fid)
        if c.get("hours_changes"):
            e = validate_action("service", {"hours_changes": c["hours_changes"]})
            if e:
                return f"{fid}: {e}"
        cap, fee = c.get("capacity"), c.get("fee")
        if cap is not None and not (isinstance(cap, int) and 1 <= cap <= 500):
            return f"{fid}: capacity must be 1..500"
        if fee is not None and not (0 <= float(fee) <= 100):
            return f"{fid}: fee must be $0..$100"
        if not (c.get("hours_changes") or cap is not None or fee is not None or c.get("close")):
            return f"{fid}: no change given"
    for a in adds:
        if a.get("kind") not in kinds:
            return f"new facility kind must be one of {kinds}"
        if a.get("near") not in places:
            return f"new facility 'near' must be an existing place id (e.g. {sorted(places)[:6]})"
        if a.get("hours_changes"):
            e = validate_action("service", {"hours_changes": a["hours_changes"]})
            if e:
                return f"new {a['kind']}: {e}"
    bad = [c for c in chans if c not in TOWN_CHANNELS]
    if bad:
        return f"unsupported channels {bad}; allowed {TOWN_CHANNELS}"
    return None


def town_policy(action: dict, facilities: dict, defaults: dict, target: str | None) -> dict:
    """Bo's town action -> simulator policy (web/js/townsim.js)."""
    pol: dict = {"target": target, "facilities": {}, "add": [], "channels": sorted(set(action.get("channels") or []))}
    for c in action.get("facility_changes") or []:
        f = facilities[c["facility"]]
        o = {}
        if c.get("hours_changes"):
            o["hours"] = apply_changes(f["hours"], c["hours_changes"])
        if c.get("capacity") is not None:
            o["capacity"] = int(c["capacity"])
        if c.get("fee") is not None:
            o["fee"] = round(float(c["fee"]), 2)
        if c.get("close"):
            o["closed"] = True
        pol["facilities"][c["facility"]] = o
    for i, a in enumerate(action.get("new_facilities") or []):
        d = defaults[a["kind"]]
        n = {"id": f"new-{a['kind']}-{i + 1}", "kind": a["kind"], "near": a["near"], "opCost": d.get("opCost", 20)}
        n["hours"] = apply_changes(d["hours"], a["hours_changes"]) if a.get("hours_changes") else d["hours"]
        if a.get("capacity") is not None:
            n["capacity"] = int(a["capacity"])
        if a.get("fee") is not None:
            n["fee"] = round(float(a["fee"]), 2)
        pol["add"].append(n)
    if not pol["facilities"]:
        del pol["facilities"]
    if not pol["add"]:
        del pol["add"]
    if not pol["channels"]:
        del pol["channels"]
    return pol


def describe_town(policy: dict, facilities: dict, places: dict) -> str:
    parts = []
    for fid, o in (policy.get("facilities") or {}).items():
        f = facilities.get(fid, {"name": fid, "hours": None})
        bits = []
        if o.get("closed"):
            bits.append("closed")
        if "hours" in o:
            ch = [f"{DAYS[d]} " + (f"{_fmt(x[0])}-{_fmt(x[1])}" if x else "closed") for d, x in enumerate(o["hours"]) if not f.get("hours") or x != f["hours"][d]]
            bits.append(", ".join(ch) or "same hours")
        if "capacity" in o:
            bits.append(f"capacity {o['capacity']}")
        if "fee" in o:
            bits.append(f"fee ${o['fee']:g}")
        parts.append(f"{f['name']}: {'; '.join(bits)}")
    for a in policy.get("add") or []:
        parts.append(f"new {a['kind'].replace('_', ' ')} near {places.get(a['near'], a['near'])}")
    if policy.get("channels"):
        parts.append("notice via " + " + ".join(policy["channels"]))
    return " | ".join(parts) or "current practice"
