// DOM rendering for the side panel: log, experiments, audiences/live stats, selection.
import { COHORTS, DAYS, hoursText, staffHours } from "./sim.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const AGENTS = { ada: "Ada (Researcher)", bo: "Bo (Designer)", cy: "Cy (Reviewer)", dee: "Dee (Runner)", eli: "Eli (Archivist)" };

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
    case "LEARN": body = `${esc(e.name)} heard the notice via <b>${esc(e.via)}</b>${e.fromName ? ` from ${esc(e.fromName)}` : ""} at ${esc(e.at)}`; break;
    case "VISIT": body = `${esc(e.name)} (${esc(COHORTS[e.cohort].label)}) visited the library${e.restricted ? " · <b>can't make current hours</b>" : ""}`; break;
    case "TURNED_AWAY": body = `${esc(e.name)} turned away: ${esc(e.reason)}`; break;
    default: body = esc(JSON.stringify(e));
  }
  const cls = `entry t-${e.type}${e.type === "REVIEW" && !e.ok ? " reject" : ""}`;
  return `<div class="${cls}"><div class="head"><span class="type">${e.type.replace("_", " ")}</span><span class="who">${esc(who)}</span><span class="when">${esc(e.clock || "")}</span></div>${body}</div>`;
}

export function experimentsHTML(exps, viewingId, P) {
  if (!exps.length) return `<p class="note">Run a trial to see experiments. Each one records its parent, the change, the source that caused it, and results over matched seeds.</p>`;
  const max = Math.max(1, ...exps.filter((x) => x.result).map((x) => x.result.mean[P.key]));
  let html = `<p class="note">Primary metric: ${esc(P.label)}. Click a run to replay it in town (same seed, same residents).</p>`;
  for (const x of exps) {
    const tag = x.best ? `<span class="tagx best">BEST</span>` : x.status === "infeasible" ? `<span class="tagx infeasible">INFEASIBLE</span>` : x.status === "rejected" ? `<span class="tagx rejected">REJECTED</span>` : `<span class="tagx">${esc(x.status.toUpperCase())}</span>`;
    const v = x.result ? x.result.mean[P.key] : 0;
    html += `<div class="exp${x.id === viewingId ? " viewing" : ""}" data-exp="${x.id}">
      <h4><span>${esc(x.id)} · ${esc(x.label)}</span>${tag}</h4>
      <div class="meta">${esc(x.role)}${x.parent ? ` · from ${esc(x.parent)}` : ""} · ${esc(x.change)}${x.source ? ` · source ${esc(x.source)}` : ""}</div>
      ${x.result ? `<div class="metrics">${v.toFixed(1)}${P.unit} ± ${x.result.sd[P.key].toFixed(1)} <span class="meta">(n=${x.result.n})</span>${x.policy.hours ? ` · staff ${staffHours(x.policy.hours)} h/wk` : ""}</div><div class="bar"><i style="width:${(100 * v) / max}%"></i></div>` : ""}
    </div>`;
  }
  if (exps.heldOut) {
    const H = exps.heldOut;
    html += `<h5>HELD-OUT TEST (frozen picks)</h5><table class="cmp"><tr><th>Scenario</th>${H.finalists.map((f) => `<th>${esc(f.id)}<br>${esc(f.role)}${f.feasible ? "" : " ✗"}</th>`).join("")}</tr>`;
    for (const row of H.table) html += `<tr><td>${esc(row.scenario)}</td>${H.finalists.map((f) => `<td>${row[f.id].toFixed(1)}</td>`).join("")}</tr>`;
    html += `</table><p class="note">✗ = breaks a discovered constraint. Same search budget for sweep, one-shot and agent. Demo inputs are synthetic.</p>`;
  }
  return html;
}

export function audiencesHTML(mode, model, residents, flashSlug) {
  if (!model) return `<p class="note">Run a trial to see live state.</p>`;
  const st = model.state;
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
  return `<h3><span>${esc(b.name)}</span><span class="close" data-close>CLOSE ✕</span></h3>${extra}<div class="note">${here.length} people here${here.length ? ": " + esc(here.slice(0, 12).join(", ")) + (here.length > 12 ? "..." : "") : ""}</div>`;
}

export function clockText(tick, ticksPerDay) {
  const day = Math.floor(tick / ticksPerDay) % 7;
  const m = (tick % ticksPerDay) * 10;
  return `${DAYS[day]} ${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
