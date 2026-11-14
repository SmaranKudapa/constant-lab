// Batch simulator entry point for Node (Modal workers, local tests).
// Reads JSON on stdin, prints JSON on stdout. Uses the same layout.js, sim.js
// and rng.js as the browser, so numbers match the in-browser replay.
//
// Input: one job or an array of jobs:
//   {city, mode: "service"|"perception", policy, seeds: [0,1,...] | N, days?, scenario?}
//   policy: {hours: [[openMin, closeMin]|null x7]} | {hours_changes: [{day, open:"HH:MM"|null, close}]}
//           | {channels: ["online","board","bulletin"]}, optional capacity
//   scenario: {name?, seed?, mix?, interestMult?, count?}  (seed defaults to the city name)
//   {info: true, city, scenario?} returns {residents: {n, byCohort}} without simulating.
// Output: runBatch result ({n, mean, sd, runs}) plus {seeds, ms}, or an array of them.
import { pathToFileURL } from "node:url";
import { layoutTown } from "../web/js/layout.js";
import { makeResidents, runBatch, hoursWith } from "../web/js/sim.js";

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
export function runJob({ city, mode = "service", policy = {}, seeds = 16, days, scenario = null, info = false }) {
  if (!city) throw new Error("job.city is required");
  const t0 = Date.now();
  if (!towns.has(city)) towns.set(city, layoutTown(city));
  const town = towns.get(city);
  const rkey = JSON.stringify([city, scenario]);
  if (!residentCache.has(rkey)) residentCache.set(rkey, scenario ? makeResidents(town, scenario.seed ?? city, scenario) : makeResidents(town, city));
  const residents = residentCache.get(rkey);
  if (info) {
    const byCohort = {};
    for (const r of residents) byCohort[r.cohort] = (byCohort[r.cohort] || 0) + 1;
    return { residents: { n: residents.length, byCohort, restricted: residents.filter((r) => r.restricted).length } };
  }
  const seedList = Array.isArray(seeds) ? seeds : [...Array(seeds).keys()];
  const res = runBatch({ town, residents, mode, policy: normalizePolicy(policy), seeds: seedList, days: days ?? (mode === "service" ? 7 : 3) });
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
