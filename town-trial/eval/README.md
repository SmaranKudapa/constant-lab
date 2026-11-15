# Town Trial evaluation (M4)

Every result here comes from real runs. Raw event logs for every evaluated trial are in
`results/trials/<trial_id>.json`, so each summary number can be traced to the run that produced it.

| script | what | output |
|---|---|---|
| `run_eval.py compare` | 4-way comparison with matched budgets on the deployed backend: current practice, your idea, parameter sweep (6 configs), one-shot LLM (same model and evidence, no feedback), iterative agent. Picks are frozen, then tested on held-out scenarios A/B/C (more shift workers, older town, busier library) x seeds 100-107. | `results/compare.json` |
| `exa_ablation.py` | Exa ablation on service trials: no search vs broad (same number of generic queries) vs failure-guided (the comparison runs). | `results/exa_ablation.json` |
| `modal_timing.py` | The same simulator workload serially (one container) vs fanned out with `.map`, at four sizes, with cost bounds from Modal's list prices. | `results/modal_timing.json` |
| `real_anchor.py` | Toronto Public Library's 2024 hours expansion (real before/after with a control group) vs the simulator's prediction for the same schedule change. | `results/real_anchor.json` |

Run (needs the backend deployed; `modal_timing.py` needs `modal` and the workspace token):

```
python town-trial/eval/run_eval.py compare
python town-trial/eval/exa_ablation.py
modal run town-trial/eval/modal_timing.py
python town-trial/eval/real_anchor.py
python town-trial/eval/run_eval.py summarize     # re-aggregate saved trials
```

Results are summarised in `RESULTS.md`.
