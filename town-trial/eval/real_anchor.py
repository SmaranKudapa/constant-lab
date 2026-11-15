"""Real-data anchor: does the simulator's predicted effect of longer hours match a real before/after?

    python town-trial/eval/real_anchor.py      # writes eval/results/real_anchor.json

Real case (found with Exa): Toronto Public Library, July 2024. Eight branches added Monday
service plus extra morning and evening hours. TPL reported a 61% year-over-year increase in
July traffic at those branches, against about 6% at branches whose hours did not change
(and +55% vs -1% June to July). Sources:
  https://tpl.ca/wp-content/uploads/sites/164/2025/05/12a-2025-revised-open-hours-plan-and-implementation-combined.pdf
  https://blogs.tpl.ca/programming/2024/09/city-librarians-report-for-september-2024/
Our inference (labelled): the branches moved from TPL's 40-hour band (Tue/Thu 12:30-20:30,
Wed/Fri 10:00-18:00, Sat 9:00-17:00) to the 62-hour band (Mon-Thu 9:00-20:30, Fri-Sat
9:00-17:00), the band in the same report that matches "Monday + mornings + evenings".

Simulator setup: the same before/after schedules in several procedural towns, 32 matched
seeds each, 7-day weeks. We compare relative change in total weekly visits. The simulated
town is synthetic (72 residents, model-default schedules and interest), so this tests the
direction and rough size of the effect, not a calibrated forecast. Whatever happens is reported.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "backend"))
from sim import Runner, local_mapper  # noqa: E402

H = lambda h, m=0: h * 60 + m  # noqa: E731
BEFORE = [None, [H(12, 30), H(20, 30)], [H(10), H(18)], [H(12, 30), H(20, 30)], [H(10), H(18)], [H(9), H(17)], None]   # 40 h band
AFTER = [[H(9), H(20, 30)]] * 4 + [[H(9), H(17)], [H(9), H(17)], None]                                                  # 62 h band
TOWNS = ["Evart, MI", "Marfa, TX", "Ely, MN", "Hood River, OR", "Springfield, IL", "Oslo"]
SEEDS = 32
REAL = {"treated_yoy_pct": 61, "control_yoy_pct": 6, "treated_mom_pct": 55, "control_mom_pct": -1}


def main():
    runner = Runner(local_mapper(), "local Node")
    jobs = []
    for t in TOWNS:
        for name, hours in (("before", BEFORE), ("after", AFTER)):
            jobs.append({"key": f"{t}|{name}", "city": t, "mode": "service", "policy": {"hours": hours}, "seeds": SEEDS, "days": 7})
    out = runner.run(jobs)["results"]
    towns = []
    for t in TOWNS:
        b, a = out[f"{t}|before"]["mean"], out[f"{t}|after"]["mean"]
        towns.append({"town": t, "visits_before": b["visits"], "visits_after": a["visits"], "change_pct": 100 * (a["visits"] / b["visits"] - 1),
                      "unique_before": b["uniqueVisitors"], "unique_after": a["uniqueVisitors"],
                      "turned_away_before": b["turnedAway"], "turned_away_after": a["turnedAway"]})
    sim_pct = sum(x["change_pct"] for x in towns) / len(towns)
    # The general town model (v2): same schedules at the library, latent demand, people who don't know the hours get turned away.
    tj = []
    for t in TOWNS:
        for name, hours in (("before", BEFORE), ("after", AFTER)):
            tj.append({"key": f"{t}|{name}", "city": t, "mode": "town", "policy": {"target": "library", "facilities": {"library": {"hours": hours}}},
                       "seeds": SEEDS, "days": 7})
    tout = runner.run(tj)["results"]
    town_rows = []
    for t in TOWNS:
        b, a = tout[f"{t}|before"]["mean"], tout[f"{t}|after"]["mean"]
        town_rows.append({"town": t, "library_visits_before": b["visits.f.library"], "library_visits_after": a["visits.f.library"],
                          "change_pct": 100 * (a["visits.f.library"] / b["visits.f.library"] - 1),
                          "turned_away_before": b.get("turnedAway.f.library", 0), "turned_away_after": a.get("turnedAway.f.library", 0)})
    town_pct = sum(x["change_pct"] for x in town_rows) / len(town_rows)
    real_net = 100 * ((1 + REAL["treated_yoy_pct"] / 100) / (1 + REAL["control_yoy_pct"] / 100) - 1)
    res = {
        "case": "Toronto Public Library, 8 branches, July 2024: Monday service + extra mornings and evenings",
        "sources": ["https://tpl.ca/wp-content/uploads/sites/164/2025/05/12a-2025-revised-open-hours-plan-and-implementation-combined.pdf",
                    "https://blogs.tpl.ca/programming/2024/09/city-librarians-report-for-september-2024/"],
        "real": {**REAL, "net_effect_pct_vs_control": round(real_net, 1),
                 "note": "Year-over-year July traffic; control = branches whose hours did not change. One month of data, 8 branches."},
        "assumed_schedules": {"before": "40 h band: Tue/Thu 12:30-20:30, Wed/Fri 10:00-18:00, Sat 9:00-17:00",
                              "after": "62 h band: Mon-Thu 9:00-20:30, Fri-Sat 9:00-17:00",
                              "note": "Our inference from TPL's band table; TPL did not publish per-branch schedules in these sources."},
        "simulated": {"towns": towns, "seeds": SEEDS, "mean_change_pct": round(sim_pct, 1),
                      "range_pct": [round(min(x["change_pct"] for x in towns), 1), round(max(x["change_pct"] for x in towns), 1)]},
        "simulated_town_model": {"towns": town_rows, "seeds": SEEDS, "mean_change_pct": round(town_pct, 1),
                                 "range_pct": [round(min(x["change_pct"] for x in town_rows), 1), round(max(x["change_pct"] for x in town_rows), 1)],
                                 "note": "General town model (web/js/townsim.js): wants accumulate when places are closed (latent demand). Not tuned to this case."},
        "comparison": {"sim_minus_real_pct_points": round(sim_pct - real_net, 1), "town_model_minus_real_pct_points": round(town_pct - real_net, 1)},
        "caveats": ["Synthetic towns of 72 residents with model-default schedules; residents' interest caps weekly visits at 0-2.",
                    "The real figure includes effects the model lacks (new awareness, programmes, seasonality beyond the control).",
                    "Comparison is of relative change only; no calibration to Toronto was done."],
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    path = HERE / "results" / "real_anchor.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(res, indent=2))
    print(json.dumps({"real_net_pct": res["real"]["net_effect_pct_vs_control"], "sim_mean_pct": res["simulated"]["mean_change_pct"],
                      "town_model_mean_pct": town_pct, "town_model_range": res["simulated_town_model"]["range_pct"],
                      "sim_range": res["simulated"]["range_pct"], "towns": [(x["town"], round(x["change_pct"], 1)) for x in towns]}, indent=1))


if __name__ == "__main__":
    main()
