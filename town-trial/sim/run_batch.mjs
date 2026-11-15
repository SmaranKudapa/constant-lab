// Batch simulator entry point for Node (Modal workers, local tests).
// Reads JSON on stdin, prints JSON on stdout. Uses the same layout.js, sim.js
// and rng.js as the browser, so numbers match the in-browser replay.
//
// Input: one job or an array of jobs:
//   {city, mode: "service"|"perception", policy, seeds: [0,1,...] | N, days?, scenario?}
//   policy: {hours: [[openMin, closeMin]|null x7]} | {hours_changes: [{day, open:"HH:MM"|null, close}]}
//           | {channels: ["online","board","bulletin"]}, optional capacity
//   scenario: {name?, seed?, mix?, interestMult?, count?}  (seed defaults to the city name)
//   spec: optional real-town spec (backend/towns.py); the town and resident mix are built from it
//   {info: true, city, scenario?} returns {residents: {n, byCohort}} without simulating.
//   trace: true adds failure traces (counts over the job's seeds) for the reviewer:
//     turnedAway by cohort / reason / day+hour, visits by cohort, learned via, aware by cohort.
//     Same models and seeds as runBatch, so the numbers are identical.
//   learn: true adds the ordered LEARN events (resident, via, tick) for the watched-run replay into past.dev.
// Output: runBatch result ({n, mean, sd, runs}) plus {seeds, ms}, or an array of them.
import { pathToFileURL } from "node:url";
import { layoutTown, residentScenario } from "../web/js/layout.js";
import { makeResidents, runBatch, hoursWith, createModel, TICKS_PER_DAY, DAYS } from "../web/js/sim.js";

const toMin = (t) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + (m || 0); };

export function normalizePolicy(policy = {}) {
  const out = { ...policy };
  if (policy.hours_changes) {
    out.hours = hoursWith(policy.hours_changes.map((c) => [c.day, c.open == null ? null : toMin(c.open), c.close == null ? null : toMin(c.close)]));
    delete out.hours_changes;
  }
  return out;
}

const towns = new Map();
const residentCache = new Map();
// runBatch with an emit hook that counts trace events (no effect on the simulation).
function runTraced({ town, residents, mode, policy, seeds, days }, keepLearn = false) {
  const trace = { turnedAwayByCohort: {}, turnedAwayByReason: {}, turnedAwayByDayHour: {}, visitsByCohort: {}, restrictedVisitsByCohort: {}, learnedVia: {}, awareByCohort: {} };
  const learn = [];
  const inc = (o, k) => { o[k] = (o[k] || 0) + 1; };
  const runs = seeds.map((seed) => {
    let model = null;
    const emit = (type, f) => {
      if (type === "TURNED_AWAY") {
        const t = model.state.tick, slot = `${DAYS[Math.floor(t / TICKS_PER_DAY) % 7]} ${String(Math.floor(((t % TICKS_PER_DAY) * 10) / 60)).padStart(2, "0")}:00`;
        inc(trace.turnedAwayByCohort, f.cohort); inc(trace.turnedAwayByReason, f.reason); inc(trace.turnedAwayByDayHour, slot);
      } else if (type === "VISIT") { inc(trace.visitsByCohort, f.cohort); if (f.restricted) inc(trace.restrictedVisitsByCohort, f.cohort); }
      else if (type === "LEARN") {
        inc(trace.learnedVia, f.via); inc(trace.awareByCohort, f.cohort);
        if (keepLearn) learn.push({ seed, tick: model.state.tick, resident: f.resident, name: f.name, cohort: f.cohort, via: f.via, from: f.from });
      }
    };
    model = createModel({ town, residents, mode, policy, seed, days, emit });
    while (!model.done()) model.step();
    return model.summary();
  });
  return { runs, trace, learn };
}

export function runJob({ city, mode = "service", policy = {}, seeds = 16, days, scenario = null, info = false, trace = false, learn = false, spec = null }) {
  if (!city) throw new Error("job.city is required");
  const t0 = Date.now();
  const tkey = spec ? `${city}|spec:${spec.fetched_at}` : city;
  if (!towns.has(tkey)) towns.set(tkey, layoutTown(city, spec));
  const town = towns.get(tkey);
  const rkey = JSON.stringify([tkey, scenario]);
  const sc = residentScenario(spec, scenario);
  if (!residentCache.has(rkey)) residentCache.set(rkey, makeResidents(town, (scenario && scenario.seed) ?? city, sc));
  const residents = residentCache.get(rkey);
  if (info) {
    const byCohort = {};
    for (const r of residents) byCohort[r.cohort] = (byCohort[r.cohort] || 0) + 1;
    return { residents: { n: residents.length, byCohort, restricted: residents.filter((r) => r.restricted).length,
      list: residents.map((r) => ({ id: r.id, name: r.name, cohort: r.cohort, channel: r.channel, neighborhood: r.neighborhood })) } };
  }
  const seedList = Array.isArray(seeds) ? seeds : [...Array(seeds).keys()];
  const args = { town, residents, mode, policy: normalizePolicy(policy), seeds: seedList, days: days ?? (mode === "service" ? 7 : 3) };
  if (trace || learn) {
    const { runs, trace: tr, learn: le } = runTraced(args, learn);
    const byCohort = {};
    for (const r of residents) byCohort[r.cohort] = (byCohort[r.cohort] || 0) + 1;
    return { runs, seeds: seedList, trace: { ...tr, residentsByCohort: byCohort }, ...(learn ? { learn: le } : {}), ms: Date.now() - t0 };
  }
  const res = runBatch(args);
  return { ...res, seeds: seedList, ms: Date.now() - t0 };
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const input = JSON.parse(raw);
  const out = Array.isArray(input) ? input.map(runJob) : runJob(input);
  process.stdout.write(JSON.stringify(out));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e.stack || String(e)); process.exit(1); });
