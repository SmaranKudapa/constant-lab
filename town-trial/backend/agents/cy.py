"""Cy, the reviewer: checks causal assumptions and reads failure traces.

Hard constraints (staff hours, supported actions) are checked in code before
Cy sees a proposal. Cy judges what code can't: whether the proposal's
reasoning relies on real-world inputs that no local source supports.
"""
from __future__ import annotations

from agents.llm import LLM, strict

SYSTEM = ("You are Cy, the reviewer in a team testing local policy ideas in a simulated town. "
          "Two kinds of evidence are legitimate: (1) the team's own simulation results and failure traces, which are valid grounds for "
          "choosing what to try next; (2) local sources about the real town. "
          "Reject a proposal only if it is outside the supported actions, or if its reasoning changes or assumes a real-world MODEL INPUT "
          "(demand levels, open rates, behaviour, staffing availability, budgets) that no local source supports; results from other towns, "
          "industry averages and guesses are hypotheses, not inputs. Citing the simulation trace is fine. Be brief and specific.")


class Cy:
    def __init__(self, llm: LLM):
        self.llm = llm

    def review(self, mode: str, proposal: str, evidence: str, constraints: str, trace: str = "") -> dict:
        """Cy classifies each assumption; code decides: reject only if an assumption is an unsupported real-world input."""
        schema = strict({
            "assumptions": {"type": "array", "items": strict({
                "assumption": {"type": "string"},
                "basis": {"type": "string", "enum": ["simulation_result", "model_mechanism", "local_source", "channel_existence", "unsupported_real_world_input"],
                          "description": "simulation_result: comes from the team's simulation results or trace (always acceptable); "
                                         "model_mechanism: an expectation about the action's effect (reach, visits, who it helps) that the simulation "
                                         "itself will test by running it (acceptable); "
                                         "local_source: stated by a listed local source; channel_existence: whether a notice channel "
                                         "(online, board, bulletin) exists in the town, which code labels for every arm (acceptable); "
                                         "unsupported_real_world_input: any other claim about the real town's demand, behaviour, staffing, budget "
                                         "or rates that no listed source states"}})},
            "reason": {"type": "string", "description": "one or two sentences for the log"},
        })
        user = (f"Trial type: {mode}\nProposal: {proposal}\nLocal sources so far: {evidence}\n"
                f"Simulation results and trace (basis = simulation_result): {trace or 'none'}\nConstraints (already checked in code): {constraints}\n"
                "List the proposal's key assumptions (at most 4) and classify each.")
        out = self.llm.json("review", schema, SYSTEM, user)
        bad = [a["assumption"] for a in out["assumptions"] if a["basis"] == "unsupported_real_world_input"]
        return {"ok": not bad, "reason": out["reason"], "ungrounded_inputs": bad, "assumptions": out["assumptions"]}

    def failure(self, mode: str, city: str, results: str, trace: str, constraints: str) -> dict:
        schema = strict({
            "trace": {"type": "string", "description": "what the failure trace shows, 1-2 sentences, citing its numbers"},
            "next_question": {"type": "string", "description": "one short factual question (under 20 words) about the real town that the simulation "
                              "cannot know and whose answer would change what is allowed or what to try: staffing or budget limits, policies, which channels exist"},
            "entity": {"type": "string", "description": "the specific local body that would answer it (e.g. library board, school district, city council)"},
            "search_topic": {"type": "string", "description": "3-8 keywords for a web search, no town name, e.g. 'library board staffing budget evening hours'"},
        })
        user = (f"Trial type: {mode}\nTown: {city}\nResults (mean over matched seeds): {results}\n"
                f"Failure trace of the best experiment: {trace}\nConstraints: {constraints}\n"
                "Read the trace: who is still missed and why. Then ask the next question for web search.")
        return self.llm.json("failure", schema, SYSTEM, user)
