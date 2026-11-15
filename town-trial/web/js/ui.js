// DOM rendering for the side panel: log, experiments, audiences/live stats, selection.
import { COHORTS, DAYS, hoursText, staffHours } from "./sim.js";
import { roleOf } from "./voices.js";

export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const AGENTS = { ada: "Ada (Researcher)", bo: "Bo (Designer)", cy: "Cy (Reviewer)", dee: "Dee (Runner)", eli: "Eli (Archivist)" };
export const AGENT_COLOR = { ada: "#59c2ff", bo: "#ffd34d", cy: "#ff9f43", dee: "#5be37d", eli: "#ff7ad9" };
export const link = (u) => (/^https?:\/\//.test(u || "") ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>` : esc(u));

// The reasoning behind one experiment, rebuilt from the event log: every step that names it, in order,
// with the agent who took the step. Works the same in demo and live mode.
export function reasoningFor(x, events) {
  const id = x.id, steps = [];
  let evidenceShown = false;
  const add = (e, text, sources = []) => steps.push({ seq: e.seq, agent: e.agent, type: e.type, text, sources, scripted: !!e.scripted });
  for (const e of events) {
    if (e.type === "CLAIM" && x.role === "user") add(e, `Testable claim: ${e.claim}`);
    else if (e.type === "MEMORY_READ" && e.author && String(e.used_for || "").includes(id))
      add(e, `Read ${AGENTS[e.author] || e.author}'s fact from shared memory: ${e.claim}`, [e.source_id]);
    else if (e.type === "EXA" && !evidenceShown && x.source && (e.results || []).some((r) => r.url === x.source) && (evidenceShown = true))
      add(e, `Found the evidence this rests on (${e.search} search "${e.query}"): ${e.used_for}`, [x.source]);
    else if (e.type === "PROPOSE" && e.exp === id) add(e, `Proposed ${id} (from ${e.parent}): ${e.change}. Why: ${e.why}`);
    else if (e.type === "REVIEW" && e.exp === id) {
      const as = (e.assumptions || []).map((a) => `${a.assumption} [${a.basis.replace(/_/g, " ")}]`).join("; ");
      add(e, `${e.ok ? "Approved" : "Rejected"}${e.by === "code" ? " (rule checked in code)" : ""}: ${e.reason}${as ? ` Assumptions: ${as}.` : ""}`);
    } else if (e.type === "CONSTRAINT" && (e.changes || []).some((c) => c.startsWith(id + " ")))
      add(e, `New constraint ${e.constraint} made ${id} infeasible.`, [e.source]);
    else if (e.type === "RUN_START" && (e.exps || []).includes(id)) add(e, `Ran ${id} over ${e.seeds} matched seeds on ${e.where}${e.held_out ? " (held-out scenarios)" : ""}.`);
    else if (e.type === "RUN_DONE" && e.exp === id)
      add(e, `Result: ${e.value}${e.staff_hours !== undefined && e.staff_hours !== null ? `, staff ${e.staff_hours} h/wk` : ""}${e.budget ? `, budget ${e.budget}` : ""}${e.turned_away ? `, turned away ${e.turned_away}` : ""}${e.overall ? `, overall ${e.overall}` : ""}${e.note ? ` (${e.note})` : ""}.`);
    else if (e.type === "FAILURE" && e.exp === id) add(e, `Read the failure trace: ${e.trace} Next question: ${e.next_question}`);
    else if (e.type === "HELD_OUT" && (e.finalists || []).includes(id)) add(e, `Frozen and tested on ${e.scenarios} held-out scenarios x ${e.seeds} seeds.`);
    else if (e.type === "BRIEF" && e.recommend === id) add(e, `Recommended ${id}: ${e.summary} Assumes: ${e.assumptions}`);
  }
  return steps;
}

function reasoningHTML(x, events) {
  const steps = reasoningFor(x, events);
  if (!steps.length) return `<div class="why-panel"><p class="note">No reasoning recorded yet for ${esc(x.id)}.</p></div>`;
  return `<div class="why-panel">${steps.map((s) => `<div class="why-step" style="border-left-color:${AGENT_COLOR[s.agent] || "#999"}">
      <div class="why-who" style="color:${AGENT_COLOR[s.agent] || "#999"}">${esc(AGENTS[s.agent] || s.agent || "system")} · ${esc(s.type.replace("_", " "))}${s.scripted ? " · scripted" : ""}</div>
      <div>${esc(s.text)}</div>${s.sources.filter(Boolean).map((u) => `<div class="why-src">source: ${link(u)}</div>`).join("")}</div>`).join("")}</div>`;
}

export function entryHTML(e, residentsById) {
  const who = e.agent ? AGENTS[e.agent] || e.agent : e.name ? `${e.name}` : "town";
  let body = "";
  switch (e.type) {
    case "CLAIM": body = `${esc(e.claim)}<br><i>Metric:</i> ${esc(e.metric)}<br><i>Constraint:</i> ${esc(e.constraint)} · ${esc(e.horizon)}`; break;
    case "EXA": body = `<i>${esc(e.search)} search:</i> "${esc(e.query)}"` + e.results.map((r) => `<div class="src"><b>${esc(r.title)}</b><br>"${esc(r.passage)}"<br><i>${esc(r.url)}</i></div>`).join("") + `<div>Used for: ${esc(e.used_for)}</div>`; break;
    case "MEMORY_WRITE": body = `past.dev write <b>${esc(e.source_id)}</b>: ${esc(e.claim)}${e.audience ? ` · audience: ${esc(e.audience)}` : ""}${e.effective ? ` · effective ${esc(e.effective)}` : ""}${e.note ? `<br>${esc(e.note)}` : ""}`; break;
    case "MEMORY_READ": body = e.author ? `past.dev read <b>${esc(e.source_id)}</b>, written by <b>${esc(AGENTS[e.author] || e.author)}</b>: ${esc(e.claim)}<br>Used for: ${esc(e.used_for)}` : `past.dev recall "${esc(e.query)}": ${esc(e.note)}`; break;
    case "AUDIENCE":
      if (e.op === "update_traits") body = `${esc(e.identity)} traits → heard_library_notice=true (via ${esc(e.traits.heard_via)}). Audience <b>${esc(e.slug)}</b> now ${e.members} members.`;
      else if (e.op === "replace_audience") body = `Audience <b>${esc(e.slug)}</b> (${esc(e.kind)}): ${esc(e.rule)} · ${e.members} members`;
      else body = `${esc(e.op)}: ${e.count} identities. ${esc(e.note)}`;
      break;
    case "PROPOSE": body = `<b>${esc(e.exp)}</b> (from ${esc(e.parent)}): ${esc(e.change)}<br><i>${esc(e.why)}</i>`; break;
    case "REVIEW": body = `<b>${esc(e.exp)}</b> ${e.ok ? "APPROVED" : "REJECTED"}: ${esc(e.reason)}`; break;
    case "RUN_START": body = `${e.exps.join(", ")} × ${e.seeds} matched seeds → ${e.workers} workers on ${esc(e.where)}`; break;
    case "RUN_DONE": body = `<b>${esc(e.exp)}</b>: ${esc(e.value)}${e.staff_hours !== undefined ? ` · staff ${e.staff_hours} h/wk` : ""}${e.turned_away ? ` · turned away ${e.turned_away}` : ""}${e.overall ? ` · overall ${e.overall}` : ""}${e.note ? ` · ${esc(e.note)}` : ""}`; break;
    case "FAILURE": body = `<b>${esc(e.exp)}</b>: ${esc(e.trace)}<br><i>Next question:</i> ${esc(e.next_question)}`; break;
    case "CONSTRAINT": body = `New constraint: <b>${esc(e.constraint)}</b> (was ${esc(e.previous)}). ${esc(e.changes.join("; "))}<br><i>${esc(e.source)}</i>`; break;
    case "HELD_OUT": body = `${e.finalists.join(", ")} frozen and tested on ${e.scenarios} held-out scenarios × ${e.seeds} seeds. ${esc(e.note)}`; break;
    case "BRIEF": body = `Recommend <b>${esc(e.recommend)}: ${esc(e.label)}</b><br>${esc(e.summary)}<br><i>Assumes:</i> ${esc(e.assumptions)}<br><i>Pilot:</i> ${esc(e.pilot)}`; break;
    case "LEARN": body = `${esc(e.name)} (${esc(roleOf({ id: e.resident, cohort: e.cohort }))}) heard the notice via <b>${esc(e.via)}</b>${e.fromName ? ` from ${esc(e.fromName)}` : ""} at ${esc(e.at)}`; break;
    case "VISIT": body = `${esc(e.name)} (${esc(roleOf({ id: e.resident, cohort: e.cohort }))}, ${esc(COHORTS[e.cohort].label)}) visited ${esc(e.facilityName || "the library")}${e.restricted ? " · <b>can't make current hours</b>" : ""}`; break;
    case "TURNED_AWAY": body = `${esc(e.name)} (${esc(roleOf({ id: e.resident, cohort: e.cohort }))}) turned away${e.facilityName ? ` at ${esc(e.facilityName)}` : ""}: ${esc(e.reason)}`; break;
    case "FRAME": body = `Question framed as: <b>${esc(e.label)}</b> (${esc(e.direction === "min" ? "lower is better" : "higher is better")})${e.target_name ? `<br><i>Place:</i> ${esc(e.target_name)}` : ""}${e.budget_scope ? `<br><i>Budget covers:</i> ${esc(e.budget_scope)}` : ""}${e.budget_limit && e.budget_limit.type !== "none" ? `<br><i>Budget limit (from your question):</i> ${esc(e.budget_limit.type.replace(/_/g, " "))}${e.budget_limit.value ? " " + e.budget_limit.value : ""}` : ""}`; break;
    case "VOICES": body = `How residents would react to <b>${esc(e.exp)}</b> (${e.scripted ? "scripted" : "LLM-written"}, not real people):` + (e.voices || []).map((v) => `<div class="src"><b>${esc(v.role)}</b> (${esc(v.label)}, ${esc(v.stance)}: ${v.before} → ${v.after} ${esc(v.unit)}): "${esc(v.quote)}"</div>`).join(""); break;
    case "NOTE": body = `${e.level === "error" ? "<b>Error:</b> " : ""}${esc(e.message)}`; break;
    default: body = esc(JSON.stringify(e));
  }
  const cls = `entry t-${e.type}${(e.type === "REVIEW" && !e.ok) || (e.type === "NOTE" && e.level === "error") ? " reject" : ""}`;
  return `<div class="${cls}"><div class="head"><span class="type">${e.type.replace("_", " ")}</span><span class="who">${esc(who)}</span><span class="when">${esc(e.clock || "")}</span></div>${body}</div>`;
}

export const usd = (x) => { const a = Math.abs(x), s = x < 0 ? "-" : ""; return a >= 1e6 ? `${s}$${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${s}$${(a / 1e3).toFixed(1)}k` : `${s}$${a.toFixed(0)}`; };
// Primary metric of an experiment: a simulator mean, or the net annual budget for budget questions.
export const metricOf = (x, P) => (P.key === "budget.net" ? (x.budget ? x.budget.net : 0) : (x.result.mean[P.key] ?? 0));
export const fmtMetric = (v, P) => (P.key === "budget.net" ? `${usd(v)}/yr` : v.toFixed(1));

export function experimentsHTML(exps, viewingId, P, events = [], openWhy = new Set()) {
  if (!exps.length) return `<p class="note">Run a trial to see experiments. Each one records its parent, the change, the source that caused it, and results over matched seeds.</p>`;
  const max = Math.max(1, ...exps.filter((x) => x.result).map((x) => Math.abs(metricOf(x, P))));
  const base = exps.find((x) => x.role === "baseline" && x.budget);
  let html = `<p class="note">Primary metric: ${esc(P.label)}. Click a run to replay it in town (same seed, same residents).</p>`;
  for (const x of exps) {
    const tag = x.best ? `<span class="tagx best">BEST</span>` : x.status === "infeasible" ? `<span class="tagx infeasible">INFEASIBLE</span>` : x.status === "rejected" ? `<span class="tagx rejected">REJECTED</span>` : `<span class="tagx">${esc(x.status.toUpperCase())}</span>`;
    const v = x.result ? metricOf(x, P) : 0;
    const bud = x.budget ? ` · budget ${usd(x.budget.net)}/yr${base && x !== base ? ` (${x.budget.net >= base.budget.net ? "+" : ""}${usd(x.budget.net - base.budget.net)})` : ""}` : "";
    html += `<div class="exp${x.id === viewingId ? " viewing" : ""}" data-exp="${x.id}"><div class="exp-row">
      <button type="button" class="why${openWhy.has(x.id) ? " open" : ""}" data-why="${x.id}" title="Why? Show the reasoning behind ${esc(x.id)}">?</button><div class="exp-body">
      <h4><span>${esc(x.id)} · ${esc(x.label)}</span>${tag}</h4>
      <div class="meta">${esc(x.role)}${x.parent ? ` · from ${esc(x.parent)}` : ""} · ${esc(x.change)}${x.source ? ` · source ${esc(x.source)}` : ""}</div>
      ${x.result ? `<div class="metrics">${fmtMetric(v, P)}${P.key === "budget.net" ? "" : `${P.unit} ± ${(x.result.sd[P.key] ?? 0).toFixed(1)}`} <span class="meta">(n=${x.result.n})</span>${x.policy.hours ? ` · staff ${staffHours(x.policy.hours)} h/wk` : ""}${bud}</div><div class="bar"><i style="width:${(100 * Math.abs(v)) / max}%"></i></div>` : ""}
    </div></div>${openWhy.has(x.id) ? reasoningHTML(x, events) : ""}</div>`;
  }
  if (exps.heldOut) {
    const H = exps.heldOut;
    html += `<h5>HELD-OUT TEST (frozen picks)</h5><table class="cmp"><tr><th>Scenario</th>${H.finalists.map((f) => `<th>${esc(f.id)}<br>${esc(f.role)}${f.feasible ? "" : " ✗"}</th>`).join("")}</tr>`;
    for (const row of H.table) html += `<tr><td>${esc(row.scenario)}</td>${H.finalists.map((f) => `<td>${fmtMetric(row[f.id], P)}</td>`).join("")}</tr>`;
    html += `</table><p class="note">✗ = breaks a discovered constraint. Same search budget for sweep, one-shot and agent. Residents' schedules and demand rates are model defaults (labelled), not measurements.</p>`;
  }
  return html;
}

export function audiencesHTML(mode, model, residents, flashSlug) {
  if (!model) return `<p class="note">Run a trial to see live state.</p>`;
  const st = model.state;
  if (mode === "town" && model.facilities) {
    const C = st.metrics.counts;
    let html = `<p class="note">Live counts for the run you're watching (seed 0), at the town's public places.</p>`;
    for (const f of model.facilities) {
      const fs = st.fac[f.id] || { inside: [], queue: [] };
      html += `<div class="aud"><div class="slug">${esc(f.name.toUpperCase())}${f.closed ? " · CLOSED BY POLICY" : ""}</div>` +
        `<div class="rule">${esc(f.kind.replace("_", " "))} · hours ${esc(hoursText(f.hours))} (${esc(f.hoursSource)})${f.fee ? ` · fee $${f.fee}` : ""}</div>` +
        `<div>Inside: ${fs.inside.length} · Queue: ${fs.queue.length} · Visits: ${C[`visits.f.${f.id}`] || 0} · Turned away: ${C[`turnedAway.f.${f.id}`] || 0}</div></div>`;
    }
    if (C.aware) html += `<h5>HOW PEOPLE HEARD</h5>` + Object.entries(st.metrics.learnedVia).filter(([, v]) => v).map(([k, v]) => `<div>${k}: ${v}</div>`).join("");
    return html + legendHTML();
  }
  if (mode === "perception") {
    const aware = model.S.filter((s) => s.aware).length;
    const fam = residents.filter((r) => r.cohort === "families");
    const famAware = model.S.filter((s) => s.aware && s.r.cohort === "families").length;
    const aud = (slug, rule, n, total) => `<div class="aud${flashSlug === slug ? " flash" : ""}"><div class="slug">${slug}</div><div class="rule">rule: ${rule}</div><div>${n} / ${total} members</div><div class="bar"><i style="width:${(100 * n) / total}%;background:#ff7ad9"></i></div></div>`;
    let html = `<p class="note">Each resident is a past.dev identity. When they hear the notice, their traits update and they join the <b>heard-library-notice</b> audience, which is what lets them recall it.</p>`;
    html += aud("heard-library-notice", "heard_library_notice = true", aware, residents.length);
    html += aud("working-parents", "cohort = families", fam.length, residents.length);
    html += aud("parents-who-heard", "cohort = families AND heard_library_notice = true", famAware, fam.length);
    html += `<h5>HOW PEOPLE HEARD</h5>` + Object.entries(st.metrics.learnedVia).map(([k, v]) => `<div>${k}: ${v}</div>`).join("");
    html += legendHTML();
    return html;
  }
  const M = st.metrics;
  let html = `<p class="note">Live counts for the run you're watching.</p>`;
  html += `<div class="aud"><div class="slug">LIBRARY</div><div class="rule">${esc(hoursText(model.hours))}</div><div>Inside: ${st.inside.length} · Queue: ${st.queue.length}</div><div>Visits: ${M.visits} · Can't-make-current-hours visits: ${M.restrictedVisits}</div><div>Turned away: ${M.turnedAway} · Staff: ${staffHours(model.hours)} h/wk</div></div>`;
  html += `<h5>VISITS BY GROUP</h5>` + Object.entries(COHORTS).map(([k, c]) => `<div>${c.label}: ${M.byCohort[k] || 0}</div>`).join("");
  html += legendHTML();
  return html;
}

function legendHTML() {
  return `<h5>SHIRT COLOURS</h5>` + Object.values(COHORTS).map((c) => `<span class="pill" style="background:#${c.shirt.toString(16).padStart(6, "0")}">${c.label}</span>`).join("") +
    `<h5>ICONS</h5><div class="note">? hasn't heard · ! heard · &gt; going to library · ~ waiting · + served · x turned away</div>`;
}

export function residentHTML(r, s, mode, events) {
  const aud = [`town-everyone`, `cohort-${r.cohort}`];
  if (s && s.aware) aud.push("heard-library-notice");
  const mine = events.filter((e) => e.resident === r.id).slice(-12).reverse();
  return `<h3><span>${esc(r.name)}</span><span class="close" data-close>CLOSE ✕</span></h3>
  <div class="role-badge">${esc(roleOf(r))}</div>
  <div class="kv"><b>past.dev identity</b><span>${r.id}</span><b>Group</b><span>${esc(COHORTS[r.cohort].label)}</span><b>Gets news via</b><span>${esc(r.channel)}</span>
  <b>Neighborhood</b><span>${esc(r.neighborhood)}</span><b>Home</b><span>${esc(r.home.name)}</span><b>Now at</b><span>${esc(s ? s.at.name : r.home.name)}</span>
  <b>Library visits/wk</b><span>${r.interest} wanted${s ? `, ${s.visitsWeek} made` : ""}</span><b>Current hours?</b><span>${r.restricted ? "can't make them" : "can make them"}</span></div>
  <div style="margin-top:6px">${aud.map((a) => `<span class="pill on">${a}</span>`).join("")}${s && !s.aware && mode === "perception" ? `<span class="pill off">not in heard-library-notice</span>` : ""}</div>
  <h5>THEIR LOG</h5>${mine.length ? mine.map((e) => entryHTML(e)).join("") : `<p class="note">Nothing yet.</p>`}`;
}

export function researcherHTML(spec, events) {
  const mine = events.filter((e) => e.agent === spec.id || e.author === spec.id).slice(-30).reverse();
  return `<h3><span>${esc(spec.name)} · ${esc(spec.role)}</span><span class="close" data-close>CLOSE ✕</span></h3>
  <div class="note">${esc(spec.does)}</div><h5>LOG</h5>${mine.length ? mine.map((e) => entryHTML(e)).join("") : `<p class="note">Waiting for a trial.</p>`}`;
}

export function stationHTML(id, label, events) {
  const filter = { lookout: (e) => e.type === "EXA", archive: (e) => e.type.startsWith("MEMORY") || e.type === "AUDIENCE" && e.op !== "update_traits", court: (e) => e.type === "REVIEW" || e.type === "FAILURE" || e.type === "HELD_OUT", portal: (e) => e.type.startsWith("RUN"), drafting: (e) => ["CLAIM", "PROPOSE", "BRIEF"].includes(e.type) }[id];
  const mine = events.filter(filter).slice(-30).reverse();
  return `<h3><span>${esc(label)}</span><span class="close" data-close>CLOSE ✕</span></h3>${mine.length ? mine.map((e) => entryHTML(e)).join("") : `<p class="note">Nothing here yet.</p>`}`;
}

export function buildingHTML(b, model, events) {
  let extra = "";
  if (b.id === "library" && model) extra = `<div class="kv"><b>Hours</b><span>${esc(hoursText(model.hours))}</span><b>Inside</b><span>${model.state.inside.length}</span><b>Queue</b><span>${model.state.queue.length}</span></div>`;
  const here = model ? model.S.filter((s) => s.at === b).map((s) => s.r.name) : [];
  if (b.osm || b.synthetic) extra += `<div class="kv"><b>Kind</b><span>${esc(b.kind.replace("_", " "))}${b.public ? " (public)" : ""}</span>` +
    (b.osm ? `<b>Source</b><span><a href="https://www.openstreetmap.org/${esc(b.osm)}" target="_blank" rel="noopener">OpenStreetMap ${esc(b.osm)}</a></span>` : "") +
    (b.synthetic ? `<b>Source</b><span>synthetic (not mapped in OSM)</span>` : "") +
    (b.hoursOsm ? `<b>Mapped hours</b><span>${esc(b.hoursOsm)}</span>` : "") + `</div>`;
  return `<h3><span>${esc(b.name)}</span><span class="close" data-close>CLOSE ✕</span></h3>${extra}<div class="note">${here.length} people here${here.length ? ": " + esc(here.slice(0, 12).join(", ")) + (here.length > 12 ? "..." : "") : ""}</div>`;
}

export function clockText(tick, ticksPerDay) {
  const day = Math.floor(tick / ticksPerDay) % 7;
  const m = (tick % ticksPerDay) * 10;
  return `${DAYS[day]} ${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
