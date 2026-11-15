// The end-of-trial summary, rebuilt purely from the event log and the experiment list (same in demo
// and live mode). Feeds the results popup; saved per trial so past popups can be reopened.
import { reasoningFor, metricOf, fmtMetric, usd, AGENTS } from "./ui.js";
import { staffHours } from "./sim.js";

const RESEARCH = new Set(["CLAIM", "FRAME", "EXA", "MEMORY_WRITE", "MEMORY_READ", "PROPOSE", "REVIEW", "RUN_START", "RUN_DONE", "FAILURE",
  "CONSTRAINT", "HELD_OUT", "BRIEF", "VOICES", "NOTE"]);
const ROLE = { baseline: "current practice", user: "your idea", sweep: "parameter sweep", oneshot: "one-shot LLM", revision: "agent revision" };

export function stepText(e) {
  switch (e.type) {
    case "CLAIM": return `Wrote the testable claim: ${e.claim}`;
    case "FRAME": return `Framed the question as "${e.label}"${e.target_name ? ` at ${e.target_name}` : ""}.`;
    case "EXA": return `Searched the web (${e.search}): "${e.query}". ${(e.results || []).length} result(s); used for: ${e.used_for}`;
    case "MEMORY_WRITE": return `Saved "${e.claim}" to shared memory (${e.source_id}).`;
    case "MEMORY_READ": return e.author ? `Read ${AGENTS[e.author] || e.author}'s note "${e.claim}" from shared memory, for ${e.used_for}.` : `Checked shared memory: ${e.note || e.query}`;
    case "PROPOSE": return `Proposed ${e.exp}: ${e.change}`;
    case "REVIEW": return `${e.ok ? "Approved" : "Rejected"} ${e.exp}: ${e.reason}`;
    case "RUN_START": return `Ran ${(e.exps || []).join(", ")} over ${e.seeds} matched seeds on ${e.where}${e.held_out ? " (held-out towns)" : ""}.`;
    case "RUN_DONE": return `${e.exp} finished: ${e.value}${e.budget ? ` · ${e.budget}` : ""}.`;
    case "FAILURE": return `Read ${e.exp}'s failure trace. Next question: ${e.next_question}`;
    case "CONSTRAINT": return `Found a constraint: ${e.constraint}.`;
    case "HELD_OUT": return `Froze ${(e.finalists || []).join(", ")} and tested them on ${e.scenarios} unseen towns.`;
    case "VOICES": return `Asked how each group of residents would react to ${e.exp}${e.scripted ? " (scripted)" : " (LLM-written)"}.`;
    case "BRIEF": return `Wrote the decision brief: recommend ${e.recommend === "none" ? "nothing" : `${e.recommend}, ${e.label}`}.`;
    case "NOTE": return e.message;
    default: return e.type;
  }
}

function whyNot(x, best, P, events) {
  if (x.status === "rejected") {
    const r = [...events].reverse().find((e) => e.type === "REVIEW" && e.exp === x.id && !e.ok);
    return `Rejected by ${r && r.by === "code" ? "a rule checked in code" : "Cy"}: ${r ? r.reason : "failed review"}`;
  }
  if (x.status === "infeasible") {
    const c = [...events].reverse().find((e) => e.type === "CONSTRAINT");
    return `Breaks a constraint${c ? `: ${c.constraint}` : ""}.`;
  }
  if (!x.result) return `Never ran (${x.status}).`;
  const v = metricOf(x, P), bv = metricOf(best, P);
  const lead = x.role === "baseline" ? "Current practice." : x.role === "sweep" ? "Best of the blind parameter sweep." : x.role === "oneshot" ? "One-shot LLM guess with no feedback." : "";
  return `${lead} Scored ${fmtMetric(v, P)}${P.unit || ""} vs ${fmtMetric(bv, P)}${P.unit || ""} for ${best.id}.`.trim();
}

