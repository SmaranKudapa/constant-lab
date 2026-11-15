// The general town model ("town" mode): residents use any public place in the town (library,
// clinic, pharmacy, community centre, sports, park, post office, town hall), and outreach
// reaches them through channels that exist at real places. Explicit rules, no LLM.
//
// Policy (all optional):
//   facilities: { <id>: { hours: [[open,close]|null x7], capacity, fee, staff, closed } }   overrides
//   add:        [{ id, kind, near: <building id>, hours, capacity, fee, staff }]            new places
//   channels:   ["online","board","bulletin","newspaper","mailer"]                          outreach
//   target:     <facility id>   the place the trial is about ("can't make current hours" is measured for it)
//
// Every default below is a labelled model assumption (see FACILITY_DEFAULTS / DEMAND); real opening hours
// from OpenStreetMap replace the default hours when they parse. Budgets are computed from the summary's
// staff hours, open hours and fee revenue by the backend (policy.py), never by an LLM.
import { makeRng } from "./rng.js";
import { scheduleAt, TICK_MIN, TICKS_PER_DAY, DAYS } from "./sim.js";

const H = (h, m = 0) => h * 60 + m;
const week = (spec) => DAYS.map((_, d) => (spec[d] === undefined ? null : spec[d]));
const MON_FRI = (o, c) => [[o, c], [o, c], [o, c], [o, c], [o, c], null, null];
const MON_SAT = (o, c) => [[o, c], [o, c], [o, c], [o, c], [o, c], [o, c], null];
const DAILY = (o, c) => Array(7).fill([o, c]);

// capacity is in model residents (the sample), staff = staff on duty per open hour, opCost = $ per open hour
export const FACILITY_DEFAULTS = {
  library: { hours: MON_SAT(H(10), H(18)), capacity: 6, staff: 2, fee: 0, opCost: 25, stay: [6, 10] },
  clinic: { hours: MON_FRI(H(8), H(17)), capacity: 4, staff: 3, fee: 0, opCost: 40, stay: [3, 6] },
  pharmacy: { hours: MON_SAT(H(9), H(19)), capacity: 3, staff: 2, fee: 0, opCost: 20, stay: [1, 3] },
  community: { hours: MON_SAT(H(9), H(21)), capacity: 10, staff: 1, fee: 0, opCost: 20, stay: [6, 12] },
  sports: { hours: DAILY(H(7), H(21)), capacity: 12, staff: 1, fee: 0, opCost: 15, stay: [6, 12] },
  park: { hours: DAILY(H(6), H(22)), capacity: 100, staff: 0, fee: 0, opCost: 4, stay: [4, 10] },
  post_office: { hours: [[H(9), H(17)], [H(9), H(17)], [H(9), H(17)], [H(9), H(17)], [H(9), H(17)], [H(9), H(12)], null], capacity: 3, staff: 2, fee: 0, opCost: 15, stay: [1, 2] },
  townhall: { hours: MON_FRI(H(8), H(16, 30)), capacity: 4, staff: 3, fee: 0, opCost: 30, stay: [2, 4] },
};
export const TOWN_KINDS = Object.keys(FACILITY_DEFAULTS);
// Wanted visits per resident per week at easy access, by cohort (model assumption).
export const DEMAND = {
  library: { "day-workers": 0.5, families: 0.6, seniors: 0.8, students: 0.9, "night-shift": 0.4, remote: 0.6 },
  clinic: { "day-workers": 0.12, families: 0.2, seniors: 0.4, students: 0.08, "night-shift": 0.15, remote: 0.12 },
  pharmacy: { "day-workers": 0.25, families: 0.35, seniors: 0.6, students: 0.1, "night-shift": 0.25, remote: 0.25 },
  community: { "day-workers": 0.25, families: 0.5, seniors: 0.6, students: 0.4, "night-shift": 0.2, remote: 0.3 },
  sports: { "day-workers": 0.2, families: 0.2, seniors: 0.1, students: 0.5, "night-shift": 0.15, remote: 0.25 },
  park: { "day-workers": 1.0, families: 1.5, seniors: 1.2, students: 1.2, "night-shift": 0.8, remote: 1.2 },
  post_office: { "day-workers": 0.2, families: 0.25, seniors: 0.4, students: 0.05, "night-shift": 0.2, remote: 0.25 },
  townhall: { "day-workers": 0.05, families: 0.06, seniors: 0.08, students: 0.02, "night-shift": 0.05, remote: 0.05 },
};
// Willingness to pay per visit ($) by cohort; scaled by the town's median income when known.
export const WTP = { "day-workers": 12, families: 6, seniors: 5, students: 3, "night-shift": 6, remote: 15 };
export const CHANNELS = ["online", "board", "bulletin", "newspaper", "mailer"];
const BOARD_PLACES = ["post_office", "townhall", "library", "community"]; // "board" = paper flyers posted at these public places

