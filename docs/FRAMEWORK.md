# Constant Lab: research framework proposal

Iterate AI Research Hackathon · Track 1 (beat a best-known result in mathematics autonomously) · also entering Exa, past.dev and Modal · written Saturday 10:45

## 1. Summary

Constant Lab is a small research organisation made of AI agents. It takes constants from Terence Tao's optimization-constants table, where each constant has a best-known bound, and tries to improve those bounds without a human choosing what to try.

A plain autoresearch loop is one agent editing one file against one metric. Constant Lab differs in four ways:

1. **It builds and tests its own referee first.** For each constant, a verifier agent writes an exact checker and must reproduce the published record before any search starts. No reproduced record, no search.
2. **Agents have roles, and a director moves money between them.** Researchers read, breakers search, a verifier checks. The director shifts compute toward whoever is closing the gap fastest per dollar and writes down why.
3. **Nothing is tried blind.** Every new approach starts with shared-memory recall (past.dev) and a literature scout (Exa). Every attempt ends with a note that other agents on other constants can use.
4. **Every step is logged in one format** that the viewer, the comparison chart and the pitch all read.

## 2. What last night taught us

| Lesson | Design consequence |
|---|---|
| Six agents used up a 5-hour usage limit in ten minutes. | Budget is a first-class object: hard caps per agent, per constant and overall, and the director allocates dollars, not just workers. |
| The famous constants (1a–1d, 89a) are raced daily by other agent pipelines for gains of a billionth. | Pick quiet constants with cheap exact checks. Check Tao's open pull requests and arXiv, not just the published table, before calling anything a record. |
| A quick solo experiment on 16a found a likely gain in an hour, because the existing certificate threw away a tail it could have bounded. | "Read how the record was certified and look for slack" is a strategy the researchers should run on every constant. |
| The first 16a number was floating point and unproven. | A claim only counts after the verifier re-derives it in exact or interval arithmetic with separate code. |
| Agents sharing one repo needed strict rules about who writes where. | Each agent writes only to its own workspace; shared state goes through memory and the log. |

## 3. Parts

| Part | What it does | Runs on |
|---|---|---|
| **Problem card** | One YAML file per constant: definition, direction, record and source, candidate format, checker path, budget. | Repo |
| **Verifier** | Writes the exact checker from the definition; reproduces the published record (the gate); later re-checks every claimed improvement with independent code and does the novelty check. Only the verifier can declare a record. | LLM + Modal Sandbox + Exa |
| **Researchers** | Read the constant's page, certificates and papers (Exa); write method notes and proposed approaches to shared memory. Rerun when a constant stalls. | LLM + Exa + past.dev |
| **Breakers** | Each owns one approach as a strategy file. Cycle: recall → scout → edit → run → exact score → keep or revert → write note. | LLM + Modal + past.dev |
| **Director** | Opens and closes constants, spawns and retires agents, allocates budget, calls researchers on stalls. Logs a reason for every decision. | LLM + plain code |
| **Shared memory** | Notes (tricks, dead ends, bugs, insights, method summaries), one identity per agent, readable across constants. | past.dev |
| **Event log** | Append-only JSON lines (`docs/LOG_FORMAT.md`). | Modal Volume |
| **Viewer** | The mountain view, read-only on the log. Already built in `web/`. | Modal web endpoint |

## 4. One cycle of a breaker

```
1. RECALL   memory.search(constant + technique)          -> log MEMORY_READ (with author) for notes used
2. SCOUT    if approach is new, changed, or stalled:
              exa.search(methods + prior attempts)       -> log EXA (sources, what we did with them)
3. PROPOSE  LLM edits strategy file (given card, incumbent, notes, scout brief)
4. RUN      Modal Sandbox: strategy(start=incumbent, budget_s) -> candidate   (no network, no secrets, timeout)
5. SCORE    checker(candidate) exactly
6. RATCHET  better than the agent's incumbent? keep (log KEEP) : revert (log REVERT, with reason)
7. RECORD   memory.write(what was tried, result, evidence) -> log MEMORY_WRITE
8. CLAIM    if score beats the record: hand to verifier  -> VERIFY, then SUMMIT only if it passes
```

Steps 1, 2 and 7 are what enter the past.dev and Exa challenges; they sit in the main loop, not beside it. The scout brief is cached per approach so Exa isn't called on every small edit.

**Strategy file interface** (the only thing a breaker edits):

