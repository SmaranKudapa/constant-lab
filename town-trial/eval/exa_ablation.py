"""Exa ablation: no search vs broad vs failure-guided, with equal query and time budgets.

    python town-trial/eval/exa_ablation.py      # runs the none/broad arms; the failure-guided arm is the comparison suite

Arms (service trials, same towns, same prompt, same LLM budget):
  none    - no Exa calls; baseline uses model defaults, gaps are logged
  broad   - 3 searches: the baseline hours query plus 2 generic town/library queries
  failure - 3 searches: the baseline query plus 2 queries built from Cy's next_question + entity
Reports verified facts, constraints found, logged gaps and the agent's held-out score per arm
(results/exa_ablation.json). Implementation: research_loop.LiveTrial (exa_mode option).
"""
import sys

from run_eval import main

if __name__ == "__main__":
    sys.argv = [sys.argv[0], "ablation"]
    main()
