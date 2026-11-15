"""Resident voices: what each group of residents would say about the recommended policy.

The numbers (and so each group's stance) come from the simulator, computed in code. The LLM only
writes a role and a one-line first-person quote that matches those numbers. Every quote is labelled
LLM-written (or scripted, when the LLM is unavailable): these are not real residents.
"""
from __future__ import annotations

from .llm import LLM, strict

COHORTS = {
    "day-workers": ("Day workers", "work 9:00-17:00 on weekdays"),
    "families": ("Working parents", "work days and do the school run morning and afternoon"),
    "seniors": ("Seniors", "retired, free most of the day, avoid going out after dark"),
    "students": ("Students", "in school until about 15:00, free evenings and weekends"),
    "night-shift": ("Night shift", "work nights and sleep in the morning, free early afternoon"),
    "remote": ("Remote workers", "work from home with flexible hours"),
}
STANCES = ["helped", "hurt", "unchanged"]


def _stance(before: float, after: float, higher_is_better: bool = True) -> str:
    d = after - before
    if abs(d) < max(0.25, 0.05 * abs(before)):
        return "unchanged"
    return "helped" if (d > 0) == higher_is_better else "hurt"


def facts(best: dict, base: dict, awareness: bool = False) -> list[dict]:
    """Per-group numbers for the recommended policy vs current practice (means over matched seeds)."""
    mb, ma = (base.get("result") or {}).get("mean", {}), (best.get("result") or {}).get("mean", {})
    out = []
    for c, (label, sched) in COHORTS.items():
        key = f"awarePct.c.{c}" if awareness else f"visits.c.{c}"
        if key not in mb and key not in ma:
            continue
        b, a = float(mb.get(key, 0.0)), float(ma.get(key, 0.0))
        out.append({"cohort": c, "label": label, "schedule": sched, "before": round(b, 1), "after": round(a, 1),
                    "unit": "% heard about it" if awareness else "visits/week", "stance": _stance(b, a)})
    if not out:  # older modes have no per-group numbers: one town-wide line, still from the simulator
        k = "awarePct" if awareness else "visits"
        b, a = float(mb.get(k, 0.0)), float(ma.get(k, 0.0))
        out.append({"cohort": "everyone", "label": "Residents", "schedule": "a mix of schedules", "before": round(b, 1), "after": round(a, 1),
                    "unit": "% heard about it" if awareness else "visits/week", "stance": _stance(b, a)})
    return out


SCHEMA = strict({"voices": {"type": "array", "items": strict({
    "cohort": {"type": "string"},
    "role": {"type": "string", "description": "a concrete everyday role for one person in this group, e.g. 'High-school student', 'Night-shift nurse'"},
    "quote": {"type": "string", "description": "one first-person sentence, under 120 characters, plain spoken, no hashtags or emoji"},
})}})

SYSTEM = ("You write short first-person reactions from residents of a small town to a local policy change. "
          "Each group's numbers come from a simulation and you must not contradict them: a group marked 'helped' should sound glad "
          "and say why it fits their schedule; 'hurt' should sound let down and say why; 'unchanged' should explain why it makes no "
          "difference to them (e.g. 'Can't make it, I'm in class until 6' or 'I already go on Saturdays'). Mention their schedule "
          "or situation concretely. No numbers, no statistics, no names.")


def llm_voices(llm: LLM, city: str, question: str, change: str, rows: list[dict]) -> list[dict]:
    lines = "\n".join(f"- cohort={r['cohort']} ({r['label']}; {r['schedule']}): {r['stance']} ({r['before']} -> {r['after']} {r['unit']})" for r in rows)
    out = llm.json("resident_voices", SCHEMA, SYSTEM,
                   f"Town: {city}\nQuestion asked: {question}\nRecommended policy: {change}\nGroups:\n{lines}\n"
                   f"Write exactly one voice per cohort, using the cohort ids above.")
    got = {v["cohort"]: v for v in out.get("voices", [])}
    missing = [r["cohort"] for r in rows if r["cohort"] not in got]
    if missing:
        raise ValueError(f"no voice for {', '.join(missing)}")
    return [{**r, "role": got[r["cohort"]]["role"][:40], "quote": got[r["cohort"]]["quote"][:160]} for r in rows]


ROLE = {"day-workers": "Office worker", "families": "Parent of two", "seniors": "Retired teacher", "students": "High-school student",
        "night-shift": "Night-shift nurse", "remote": "Remote developer", "everyone": "Resident"}
WHY = {"day-workers": ("now I can go after work", "it's only open while I'm at work", "my hours haven't changed and neither has this"),
       "families": ("it finally fits around the school run", "it's harder to fit around the kids now", "I still can't fit it around the kids"),
       "seniors": ("it's easier for me to get there", "I've lost the times I used to go", "I already go during the day"),
       "students": ("I can come after class", "it's closed when I'm out of school", "can't make it, I'm in class until then"),
       "night-shift": ("it's open when I'm awake", "it's closed whenever I'm free", "I'm asleep when it's open"),
       "remote": ("I can slot it into my day", "it's less convenient for me now", "I can go anytime anyway"),
       "everyone": ("it works better for me", "it works worse for me", "it doesn't change much for me")}


def scripted_voices(rows: list[dict]) -> list[dict]:
    lead = {"helped": "Good news: ", "hurt": "Not great: ", "unchanged": "Doesn't change much: "}
    return [{**r, "role": ROLE.get(r["cohort"], "Resident"), "quote": lead[r["stance"]] + WHY.get(r["cohort"], WHY["everyone"])[STANCES.index(r["stance"])] + "."}
            for r in rows]
