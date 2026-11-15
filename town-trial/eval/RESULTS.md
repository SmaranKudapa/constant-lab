# Town Trial evaluation results (M4)

Measured 2026-11-15 against the deployed backend (`town-trial-api` on Modal, model `gpt-5.4-mini`
for every agent and arm). Every number below comes from a saved run: raw event logs are in
`results/trials/`, summaries in `results/*.json`. Small samples (4 towns per cell); read the
numbers as indications, not significance tests.

## v2: real towns and the general town model (measured 2026-11-15, after the v1 results below)

Live trials now run on the **real town** (OpenStreetMap places, names and street names; population from OSM) with the
**general town model** (`web/js/townsim.js`: every public place, latent demand, fees, budgets), and Bo frames each question
(metric, place, resident group, budget limit). Same 4 towns and the same two questions as v1. Raw logs: `results/trials/`
(tag `town`); summary: `results/compare_town.json`.

| town | question | metric Bo chose | current | your idea | sweep | one-shot | agent | best on held-out |
|---|---|---|---|---|---|---|---|---|
| Ely, MN | notice | % of working parents who heard the notice within 3 days | 0.0 | 21.6 | 92.1 | 21.6 | 55.2 | sweep |
| Evart, MI | notice | % of working parents who heard the notice within 3 days | 0.0 | - | 92.6 | 87.3 | 86.0 | sweep |
| Hood River, OR | notice | % of working parents who heard the notice within 3 days | 0.0 | 20.7 | 92.8 | 89.2 | 89.2 | sweep |
| Marfa, TX | notice | % of working parents who heard the notice within 3 days | 0.0 | 26.1 | 92.5 | 27.6 | 54.4 | sweep |
| Ely, MN | library hours | visits/week by day workers to libraries | 3.6 | 6.0 | 9.3 | 4.9 | 9.5 | agent |
| Evart, MI | library hours | residents (of the sample) who visit libraries in a week | 22.9 | 30.9 | 37.9 | 29.8 | 31.1 | sweep |
| Hood River, OR | library hours | residents (of the sample) who visit libraries in a week | 40.4 | 45.3 | 51.0 | 47.4 | 53.5 | agent |
| Marfa, TX | library hours | visits/week by day workers to libraries | 1.7 | 4.0 | 7.5 | 4.3 | 9.5 | agent |

- **Library hours:** the iterative agent's pick is best on the held-out scenarios in **3 of 4 towns**
  (v1: 2 of 4); the sweep in 1. Bo framed the question two ways (visits by day workers, or unique
  library visitors), so compare within a row, not averages across rows.
- **Notice:** the 6-config sweep wins every town (it includes mailer and all-channel combinations, ~92% of working parents
  within 3 days); the agent reaches 71% on average and the one-shot 56%. Cy rejected
  7 of Bo's outreach proposals over unsourced claims about how residents read notices, which kept the agent cautious.
- Every experiment carries an annual budget (see the Experiments tab and `budgets` in the JSON); no trial in this set had a
  budget limit, so none were marked infeasible.

**Real-data anchor, v2 model:** the Toronto schedule change (40 h -> 62 h band) now gives **+24.9%** library visits
(range 23.2-29.5% over 6 towns), against the real **+51.9%** and the v1 model's +4.2%.
Latent demand (wants that build up while a place is closed) closes about half of the gap without tuning to this case.
It still under-predicts, so magnitudes remain indications, not forecasts.

**Not re-run on v2:** the Exa ablation and the Modal timing below are from the v1 model (the timing measures the same simulator
fan-out; the ablation should be repeated).

# v1 results (library-hours / notice model, procedural-grid towns)

## 1. Four-way comparison, matched budgets, frozen picks on held-out scenarios

Each trial freezes its finalists, then runs them on held-out scenarios fixed in advance
(A: more shift workers, B: older town, C: busier library; seeds 100-107, residents never seen during
search). Towns: Evart MI, Marfa TX, Ely MN, Hood River OR. Values are held-out means.