```python
def climb(start: dict, budget_s: float, seed: int, notes: list[str]) -> dict:
    """Return a candidate in the card's format. Must finish within budget_s."""
```

## 5. Roles are prompts plus boundaries

An agent = role prompt + scope (which constant, which approach) + its own write path + the shared protocol. Same model underneath; a stronger model for the director, verifier and researchers, a cheaper one for routine breaker edits.

| Role | Reads | Writes | May not |
|---|---|---|---|
| Verifier | card, papers, candidate | `checkers/<id>.py`, VERIFY/SUMMIT events | edit strategies |
| Researcher | Exa, Tao repo, memory | memory notes, approach proposals | run searches |
| Breaker | card, memory, scout brief | its own `strategies/<agent>.py`, memory notes | edit the checker, declare a record |
| Director | log, budget | DECIDE events, agent roster | edit code |

The split that matters most: **the agent that searches never grades itself**, and cannot touch the checker.

## 6. Director policy

Keep the arithmetic in code and let the LLM explain and handle exceptions.

- **Progress rate** per agent: altitude gained per dollar, where altitude = share of the gap between the lab's starting score and the record that has been closed. Exponentially decayed so old luck fades.
- **Allocation** every few minutes: Thompson sampling (or UCB) over those rates, with at least 15% of budget reserved for agents and constants that haven't paid off yet.
- **Stall:** no kept attempt on a constant for 45 minutes → send a researcher. No gain for 3 hours → drop to a minimum crew.
- **Retire:** an approach with 8 attempts and no keep is retired, and a dead-end note is written automatically.
- **Spawn:** a researcher's proposal, or a variation of the best approach, starts a new breaker.
- **Open a new constant** when a card's verifier gate passes and budget is free.

## 7. Problem card and the verifier gate

```yaml
id: 71a
name: Fourier entropy-influence constant
direction: maximize
record: {value: "6.5218457109", source: "Num2026", status: claimed}
candidate: {kind: truth_table, variables: 18}
checker: checkers/c71a.py        # exact Walsh transform, entropy in interval arithmetic
conditions: [balanced, "influence > 1"]   # hypotheses of the scoring rule, enforced by the checker
budget_usd: 40
```

Gate, in order: (1) verifier writes the checker from the definition and the source paper; (2) it downloads the published record construction and reproduces the published value; (3) it writes two or three negative tests (inputs that must be rejected); (4) only then is the constant open. Step 2 is the lab's proof that its referee is right, and it's a strong moment in the demo.

## 8. Target constants

Chosen from a triage of all 124 constants (see the `constant-temp` repo): bound comes from an explicit construction, the check is exact and cheap, and nobody is racing it this week.

| Priority | Constant | Why |
|---|---|---|
| Pipeline test | **16a** Brezis–Gallouet–Wainger | Checker is a lattice sum; a likely gain is already known from pre-event scouting, so it tells us whether the pipeline works. Disclose that origin; don't present it as the system's own discovery unless the system finds it unprompted. |
| Primary | **71a** Fourier entropy–influence | Quiet since early October; exact check in milliseconds; discrete search suits many breakers. |
| Primary | **89b / 89c** Ramsey multiplicity of K5 / K6 | Newer and far less attacked than K4; published graphons and checkers exist. |
| Scouting | 45a Romanoff, 51a Erdős maximum term, 3b/3c sum-difference | Opened by researchers if their dossiers hold up. |
| Stretch | 1d signed autocorrelation | Crowded; only if budget is left, as a "hot race" demo. |

Before any claim, "record" means the best of: the published table, every open pull request on Tao's repo, and recent arXiv.

## 9. Infrastructure

- **Modal.** One long-running orchestrator function (director + agent loops; checkpoint state every few minutes because a single call is capped at 24 hours). Strategy runs go to **Sandboxes** with a timeout, no network and no secrets, since the code is agent-written. Heavier verified searches can fan out as plain Modal functions. One **Volume** holds the event log, incumbents and candidates. One web endpoint serves the viewer and `/api/events`. To avoid several containers appending to one file, route events through a single writer (a `modal.Queue` drained by the orchestrator).
- **LLM.** OpenAI API with a spending cap; exponential backoff on rate limits; a per-agent token budget enforced in code.
- **Exa.** `search` with contents for the scout and the novelty check; restrict to papers and recent dates where useful.
- **past.dev.** One identity per agent; write after each attempt; recall before each. Exact calls to confirm with their mentor on site.
- **Budget caps (starting point):** Modal $250 total → $150 for the main run, $50 for comparisons, $50 spare. Exa $50. A kill switch (a flag file on the Volume the orchestrator checks every cycle) that anyone can flip from a phone.

