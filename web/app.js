/* Constant Lab viewer. No build step. Reads the lab's event log (docs/LOG_FORMAT.md) and draws the climb.
   Every peak is one constant; altitude is the share of the gap to the record an agent has closed. */
(() => {
"use strict";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : null);
const PALETTE = ["#D9482B", "#2E7FB8", "#2F9B6B", "#8C5BC7", "#C27A12", "#0E8A8A", "#B03A7A", "#5B6B2F"];
const W = 240, H = 150, GROUND = 122, APEX = { x: 120, y: 20 }, HW = 104;

/* ---------------- state built from events ---------------- */
const S = { peaks: {}, order: [], agents: {}, notes: {}, events: [], decisions: [], exa: [], budget: null, seq: 0, mode: "connecting" };
let view = { screen: "landing", mode: "climb", idx: 0, sel: null };

function frac(p, v) {
  const a = parseFloat(p.start), r = parseFloat(p.record), x = parseFloat(v);
  if (!isFinite(a) || !isFinite(r) || !isFinite(x) || a === r) return 0;
  return Math.max(0, Math.min(1.06, (x - a) / (r - a)));
}
function better(p, a, b) { // is a better than b?
  if (b == null) return true;
  return p.direction === "minimize" ? parseFloat(a) < parseFloat(b) : parseFloat(a) > parseFloat(b);
}
function apply(e) {
  S.seq = Math.max(S.seq, e.seq || 0); S.events.push(e);
  const p = e.peak ? S.peaks[e.peak] : null, ag = e.agent ? S.agents[e.agent] : null;
  switch (e.type) {
    case "PEAK":
      if (!S.peaks[e.peak]) S.order.push(e.peak);
      S.peaks[e.peak] = Object.assign({ id: e.peak, name: e.name || e.peak, constant: e.constant || "", direction: e.direction || "maximize",
        record: e.record, record_source: e.record_source || "", blurb: e.blurb || "", start: e.start ?? e.record, best: null, verified: null, summit: false,
        color: PALETTE[(S.order.length - 1) % PALETTE.length] }, S.peaks[e.peak] ? { best: S.peaks[e.peak].best } : {});
      break;
    case "AGENT":
      S.agents[e.agent] = Object.assign(S.agents[e.agent] || { attempts: [], reads: [], writes: [], exa: [], best: null, kept: 0, tried: 0 },
        { name: e.agent, peak: e.peak, role: e.role || "breaker", approach: e.approach || "", steps: e.steps || [], status: "active" });
      break;
    case "KEEP": case "REVERT":
      if (ag) { ag.tried++; ag.attempts.unshift(e); ag.attempts.length = Math.min(ag.attempts.length, 8);
        if (e.type === "KEEP") { ag.kept++; if (p && e.score != null && better(p, e.score, ag.best)) ag.best = e.score; } }
      if (p && e.type === "KEEP" && e.score != null && better(p, e.score, p.best)) p.best = e.score;
      break;
    case "APPROACH": if (ag) { ag.approach = e.approach || ag.approach; ag.steps = e.steps || ag.steps; } break;
    case "RETIRE": if (ag) ag.status = "retired"; break;
    case "MEMORY_WRITE":
      S.notes[e.note_id] = { id: e.note_id, author: e.agent, peak: e.peak, kind: e.kind, claim: e.claim, reads: 0, t: e.t };
      if (ag) ag.writes.unshift(e); break;
    case "MEMORY_READ":
      if (S.notes[e.note_id]) S.notes[e.note_id].reads++;
      if (ag) ag.reads.unshift(e); break;
    case "EXA": S.exa.unshift(e); if (ag) ag.exa.unshift(e); break;
    case "DECIDE": S.decisions.unshift(e); break;
    case "VERIFY": if (p && e.ok) p.verified = e.score; break;
    case "SUMMIT": if (p) { p.summit = true; p.verified = e.score ?? p.verified; } break;
    case "BUDGET": S.budget = e; break;
  }
}
const peakAgents = (pid) => Object.values(S.agents).filter((a) => a.peak === pid && a.role !== "director")
  .sort((a, b) => frac(S.peaks[pid], b.best) - frac(S.peaks[pid], a.best));

/* ---------------- pixel art ---------------- */
function rng(seed) { let s = 0; for (const c of String(seed)) s = (s * 31 + c.charCodeAt(0)) >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function route() { // zigzag path from the base to the apex, as [x, y] points
  const pts = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push([APEX.x + (i % 2 ? -1 : 1) * (1 - t) * HW * 0.36 - 6 * (1 - t), GROUND - t * (GROUND - APEX.y - 2)]); }
  return pts;
}
const ROUTE = route();
function along(f) {
  const segs = ROUTE.slice(1).map((q, i) => Math.hypot(q[0] - ROUTE[i][0], q[1] - ROUTE[i][1]));
  let L = segs.reduce((a, b) => a + b, 0) * Math.max(0, Math.min(1, f));
  for (let i = 0; i < segs.length; i++) { if (L <= segs[i]) { const t = L / segs[i]; return [ROUTE[i][0] + (ROUTE[i + 1][0] - ROUTE[i][0]) * t, ROUTE[i][1] + (ROUTE[i + 1][1] - ROUTE[i][1]) * t]; } L -= segs[i]; }
  return ROUTE[ROUTE.length - 1];
}
function drawPeak(cv, seed, color, opts = {}) {
  const g = cv.getContext("2d"), r = rng(seed), px = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), w, h); };
  px(0, 0, W, H, "#F4F1EA");
  for (let i = 0; i < 4; i++) { const cx = 20 + r() * 200, cy = 8 + r() * 26, cw = 18 + r() * 22; px(cx, cy, cw, 3, "#fff"); px(cx + 3, cy - 2, cw - 8, 2, "#fff"); }
  const mount = (ax, ay, hw, light, shade, snow, sf, sd) => {
    const n = rng(seed + sd), jag = Array.from({ length: W }, () => n());
    for (let x = 0; x < W; x++) {
      const d = Math.abs(x + 0.5 - ax) / hw; if (d >= 1) continue;
      const top = Math.round(ay + Math.pow(d, 0.92) * (GROUND - ay) + (jag[x >> 1] - 0.5) * 5 * d);
      const snowline = Math.round(ay + sf * (GROUND - ay) + (jag[(x >> 2) + 60] - 0.5) * 7);
      const face = x < ax - (jag[x >> 3] > 0.7 ? 3 : 0) ? light : shade;
      if (top < snowline) { px(x, top, 1, snowline - top, snow); px(x, snowline, 1, GROUND - snowline, face); } else px(x, top, 1, GROUND - top, face);
    }
  };
  mount(40 + r() * 30, 58 + r() * 14, 70, "#C9CFD6", "#B9C0C9", "#ECEFF3", 0.3, "b1");
  mount(190 + r() * 20, 50 + r() * 16, 76, "#C9CFD6", "#B9C0C9", "#ECEFF3", 0.3, "b2");
  mount(APEX.x, APEX.y, HW, "#8E9AA8", "#6C7889", "#FFFFFF", 0.3, "m");
  px(0, GROUND, W, H - GROUND, "#E9E3D2");
  for (let i = 0; i < 60; i++) px(r() * W, GROUND + 2 + r() * (H - GROUND - 3), 2, 1, "#DCD3BC");
  for (let i = 0; i < 9; i++) { const x = 6 + r() * 228, y = GROUND - 5 + r() * 4; if (Math.abs(x - 120) < 20) continue; px(x + 2, y + 5, 1, 2, "#6B4F3A"); px(x + 2, y, 1, 2, "#3D6344"); px(x + 1, y + 2, 3, 2, "#4E7A55"); px(x, y + 4, 5, 1, "#3D6344"); }
  g.fillStyle = color; for (let k = 0; k <= 300; k++) { const [x, y] = along(k / 300); if ((k >> 1) % 2 === 0) g.fillRect(Math.round(x), Math.round(y), 1, 1); }
  for (const f of [0.33, 0.66]) { const [x, y] = along(f); for (let j = 0; j < 4; j++) px(x - j, y - 4 + j, 2 * j + 1, 1, color); }
  if (!opts.mini) { // base camp, note pile, lookout
    for (let j = 0; j < 6; j++) px(120 - j, 136 + j, 2 * j + 1, 1, "#E4A33B");
    for (let s = 0; s < 4; s++) px(64 - (4 - s), 142 - s * 2, 2 * (4 - s) + 1, 2, s % 2 ? "#9C9488" : "#B5AD9F");
    px(182, 130, 1, 12, "#6B4F3A"); px(189, 130, 1, 12, "#6B4F3A"); px(180, 128, 12, 2, "#8A6A48"); px(183, 124, 6, 4, "#B99269");
  }
  if (opts.summit) { px(APEX.x + 2, APEX.y - 9, 1, 9, "#2B2622"); px(APEX.x + 3, APEX.y - 9, 6, 4, color); }
  if (opts.dots) for (const f of opts.dots) { const [x, y] = along(f * 0.97); px(x - 1, y - 4, 3, 4, color); px(x - 1, y - 5, 3, 1, "#2B2622"); }
}

