# Entering the Exa and past.dev challenges

Both are worth entering: each needs one change to the research loop, and the viewer already shows the evidence their briefs ask for.

## What the briefs require (from the Resources tab)

**Exa** (judged: Exa is central 30%, research value 25%, creativity 25%, checkable output 20%)
- At least one Exa call runs in the main loop, not a side feature.
- The repo points to where Exa is called.
- The demo shows what was found through Exa and how it was used.
- Strongest projects do something model knowledge alone can't: recent data, checking a claim against sources, finding a method nobody told the agent about.

**past.dev**
- More than one agent writes to the memory layer; more than one reads from it.
- At least one agent reads data written by a different agent and uses it.
- README says which memory holds what. No need to prove it helped; if it didn't, explain why.

## Changes to the loop

Old cycle: propose → run → verify → keep or revert.
New cycle, for every agent on every attempt:

1. **Recall (past.dev).** Search shared memory for notes on this constant and on similar techniques from other constants. Log a `MEMORY_READ` for each note actually used, with its author.
2. **Scout (Exa).** A breaker may not propose a new approach without a scout brief for it. The brief is an Exa search for (a) methods for this kind of problem and (b) whether the idea was already tried. Cached per approach, so it runs when an agent starts, changes approach, or stalls, not on every small edit. Log an `EXA` event with sources and what was done with them.
3. Propose → run on Modal → exact check → keep or revert.
4. **Record (past.dev).** Write one note: what was tried, the result, and the evidence. Log `MEMORY_WRITE`.

Two more Exa calls that make it central rather than decorative:
- **Verifier novelty check.** Before any `SUMMIT`, the verifier searches for newer claims (recent arXiv, Tao's repo and its open pull requests) and logs the sources. This is "check a claim against real sources".
- **Researcher agents** whose whole job is Exa: they read papers on a constant and write method notes into past.dev for the breakers. That makes the two sponsors' pieces depend on each other.

## Where each kind of memory lives (for the README)

| Store | Holds |
|---|---|
| past.dev | Notes: tricks, dead ends, bugs, insights, method summaries from Exa. One identity per agent. |
| `events.jsonl` on a Modal Volume | The event log (what happened, when, why). |
| Modal Volume files | Candidate constructions and verifier outputs. |

## Evidence the viewer shows

- **Lookout panel:** every Exa query, its sources as links, and what the lab did with them.
- **Note pile panel:** notes, writers, and the list of cross-agent reads.
- **Agent panel:** "Notes it used (from other agents)" and "Sources found with Exa".

## To check with the sponsors on site

- past.dev: the exact write and recall calls and how to give each agent its own identity (their docs weren't reachable from Claude's sandbox). Ask Lazare.
- Exa: whether the `research paper` category and date filters behave as expected for arXiv preprints from the last few weeks.
- Ablation for the pitch: same budget with memory off and with the scout off.
