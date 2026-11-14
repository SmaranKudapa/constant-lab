"""Writes web/demo/events.jsonl: a SAMPLE replay so the viewer has something to show before the lab runs.
Records are the real published/claimed values (Nov 2026); every score the 'agents' reach is made up."""
import json, random, datetime
random.seed(3); out = []; t = datetime.datetime(2026, 11, 14, 20, 0, 0); seq = 0
def emit(type, **kw):
    global seq, t
    seq += 1; t += datetime.timedelta(seconds=random.randint(20, 140))
    out.append(dict(seq=seq, t=t.isoformat() + "Z", type=type, **kw))
P = [("16a", "Torus Ridge", "C16a · Brezis–Gallouet–Wainger constant", "maximize", "2.1562247706", "certified, Tao table", "2.1562240000", "The sharpest constant in a classic inequality for functions on a torus."),
     ("71a", "Entropy Spire", "C71 · Fourier entropy–influence", "maximize", "6.5218457109", "Num2026", "6.5143270000", "How much spectral entropy a Boolean function can have per unit of influence."),
     ("89b", "Ramsey Col", "C89b · Ramsey multiplicity of K5", "minimize", "0.0016870052", "SK2026", "0.0016900000", "Colour a graph's edges so as few same-colour 5-cliques appear as possible."),
     ("1d", "Signed Face", "C1d · Signed autocorrelation", "minimize", "1.4546733414", "PR #345", "1.4550000000", "Find a signed function whose self-overlap never gets large.")]
for pid, name, const, d, rec, src, start, blurb in P:
    emit("PEAK", peak=pid, name=name, constant=const, direction=d, record=rec, record_source=src, start=start, blurb=blurb)
A = {"16a": [("Serac", "breaker", "Sum the whole series instead of cutting it off, with a proven bound on the tail.", ["Exact lattice sum up to a cutoff", "Bound the tail with a lattice-point estimate", "Re-check in interval arithmetic"]),
             ("Talus", "breaker", "Tune the trial function's parameter with a finer search.", ["Golden-section search over mu", "Score with the verifier", "Keep only certified gains"]),
             ("Scree", "researcher", "Read the original paper and look for a better family of trial functions.", ["Search for the source paper", "Extract the extremal problem", "Propose new families to the breakers"])],
     "71a": [("Firn", "breaker", "Flip one truth-table entry at a time and keep it if the ratio rises.", ["Start from the record function", "Try flips that keep it balanced", "Exact Walsh transform each time"]),
             ("Névé", "breaker", "Repeat the variable-splitting trick that set the last two records.", ["Copy the record's split", "Apply it to a new variable", "Check influence exactly"]),
             ("Cirque", "researcher", "Look for building-block functions in the literature.", ["Search for composition theorems", "List candidate blocks", "Hand them to Firn"])],
     "89b": [("Piton", "breaker", "Gradient steps on the block densities of the record graphon.", ["Load the 192-block graphon", "Projected gradient step", "Exact rational re-count"]),
             ("Belay", "breaker", "Split every block in two and choose signs by ascent.", ["Double the blocks", "Sign refinement", "Verify exactly"])],
     "1d": [("Cornice", "breaker", "Push down every near-maximal point of the self-overlap together.", ["Find near-maximal knots", "Solve a small minimax step", "Exact integer check"]),
            ("Moraine", "breaker", "Re-solve the record at double resolution.", ["Interpolate to 2x cells", "p-norm continuation", "Verify"])]}
for pid, team in A.items():
    for n, role, ap, steps in team: emit("AGENT", agent=n, peak=pid, role=role, approach=ap, steps=steps)
emit("BUDGET", spent="4", cap="250")
final = {"Serac": 1.03, "Talus": 0.55, "Scree": 0.0, "Firn": 0.74, "Névé": 0.41, "Cirque": 0.0, "Piton": 0.62, "Belay": 0.28, "Cornice": 0.36, "Moraine": 0.17}
prog = {k: 0.0 for k in final}; peak_of = {n: pid for pid, team in A.items() for n, *_ in team}; meta = {p[0]: p for p in P}
def score(pid, f):
    _, _, _, d, rec, _, start, _ = meta[pid]; a, r = float(start), float(rec); return f"{a + (r - a) * f:.10f}"
