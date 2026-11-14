// Quick checks of the simulator rules with a fake town (no 3D needed).
// Run: node town-trial/tests/sim_check.mjs
import { makeResidents, createModel, runBatch, hoursWith, staffHours, BASELINE_HOURS } from "../web/js/sim.js";
const b = (id, kind, extra = {}) => ({ id, kind, name: id, x: 0, z: 0, ...extra });
const town = { homes: [], works: [], byId: {} };
for (let i = 0; i < 60; i++) town.homes.push(b("home-" + i, "home", { z: i % 2 ? 5 : -5, x: i % 3 ? 5 : -5 }));
for (let i = 0; i < 8; i++) town.works.push(b("work-" + i, "work"));
for (const id of ["library", "school", "plaza", "park", "cafe"]) town.byId[id] = b(id, id, { outdoor: id === "plaza" || id === "park" });
const H = (h) => h * 60;
const residents = makeResidents(town, "test");
let fails = 0;
const check = (name, ok, info = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name} ${info}`); if (!ok) fails++; };

// 1. Conservation: every resident is somewhere every tick, and library inside <= capacity
const m = createModel({ town, residents, mode: "service", policy: { hours: BASELINE_HOURS, capacity: 6 }, seed: 1 });
let maxInside = 0, lost = 0;
while (!m.done()) { m.step(); maxInside = Math.max(maxInside, m.state.inside.length); lost += m.S.filter((s) => !s.at).length; }
check("capacity cap", maxInside <= 6, `max inside=${maxInside}`);
check("nobody lost", lost === 0);
const s = m.summary();
check("visits = sum by cohort", s.visits === Object.values(m.state.metrics.byCohort).reduce((a, x) => a + x, 0), `visits=${s.visits}`);

// 2. Library closed all week => zero visits
const closed = createModel({ town, residents, mode: "service", policy: { hours: [null, null, null, null, null, null, null] }, seed: 1 });
while (!closed.done()) closed.step();
check("closed library => 0 visits", closed.summary().visits === 0, `turned away=${closed.summary().turnedAway}`);

// 3. Staff hours arithmetic: baseline 6 days x 8h x 2 staff = 96
check("baseline staff hours = 96", staffHours(BASELINE_HOURS) === 96);
check("Tue/Thu to 21:00 adds 12", staffHours(hoursWith([[1, H(10), H(21)], [3, H(10), H(21)]])) === 108);

// 4. Same seed => same result (replayable)
const r1 = runBatch({ town, residents, mode: "service", policy: { hours: BASELINE_HOURS }, seeds: [7], days: 7 });
const r2 = runBatch({ town, residents, mode: "service", policy: { hours: BASELINE_HOURS }, seeds: [7], days: 7 });
check("deterministic replay", JSON.stringify(r1.mean) === JSON.stringify(r2.mean));

// 5. Perception: no channels => nobody aware
const none = createModel({ town, residents, mode: "perception", policy: { channels: [] }, seed: 3, days: 3 });
while (!none.done()) none.step();
check("no outreach => nobody aware", none.summary().awarePct === 0);

// Print headline numbers
const seeds = [...Array(20).keys()];
const show = (label, mode, policy, days) => { const r = runBatch({ town, residents, mode, policy, seeds, days }); console.log(label.padEnd(28), JSON.stringify(Object.fromEntries(Object.entries(r.mean).map(([k, v]) => [k, +v.toFixed(1)])))); };
console.log("restricted residents:", residents.filter((r) => r.restricted).length, "of", residents.length);
show("baseline", "service", { hours: BASELINE_HOURS }, 7);
show("Tue/Thu to 21", "service", { hours: hoursWith([[1, H(10), H(21)], [3, H(10), H(21)]]) }, 7);
show("Tue/Thu 13-21", "service", { hours: hoursWith([[1, H(13), H(21)], [3, H(13), H(21)]]) }, 7);
show("online only", "perception", { channels: ["online"] }, 3);
show("online+board", "perception", { channels: ["online", "board"] }, 3);
show("online+bulletin", "perception", { channels: ["online", "bulletin"] }, 3);
process.exit(fails ? 1 : 0);
