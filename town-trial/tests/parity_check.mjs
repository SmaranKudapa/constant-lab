// Parity: the pure layout (layout.js) must build the same town and residents
// as the original three.js town.js did, and run_batch.mjs must return what
// runBatch returns in-process. The browser exposes the same fingerprint as
// window.__townTrial.fingerprint(); for "Evart, MI" it must equal GOLDEN below.
// Run: node town-trial/tests/parity_check.mjs
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { layoutTown, townFingerprint } from "../web/js/layout.js";
import { makeResidents, runBatch, BASELINE_HOURS } from "../web/js/sim.js";

// buildings/residents values were computed from the pre-split town.js (commit 21cc141);
// trees cover decoration RNG order (rounded, since Math.cos/sin can differ in the last bit across engines).
const GOLDEN = {
  "Evart, MI": { buildings: "250117bdc4d60a00", residents: "dad599ac6ac9a800", trees: "c8b3d1d26864c800" },
  "Springfield, IL": { buildings: "884027e14dea5800", residents: "a2c42d08a583d000", trees: "d03c7e09845e880" },
  "Marfa, TX": { buildings: "fb55bdf432c71000", residents: "1513c9eaaf311a00", trees: "c222676780995800" },
  Oslo: { buildings: "d194abb82a433800", residents: "c1a41558577e4000", trees: "76e14e88166a4000" },
};

const GOLDEN_SPEC = { buildings: "7d2669e6a3b2b800", residents: "5b9ad34297e58800", trees: "4d93b8aab6da6000" };
let fails = 0;
const check = (name, ok, info = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name} ${info}`); if (!ok) fails++; };

for (const [city, want] of Object.entries(GOLDEN)) {
  const t = layoutTown(city);
  const got = townFingerprint(t, makeResidents(t, city));
  check(`fingerprint ${city}`, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));
}

// run_batch.mjs over stdin == runBatch in-process
const city = "Evart, MI";
const job = { city, mode: "service", policy: { hours_changes: [{ day: 1, open: "13:00", close: "21:00" }, { day: 3, open: "13:00", close: "21:00" }] }, seeds: 4 };
const script = fileURLToPath(new URL("../sim/run_batch.mjs", import.meta.url));
const p = spawnSync(process.execPath, [script], { input: JSON.stringify(job), encoding: "utf8" });
check("run_batch exits 0", p.status === 0, p.stderr.trim());
const viaCli = JSON.parse(p.stdout || "{}");
const t = layoutTown(city);
const H = (h) => h * 60;
const hours = BASELINE_HOURS.map((x) => (x ? x.slice() : null)); hours[1] = [H(13), H(21)]; hours[3] = [H(13), H(21)];
const direct = runBatch({ town: t, residents: makeResidents(t, city), mode: "service", policy: { hours }, seeds: [0, 1, 2, 3], days: 7 });
check("run_batch == runBatch", JSON.stringify(viaCli.mean) === JSON.stringify(direct.mean), JSON.stringify(viaCli.mean));

// Real-town spec (OSM fixture, frozen 2026-11-15): same layout, residents and run results via run_batch and in-process.
{
  const fs = await import("node:fs");
  const { residentScenario } = await import("../web/js/layout.js");
  const spec = JSON.parse(fs.readFileSync(fileURLToPath(new URL("./fixtures/spec_evart.json", import.meta.url)), "utf8"));
  const rt = layoutTown("Evart, MI", spec);
  const rres = makeResidents(rt, "Evart, MI", residentScenario(spec));
  const fp = townFingerprint(rt, rres);
  check("real-town fingerprint (Evart spec)", JSON.stringify(fp) === JSON.stringify(GOLDEN_SPEC), JSON.stringify(fp));
  const pj = spawnSync(process.execPath, [script], { input: JSON.stringify({ city: "Evart, MI", seeds: 4, spec }), encoding: "utf8" });
  const direct2 = runBatch({ town: rt, residents: rres, mode: "service", policy: { hours: BASELINE_HOURS }, seeds: [0, 1, 2, 3], days: 7 });
  check("run_batch with spec == runBatch", JSON.stringify(JSON.parse(pj.stdout || "{}").mean) === JSON.stringify(direct2.mean));
}

// trace: true must not change the numbers
const pt = spawnSync(process.execPath, [script], { input: JSON.stringify({ ...job, trace: true }), encoding: "utf8" });
const traced = JSON.parse(pt.stdout || "{}");
check("trace keeps runs identical", JSON.stringify(traced.runs) === JSON.stringify(viaCli.runs), JSON.stringify(traced.trace && traced.trace.turnedAwayByCohort));

process.exit(fails ? 1 : 0);