/* ---------------- rendering ---------------- */
const fmtT = (t) => { const d = new Date(t); return isNaN(d) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); };
const pct = (f) => (f >= 1 ? "100% · summit" : Math.round(f * 100) + "%");
function describe(e) {
  const a = e.agent ? `<b>${esc(e.agent)}</b> ` : "";
  switch (e.type) {
    case "PEAK": return `New mountain: ${esc(e.name)} (${esc(e.constant)}). Record to beat ${esc(e.record)}.`;
    case "AGENT": return `${a}joins as ${esc(e.role || "breaker")}: ${esc(e.approach)}`;
    case "KEEP": return `${a}improved to <b>${esc(e.score)}</b>. ${esc(e.summary || "")}`;
    case "REVERT": return `${a}tried and reverted. ${esc(e.summary || "")}`;
    case "APPROACH": return `${a}changes approach: ${esc(e.approach)}`;
    case "RETIRE": return `${a}retired. ${esc(e.reason || "")}`;
    case "MEMORY_WRITE": return `${a}saved a note: “${esc(e.claim)}”`;
    case "MEMORY_READ": return `${a}used a note written by <b>${esc(e.author)}</b>: “${esc(e.claim)}”${e.used_for ? " → " + esc(e.used_for) : ""}`;
    case "EXA": return `${a}searched Exa for “${esc(e.query)}” and found ${(e.results || []).length} sources${e.used_for ? " → " + esc(e.used_for) : ""}`;
    case "DECIDE": return `Director: ${esc(e.decision || "")}. ${esc(e.reason || "")}`;
    case "VERIFY": return `Verifier ${e.ok ? "confirmed" : "rejected"} ${esc(e.score)} ${e.method ? "(" + esc(e.method) + ")" : ""}`;
    case "SUMMIT": return `Summit: record beaten with <b>${esc(e.score)}</b>.`;
    case "BUDGET": return `Budget: $${esc(e.spent)} of $${esc(e.cap)} used.`;
    default: return esc(e.summary || e.type);
  }
}
function renderLog() {
  const pid = view.mode === "climb" ? S.order[view.idx] : null;
  const rows = S.events.filter((e) => e.type !== "BUDGET" && (!pid || !e.peak || e.peak === pid)).slice(-60).reverse();
  $("logScope").textContent = pid ? "· " + (S.peaks[pid]?.name || "") + " and lab-wide" : "· all mountains";
  $("log").innerHTML = rows.map((e) => `<li><time>${fmtT(e.t)}</time><span class="ty ${esc(e.type)}">${esc(e.type.replace("MEMORY_", "NOTE "))}</span><span>${describe(e)}</span></li>`).join("") || `<li><span></span><span></span><span class="dim">Waiting for the first event…</span></li>`;
}
function chips() {
  const c = $("chipLive"); c.className = "chip " + (S.mode === "live" ? "live" : "demo");
  c.textContent = S.mode === "live" ? "● LIVE" : S.mode === "demo" ? "SAMPLE REPLAY · not real results" : "connecting…";
  $("chipBudget").textContent = S.budget ? `Budget $${S.budget.spent} / $${S.budget.cap}` : "Budget —";
  const n = Object.values(S.peaks).filter((p) => p.summit).length;
  $("chipSummits").textContent = `${n} summit${n === 1 ? "" : "s"} · ${S.order.length} mountains`;
  $("skipBtn").hidden = !(S.mode === "demo" && replay.queue.length);
}
function li(text, small) { return `<li>${text}${small ? `<small>${small}</small>` : ""}</li>`; }
function list(title, items, empty) { return `<div><h4>${title}</h4><ul>${items.length ? items.join("") : li(`<span class="dim">${empty}</span>`)}</ul></div>`; }
function renderPanel(p) {
  const sel = view.sel, el = $("panel");
  if (sel && sel.kind === "agent" && S.agents[sel.id]) {
    const a = S.agents[sel.id], team = peakAgents(a.peak), rank = team.indexOf(a) + 1, f = frac(p, a.best);
    el.innerHTML = `<span class="kick" style="color:${p.color}">${esc(a.role).toUpperCase()} · RANK ${rank} OF ${team.length}${a.status === "retired" ? " · RETIRED" : ""}</span><h2>${esc(a.name)}</h2><p>${esc(a.approach)}</p>
      <div class="stats"><div><span>BEST</span><b>${esc(a.best ?? "—")}</b></div><div><span>ALTITUDE</span><b>${pct(f)}</b></div><div><span>KEPT / TRIED</span><b>${a.kept} / ${a.tried}</b></div></div>
      ${list("HOW IT CLIMBS", (a.steps || []).map((s, i) => li(`${i + 1}. ${esc(s)}`)), "No steps logged yet")}
      ${list("NOTES IT USED (from other agents)", a.reads.slice(0, 5).map((e) => li(esc(e.claim), `written by ${esc(e.author)}${e.used_for ? " · used for: " + esc(e.used_for) : ""}`)), "None yet")}
      ${list("NOTES IT WROTE", a.writes.slice(0, 5).map((e) => li(esc(e.claim), esc(e.kind || ""))), "None yet")}
      ${list("SOURCES FOUND WITH EXA", a.exa.slice(0, 3).flatMap((e) => (e.results || []).slice(0, 3).map((r) => { const u = safeUrl(r.url); return li(u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(r.title || u)}</a>` : esc(r.title), `query: ${esc(e.query)}`); })), "None yet")}
      ${list("LAST ATTEMPTS", a.attempts.slice(0, 6).map((e) => li(`${e.type === "KEEP" ? "Kept" : "Reverted"}${e.score != null ? " · " + esc(e.score) : ""}`, esc(e.summary || ""))), "None yet")}`;
  } else if (sel && sel.kind === "memory") {
    const notes = Object.values(S.notes), cross = S.events.filter((e) => e.type === "MEMORY_READ" && e.author && e.author !== e.agent);
    el.innerHTML = `<span class="kick">SHARED MEMORY · PAST.DEV</span><h2>Note pile</h2><p>Every agent saves what it learned after each attempt and reads the pile before the next one. Notes travel between mountains.</p>
      <div class="stats"><div><span>NOTES</span><b>${notes.length}</b></div><div><span>WRITERS</span><b>${new Set(notes.map((n) => n.author)).size}</b></div><div><span>CROSS-AGENT READS</span><b>${cross.length}</b></div></div>
      ${list("LATEST CROSS-AGENT READS", cross.slice(-6).reverse().map((e) => li(`${esc(e.agent)} used ${esc(e.author)}'s note`, esc(e.claim))), "None yet")}
      ${list("MOST-READ NOTES", notes.sort((a, b) => b.reads - a.reads).slice(0, 6).map((n) => li(esc(n.claim), `by ${esc(n.author)} · read ${n.reads}×`)), "None yet")}`;
  } else if (sel && sel.kind === "exa") {
    el.innerHTML = `<span class="kick">SCOUT · EXA</span><h2>Lookout</h2><p>Before an agent proposes its next move, the scout searches the web for methods and prior results. Every source is logged with what the lab did with it.</p>
      <div class="stats"><div><span>SEARCHES</span><b>${S.exa.length}</b></div><div><span>SOURCES</span><b>${S.exa.reduce((n, e) => n + (e.results || []).length, 0)}</b></div><div><span>ON THIS PEAK</span><b>${S.exa.filter((e) => e.peak === p.id).length}</b></div></div>
      ${list("RECENT SEARCHES", S.exa.slice(0, 8).map((e) => li(`“${esc(e.query)}”${e.used_for ? " → " + esc(e.used_for) : ""}`, (e.results || []).slice(0, 3).map((r) => { const u = safeUrl(r.url); return u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(r.title || u)}</a>` : esc(r.title); }).join(" · "))), "None yet")}`;
  } else if (sel && sel.kind === "director") {
    el.innerHTML = `<span class="kick">DIRECTOR</span><h2>Base camp</h2><p>Decides which mountains and agents get compute, and writes down why.</p>
      ${list("LATEST DECISIONS", S.decisions.slice(0, 10).map((e) => li(esc(e.decision || ""), `${fmtT(e.t)} · ${esc(e.reason || "")}`)), "None yet")}`;
  } else {
    const team = peakAgents(p.id);
    el.innerHTML = `<span class="kick" style="color:${p.color}">${esc(p.constant)} · ${p.summit ? "SUMMITED" : "CLIMBING"}</span><h2>${esc(p.name)}</h2><p>${esc(p.blurb || "")} Goal: ${p.direction === "minimize" ? "push the bound lower" : "push the bound higher"} than ${esc(p.record)}${p.record_source ? " (" + esc(p.record_source) + ")" : ""}.</p>
      ${list("TEAM, RANKED BY PROGRESS", team.map((a, i) => li(`#${i + 1} <button type="button" data-agent="${esc(a.name)}">${esc(a.name)}</button> · ${pct(frac(p, a.best))}`, esc(a.approach))), "No agents yet")}
      <p class="dim" style="font-size:12px">Click a climber, the note pile, the lookout or base camp to look inside.</p>`;
    el.querySelectorAll("[data-agent]").forEach((b) => b.onclick = () => { view.sel = { kind: "agent", id: b.dataset.agent }; render(); });
  }
}
let drawnKey = "";
function renderClimb() {
  if (!S.order.length) { $("peakName").textContent = "Waiting for the lab to start…"; $("overlay").innerHTML = ""; $("panel").innerHTML = `<p class="dim">No mountains yet. They appear as soon as the lab logs its first PEAK event.</p>`; return; }
  view.idx = (view.idx + S.order.length) % S.order.length;
  const p = S.peaks[S.order[view.idx]], team = peakAgents(p.id);
  $("peakIdx").textContent = `MOUNTAIN ${view.idx + 1} OF ${S.order.length}`; $("peakName").textContent = p.name; $("peakConst").textContent = p.constant;
  const key = p.id + p.summit; if (key !== drawnKey) { drawPeak($("peakCanvas"), p.id, p.color, { summit: p.summit }); drawnKey = key; }
  const ov = $("overlay"), want = new Set(team.map((a) => "c-" + a.name));
  ov.querySelectorAll(".climber").forEach((n) => { if (!want.has(n.id)) n.remove(); });
  team.forEach((a, i) => {
    const [x, y] = along(Math.min(frac(p, a.best), 1) * 0.97); let n = document.getElementById("c-" + a.name);
    if (!n) { n = document.createElement("button"); n.type = "button"; n.id = "c-" + a.name; n.className = "climber";
      n.innerHTML = `<span class="tagname"></span><span class="body" aria-hidden="true"><i style="left:3px;top:0;width:4px;height:4px;background:#F1C9A5"></i><i class="hat" style="left:2px;top:0;width:6px;height:2px"></i><i class="coat" style="left:2px;top:5px;width:6px;height:6px"></i><i style="left:2px;top:11px;width:2px;height:5px;background:#2B2622"></i><i style="left:6px;top:11px;width:2px;height:5px;background:#2B2622"></i></span>`;
      n.onclick = () => { view.sel = { kind: "agent", id: a.name }; render(); }; ov.appendChild(n); }
    n.querySelector(".tagname").textContent = `#${i + 1} ${a.name}`; n.querySelector(".hat").style.background = p.color; n.querySelector(".coat").style.background = p.color;
    n.style.left = ((x + (i % 2 ? 5 : -5) * (i > 0)) / W * 100) + "%"; n.style.top = (y / H * 100) + "%"; n.style.opacity = a.status === "retired" ? 0.45 : 1; n.style.zIndex = 20 - i;
    n.setAttribute("aria-pressed", view.sel?.kind === "agent" && view.sel.id === a.name); n.setAttribute("aria-label", `${a.name}, rank ${i + 1}, altitude ${pct(frac(p, a.best))}`);
  });
  [["director", "Base camp", 120, 146], ["memory", "Note pile", 64, 146], ["exa", "Lookout", 186, 146]].forEach(([k, label, x, y]) => {
    let n = document.getElementById("h-" + k); if (!n) { n = document.createElement("button"); n.type = "button"; n.id = "h-" + k; n.className = "hot"; n.textContent = label; n.onclick = () => { view.sel = { kind: k }; render(); }; ov.appendChild(n); }
    n.style.left = (x / W * 100) + "%"; n.style.top = (y / H * 100) + "%"; n.setAttribute("aria-pressed", view.sel?.kind === k);
  });
  const top = team[0];
  $("scorebar").innerHTML = `<div><span>RECORD TO BEAT</span><b>${esc(p.record)}</b></div><div><span>OUR BEST</span><b>${esc(p.best ?? "—")}</b></div><div><span>VERIFIED</span><b>${esc(p.verified ?? "not yet")}</b></div><div><span>ALTITUDE</span><b>${pct(frac(p, p.best))}${top ? " · led by " + esc(top.name) : ""}</b></div>`;
  renderPanel(p);
}
function renderWorld() {
  const row = $("worldRow"); row.innerHTML = "";
  S.order.forEach((pid, i) => {
    const p = S.peaks[pid], team = peakAgents(pid), b = document.createElement("button"); b.type = "button"; b.className = "worldCard";
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H; drawPeak(cv, pid, p.color, { mini: true, summit: p.summit, dots: team.map((a) => Math.min(frac(p, a.best), 1)) });
    const f = frac(p, p.best); b.appendChild(cv);
    b.insertAdjacentHTML("beforeend", `<span class="meta"><b>${esc(p.name)}</b><span class="dim">${esc(p.constant)} · ${team.length} agents</span><span class="bar"><i style="width:${Math.min(100, f * 100)}%;background:${p.color}"></i></span><span>${p.summit ? "Summit · record beaten" : pct(f) + " of the way to the record"}</span></span>`);
    b.onclick = () => { view.mode = "climb"; view.idx = i; view.sel = null; render(); }; row.appendChild(b);
  });
  if (!S.order.length) row.innerHTML = `<p class="dim">No mountains yet.</p>`;
}
function render() {
  $("landing").hidden = view.screen !== "landing"; $("app").hidden = view.screen !== "app";
  if (view.screen !== "app") return;
  $("climbView").hidden = view.mode !== "climb"; $("worldView").hidden = view.mode !== "world";
  $("modeClimb").setAttribute("aria-selected", view.mode === "climb"); $("modeWorld").setAttribute("aria-selected", view.mode === "world");
  chips(); if (view.mode === "climb") renderClimb(); else renderWorld(); renderLog();
}

/* ---------------- data: live polling, or sample replay ---------------- */
const API = (new URLSearchParams(location.search).get("api") || window.CONSTANT_LAB_API || "").replace(/\/$/, "");
const replay = { queue: [], timer: null };
async function poll() {
  try {
    const r = await fetch(`${API}/api/events?since=${S.seq}`, { cache: "no-store" }); if (!r.ok) throw new Error(r.status);
    const d = await r.json(); (d.events || []).forEach(apply); S.mode = "live"; if ((d.events || []).length) render(); else chips();
  } catch (err) { if (S.mode !== "live") return false; }
  return true;
}
async function start() {
  const live = await poll();
  if (live) { $("landingStatus").textContent = "Connected to the live lab."; setInterval(poll, 2000); render(); return; }
  S.mode = "demo"; $("landingStatus").textContent = "No live lab found, so this is a sample replay with made-up scores.";
  try {
    let res = await fetch("demo/events.jsonl", { cache: "no-store" });
    if (!res.ok) res = await fetch("demo/events.txt", { cache: "no-store" }); // same file, for hosts that won't serve .jsonl
    const txt = await res.text();
    replay.queue = txt.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    while (replay.queue.length && ["PEAK", "AGENT"].includes(replay.queue[0].type)) apply(replay.queue.shift());
    replay.timer = setInterval(() => { if (!replay.queue.length) { clearInterval(replay.timer); chips(); return; } apply(replay.queue.shift()); if (view.screen === "app") render(); }, 900);
  } catch (err) { $("landingStatus").textContent = "Could not load any events."; }
  render();
}
$("enterBtn").onclick = () => { view.screen = "app"; render(); };
$("homeBtn").onclick = () => { view.screen = "landing"; render(); };
$("modeClimb").onclick = () => { view.mode = "climb"; render(); };
$("modeWorld").onclick = () => { view.mode = "world"; render(); };
$("prevBtn").onclick = () => { view.idx--; view.sel = null; render(); };
$("nextBtn").onclick = () => { view.idx++; view.sel = null; render(); };
$("skipBtn").onclick = () => { replay.queue.splice(0).forEach(apply); render(); };
document.addEventListener("keydown", (e) => { if (view.screen !== "app" || view.mode !== "climb" || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
  if (e.key === "ArrowLeft") { view.idx--; view.sel = null; render(); } if (e.key === "ArrowRight") { view.idx++; view.sel = null; render(); } });
drawPeak($("heroCanvas"), "hero", "#D9482B", { mini: true, summit: true });
start();
})();
