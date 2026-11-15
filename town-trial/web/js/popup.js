// Results popup: trial question, key numbers, then tabs (why it wins / steps / other experiments).
// Also the TRIALS history: every trial finished in this visit, reopenable. Kept in memory only, so a refresh clears it.
import { esc, link, AGENT_COLOR, AGENTS } from "./ui.js";

const $ = (id) => document.getElementById(id);
let history = [];

export function remember(sum) { history.push(sum); history = history.slice(-20); renderHistory(); }
export function historyCount() { return history.length; }

const STANCE = { helped: { c: "#5be37d", t: "HELPED" }, hurt: { c: "#ff5d6c", t: "WORSE OFF" }, unchanged: { c: "#a99cc8", t: "NO CHANGE" } };

function policyHTML(s) {
  const what = s.what || (s.best ? `${s.best.label}: ${s.best.change}.` : s.brief ? s.brief.label : "");
  const why = s.reasoning || (s.brief ? s.brief.summary : "");
  let h = `<section class="rp-sec"><h4 class="rp-h">WHAT THE POLICY DOES</h4><p class="rp-lead">${esc(what)}</p></section>`;
  if (why) h += `<section class="rp-sec rp-why"><h4 class="rp-h">WHY IT WINS</h4><p class="rp-lead">${esc(why)}</p></section>`;
  if (s.funding) {
    const F = s.funding, col = { funded: "#5be37d", gap: "#ff5d6c", unverified: "#ffd34d" }[F.status] || "#a99cc8";
    h += `<section class="rp-sec rp-fund" style="border-left-color:${col}"><h4 class="rp-h" style="color:${col}">FUNDING · ${F.status === "unverified" ? "BUDGET UNVERIFIED" : esc(String(F.status).toUpperCase())} <span class="rp-who">TREASURER</span></h4>
      <p class="rp-lead">${esc(F.summary || "")}${F.source && F.source !== "none identified" ? ` · from ${esc(F.source)}` : ""}${F.gap ? ` · gap ${esc(fmtUsd(F.gap))}/yr` : ""}</p>
      <p class="rp-dim">${esc(F.reason || "")}${F.url ? ` ${link(F.url)}` : ""}</p>
      ${F.confirm.length ? `<p class="rp-dim"><b>The town must confirm:</b> ${esc(F.confirm.join("; "))}</p>` : ""}
      ${s.townBudget ? `<p class="rp-dim"><b>Town budget:</b> ${esc(s.townBudget.year || "current year")} ${esc(s.townBudget.kind)}${typeof s.townBudget.total === "number" ? ` ${esc(fmtUsd(s.townBudget.total))}` : ""} · ${link(s.townBudget.url)}${s.townBudget.published ? ` (${esc(s.townBudget.published)})` : ""}</p>` : ""}</section>`;
  }
  if (s.sources && s.sources.length) h += `<div class="rp-src rp-small">Sources: ${s.sources.map((u) => link(u)).join(" · ")}</div>`;
  return h;
}
const fmtUsd = (x) => { const a = Math.abs(x); return a >= 1e6 ? `$${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `$${(a / 1e3).toFixed(1)}k` : `$${Math.round(a)}`; };

function townsHTML(s) {
  const cases = s.cases || [], pilots = s.pilots || [];
  if (!cases.length && !pilots.length) return `<p class="rp-dim">No similar towns were found for this question.</p>`;
  const W = { yes: ["#5be37d", "IT WORKED"], no: ["#ff5d6c", "IT FAILED"], mixed: ["#ffd34d", "MIXED"], unknown: ["#a99cc8", "OUTCOME UNCLEAR"] };
  let h = cases.map((c) => { const [col, t] = W[c.worked] || W.unknown; return `<div class="rp-card" style="border-left-color:${col}"><div class="rp-who" style="color:${col}">${esc(c.town)} · ${t}</div>
    <div><b>What they did:</b> ${esc(c.intervention)}</div><div><b>What happened:</b> ${esc(c.outcome)}</div>
    <div class="rp-dim"><b>Cost:</b> ${esc(c.cost)} · <b>Similar because:</b> ${esc(c.similarity)}</div><div class="rp-dim"><b>May not transfer:</b> ${esc(c.caveat)}</div>
    <div class="rp-src">${link(c.source)}${c.published ? ` · ${esc(c.published)}` : ""}</div></div>`; }).join("");
  if (pilots.length) h += `<h4 class="rp-h">PILOT PROPOSALS (NOT SIMULATED)</h4>` + pilots.map((p) => `<div class="rp-card" style="border-left-color:#59c2ff"><div><b>From ${esc(p.town)}:</b> ${esc(p.idea)}</div><div class="rp-src">${link(p.source)}</div></div>`).join("");
  return h;
}

function chainHTML(s) {
  if (!s.chain2 || !s.chain2.length) return "";
  return `<h4 class="rp-h">RESEARCH CHAIN</h4>` + s.chain2.map((c) => `<div class="rp-chainrow"><span class="rp-num" style="--c:#ff9f43">R${c.round}</span><div>
    <div><b>Failure:</b> ${esc(c.failure)}</div><div><b>Question:</b> ${esc(c.question)}</div><div><b>Source:</b> ${c.source ? link(c.source) : "none found"}</div>
    <div><b>Changed idea:</b> ${esc(c.idea)}</div><div><b>New result:</b> ${esc(c.result)}${c.improved ? ` <span style="color:#5be37d">▲ better</span>` : ""}</div></div></div>`).join("") + `<h4 class="rp-h">EVERY STEP</h4>`;
}

function residentsHTML(s) {
  if (!s.voices || !s.voices.list.length) return `<p class="rp-dim">No resident reactions recorded for this trial.</p>`;
  let h = `<div class="rp-voices">`;
  for (const v of s.voices.list) {
    const st = STANCE[v.stance] || STANCE.unchanged;
    h += `<div class="rp-voice" style="border-color:${st.c}"><div class="rp-vrole">${esc(v.role)} <span class="rp-dim">· ${esc(v.label)}</span></div>
      <div class="rp-quote">"${esc(v.quote)}"</div><div class="rp-vnum" style="color:${st.c}">${st.t} · ${v.before} → ${v.after} ${esc(v.unit)}</div></div>`;
  }
  return h + `</div>`;
}

function stepsHTML(s) {
  return `<ol class="rp-steps">${s.steps.map((st, i) => `<li style="--c:${AGENT_COLOR[st.agent] || "#888"};--i:${Math.min(i, 40)}">
    <span class="rp-num">${i + 1}</span><div><div class="rp-who" style="color:${AGENT_COLOR[st.agent] || "#aaa"}">${esc(AGENTS[st.agent] || st.agent || "system")} · ${esc(st.type.replace("_", " "))}${st.clock ? ` · ${esc(st.clock)}` : ""}${st.scripted ? " · scripted" : ""}</div>
    <div${st.level === "error" ? ' class="rp-err"' : ""}>${esc(st.text)}</div></div></li>`).join("")}</ol>`;
}

function othersHTML(s) {
  if (!s.others.length) return `<p class="rp-dim">No other experiments.</p>`;
  return s.others.map((o) => `<div class="rp-other st-${esc(o.status)}"><div class="rp-otop"><b>${esc(o.id)}</b> ${esc(o.label)}<span class="rp-ostat">${esc(o.status.toUpperCase())}</span><span class="rp-oval">${esc(o.text)}</span></div>
    <div class="rp-dim">${esc(o.role)} · ${esc(o.why)}</div></div>`).join("");
}

// Digits roll like a slot machine before settling on the real value.
function roll(el, delay) {
  const final = el.textContent;
  const t0 = performance.now() + delay;
  const tick = (now) => {
    const u = (now - t0) / 900;
    if (u < 0) { el.textContent = final.replace(/\d/g, "0"); requestAnimationFrame(tick); return; }
    if (u >= 1) { el.textContent = final; return; }
    const settled = Math.floor(u * final.length);
    el.textContent = [...final].map((ch, i) => (i < settled || !/\d/.test(ch) ? ch : String((Math.random() * 10) | 0))).join("");
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

let onClosed = null;
function failHTML(s) {
  const nosim = s.fail === "nosim";
  return `<div class="rp-backdrop" data-close></div>
  <div class="rp-win rp-fail" role="dialog" aria-label="Trial result">
    <div class="rp-glow"></div>
    <button class="rp-x" data-close title="Close">✕</button>
    <div class="rp-head">
      <div class="rp-kicker">✕ ${nosim ? "CAN'T BE SIMULATED" : "NO OPTION WORKED"} · ${esc(s.city || "")}</div>
      <div class="rp-q">"${esc(s.prompt)}"</div>
    </div>
    <div class="rp-body">
      <section class="rp-sec rp-failsec"><h4 class="rp-h">${nosim ? "WHY THIS QUESTION CAN'T BE SIMULATED" : "WHY NOTHING WAS RECOMMENDED"}</h4>
        <p class="rp-lead">${esc((s.brief && s.brief.summary) || "The question can't be expressed with the actions the town model supports.")}</p></section>
      ${nosim ? "" : `<h4 class="rp-h">WHAT WAS TRIED</h4>${othersHTML(s)}`}
    </div>
  </div>`;
}

export function openSummary(s, origin = null, onClose = null) {
  onClosed = onClose;
  if (s.fail) {  // red popup: no numbers, no tabs, just why
    const root = $("results");
    root.innerHTML = failHTML(s);
    root.classList.remove("hidden", "closing");
    root.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeSummary));
    return;
  }
  const root = $("results");
  const tiles = s.tiles.map((t, i) => `<div class="rp-tile ${t.good ? "good" : "bad"}" style="--i:${i}"><div class="rp-tl">${esc(t.label)}</div><div class="rp-tv">${esc(t.text)}</div><div class="rp-ts">${esc(t.sub)}</div></div>`).join("");
  root.innerHTML = `<div class="rp-backdrop" data-close></div><div class="rp-rays"></div>
  <div class="rp-win" role="dialog" aria-label="Trial results">
    <div class="rp-glow"></div>
    <button class="rp-x" data-close title="Close">✕</button>
    <div class="rp-head">
      <div class="rp-kicker">${s.best ? "★ BEST POLICY FOUND ★" : "TRIAL FINISHED"} · ${esc(s.city || "")}</div>
      <div class="rp-q">"${esc(s.prompt)}"</div>
      ${s.best ? `<div class="rp-best"><span class="rp-badge">${esc(s.best.id)}</span>${esc(s.best.label)}<div class="rp-change">${esc(s.best.change)} · ${esc(s.best.role)}</div></div>` : `<div class="rp-best">${esc(s.brief ? s.brief.label : "No recommendation")}</div>`}
      <div class="rp-tiles">${tiles}</div>
      <div class="rp-metric rp-dim">Ranked by ${esc(s.metricLabel)}.</div>
    </div>
    <div class="rp-tabs"><button class="rp-tab active" data-rt="policy">POLICY</button><button class="rp-tab" data-rt="residents">RESIDENTS</button><button class="rp-tab" data-rt="towns">SIMILAR TOWNS (${(s.cases || []).length})</button><button class="rp-tab" data-rt="steps">STEPS (${s.steps.length})</button><button class="rp-tab" data-rt="others">OTHER EXPERIMENTS (${s.others.length})</button><i class="rp-ink"></i></div>
    <div class="rp-body"><div data-rb="policy">${policyHTML(s)}</div><div data-rb="residents" hidden>${residentsHTML(s)}</div><div data-rb="towns" hidden>${townsHTML(s)}</div><div data-rb="steps" hidden>${chainHTML(s)}${stepsHTML(s)}</div><div data-rb="others" hidden>${othersHTML(s)}</div></div>
  </div>`;
  const win = root.querySelector(".rp-win");
  if (origin) { // fly out of the winning building's spot on screen
    const dx = origin.x - window.innerWidth / 2, dy = origin.y - window.innerHeight / 2;
    win.style.setProperty("--ox", `${dx}px`); win.style.setProperty("--oy", `${dy}px`);
  }
  root.classList.remove("hidden", "closing");
  root.querySelectorAll(".rp-tv").forEach((el, i) => roll(el, 650 + i * 120));
  const ink = root.querySelector(".rp-ink");
  const moveInk = (b) => { ink.style.left = `${b.offsetLeft}px`; ink.style.width = `${b.offsetWidth}px`; };
  requestAnimationFrame(() => moveInk(root.querySelector(".rp-tab.active")));
  root.querySelectorAll(".rp-tab").forEach((b) => b.addEventListener("click", () => {
    root.querySelectorAll(".rp-tab").forEach((x) => x.classList.toggle("active", x === b));
    root.querySelectorAll("[data-rb]").forEach((x) => (x.hidden = x.dataset.rb !== b.dataset.rt));
    root.querySelector(".rp-body").scrollTop = 0;
    moveInk(b);
  }));
  root.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeSummary));
}

export function closeSummary() {
  const root = $("results");
  if (root.classList.contains("hidden")) return;
  root.classList.add("closing");
  const cb = onClosed; onClosed = null;
  if (cb) cb();
  setTimeout(() => { root.classList.add("hidden"); root.classList.remove("closing"); root.innerHTML = ""; }, 380);
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeSummary(); $("trials-menu").classList.add("hidden"); } });

export function renderHistory() {
  const btn = $("trials-btn"), menu = $("trials-menu");
  btn.textContent = `TRIALS${history.length ? ` (${history.length})` : ""}`;
  menu.innerHTML = history.length ? [...history].reverse().map((s, i) => `<button class="tr-item" data-h="${history.length - 1 - i}">
    <b>${esc(s.best ? `${s.best.id}: ${s.best.label}` : s.brief ? s.brief.label : "No recommendation")}</b><span>"${esc(s.prompt)}"</span><i>${esc(s.city || "")} · ${new Date(s.when).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</i></button>`).join("")
    : `<p class="rp-dim" style="padding:8px">No finished trials yet. Run one and its results land here.</p>`;
}
export function initHistory() {
  renderHistory();
  $("trials-btn").addEventListener("click", (e) => { e.stopPropagation(); renderHistory(); $("trials-menu").classList.toggle("hidden"); });
  $("trials-menu").addEventListener("click", (e) => {
    const it = e.target.closest("[data-h]");
    if (it) { $("trials-menu").classList.add("hidden"); openSummary(history[+it.dataset.h]); }
  });
  document.addEventListener("click", (e) => { if (!e.target.closest("#trials-menu")) $("trials-menu").classList.add("hidden"); });
}
