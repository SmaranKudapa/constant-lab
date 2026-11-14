// The town simulator: explicit rules, no LLM. One tick = 10 simulated minutes.
// The same code drives the 3D replay (one seed, with events) and the batch
// runs behind the experiment table (many seeds, no rendering), so every number
// on screen comes from the run you can watch.
import { makeRng } from "./rng.js";

export const TICK_MIN = 10;
export const TICKS_PER_DAY = (24 * 60) / TICK_MIN;
export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const H = (h, m = 0) => h * 60 + m;

export const COHORTS = {
  "day-workers": { label: "Day workers", share: 0.3, shirt: 0x3f7fd6, online: 0.7, paper: 0.15, interest: [0.35, 0.45, 0.2] },
  families: { label: "Working parents", share: 0.22, shirt: 0xff7ad9, online: 0.3, paper: 0.15, interest: [0.3, 0.45, 0.25] },
  seniors: { label: "Seniors", share: 0.16, shirt: 0xb48ce6, online: 0.2, paper: 0.6, interest: [0.2, 0.4, 0.4] },
  students: { label: "Students", share: 0.14, shirt: 0x5be37d, online: 0.8, paper: 0.05, interest: [0.25, 0.4, 0.35] },
  "night-shift": { label: "Night shift", share: 0.1, shirt: 0xff9f43, online: 0.35, paper: 0.15, interest: [0.4, 0.4, 0.2] },
  remote: { label: "Remote workers", share: 0.08, shirt: 0x3fd0c9, online: 0.9, paper: 0.05, interest: [0.4, 0.4, 0.2] },
};
const FIRST = ["Ana", "Ben", "Cleo", "Dev", "Eva", "Finn", "Gia", "Hal", "Ines", "Jae", "Kai", "Lena", "Milo", "Nia", "Omar", "Pia", "Quin", "Rosa", "Sam", "Tara", "Uma", "Vic", "Wren", "Xia", "Yusuf", "Zoe", "Ari", "Bea", "Cal", "Dot", "Eli", "Fay", "Gus", "Hana", "Ivo", "June", "Kip", "Lou", "Mae", "Ned"];
const LAST = ["Ortiz", "Nguyen", "Park", "Smith", "Okafor", "Reyes", "Kim", "Brown", "Patel", "Haddad", "Larsen", "Cruz", "Chen", "Diaz", "Moreau", "Ali"];
const SKIN = [0xf1c7a5, 0xd9a07a, 0xb07a55, 0x8a5a3c, 0x5e3b26, 0xf5d6c0];
const HAIR = [0x2b1d14, 0x5a3a22, 0x8c5a2b, 0xe0c068, 0x1b1530, 0xb3412f, 0xdedede];

// ---------- policies ----------
export const BASELINE_HOURS = [[H(10), H(18)], [H(10), H(18)], [H(10), H(18)], [H(10), H(18)], [H(10), H(18)], [H(10), H(18)], null];
export function hoursWith(changes) {
  const h = BASELINE_HOURS.map((x) => (x ? x.slice() : null));
  for (const [day, open, close] of changes) h[day] = open === null ? null : [open, close];
  return h;
}
export const staffHours = (hours, staff = 2) => hours.reduce((s, x) => s + (x ? (x[1] - x[0]) / 60 : 0), 0) * staff;
export function hoursText(hours) {
  const f = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return hours.map((x, d) => (x && (BASELINE_HOURS[d] === null || x[0] !== BASELINE_HOURS[d][0] || x[1] !== BASELINE_HOURS[d][1]) ? `${DAYS[d]} ${f(x[0])}-${f(x[1])}` : null)).filter(Boolean).join(", ") || "current hours";
}

