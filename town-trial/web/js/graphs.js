// Audience graphs (past.dev audiences): membership of an audience over time, one line per resident type in its
// shirt colour, plus the audience's makeup by type and how members first heard (by channel). Built from
// timestamped joins recorded tick by tick while the simulator runs (the same town, residents and simulator as the
// backend; mean of matched seeds), not from final counts. "Heard" is membership only: not opinion or behaviour.
import { createModel, COHORTS, TICKS_PER_DAY, DAYS } from "./sim.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const hex = (n) => `#${n.toString(16).padStart(6, "0")}`;
const VIA = { online: "Online post", board: "Flyers", bulletin: "School bulletin", newspaper: "Newspaper", mailer: "Mailer", "word-of-mouth": "Word of mouth" };
const SEEDS = [0, 1, 2, 3];
const cache = new Map();

// Timestamped joins for one policy: per-cohort cumulative members at each hour, first-heard channels, cohort sizes.
export function audienceSeries({ town, residents, mode, policy, days, incomeFactor = 1 }) {
  const key = JSON.stringify([mode, policy, days, residents.length]);
  if (cache.has(key)) return cache.get(key);
  const hours = days * 24, cohorts = [...new Set(residents.map((r) => r.cohort))];
  const size = Object.fromEntries(cohorts.map((c) => [c, residents.filter((r) => r.cohort === c).length]));
  const curve = Object.fromEntries(cohorts.map((c) => [c, new Float32Array(hours + 1)]));
  const via = {};
  for (const seed of SEEDS) {
    const joins = [];
    let m = null;
    m = createModel({ town, residents, mode, policy, seed, days, incomeFactor,
      emit: (type, f) => { if (type === "LEARN") joins.push({ tick: m ? m.state.tick : 0, cohort: f.cohort, via: f.via }); } });
    while (!m.done()) m.step();
    for (const j of joins) {
      const h = Math.min(hours, Math.floor((j.tick / TICKS_PER_DAY) * 24) + 1);
      for (let k = h; k <= hours; k++) curve[j.cohort][k] += 1 / SEEDS.length;
      via[j.via] = (via[j.via] || 0) + 1 / SEEDS.length;
    }
  }
  const out = { hours, cohorts, size, curve, via, days };
  cache.set(key, out);
  return out;
}

function halfTime(series, c) {
  const target = series.size[c] / 2, cv = series.curve[c];
  for (let h = 0; h <= series.hours; h++) if (cv[h] >= target) return h;
  return null;
}
const hourLabel = (h) => `${DAYS[Math.floor(h / 24) % 7]} ${String(h % 24).padStart(2, "0")}:00`;