**Library hours** (visits/week by residents who can't make current hours):

| arm | held-out mean | gain vs current | best feasible on held-out | infeasible picks |
|---|---|---|---|---|
| current practice | 2.61 | | 0/4 | 0 |
| your idea | 5.21 | +2.59 | 0/4 | 1 |
| parameter sweep (6 configs) | **5.80** | **+3.19** | 1/4 | 0 |
| one-shot LLM | 5.53 | +2.92 | 1/4 | 1 |
| iterative agent | 4.80 | +2.19 | **2/4** | 0 |

**Notice outreach** (% of working parents who heard within 3 days):

| arm | held-out mean | gain vs current | best on held-out |
|---|---|---|---|
| current practice (= your idea in all 4 towns) | 43.4 | | 0/4 |
| parameter sweep | 94.7 | +51.3 | 3/4 |
| one-shot LLM | 92.9 | +49.5 | 0/4 |
| iterative agent | **95.7** | **+52.3** | 1/4 |

What this shows, honestly:
- On average the iterative agent does **not** beat a 6-config parameter sweep on library hours; it
  ties it on outreach (most arms converge on using every channel).
- The agent's value shows where real constraints exist. In **Ely, MN**, Ada's failure-guided search
  found a reported library budget cut ([Ely Echo](https://www.elyecho.com/article/3605,check-it-out-at-your-library):
  a $38,506.91 cut, $20,000 reinstated). Code read it as "no additional staff hours" (<= 95/week),
  which made **your idea and the one-shot pick infeasible**; the agent's pick (8.2) was the best
  feasible option on held-out. That reading of a budget cut is an interpretation and is labelled as one.
- The agent ran 2.5 revisions per hours trial on average (Cy rejected 6 proposals over 4 trials),
  so it used fewer simulator runs than the sweep's 6.
- Run-to-run variance is large: the agent scored 2.1 on Evart here and 5.4 in an earlier run of the same trial.

## 2. Exa ablation (library-hours trials, same 4 towns, equal query budgets)

| arm | Exa calls | verified facts (quoted from a source) | staffing limit found | logged gaps | agent held-out |
|---|---|---|---|---|---|
| no search | 0 | 0.0 | 0/4 | 2.0 | 4.65 (1 pick breaks the Ely cap) |
| broad (generic queries) | 3 | 1.0 | 0/4 | 1.0 | **5.99** |
| failure-guided | 3 | **1.5** | **1/4** | 0.75 | 4.80 |

Failure-guided search finds more grounded facts and the only real constraint. It did **not** raise
the agent's held-out score in this sample; broad search scored higher. Every arm's pick was also
checked against the constraint found for its town in any arm: the no-search arm's Ely pick (96 staff
hours) breaks the sourced 95-hour cap; the broad and failure-guided picks don't.

## 3. Modal: serial vs fanned out (`results/modal_timing.json`)

Same simulator workload (4 towns x 6 policies x N seeds, 7-day model), timed inside Modal.
Serial = one container, one Node process (the best case for serial). Results were identical in every row.

| seed-runs | seeds per call | serial | fanned out | containers | speedup | cost, serial / fan-out (lower bound) |
|---|---|---|---|---|---|---|
| 768 | 4 (the live trial's old setting) | 4.96 s | 4.86 s | 19 | 1.0x | $0.00003 / $0.0003 |
| 768 | 32 | 2.19 s | 0.46 s | 24 | 4.7x | $0.00003 / $0.00009 |
| 6,144 | 64 | 15.7 s | 1.38 s | 34 | 11.3x | $0.0002 / $0.0004 |
| 24,576 | 256 | 63.6 s | 2.99 s | 34 | **21.3x** | $0.0009 / $0.0011 |

One seed-run takes ~3.5 ms, so small batches are dominated by container start-up: fan-out pays off for
evaluation-size sweeps, not for a single 16-seed experiment (live trials now use 8-seed calls).
Upper-bound costs including idle scale-down are in the JSON (at most $0.03 per row). Prices:
$0.0000131/core-s and $0.00000222/GiB-s (modal.com/pricing).

## 4. Real-data anchor: Toronto Public Library (`results/real_anchor.json`)

In July 2024, eight TPL branches added Monday service plus morning and evening hours. TPL reported
**+61%** year-over-year July traffic at those branches against **+6%** at unchanged branches:
a net effect of **+52%** ([board report](https://tpl.ca/wp-content/uploads/sites/164/2025/05/12a-2025-revised-open-hours-plan-and-implementation-combined.pdf),
[City Librarian's report](https://blogs.tpl.ca/programming/2024/09/city-librarians-report-for-september-2024/)).

We ran the same schedule change in the simulator (our inference: TPL's 40-hour band to its 62-hour
band) in 6 towns x 32 seeds. **The simulator predicts +4.2% (range 2.8-6.0%)**: the right direction,
about 12x too small. Turned-away trips fall ~88%, but visits barely rise, because each simulated
resident has a fixed weekly visit budget (0-2), so longer hours reshuffle demand instead of creating it.
Toronto's result says longer hours create new visits. **The simulator's magnitudes are not forecasts**;
the comparisons above rank policies inside one model, with this limitation.

## What we would change next
- Let longer or better-timed hours raise residents' visit propensity (latent demand), then re-run the anchor.
- More towns and repeated trials per town, to separate the agent's effect from LLM run-to-run variance.