// ---------- residents ----------
export function makeResidents(town, seed, scenario = {}) {
  const rng = makeRng("residents:" + seed);
  const n = scenario.count || 72;
  const mix = { ...Object.fromEntries(Object.entries(COHORTS).map(([k, v]) => [k, v.share])), ...(scenario.mix || {}) };
  const total = Object.values(mix).reduce((a, b) => a + b, 0);
  const cohortList = [];
  for (const [k, v] of Object.entries(mix)) for (let i = 0; i < Math.round((v / total) * n); i++) cohortList.push(k);
  while (cohortList.length < n) cohortList.push("day-workers");
  cohortList.length = n;
  const homes = rng.shuffle(town.homes);
  const residents = [];
  let hi = 0;
  const shuffled = rng.shuffle(cohortList);
  for (let i = 0; i < n; i++) {
    const cohort = shuffled[i];
    const C = COHORTS[cohort];
    const home = homes[hi % homes.length];
    if (rng.chance(0.55)) hi++; // households of 1-3
    const r = rng.next();
    const channel = r < C.online ? "online" : r < C.online + C.paper ? "paper" : "word-of-mouth";
    const ir = rng.next() * (scenario.interestMult || 1);
    const interest = ir < C.interest[0] ? 0 : ir < C.interest[0] + C.interest[1] ? 1 : 2;
    const work = cohort === "students" ? town.byId.school : ["day-workers", "families", "night-shift"].includes(cohort) ? rng.pick(town.works) : null;
    residents.push({
      id: `r${String(i + 1).padStart(2, "0")}`,
      name: `${rng.pick(FIRST)} ${rng.pick(LAST)}`,
      cohort, home, work,
      shirt: C.shirt,
      pants: rng.pick([0x3b3f6b, 0x2b2840, 0x5a4a3a, 0x40566b]),
      skin: rng.pick(SKIN), hair: rng.pick(HAIR),
      worksSaturday: cohort === "day-workers" && rng.chance(0.5),
      channel, interest,
      neighborhood: home.z < 0 ? (home.x < 0 ? "northwest" : "northeast") : home.x < 0 ? "southwest" : "southeast",
    });
  }
  for (const r of residents) r.restricted = !canUseHours(r, BASELINE_HOURS);
  return residents;
}

// What a resident is doing at (day, minute): "home" | "work" | "school" | "free" | "drop"
export function scheduleAt(r, day, m) {
  const wk = day < 5, sat = day === 5;
  switch (r.cohort) {
    case "day-workers":
      if (wk && m >= H(8, 30) && m < H(18)) return "work";
      if (sat && r.worksSaturday && m >= H(9) && m < H(18)) return "work";
      if (wk && m >= H(18) && m < H(21, 30)) return "free";
      if (!wk && m >= H(10) && m < H(20)) return "free";
      return "home";
    case "families":
      if (wk && m >= H(8) && m < H(8, 30)) return "drop";
      if (wk && m >= H(8, 30) && m < H(15, 30)) return "work";
      if (wk && m >= H(15, 30) && m < H(16)) return "drop";
      if (wk && m >= H(16) && m < H(20)) return "free";
      if (!wk && m >= H(10) && m < H(19)) return "free";
      return "home";
    case "seniors":
      return m >= H(9) && m < H(17) ? "free" : "home";
    case "students":
      if (wk && m >= H(8) && m < H(15)) return "school";
      if (wk && m >= H(15) && m < H(20)) return "free";
      if (!wk && m >= H(11) && m < H(20)) return "free";
      return "home";
    case "night-shift":
      if (day !== 5 && (m >= H(22) || m < H(6))) return "work";
      if (m >= H(14) && m < H(21)) return "free";
      return "home";
    case "remote":
      if (wk && m >= H(12) && m < H(13)) return "free";
      if (m >= H(17) && m < H(21)) return "free";
      if (!wk && m >= H(10) && m < H(19)) return "free";
      return "home";
  }
  return "home";
}

export function canUseHours(r, hours) {
  for (let d = 0; d < 7; d++) {
    const h = hours[d];
    if (!h) continue;
    for (let m = h[0]; m < h[1] - 30; m += TICK_MIN) if (scheduleAt(r, d, m) === "free") return true;
  }
  return false;
}