function chartSVG(A, B, only) {
  const W = 640, H = 250, L = 40, R = 12, T = 12, Bm = 28;
  const cohorts = only ? [only] : A.cohorts;
  const max = Math.max(1, ...cohorts.map((c) => Math.max(A.size[c] ? A.curve[c][A.hours] : 0, B ? B.curve[c][B.hours] : 0)));
  const x = (h) => L + (h / A.hours) * (W - L - R), y = (v) => T + (1 - v / max) * (H - T - Bm);
  let g = `<svg viewBox="0 0 ${W} ${H}" class="ag-svg" role="img" aria-label="Audience membership over time">`;
  for (let k = 0; k <= 4; k++) { const v = (max * k) / 4, yy = y(v); g += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" class="ag-grid"/><text x="${L - 6}" y="${yy + 3}" class="ag-ax" text-anchor="end">${v.toFixed(v < 10 ? 1 : 0)}</text>`; }
  for (let d = 0; d <= A.days; d++) { const xx = x(d * 24); g += `<line x1="${xx}" x2="${xx}" y1="${T}" y2="${H - Bm}" class="ag-grid"/>${d < A.days ? `<text x="${xx + 4}" y="${H - 10}" class="ag-ax">${DAYS[d % 7]}</text>` : ""}`; }
  const line = (S, c, dash) => {
    let p = "";
    for (let h = 0; h <= S.hours; h++) p += `${h ? "L" : "M"}${x(h).toFixed(1)},${y(S.curve[c][h]).toFixed(1)}`;
    return `<path d="${p}" fill="none" stroke="${hex(COHORTS[c].shirt)}" stroke-width="${dash ? 2 : 2.6}" ${dash ? 'stroke-dasharray="5 4" opacity=".8"' : ""}/>`;
  };
  for (const c of cohorts) { if (B) g += line(B, c, true); g += line(A, c, false); }
  return g + `</svg>`;
}

function bars(entries, total) {
  return `<div class="ag-bar">${entries.filter(([, v]) => v > 0).map(([label, v, col]) =>
    `<i style="flex:${v};background:${col}" title="${esc(label)}: ${v.toFixed(1)}"></i>`).join("")}</div>` +
    `<div class="ag-legend">${entries.filter(([, v]) => v > 0).map(([label, v, col]) => `<span><b style="background:${col}"></b>${esc(label)} ${total ? Math.round((100 * v) / total) : 0}%</span>`).join("")}</div>`;
}

// exps: experiments with results; aud: { slug, title, cohort|null }
export function openAudienceGraph({ town, residents, mode, days, incomeFactor, exps, aud, viewingId }) {
  let root = document.getElementById("aud-graph");
  if (!root) { root = document.createElement("div"); root.id = "aud-graph"; document.body.appendChild(root); }
  const list = exps.filter((x) => x.result && x.policy);
  if (!list.length) return;
  let a = (list.find((x) => x.id === viewingId) || list.find((x) => x.best) || list[list.length - 1]).id, b = "";
  const opts = (sel) => list.map((x) => `<option value="${esc(x.id)}"${x.id === sel ? " selected" : ""}>${esc(x.id)} · ${esc(x.label)}</option>`).join("");
  const render = () => {
    const XA = list.find((x) => x.id === a), XB = list.find((x) => x.id === b);
    const A = audienceSeries({ town, residents, mode, policy: XA.policy, days, incomeFactor });
    const B = XB ? audienceSeries({ town, residents, mode, policy: XB.policy, days, incomeFactor }) : null;
    const cohorts = aud.cohort ? [aud.cohort] : A.cohorts;
    const finalOf = (S, c) => S.curve[c][S.hours];
    const total = cohorts.reduce((s, c) => s + finalOf(A, c), 0), size = cohorts.reduce((s, c) => s + A.size[c], 0);
    const makeup = cohorts.map((c) => [COHORTS[c].label, finalOf(A, c), hex(COHORTS[c].shirt)]);
    const VC = { online: "#59c2ff", board: "#ffd34d", bulletin: "#5be37d", newspaper: "#b48ce6", mailer: "#ff9f43", "word-of-mouth": "#ff7ad9" };
    const viaE = Object.entries(A.via).map(([k, v]) => [VIA[k] || k, v, VC[k] || "#aaa"]);
    const viaT = viaE.reduce((s, e) => s + e[1], 0);
    const speed = cohorts.map((c) => { const ha = halfTime(A, c), hb = B ? halfTime(B, c) : undefined;
      return `<tr><td><b style="background:${hex(COHORTS[c].shirt)}"></b>${esc(COHORTS[c].label)}</td><td>${Math.round((100 * finalOf(A, c)) / Math.max(1, A.size[c]))}%</td><td>${ha === null ? "never" : `${ha} h (${hourLabel(ha)})`}</td>${B ? `<td>${hb === null ? "never" : `${hb} h`}</td>` : ""}</tr>`; }).join("");
    root.innerHTML = `<div class="ag-backdrop" data-agclose></div><div class="ag-win panel" role="dialog" aria-label="Audience graph">
      <button class="rp-x" data-agclose title="Close">✕</button>
      <div class="ag-head"><div class="rp-kicker">PAST.DEV AUDIENCE</div><h3>${esc(aud.title)}</h3><div class="rp-dim">${esc(aud.rule)}</div></div>
      <div class="ag-ctl"><label>Experiment <select data-ag="a">${opts(a)}</select></label><label>Compare with <select data-ag="b"><option value="">none</option>${opts(b)}</select></label></div>
      ${chartSVG(A, B, aud.cohort)}
      <div class="ag-key">${cohorts.map((c) => `<span><b style="background:${hex(COHORTS[c].shirt)}"></b>${esc(COHORTS[c].label)}</span>`).join("")}${B ? `<span class="rp-dim">solid: ${esc(a)} · dashed: ${esc(b)}</span>` : ""}</div>
      <div class="ag-stats"><b>${total.toFixed(1)}</b> of ${size} residents joined by the end (${Math.round((100 * total) / Math.max(1, size))}%), mean of ${SEEDS.length} matched seeds.</div>
      <h4 class="rp-h">AUDIENCE MAKEUP BY RESIDENT TYPE</h4>${bars(makeup, total)}
      <h4 class="rp-h">HOW MEMBERS FIRST HEARD${aud.cohort ? " (WHOLE TOWN)" : ""}</h4>${bars(viaE, viaT)}
      <h4 class="rp-h">HOW FAST EACH TYPE JOINS</h4><table class="ag-tab"><tr><th>Type</th><th>Joined</th><th>Half joined after</th>${B ? `<th>${esc(b)}</th>` : ""}</tr>${speed}</table>
      <p class="rp-dim rp-small">Membership means a resident heard the notice. It says nothing about whether they agree with it or change what they do.</p></div>`;
    root.querySelectorAll("[data-agclose]").forEach((el) => el.addEventListener("click", () => root.classList.add("hidden")));
    root.querySelectorAll("select[data-ag]").forEach((el) => el.addEventListener("change", () => { if (el.dataset.ag === "a") a = el.value; else b = el.value; render(); }));
  };
  render();
  root.classList.remove("hidden");
}