// OpenStreetMap opening_hours -> week of [open, close] minutes, for the common simple forms; null if unsure.
const DAY_IX = { Mo: 0, Tu: 1, We: 2, Th: 3, Fr: 4, Sa: 5, Su: 6 };
export function parseOsmHours(str) {
  if (!str) return null;
  const s = String(str).trim();
  if (s === "24/7") return DAILY(0, H(24));
  const out = Array(7).fill(null);
  let any = false;
  for (const rule0 of s.split(";")) {
    const rule = rule0.trim();
    if (!rule) continue;
    const m = rule.match(/^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:,(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*)\s+(.+)$/);
    if (!m) { if (/^PH\b/.test(rule)) continue; return null; }
    const days = [];
    for (const part of m[1].split(",")) {
      const [a, b] = part.split("-");
      let i = DAY_IX[a];
      const j = b ? DAY_IX[b] : i;
      for (;;) { days.push(i); if (i === j) break; i = (i + 1) % 7; }
    }
    if (/^(off|closed)$/i.test(m[2].trim())) { for (const d of days) out[d] = null; any = true; continue; }
    let lo = Infinity, hi = -Infinity;
    for (const r of m[2].split(",")) {
      const t = r.trim().match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
      if (!t) return null;
      lo = Math.min(lo, H(+t[1], +t[2])); hi = Math.max(hi, H(+t[3], +t[4]));
    }
    if (!(hi > lo)) return null;
    for (const d of days) out[d] = [lo, hi];
    any = true;
  }
  return any ? out : null;
}

// The town's public places with their baseline settings (defaults, or OSM hours when they parse).
export function baselineFacilities(town) {
  return (town.facilities || []).filter((b) => FACILITY_DEFAULTS[b.kind]).map((b) => {
    const d = FACILITY_DEFAULTS[b.kind], osm = parseOsmHours(b.hoursOsm);
    return { id: b.id, kind: b.kind, name: b.name, building: b, hours: osm || d.hours.map((x) => (x ? x.slice() : null)),
      hoursSource: osm ? "OpenStreetMap opening_hours" : "model default", capacity: d.capacity, staff: d.staff, fee: d.fee, opCost: d.opCost };
  });
}

const freeDuring = (r, hours) => {
  for (let d = 0; d < 7; d++) { const h = hours[d]; if (!h) continue; for (let m = h[0]; m < h[1] - 30; m += TICK_MIN) if (scheduleAt(r, d, m) === "free") return true; }
  return false;
};
const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.z - b.z);