notes = [("Serac", "16a", "trick", "Cutting the series off wastes most of the gain; bound the tail instead"), ("Firn", "71a", "dead_end", "Flips that break monotonicity always lose"),
         ("Cornice", "1d", "trick", "A soft maximum gives usable gradients where the hard maximum stalls"), ("Piton", "89b", "bug", "Float counts drift after 1e-9; re-count exactly every 10 steps"),
         ("Talus", "16a", "dead_end", "Changing mu alone moves the bound by less than 1e-9"), ("Névé", "71a", "insight", "Splitting an auxiliary variable raises entropy at the same influence")]
reads = [("Moraine", "Cornice", "A soft maximum gives usable gradients where the hard maximum stalls", "switched its optimiser"), ("Talus", "Serac", "Cutting the series off wastes most of the gain; bound the tail instead", "dropped its mu search and joined the tail route"),
         ("Belay", "Piton", "Float counts drift after 1e-9; re-count exactly every 10 steps", "added exact re-counts"), ("Firn", "Névé", "Splitting an auxiliary variable raises entropy at the same influence", "tries splits before flips"),
         ("Cornice", "Serac", "Cutting the series off wastes most of the gain; bound the tail instead", "checks its own truncation error")]
exa = [("Scree", "16a", "Brezis Gallouet inequality torus sharp constant extremal function", [("Asymptotic expansions and extremals for the critical Sobolev and Gagliardo–Nirenberg inequalities on a torus", "https://arxiv.org/abs/1012.2061")], "gave Serac the exact extremal family"),
       ("Cirque", "71a", "Fourier entropy influence conjecture lower bound constant composition", [("A composition theorem for the Fourier Entropy-Influence conjecture", "https://arxiv.org/abs/1304.1347")], "confirmed the scoring rule and its conditions"),
       ("Scree", "16a", "lattice point discrepancy circle explicit bound", [("[SAMPLE] Explicit bounds for the Gauss circle problem", "https://example.org/sample-source")], "used for the tail bound"),
       ("Cirque", "71a", "balanced monotone boolean function high spectral entropy", [("[SAMPLE] Lexicographic functions and entropy", "https://example.org/sample-source-2")], "new building blocks for Firn")]
nid = 0; ni = ri = ei = 0
for step in range(46):
    n = random.choice([k for k in final if final[k] > 0])
    pid = peak_of[n]
    if step % 5 == 1 and ei < len(exa):
        a, p, q, res, used = exa[ei]; ei += 1; emit("EXA", agent=a, peak=p, query=q, results=[dict(title=x, url=u) for x, u in res], used_for=used)
    if step % 5 == 3 and ni < len(notes):
        a, p, k, c = notes[ni]; ni += 1; nid += 1; emit("MEMORY_WRITE", agent=a, peak=p, note_id=f"n{nid}", kind=k, claim=c)
    if step % 4 == 2 and ri < len(reads) and [x[3] for x in notes].index(reads[ri][2]) < ni:
        a, au, c, used = reads[ri]; ri += 1; emit("MEMORY_READ", agent=a, peak=peak_of[a], author=au, note_id=f"n{[x[3] for x in notes].index(c) + 1}", claim=c, used_for=used)
    if step % 9 == 4:
        emit("DECIDE", decision=f"Give {n} two more workers", reason=f"{n} has the best gain per dollar on {meta[pid][1]} over the last 30 minutes")
        emit("BUDGET", spent=str(4 + step * 2), cap="250")
    if random.random() < 0.55 and prog[n] < final[n]:
        prog[n] = min(final[n], prog[n] + random.uniform(0.08, 0.3) * final[n]); emit("KEEP", agent=n, peak=pid, score=score(pid, prog[n]), summary="Exact check passed.", cost_s=random.randint(40, 400))
    else:
        emit("REVERT", agent=n, peak=pid, summary=random.choice(["Score got worse.", "Verifier rejected it.", "No change after the exact check."]), cost_s=random.randint(40, 400))
for n in final:
    if final[n] > prog[n]: prog[n] = final[n]; emit("KEEP", agent=n, peak=peak_of[n], score=score(peak_of[n], prog[n]), summary="Exact check passed.", cost_s=120)
emit("VERIFY", peak="16a", score=score("16a", 1.03), ok=True, method="independent interval-arithmetic re-check; no newer claim found in Tao's repo, its open pull requests or arXiv")
emit("SUMMIT", peak="16a", score=score("16a", 1.03)); emit("BUDGET", spent="97", cap="250")
open("web/demo/events.jsonl", "w").write("\n".join(json.dumps(e, ensure_ascii=False) for e in out) + "\n"); print(len(out), "events")