// ---------- the model ----------
// mode: "service" (library visits) or "perception" (who hears a notice)
export function createModel({ town, residents, mode, policy, seed, emit = null, days = 7 }) {
  const rng = makeRng("run:" + seed);
  const lib = town.byId.library, plaza = town.byId.plaza, school = town.byId.school;
  const freeSpots = [plaza, town.byId.park, town.byId.cafe].filter(Boolean);
  const S = residents.map((r) => ({
    r, at: r.home, plan: "home", visitsWeek: 0, visitedToday: false, triedToday: false,
    libState: null, libUntil: 0, arriveAt: 0, aware: false, awareVia: null, lastFreeDecision: -1,
  }));
  const st = {
    tick: 0, mode, policy,
    queue: [], inside: [],
    metrics: { visits: 0, restrictedVisits: 0, turnedAway: 0, uniqueVisitors: new Set(), byCohort: {}, aware: 0, awareByCohort: {}, learnedVia: { online: 0, board: 0, bulletin: 0, "word-of-mouth": 0 } },
  };
  const capacity = policy.capacity || 6;
  const hours = policy.hours || BASELINE_HOURS;
  const changes = [];
  const log = (type, f) => emit && emit(type, f);

  const isOpen = (day, m) => { const h = hours[day]; return !!h && m >= h[0] && m < h[1]; };
  const move = (s, b, extra = {}) => { if (s.at !== b) { s.at = b; changes.push({ s, b, ...extra }); } };

  function learn(s, via, from = null) {
    if (s.aware) return;
    s.aware = true; s.awareVia = via;
    st.metrics.aware++;
    st.metrics.awareByCohort[s.r.cohort] = (st.metrics.awareByCohort[s.r.cohort] || 0) + 1;
    st.metrics.learnedVia[via]++;
    log("LEARN", { resident: s.r.id, name: s.r.name, cohort: s.r.cohort, via, from: from && from.r.id, fromName: from && from.r.name, at: s.at.name });
    log("AUDIENCE", { op: "update_traits", identity: s.r.id, traits: { heard_library_notice: "true", heard_via: via }, slug: "heard-library-notice", members: st.metrics.aware });
  }

  function step() {
    const day = Math.floor(st.tick / TICKS_PER_DAY) % 7;
    const m = (st.tick % TICKS_PER_DAY) * TICK_MIN;
    changes.length = 0;
    if (m === 0) for (const s of S) { s.visitedToday = false; s.triedToday = false; }

    for (const s of S) {
      const plan = scheduleAt(s.r, day, m);
      // Library arrival / stay
      if (s.libState === "going" && st.tick >= s.arriveAt) {
        if (!isOpen(day, m)) {
          s.libState = null; s.triedToday = true;
          st.metrics.turnedAway++;
          log("TURNED_AWAY", { resident: s.r.id, name: s.r.name, cohort: s.r.cohort, reason: "library closed" });
          changes.push({ s, b: lib, turned: true });
        } else if (st.inside.length < capacity) { enter(s); }
        else { s.libState = "queue"; st.queue.push(s); changes.push({ s, b: lib, queue: true }); }
      }
      if (s.libState === "inside" && (st.tick >= s.libUntil || !isOpen(day, m))) {
        s.libState = null; st.inside.splice(st.inside.indexOf(s), 1);
      }
      if (s.libState) continue;

      if (plan === "free") {
        const hourStart = m % 60 === 0 || s.lastFreeDecision < 0 || s.plan !== "free";
        if (hourStart) {
          s.lastFreeDecision = st.tick;
          const wantsLib = mode === "service" && s.visitsWeek < s.r.interest && !s.visitedToday && !s.triedToday && rng.chance(0.3);
          if (wantsLib) {
            s.libState = "going"; s.arriveAt = st.tick + 1;
            move(s, lib);
          } else if (s.at === s.r.home || !rng.chance(0.4)) {
            const roll = rng.next();
            move(s, roll < 0.35 ? s.r.home : rng.pick(freeSpots));
          }
        }
      } else if (plan === "work") move(s, s.r.work || s.r.home);
      else if (plan === "school") move(s, school);
      else if (plan === "drop") move(s, school);
      else move(s, s.r.home);
      s.plan = plan;
    }
    // Serve the queue
    while (st.queue.length && st.inside.length < capacity && isOpen(day, m)) enter(st.queue.shift());
    if (!isOpen(day, m) && st.queue.length) {
      for (const s of st.queue) { s.libState = null; st.metrics.turnedAway++; log("TURNED_AWAY", { resident: s.r.id, name: s.r.name, cohort: s.r.cohort, reason: "closed while waiting" }); changes.push({ s, b: lib, turned: true }); }
      st.queue.length = 0;
    }

    if (mode === "perception") perceptionStep(day, m);
    st.tick++;
    return changes;
  }

  function enter(s) {
    s.libState = "inside"; s.libUntil = st.tick + 6 + Math.floor(rng.next() * 4);
    st.inside.push(s);
    s.visitsWeek++; s.visitedToday = true;
    st.metrics.visits++;
    st.metrics.uniqueVisitors.add(s.r.id);
    st.metrics.byCohort[s.r.cohort] = (st.metrics.byCohort[s.r.cohort] || 0) + 1;
    if (s.r.restricted) st.metrics.restrictedVisits++;
    log("VISIT", { resident: s.r.id, name: s.r.name, cohort: s.r.cohort, restricted: s.r.restricted });
    changes.push({ s, b: lib, served: true });
  }

  function perceptionStep(day, m) {
    const ch = policy.channels || ["online"];
    const awake = m >= H(7) && m < H(23);
    const byPlace = new Map();
    for (const s of S) {
      if (!byPlace.has(s.at)) byPlace.set(s.at, []);
      byPlace.get(s.at).push(s);
      if (s.aware || !awake) continue;
      if (ch.includes("online") && s.r.channel === "online" && s.at === s.r.home && rng.chance(0.005)) learn(s, "online");
      if (ch.includes("board") && s.at === plaza && rng.chance(s.r.channel === "paper" ? 0.08 : 0.015)) learn(s, "board");
      if (ch.includes("bulletin") && s.at === school && s.r.cohort === "families" && rng.chance(0.06)) learn(s, "bulletin");
    }
    // Word of mouth between people in the same place
    for (const [place, group] of byPlace) {
      if (group.length < 2) continue;
      const aware = group.filter((g) => g.aware);
      if (!aware.length) continue;
      const p = place.kind === "home" ? 0.004 : place.kind === "work" || place.kind === "school" ? 0.0006 : 0.002;
      for (const s of group) if (!s.aware && awake && rng.chance(1 - Math.pow(1 - p, aware.length))) learn(s, "word-of-mouth", rng.pick(aware));
    }
  }

  function done() { return st.tick >= days * TICKS_PER_DAY; }
  function summary() {
    const M = st.metrics;
    const count = (c) => residents.filter((r) => r.cohort === c).length || 1;
    return {
      visits: M.visits, restrictedVisits: M.restrictedVisits, turnedAway: M.turnedAway,
      uniqueVisitors: M.uniqueVisitors.size, staffHours: staffHours(hours),
      awarePct: (100 * M.aware) / residents.length,
      familiesAwarePct: (100 * (M.awareByCohort.families || 0)) / count("families"),
      learnedVia: { ...M.learnedVia },
    };
  }
  return { step, done, summary, state: st, S, isOpen, hours };
}

// Run many seeds with no rendering and average the results.
export function runBatch({ town, residents, mode, policy, seeds, days }) {
  const runs = seeds.map((seed) => {
    const model = createModel({ town, residents, mode, policy, seed, days });
    while (!model.done()) model.step();
    return model.summary();
  });
  const mean = (k) => runs.reduce((a, r) => a + r[k], 0) / runs.length;
  const sd = (k) => { const mu = mean(k); return Math.sqrt(runs.reduce((a, r) => a + (r[k] - mu) ** 2, 0) / Math.max(1, runs.length - 1)); };
  const keys = ["visits", "restrictedVisits", "turnedAway", "uniqueVisitors", "staffHours", "awarePct", "familiesAwarePct"];
  return { n: runs.length, mean: Object.fromEntries(keys.map((k) => [k, mean(k)])), sd: Object.fromEntries(keys.map((k) => [k, sd(k)])), runs };
}
