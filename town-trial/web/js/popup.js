// Results popup: trial question, key numbers, then tabs (why it wins / steps / other experiments).
// Also the TRIALS history: every finished trial's summary, reopenable (kept in localStorage when allowed).
import { esc, link, AGENTS, AGENT_COLOR } from "./ui.js";

const KEY = "town-trial:history:v1";
const $ = (id) => document.getElementById(id);
let history = [];
try { history = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { history = []; }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(history.slice(-20))); } catch { /* storage blocked */ } };

export function remember(sum) { history.push(sum); history = history.slice(-20); save(); renderHistory(); }
export function historyCount() { return history.length; }

const STANCE = { helped: { c: "#5be37d", t: "HELPED" }, hurt: { c: "#ff5d6c", t: "WORSE OFF" }, unchanged: { c: "#a99cc8", t: "NO CHANGE" } };

function whyHTML(s) {
  let h = "";
  if (s.brief) h += `<div class="rp-card rp-brief"><div class="rp-who" style="color:${AGENT_COLOR.bo}">BO · DECISION BRIEF${s.brief.scripted ? " · scripted" : ""}</div>
    <p>${esc(s.brief.summary)}</p>${s.brief.assumptions ? `<p class="rp-dim"><b>Assumes:</b> ${esc(s.brief.assumptions)}</p>` : ""}${s.brief.pilot ? `<p class="rp-dim"><b>Pilot:</b> ${esc(s.brief.pilot)}</p>` : ""}</div>`;
  if (s.voices && s.voices.list.length) {
    h += `<h4 class="rp-h">WHAT RESIDENTS SAY <span class="rp-tag">${s.voices.scripted ? "SCRIPTED" : "LLM-WRITTEN"} · NOT REAL PEOPLE</span></h4><div class="rp-voices">`;
    for (const v of s.voices.list) {
      const st = STANCE[v.stance] || STANCE.unchanged;
      h += `<div class="rp-voice" style="border-color:${st.c}"><div class="rp-vrole">${esc(v.role)} <span class="rp-dim">· ${esc(v.label)}</span></div>
        <div class="rp-quote">"${esc(v.quote)}"</div><div class="rp-vnum" style="color:${st.c}">${st.t} · ${v.before} → ${v.after} ${esc(v.unit)}</div></div>`;
    }
    h += `</div><p class="rp-dim rp-small">${esc(s.voices.note || "")}</p>`;
  }
  if (s.chain && s.chain.length > 1) h += `<h4 class="rp-h">HOW WE GOT HERE</h4><div class="rp-chain">${s.chain.map((c) => `<span>${esc(c.id)}<i>${esc(c.label)}</i></span>`).join("<b>→</b>")}</div>`;
  for (const g of s.why) {
    h += `<h4 class="rp-h" style="color:${AGENT_COLOR[g.agent] || "#ccc"}">${esc(AGENTS[g.agent] || g.agent)}</h4>`;
    for (const st of g.steps) h += `<div class="rp-card" style="border-left-color:${AGENT_COLOR[g.agent] || "#999"}"><div class="rp-who">${esc(st.type.replace("_", " "))}${st.scripted ? " · scripted" : ""}</div>
      <div>${esc(st.text)}</div>${st.sources.filter(Boolean).map((u) => `<div class="rp-src">source: ${link(u)}</div>`).join("")}</div>`;
  }
  return h || `<p class="rp-dim">No reasoning recorded.</p>`;
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

export function openSummary(s, origin = null) {
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
      <div class="rp-metric rp-dim">Ranked by: ${esc(s.metricLabel)}. Numbers are simulator means over matched seeds; resident schedules are model defaults.</div>
    </div>
    <div class="rp-tabs"><button class="rp-tab active" data-rt="why">WHY IT WINS</button><button class="rp-tab" data-rt="steps">STEPS (${s.steps.length})</button><button class="rp-tab" data-rt="others">OTHER EXPERIMENTS (${s.others.length})</button><i class="rp-ink"></i></div>
    <div class="rp-body"><div data-rb="why">${whyHTML(s)}</div><div data-rb="steps" hidden>${stepsHTML(s)}</div><div data-rb="others" hidden>${othersHTML(s)}</div></div>
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