export function buildSummary({ prompt, city, mode, events, exps, primary: P }) {
  const brief = [...events].reverse().find((e) => e.type === "BRIEF");
  const best = exps.find((x) => x.best) || (brief && exps.find((x) => x.id === brief.recommend));
  const base = exps.find((x) => x.role === "baseline") || exps[0];
  const voicesEv = [...events].reverse().find((e) => e.type === "VOICES");
  const out = { prompt, city, mode, when: new Date().toISOString(), metricLabel: P.label, brief: brief || null, best: null, tiles: [], why: [], steps: [], others: [], voices: null };
  out.steps = events.filter((e) => RESEARCH.has(e.type)).map((e) => ({ seq: e.seq, clock: e.clock, agent: e.agent, type: e.type, text: stepText(e), scripted: !!e.scripted, level: e.level }));
  if (!best || !best.result) return out;
  out.best = { id: best.id, label: best.label, change: best.change, role: ROLE[best.role] || best.role };

  // Key numbers
  const bv = metricOf(best, P), b0 = base && base.result ? metricOf(base, P) : null;
  const better = P.direction === "min" ? -1 : 1;
  const pct = b0 ? (100 * (bv - b0)) / Math.abs(b0) : null;
  out.tiles.push({ label: P.label, value: bv, text: fmtMetric(bv, P) + (P.key === "budget.net" ? "" : P.unit || ""), sub: b0 !== null ? `vs ${fmtMetric(b0, P)}${P.key === "budget.net" ? "" : P.unit || ""} now` : "", good: b0 === null || (bv - b0) * better >= 0 });
  if (pct !== null && isFinite(pct)) out.tiles.push({ label: "Change vs current practice", value: pct, text: `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`, sub: `${best.id} vs ${base.id}`, good: (bv - b0) * better >= 0 });
  if (best.budget && base && base.budget) {
    const d = best.budget.net - base.budget.net;
    out.tiles.push({ label: "Annual budget change", value: d, text: `${d >= 0 ? "+" : "-"}${usd(Math.abs(d))}/yr`, sub: `${usd(best.budget.net)}/yr total`, good: d <= 0 });
    out.tiles.push({ label: "Staff hours / week", value: best.budget.staff_hours_week, text: `${Math.round(best.budget.staff_hours_week)} h`, sub: `was ${Math.round(base.budget.staff_hours_week)} h`, good: best.budget.staff_hours_week <= base.budget.staff_hours_week });
  } else if (best.policy && best.policy.hours && base && base.policy && base.policy.hours) {
    const s1 = staffHours(best.policy.hours), s0 = staffHours(base.policy.hours);
    out.tiles.push({ label: "Staff hours / week", value: s1, text: `${s1} h`, sub: `was ${s0} h (${s1 - s0 >= 0 ? "+" : ""}${s1 - s0})`, good: s1 <= s0 });
  }
  const ta = best.result.mean.turnedAway;
  if (ta !== undefined) out.tiles.push({ label: "Turned away / week", value: ta, text: ta.toFixed(1), sub: base && base.result && base.result.mean.turnedAway !== undefined ? `was ${base.result.mean.turnedAway.toFixed(1)}` : "", good: !(base && base.result) || ta <= base.result.mean.turnedAway });
  // What the policy is, and why it wins (Bo's brief; older briefs fall back to the summary)
  out.what = (brief && brief.what) || `${best.label}: ${best.change}.`;
  out.reasoning = (brief && brief.reasoning) || (brief && brief.summary) || "";

  // Why it wins: the reasoning of the winner and its ancestors, grouped by agent
  const chain = [];
  for (let x = best; x && !chain.includes(x); x = exps.find((q) => q.id === x.parent)) chain.unshift(x);
  const seen = new Set(), byAgent = {};
  for (const x of chain) for (const s of reasoningFor(x, events)) {
    if (seen.has(s.seq)) continue;
    seen.add(s.seq);
    (byAgent[s.agent || "system"] ||= []).push(s);
  }
  out.why = ["exa", "ada", "treasurer", "bo", "cy", "dee", "eli", "system"].filter((a) => byAgent[a]).map((a) => ({ agent: a, steps: byAgent[a].sort((p, q) => p.seq - q.seq) }));
  out.sources = [...new Set(out.why.flatMap((g) => g.steps.flatMap((s) => s.sources)).filter((u) => /^https?:\/\//.test(u || "")))].slice(0, 4);
  out.chain = chain.map((x) => ({ id: x.id, label: x.label }));
  if (voicesEv && voicesEv.exp === best.id) out.voices = { scripted: !!voicesEv.scripted, note: voicesEv.note, list: voicesEv.voices };

  // Everything else, briefly
  out.others = exps.filter((x) => x !== best).map((x) => ({ id: x.id, label: x.label, role: ROLE[x.role] || x.role, status: x.status,
    text: x.result ? fmtMetric(metricOf(x, P), P) + (P.key === "budget.net" ? "" : P.unit || "") : "-", why: whyNot(x, best, P, events) }));
  return out;
}
