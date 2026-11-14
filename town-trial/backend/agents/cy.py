"""Cy, the reviewer: checks causal assumptions and reads failure traces.

Hard constraints (staff hours, supported actions) are checked in code before
Cy sees a proposal. Cy judges what code can't: whether the proposal's
reasoning relies on inputs that no local source supports.
"""
from __future__ import annotations

from agents.llm import LLM, strict

SYSTEM = ("You are Cy, the reviewer in a team testing local policy ideas in a simulated town. "
          "Approve a proposal only if it uses supported actions and its reasoning does not rely on inputs that are not backed by the local sources listed "
          "(results from other towns, industry averages, or guesses are hypotheses, not inputs). Be brief and specific.")


class Cy:
    def __init__(self, llm: LLM):
        self.llm = llm

    def review(self, mode: str, proposal: str, evidence: str, constraints: str) -> dict:
        schema = strict({"ok": {"type": "boolean"}, "reason": {"type": "string", "description": "one or two sentences"},
                         "ungrounded_inputs": {"type": "array", "items": {"type": "string"}}})
        return self.llm.json("review", schema, SYSTEM,
                             f"Trial type: {mode}\nProposal: {proposal}\nLocal sources so far: {evidence}\nConstraints (already checked in code): {constraints}")

    def failure(self, mode: str, city: str, results: str, trace: str, constraints: str) -> dict:
        schema = strict({"trace": {"type": "string", "description": "what the failure trace shows, 1-2 sentences, citing its numbers"},
                         "next_question": {"type": "string", "description": "the one factual question about the real town whose answer would most change the ranking or the design"},
                         "entity": {"type": "string", "description": "the specific local body that would answer it (e.g. library board, school district, city council)"}})
        return self.llm.json("failure", schema, SYSTEM,
                             f"Trial type: {mode}\nTown: {city}\nResults (mean over matched seeds): {results}\n"
                             f"Failure trace of the best experiment: {trace}\nConstraints: {constraints}\n"
                             "Read the trace: who is still missed and why. Then ask the next question for web search.")