## 10. Honesty rules built into the system

1. Floating-point scores steer; only exact or interval-arithmetic scores count.
2. A record needs: an independent re-check by the verifier, a novelty check with logged sources, and a certificate (candidate file, exact value, checker hash, one-command replay).
3. If a climb starts from someone's published construction, the log and README say so and report the margin added.
4. Failures are logged and shown, not hidden.
5. Nothing is posted outside (pull requests to Tao's repo, EinsteinArena) without a human on the team deciding to.

## 11. Showing the loop is better

Same constants, same dollars, five setups: full lab; no director (even split); no shared memory; no Exa scout; and a plain single-agent ratchet. Plot altitude against dollars for each. Start the cheap versions Saturday evening so the chart exists Sunday morning. If memory or the scout turns out not to help, say so and explain why; the past.dev brief explicitly allows that.

Other numbers to report: verifier-gate pass rate, share of kept attempts, cross-agent note reads, Exa sources that led to a kept attempt, cost per kept attempt.

## 12. How it meets the judging

| Criterion | Where it's met |
|---|---|
| Research rigour (20%) | Verifier gate, exact checks, independent re-check, comparison runs. |
| Novelty (20%) | Self-built referee; roles with a budget-moving director; memory across constants. |
| Results (20%) | Any verified improvement; otherwise gap closed per constant, honestly reported. |
| Autonomy and self-improvement (20%) | No human picks approaches; the director reallocates; agents rewrite their own strategies; notes change later behaviour. |
| Interpretability and reproducibility (20%) | The event log, the viewer, certificates, one-command replay. |
| Track 1 specifics | Margin past the record; how new the loop is; "follow each decision" = DECIDE/KEEP/REVERT events with reasons. |
| Exa | Scout in the main loop, verifier novelty check, sources shown in the viewer. |
| past.dev | Many writers and readers; cross-agent reads logged with author and use. |
| Modal | Sandboxes for agent code, parallel search, Volume, live viewer endpoint. |

## 13. Build plan

| When | Goal | Owner |
|---|---|---|
| Sat by 12:00 | Card + checker for 16a; checker reproduces the published bound. `emit()` wired. | Checkers |
| Sat by 14:00 | Single-breaker cycle end to end on 16a in a Modal Sandbox (steps 3–6). This is also the baseline for the comparison. | Loop |
| Sat by 16:00 | past.dev recall/record and Exa scout in the cycle (steps 1, 2, 7). Verifier gate automated. | Memory + scout |
| Sat by 18:00 | Several breakers per constant; director allocation; caps and kill switch. Cards for 71a and 89b. | Loop + checkers |
| Sat by 20:00 | Viewer live on Modal. 30-minute supervised dry run. Start comparison runs. | Viewer + all |
| Sat night | Full run. Someone checks spend and the heartbeat every 2–3 hours. | Rota |
| Sun 08:00–12:00 | Verify claims, certificates, README (which memory holds what, where Exa is called), 2-minute video. Team listed on the platform before 12:00. | All |
| Sun 14:30 | Submit. | — |

**Cut order if behind:** comparison runs beyond "full vs plain loop" → third constant → Thompson sampling (use a simple proportional rule) → researcher role as a separate agent (fold the scout into breakers). Never cut the verifier gate or the event log.

## 14. Risks

| Risk | Mitigation |
|---|---|
| No record falls. | Report gap closed, what was learned and rejected, and the comparison chart. Four of five judging criteria don't depend on a record. |
| Checker bug produces a fake record. | Gate reproduction, negative tests, independent verifier code, human look before any claim in the pitch. |
| Spend runs away overnight. | Hard caps in code, kill switch, rota. |
| Agent-written code misbehaves. | Sandbox with timeout, no network, no secrets. |
| Someone else beats the same bound this weekend. | Novelty check right before the pitch; several constants in play. |

## 15. Repo layout

```
cards/           problem cards (YAML)
checkers/        exact checkers, written by the verifier
strategies/      one file per breaker
constant_lab/    events.py, memory.py (past.dev), scout.py (Exa), director.py, agents.py, sandbox.py
server/          Modal apps: orchestrator, viewer
web/             viewer
docs/            this file, LOG_FORMAT.md, SPONSOR_PLAN.md
certificates/    verified results with replay commands
```