export function createTownModel({ town, residents, policy = {}, seed, emit = null, days = 7, incomeFactor = 1 }) {
  const rng = makeRng("run:" + seed);
  const log = (type, f) => emit && emit(type, f);
  const ov = policy.facilities || {};
  // facilities: baseline -> policy overrides -> added places
  const base = baselineFacilities(town);
  const F = base.map((f) => ({ ...f, baseHours: f.hours }));
  for (const a of policy.add || []) {
    const near = town.byId[a.near] || town.byId.plaza, d = FACILITY_DEFAULTS[a.kind];
    if (!d) continue;
    F.push({ id: a.id, kind: a.kind, name: a.name || `New ${a.kind.replace("_", " ")}`, building: near, hours: d.hours, baseHours: null,
      hoursSource: "proposed", capacity: d.capacity, staff: d.staff, fee: d.fee, opCost: d.opCost, added: true, ...pick(a) });
  }
  for (const f of F) Object.assign(f, pick(ov[f.id] || {}));
  const open = F.filter((f) => !f.closed);
  const byKind = {};
  for (const f of open) (byKind[f.kind] = byKind[f.kind] || []).push(f);
  const target = F.find((f) => f.id === policy.target) || null;
  const channels = policy.channels || [];
  const boardAt = new Set(BOARD_PLACES.map((k) => (k === "plaza" ? town.byId.plaza : (town.buildings || []).find((b) => b.kind === k))).filter(Boolean));
  const school = town.byId.school, plaza = town.byId.plaza;
  const hang = [plaza, ...(town.buildings || []).filter((b) => b.kind === "food").slice(0, 3)].filter(Boolean);

  // residents: stable personal tastes (not seed-dependent), nearest place of each kind, whether they know its hours
  const S = residents.map((r) => {
    const pr = makeRng("demand:" + r.id);
    const taste = {}, choice = {}, knows = {};
    for (const k of Object.keys(byKind)) {
      taste[k] = (DEMAND[k][r.cohort] || 0.2) * (0.4 + 1.2 * pr.next()) * (0.6 + 0.4 * (r.interest ?? 1));
      const near = byKind[k].slice().sort((a, b) => dist(r.home, a.building) - dist(r.home, b.building) || (a.id < b.id ? -1 : 1))[0];
      choice[k] = near;
      knows[near.id] = pr.chance(0.75);
    }
    const restricted = target && target.baseHours ? !freeDuring(r, target.baseHours) : false;
    const desire = Object.fromEntries(Object.keys(taste).map((k) => [k, taste[k] * 0.3]));
    return { r, at: r.home, plan: "home", taste, choice, knows, desire, restricted, libState: null, fac: null, libUntil: 0, arriveAt: 0,
      aware: false, awareVia: null, lastFreeDecision: -1, visited: new Set() };
  });
  const st = { tick: 0, mode: "town", policy, inside: [], queue: [], fac: Object.fromEntries(open.map((f) => [f.id, { inside: [], queue: [] }])),
    metrics: { counts: {}, unique: {}, learnedVia: Object.fromEntries(CHANNELS.concat(["word-of-mouth"]).map((c) => [c, 0])) } };
  const C = st.metrics.counts;
  const inc = (k, v = 1) => { C[k] = (C[k] || 0) + v; };
  const changes = [];
  const isOpenF = (f, day, m) => { const h = f.hours[day]; return !f.closed && !!h && m >= h[0] && m < h[1]; };
  // A place the town doesn't have (no library, no park...) is never a destination: the resident stays where they are
  const move = (s, b, extra = {}) => { if (b && s.at !== b) { s.at = b; changes.push({ s, b, ...extra }); } };
  const wtp = (c) => (WTP[c] || 8) * incomeFactor;

  function enter(s, f) {
    const fs = st.fac[f.id], d = FACILITY_DEFAULTS[f.kind];
    s.libState = "inside"; s.fac = f; s.libUntil = st.tick + d.stay[0] + Math.floor(rng.next() * (d.stay[1] - d.stay[0] + 1));
    fs.inside.push(s);
    s.desire[f.kind] = 0;
    inc("visits"); inc(`visits.k.${f.kind}`); inc(`visits.f.${f.id}`); inc(`visits.c.${s.r.cohort}`); inc(`visits.kc.${f.kind}.${s.r.cohort}`);
    if (f.fee) { inc("revenue", f.fee); inc(`revenue.f.${f.id}`, f.fee); }
    if (target && f.id === target.id && s.restricted) inc("visits.restricted");
    if (!s.visited.has(f.kind)) { s.visited.add(f.kind); inc(`unique.k.${f.kind}`); if (s.visited.size === 1) inc("unique"); }
    log("VISIT", { resident: s.r.id, name: s.r.name, cohort: s.r.cohort, facility: f.id, facilityName: f.name, kind: f.kind, restricted: s.restricted && target && f.id === target.id });
    changes.push({ s, b: f.building, served: true });
  }
  function turnAway(s, f, reason) {
    inc("turnedAway"); inc(`turnedAway.k.${f.kind}`); inc(`turnedAway.f.${f.id}`);
    s.desire[f.kind] *= 0.5;
    log("TURNED_AWAY", { resident: s.r.id, name: s.r.name, cohort: s.r.cohort, facility: f.id, facilityName: f.name, kind: f.kind, reason });
    changes.push({ s, b: f.building, turned: true });
  }
  function learn(s, via, from = null) {
    if (s.aware) return;
    s.aware = true; s.awareVia = via;
    if (target) s.knows[target.id] = true;  // the notice is about the target's (new) arrangements
    inc("aware"); inc(`aware.c.${s.r.cohort}`); st.metrics.learnedVia[via]++;
    log("LEARN", { resident: s.r.id, name: s.r.name, cohort: s.r.cohort, via, from: from && from.r.id, fromName: from && from.r.name, at: s.at.name });
    log("AUDIENCE", { op: "update_traits", identity: s.r.id, traits: { heard_notice: "true", heard_via: via }, slug: "heard-notice", members: C.aware });
  }

  function step() {
    const day = Math.floor(st.tick / TICKS_PER_DAY) % 7, m = (st.tick % TICKS_PER_DAY) * TICK_MIN;
    changes.length = 0;
    for (const s of S) for (const k in s.desire) s.desire[k] = Math.min(3 * s.taste[k], s.desire[k] + s.taste[k] / (7 * TICKS_PER_DAY));
    for (const s of S) {
      const plan = scheduleAt(s.r, day, m);
      if (s.libState === "going" && st.tick >= s.arriveAt) {
        const f = s.fac, fs = st.fac[f.id];
        if (!isOpenF(f, day, m)) { s.libState = null; turnAway(s, f, "closed"); }
        else if (fs.inside.length < f.capacity) enter(s, f);
        else { s.libState = "queue"; fs.queue.push(s); changes.push({ s, b: f.building, queue: true }); }
      }
      if (s.libState === "inside" && (st.tick >= s.libUntil || !isOpenF(s.fac, day, m))) {
        const fs = st.fac[s.fac.id];
        s.libState = null; fs.inside.splice(fs.inside.indexOf(s), 1);
      }
      if (s.libState) continue;
      if (plan === "free") {
        if (m % 60 === 0 || s.lastFreeDecision < 0 || s.plan !== "free") {
          s.lastFreeDecision = st.tick;
          let went = false;
          for (const k of rng.shuffle(Object.keys(s.choice))) {
            const f = s.choice[k];
            const p = Math.min(0.9, s.desire[k] * 0.35 * Math.exp(-dist(s.r.home, f.building) / 80));
            if (!rng.chance(p)) continue;
            if (s.knows[f.id] && !isOpenF(f, day, m)) continue;            // knows it's closed: the wish waits (latent demand)
            if (f.fee && !rng.chance(wtp(s.r.cohort) / (wtp(s.r.cohort) + f.fee))) { s.desire[k] *= 0.7; inc(`feeDeterred.k.${k}`); continue; }
            s.libState = "going"; s.fac = f; s.arriveAt = st.tick + 1; move(s, f.building); went = true; break;
          }
          if (!went && (s.at === s.r.home || !rng.chance(0.4))) move(s, rng.next() < 0.35 ? s.r.home : rng.pick(hang));
        }
      } else if (plan === "work") move(s, s.r.work || s.r.home);
      else if (plan === "school" || plan === "drop") move(s, school || s.r.home);
      else move(s, s.r.home);
      s.plan = plan;
    }
    for (const f of open) {
      const fs = st.fac[f.id];
      while (fs.queue.length && fs.inside.length < f.capacity && isOpenF(f, day, m)) enter(fs.queue.shift(), f);
      if (!isOpenF(f, day, m) && fs.queue.length) { for (const s of fs.queue) { s.libState = null; turnAway(s, f, "closed while waiting"); } fs.queue.length = 0; }
    }
    if (channels.length) outreach(day, m);
    if (target) { const ts = st.fac[target.id]; st.inside = ts ? ts.inside : []; st.queue = ts ? ts.queue : []; }
    st.tick++;
    return changes;
  }

  function outreach(day, m) {
    const awake = m >= H(7) && m < H(23);
    const byPlace = new Map();
    for (const s of S) {
      if (!byPlace.has(s.at)) byPlace.set(s.at, []);
      byPlace.get(s.at).push(s);
      if (s.aware || !awake) continue;
      const home = s.at === s.r.home;
      if (channels.includes("online") && s.r.channel === "online" && home && rng.chance(0.005)) learn(s, "online");
      if (channels.includes("board") && boardAt.has(s.at) && rng.chance(s.r.channel === "paper" ? 0.08 : 0.015)) learn(s, "board");
      if (channels.includes("bulletin") && s.at === school && s.r.cohort === "families" && rng.chance(0.06)) learn(s, "bulletin");
      if (channels.includes("newspaper") && s.r.channel === "paper" && home && rng.chance(0.004)) learn(s, "newspaper");
      if (channels.includes("mailer") && home && st.tick >= TICKS_PER_DAY && rng.chance(0.0025)) learn(s, "mailer");
    }
    for (const [place, group] of byPlace) {
      if (group.length < 2) continue;
      const aware = group.filter((g) => g.aware);
      if (!aware.length) continue;
      const p = place.kind === "home" ? 0.004 : place.employs || place.kind === "school" ? 0.0006 : 0.002;
      for (const s of group) if (!s.aware && awake && rng.chance(1 - Math.pow(1 - p, aware.length))) learn(s, "word-of-mouth", rng.pick(aware));
    }
  }

  const done = () => st.tick >= days * TICKS_PER_DAY;
  const openHours = (f) => (f.closed ? 0 : f.hours.reduce((a, h) => a + (h ? (h[1] - h[0]) / 60 : 0), 0));
  function summary() {
    const out = { ...C };
    for (const k of ["visits", "unique", "turnedAway", "revenue", "aware", "visits.restricted"]) out[k] = out[k] || 0;
    const n = residents.length, cohortN = {};
    for (const r of residents) cohortN[r.cohort] = (cohortN[r.cohort] || 0) + 1;
    out.awarePct = (100 * (C.aware || 0)) / n;
    for (const c in cohortN) out[`awarePct.c.${c}`] = (100 * (C[`aware.c.${c}`] || 0)) / cohortN[c];
    for (const f of F) { out[`openHours.f.${f.id}`] = openHours(f); out[`staffHours.f.${f.id}`] = openHours(f) * (f.closed ? 0 : f.staff); }
    out.openHours = F.reduce((a, f) => a + openHours(f), 0);
    out.staffHours = F.reduce((a, f) => a + openHours(f) * (f.closed ? 0 : f.staff), 0);
    out.restrictedResidents = S.filter((s) => s.restricted).length;
    out.learnedVia = { ...st.metrics.learnedVia };
    return out;
  }
  const isOpen = (day, m) => (target ? isOpenF(target, day, m) : false);
  return { step, done, summary, state: st, S, isOpen, hours: target ? target.hours : null, facilities: F };
}

function pick(o) {
  const out = {};
  for (const k of ["hours", "capacity", "fee", "staff", "closed", "name"]) if (o[k] !== undefined && o[k] !== null) out[k] = o[k];
  return out;
}
