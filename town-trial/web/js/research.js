// The research loop as seen from Heaven. In the demo the agents' words are
// scripted, but every number comes from real batch runs of sim.js, and every
// step is logged in the same event format the real backend will write.
import { demoVoices } from "./voices.js";
import { runBatch, hoursWith, hoursText, staffHours, BASELINE_HOURS, makeResidents } from "./sim.js";

const H = (h, m = 0) => h * 60 + m;
export const SEEDS = 16;       // matched seeds per experiment
export const SWEEP_BUDGET = 6; // runs the parameter sweep may spend

export function classify(prompt) {
  const p = prompt.toLowerCase();
  const perception = ["hear", "aware", "perception", "notice", "market", "campaign", "opinion", "outreach", "flyer", "advert", "know about", "find out", "word of mouth", "believe", "think about"];
  return perception.some((w) => p.includes(w)) ? "perception" : "service";
}

export function primary(mode) {
  return mode === "service"
    ? { key: "restrictedVisits", label: "visits/week by residents who can't make current hours", unit: "" }
    : { key: "familiesAwarePct", label: "% of working parents who heard within 3 days", unit: "%" };
}

export function createResearch({ mode, prompt, town, residents, emit, heaven, researchers, onChange, onView, setBusy }) {
  const city = town.name;
  const exps = [];
  const steps = [];
  let constraint = null;
  const P = primary(mode);
  const days = mode === "service" ? 7 : 3;

  const say = (id, text, station) => steps.push({ kind: "say", id, text, station, dur: 2.2 });
  const act = (fn, dur = 2.5) => steps.push({ kind: "act", fn, dur });
  const exp = (e) => { const x = { status: "queued", result: null, ...e }; exps.push(x); onChange(); return x; };
  const run = (x, seeds = SEEDS, tag = "") => {
    x.status = "running"; onChange();
    const res = runBatch({ town, residents, mode, policy: x.policy, seeds: [...Array(seeds).keys()], days });
    x.result = res;
    x.status = constraint && !constraint.ok(x) ? "infeasible" : "done";
    onChange();
    return res;
  };
  const fmt = (x) => x.result ? `${x.result.mean[P.key].toFixed(1)}${P.unit} ± ${x.result.sd[P.key].toFixed(1)}` : "-";
  const exa = (agent, query, kind, results, usedFor) => emit("EXA", { agent, query, search: kind, results, used_for: usedFor });

  // ---------------- service mode: library hours ----------------
  if (mode === "service") {
    const proposal = hoursWith([[1, H(10), H(21)], [3, H(10), H(21)]]);
    const shift = hoursWith([[1, H(13), H(21)], [3, H(13), H(21)]]);
    const shift3 = hoursWith([[1, H(13), H(21)], [3, H(13), H(21)], [5, H(12), H(20)]]);
    let E0, E1, E2, E3, E4;

    say("bo", "Writing the testable claim", "drafting");
    act(() => emit("CLAIM", { agent: "bo", claim: `In ${city}, opening the library until 21:00 on Tue and Thu increases weekly visits by residents who cannot use current hours.`, metric: P.label, constraint: "staff hours (unknown yet)", horizon: "1 week, 16 matched seeds", prompt }));
    say("eli", "Recalling memory for this town", "archive");
    act(() => emit("MEMORY_READ", { agent: "eli", query: `${city} library`, found: 0, note: "No prior facts for this town. Starting fresh." }));
    say("ada", "Searching: current library hours", "lookout");
    act(() => {
      exa("ada", `${city} public library opening hours`, "broad", [{ title: `${city} Public Library: hours and locations (FIXTURE)`, url: "fixture://library-hours", passage: "Mon-Sat 10:00-18:00. Closed Sunday." }], "Baseline hours for the simulator");
      heaven.drop(heaven.stations.lookout, town.byId.library, 3, 0x59c2ff);
    });
    say("ada", "Saving the baseline to shared memory", "archive");
    act(() => emit("MEMORY_WRITE", { agent: "ada", source_id: "fact-library-hours", kind: "fact", claim: "Library open Mon-Sat 10:00-18:00, closed Sun", effective: "2026-09-01", source: "fixture://library-hours" }));
    say("bo", "Reading Ada's fact, building runs", "archive");
    act(() => {
      emit("MEMORY_READ", { agent: "bo", source_id: "fact-library-hours", author: "ada", claim: "Library open Mon-Sat 10:00-18:00, closed Sun", used_for: "baseline policy E0" });
      E0 = exp({ id: "E0", label: "Current hours", role: "baseline", parent: null, policy: { hours: BASELINE_HOURS }, change: "none (current practice)" });
      E1 = exp({ id: "E1", label: "Your idea: Tue/Thu until 21:00", role: "user", parent: "E0", policy: { hours: proposal }, change: hoursText(proposal) });
      emit("PROPOSE", { agent: "bo", exp: "E1", parent: "E0", change: E1.change, why: "The user's proposal, translated into supported actions (open/close times)." });
    });
    say("cy", "Checking E1's assumptions", "court");
    act(() => emit("REVIEW", { agent: "cy", exp: "E1", ok: true, reason: "Supported actions only. Flag: needs 12 more staff hours a week, and staffing is an unverified input." }));
    say("dee", "Fanning E0 + E1 out to Modal", "portal");
    act(() => {
      emit("RUN_START", { agent: "dee", exps: ["E0", "E1"], seeds: SEEDS, workers: SEEDS * 2, where: "Modal (demo: in-browser)" });
      heaven.drop(heaven.stations.portal, town.byId.library, 12, 0x5be37d);
      setBusy(true);
    }, 1.5);
    act(() => {
      run(E0); run(E1);
      emit("RUN_DONE", { agent: "dee", exp: "E0", metric: P.key, value: fmt(E0), staff_hours: staffHours(E0.policy.hours), turned_away: E0.result.mean.turnedAway.toFixed(1) });
      emit("RUN_DONE", { agent: "dee", exp: "E1", metric: P.key, value: fmt(E1), staff_hours: staffHours(E1.policy.hours), turned_away: E1.result.mean.turnedAway.toFixed(1) });
      setBusy(false);
      onView(E1);
    });
    say("cy", "E1 works, but can we staff it?", "court");
    act(() => emit("FAILURE", { agent: "cy", exp: "E1", trace: `E1 beats E0 (${fmt(E1)} vs ${fmt(E0)}), but uses ${staffHours(E1.policy.hours)} staff hours vs ${staffHours(E0.policy.hours)}. The ranking depends on an input nobody has checked.`, next_question: "Is extra evening staffing allowed this fiscal year?" }));
    say("ada", "Failure-guided search: staffing", "lookout");
    act(() => {
      exa("ada", `${city} library board meeting minutes staffing budget evening hours 2026`, "failure-guided", [{ title: `${city} Library Board minutes, Oct 2026 (FIXTURE)`, url: "fixture://board-minutes", passage: "No additional staff hours approved for FY2027. Schedule changes must stay within current staffing." }], "Adds constraint: staff hours <= current (96/week)");
      heaven.drop(heaven.stations.lookout, town.byId.townhall, 3, 0x59c2ff);
    });
    act(() => {
      constraint = { text: "staff hours <= 96/week", ok: (x) => staffHours(x.policy.hours) <= 96 };
      emit("CONSTRAINT", { agent: "ada", constraint: constraint.text, source: "fixture://board-minutes", previous: "unknown", changes: ["E1 is now infeasible"] });
      emit("MEMORY_WRITE", { agent: "ada", source_id: "fact-staffing-cap", kind: "constraint", claim: "No new staff hours in FY2027", effective: "2026-10-14", supersedes: null, source: "fixture://board-minutes" });
      E1.status = "infeasible"; onChange();
    });
    say("bo", "Reading the cap, rethinking", "archive");
    act(() => {
      emit("MEMORY_READ", { agent: "bo", source_id: "fact-staffing-cap", author: "ada", claim: "No new staff hours in FY2027", used_for: "revision must keep staff hours at 96" });
      E2 = exp({ id: "E2", label: "Assume evening demand doubles", role: "revision", parent: "E1", policy: { hours: proposal }, change: "E1 + assume 2x evening demand" });
      emit("PROPOSE", { agent: "bo", exp: "E2", parent: "E1", change: E2.change, why: "A blog post says evening hours doubled visits elsewhere." });
    });
    say("cy", "Rejecting E2: not local evidence", "court");
    act(() => {
      E2.status = "rejected"; onChange();
      emit("REVIEW", { agent: "cy", exp: "E2", ok: false, reason: "Changes a demand input from an out-of-town anecdote with no local evidence. Results elsewhere are hypotheses, not model inputs." });
      E3 = exp({ id: "E3", label: "Shift Tue/Thu to 13:00-21:00", role: "revision", parent: "E1", policy: { hours: shift }, change: hoursText(shift), source: "fixture://board-minutes" });
      emit("PROPOSE", { agent: "bo", exp: "E3", parent: "E1", change: E3.change, why: "Same 96 staff hours: move the morning hours on Tue/Thu to the evening." });
    });
    say("cy", "E3 approved", "court");
    act(() => emit("REVIEW", { agent: "cy", exp: "E3", ok: true, reason: "Supported actions, staff hours unchanged (96)." }));
    say("dee", "Running E3", "portal");
    act(() => { emit("RUN_START", { agent: "dee", exps: ["E3"], seeds: SEEDS, workers: SEEDS, where: "Modal (demo: in-browser)" }); heaven.drop(heaven.stations.portal, town.byId.library, 8); }, 1.4);
    act(() => { run(E3); emit("RUN_DONE", { agent: "dee", exp: "E3", metric: P.key, value: fmt(E3), staff_hours: 96, turned_away: E3.result.mean.turnedAway.toFixed(1) }); onView(E3); });
    say("cy", "Inspecting E3's turned-away log", "court");
    act(() => emit("FAILURE", { agent: "cy", exp: "E3", trace: `Mornings lost on Tue/Thu cost some daytime visits. Many residents who work Saturdays are still turned away.`, next_question: "Would moving Saturday later reach them?" }));
    say("bo", "Proposing E4: add a later Saturday", "drafting");
    act(() => {
      E4 = exp({ id: "E4", label: "E3 + Saturday 12:00-20:00", role: "revision", parent: "E3", policy: { hours: shift3 }, change: hoursText(shift3) });
      emit("PROPOSE", { agent: "bo", exp: "E4", parent: "E3", change: E4.change, why: "Keeps 96 staff hours; targets Saturday workers seen in E3's trace." });
      emit("REVIEW", { agent: "cy", exp: "E4", ok: true, reason: "Supported actions, staff hours unchanged." });
    });
    act(() => { run(E4); emit("RUN_DONE", { agent: "dee", exp: "E4", metric: P.key, value: fmt(E4), staff_hours: staffHours(shift3), turned_away: E4.result.mean.turnedAway.toFixed(1) }); }, 2);

    // Baselines with matched budgets
    say("dee", "Running the baselines", "portal");
    act(() => {
      heaven.drop(heaven.stations.portal, town.byId.library, 12);
      const options = [];
      for (const days of [[1], [3], [5], [1, 3], [2, 4], [1, 3, 5], [0, 2], [4, 5]]) for (const open of [H(12), H(13)]) options.push(days.map((d) => [d, open, open + H(8)]));
      const sweep = options.slice(0, SWEEP_BUDGET).map((c, k) => ({ id: `S${k + 1}`, policy: { hours: hoursWith(c) }, change: hoursText(hoursWith(c)) }));
      let best = null;
      for (const s of sweep) { s.result = runBatch({ town, residents, mode, policy: s.policy, seeds: [...Array(SEEDS).keys()], days }); if (!best || s.result.mean[P.key] > best.result.mean[P.key]) best = s; }
      const SW = exp({ id: "SW", label: `Sweep best of ${SWEEP_BUDGET}`, role: "sweep", parent: "E0", policy: best.policy, change: best.change });
      run(SW);
      const OS = exp({ id: "OS", label: "One-shot proposal", role: "oneshot", parent: "E0", policy: { hours: hoursWith([[5, H(12), H(20)]]) }, change: "Sat 12:00-20:00 (single proposal, no feedback)" });
      run(OS);
      emit("RUN_DONE", { agent: "dee", exp: "SW", metric: P.key, value: fmt(SW), note: `best of ${SWEEP_BUDGET} sweep configs` });
      emit("RUN_DONE", { agent: "dee", exp: "OS", metric: P.key, value: fmt(OS) });
    }, 2.5);
    heldOutAndBrief(() => [E0, E1, exps.find((x) => x.id === "SW"), exps.find((x) => x.id === "OS"), [E3, E4].sort((a, b) => b.result.mean[P.key] - a.result.mean[P.key])[0]]);
  }

  // ---------------- perception mode: who hears the notice ----------------
  if (mode === "perception") {
    let P0, P1, P2, P3;
    say("bo", "Writing the testable claim", "drafting");
    act(() => emit("CLAIM", { agent: "bo", claim: `In ${city}, posting the new library hours online only reaches most working parents within 3 days.`, metric: P.label, constraint: "no paid ads", horizon: "3 days, 16 matched seeds", prompt }));
    say("eli", "Setting up past.dev audiences", "archive");
    act(() => {
      emit("AUDIENCE", { agent: "eli", op: "bulk_replace_identities", count: residents.length, note: "One synthetic identity per resident with traits: cohort, channel, neighborhood." });
      emit("AUDIENCE", { agent: "eli", op: "replace_audience", slug: "heard-library-notice", kind: "rule", rule: "heard_library_notice = true", members: 0 });
      emit("AUDIENCE", { agent: "eli", op: "replace_audience", slug: "working-parents", kind: "rule", rule: "cohort = families", members: residents.filter((r) => r.cohort === "families").length });
      emit("MEMORY_WRITE", { agent: "eli", source_id: "notice-library-hours", kind: "notice", claim: "New library hours notice", audience: "heard-library-notice", note: "Only residents in this audience can recall the notice." });
    });
    say("ada", "Searching: how this town gets news", "lookout");
    act(() => {
      exa("ada", `${city} library hours change announcement`, "broad", [{ title: `${city} Library news page (FIXTURE)`, url: "fixture://library-news", passage: "Hours updates are posted on the website and social media." }], "Baseline channel: online post");
      heaven.drop(heaven.stations.lookout, town.byId.library, 3, 0x59c2ff);
      P0 = exp({ id: "P0", label: "Online post only", role: "baseline", parent: null, policy: { channels: ["online"] }, change: "website + social post" });
    });
    say("dee", "Running P0 on Modal", "portal");
    act(() => { emit("RUN_START", { agent: "dee", exps: ["P0"], seeds: SEEDS, workers: SEEDS, where: "Modal (demo: in-browser)" }); heaven.drop(heaven.stations.portal, town.byId.plaza, 10); }, 1.4);
    act(() => { run(P0); emit("RUN_DONE", { agent: "dee", exp: "P0", metric: P.key, value: fmt(P0), overall: P0.result.mean.awarePct.toFixed(0) + "%" }); onView(P0); });
    say("cy", "Who did the notice miss?", "court");
    act(() => emit("FAILURE", { agent: "cy", exp: "P0", trace: `Only ${fmt(P0)} of working parents heard. Most parents are offline during the day and learn by word of mouth, if at all.`, next_question: "What channel reaches parents during the school run?" }));
    say("ada", "Failure-guided search: school channels", "lookout");
    act(() => {
      exa("ada", `${city} elementary school weekly family bulletin newsletter`, "failure-guided", [{ title: `${city} Elementary: Friday family folder (FIXTURE)`, url: "fixture://school-bulletin", passage: "A weekly bulletin goes home with every student on Fridays and by email to families." }], "New channel: school bulletin reaches families at drop-off/pickup");
      emit("MEMORY_WRITE", { agent: "ada", source_id: "fact-school-bulletin", kind: "fact", claim: "School sends a weekly family bulletin", source: "fixture://school-bulletin" });
      heaven.drop(heaven.stations.lookout, town.byId.school, 3, 0x59c2ff);
    });
    say("bo", "Using Ada's find: two revisions", "archive");
    act(() => {
      emit("MEMORY_READ", { agent: "bo", source_id: "fact-school-bulletin", author: "ada", claim: "School sends a weekly family bulletin", used_for: "revision P2" });
      P1 = exp({ id: "P1", label: "+ flyers at cafe, library, town hall", role: "revision", parent: "P0", policy: { channels: ["online", "board"] }, change: "online + paper flyers at the cafe, library and town hall" });
      P2 = exp({ id: "P2", label: "+ school bulletin", role: "revision", parent: "P0", policy: { channels: ["online", "bulletin"] }, change: "online + school bulletin", source: "fixture://school-bulletin" });
      emit("PROPOSE", { agent: "bo", exp: "P1", parent: "P0", change: P1.change, why: "Paper flyers where offline residents already go." });
      emit("PROPOSE", { agent: "bo", exp: "P2", parent: "P0", change: P2.change, why: "Reaches parents at drop-off, per Ada's source." });
      emit("REVIEW", { agent: "cy", exp: "P1", ok: true, reason: "Supported channel." });
      emit("REVIEW", { agent: "cy", exp: "P2", ok: true, reason: "Supported channel; source is local." });
    });
    act(() => {
      P3 = exp({ id: "P3", label: "Assume 90% open the email", role: "revision", parent: "P2", policy: { channels: ["online", "bulletin"] }, change: "P2 + assume 90% open rate" });
      emit("PROPOSE", { agent: "bo", exp: "P3", parent: "P2", change: P3.change, why: "Industry average says emails get read." });
      P3.status = "rejected"; onChange();
      emit("REVIEW", { agent: "cy", exp: "P3", ok: false, reason: "Open rate is not in any local source. Keep it as a labelled sensitivity range, not an input." });
    });
    say("dee", "Running P1 + P2", "portal");
    act(() => { emit("RUN_START", { agent: "dee", exps: ["P1", "P2"], seeds: SEEDS, workers: SEEDS * 2, where: "Modal (demo: in-browser)" }); heaven.drop(heaven.stations.portal, town.byId.school, 12); }, 1.4);
    act(() => {
      run(P1); run(P2);
      emit("RUN_DONE", { agent: "dee", exp: "P1", metric: P.key, value: fmt(P1), overall: P1.result.mean.awarePct.toFixed(0) + "%" });
      emit("RUN_DONE", { agent: "dee", exp: "P2", metric: P.key, value: fmt(P2), overall: P2.result.mean.awarePct.toFixed(0) + "%" });
      onView(P2);
    });
    act(() => {
      const combos = [["online", "board"], ["online", "bulletin"], ["online", "board", "bulletin"], ["board"], ["bulletin"], ["online"]].slice(0, SWEEP_BUDGET);
      let best = null;
      for (const c of combos) { const r = runBatch({ town, residents, mode, policy: { channels: c }, seeds: [...Array(SEEDS).keys()], days }); if (!best || r.mean[P.key] > best.r.mean[P.key]) best = { c, r }; }
      const SW = exp({ id: "SW", label: `Sweep best of ${combos.length}`, role: "sweep", parent: "P0", policy: { channels: best.c }, change: best.c.join(" + ") });
      run(SW);
      const OS = exp({ id: "OS", label: "One-shot proposal", role: "oneshot", parent: "P0", policy: { channels: ["online", "board"] }, change: "online + flyers (no feedback)" });
      run(OS);
      emit("RUN_DONE", { agent: "dee", exp: "SW", metric: P.key, value: fmt(SW), note: `best of ${combos.length} channel combos (uses 3 channels)` });
    }, 2.5);
    heldOutAndBrief(() => [P0, exps.find((x) => x.id === "SW"), exps.find((x) => x.id === "OS"), [P1, P2].sort((a, b) => b.result.mean[P.key] - a.result.mean[P.key])[0]]);
  }

  function heldOutAndBrief(getFinalists) {
    say("cy", "Freezing picks, testing held-out towns", "court");
    act(() => {
      const finalists = getFinalists().filter(Boolean);
      const scenarios = [
        { name: "Held-out A: more shift workers", seed: city + ":A", mix: { "night-shift": 0.2, "day-workers": 0.35 } },
        { name: "Held-out B: older town", seed: city + ":B", mix: { seniors: 0.3, students: 0.06 } },
        { name: "Held-out C: busier library", seed: city + ":C", interestMult: 0.7 },
      ];
      const table = scenarios.map((sc) => {
        const res = makeResidents(town, sc.seed, sc);
        const row = { scenario: sc.name };
        for (const f of finalists) {
          const r = runBatch({ town, residents: res, mode, policy: f.policy, seeds: [...Array(8).keys()].map((k) => 100 + k), days });
          row[f.id] = r.mean[P.key];
        }
        return row;
      });
      const roleName = { baseline: "current practice", user: "your idea", sweep: "parameter sweep", oneshot: "one-shot", revision: "iterative agent" };
      const heldOut = { finalists: finalists.map((f) => ({ id: f.id, label: f.label, role: roleName[f.role] || f.role, feasible: f.status !== "infeasible" })), table, metric: P.label };
      exps.heldOut = heldOut;
      onChange();
      emit("HELD_OUT", { agent: "cy", scenarios: scenarios.length, seeds: 8, finalists: finalists.map((f) => f.id), note: "Policies frozen before testing. Residents and seeds not seen during search." });
      heaven.drop(heaven.stations.portal, town.byId.plaza, 12);
    }, 3);
    say("bo", "Writing the decision brief", "drafting");
    act(() => {
      const feasible = exps.filter((x) => x.result && x.status === "done" && x.role !== "rejected");
      const best = feasible.sort((a, b) => b.result.mean[P.key] - a.result.mean[P.key])[0];
      best.best = true; onChange();
      const base = exps[0];
      emit("VOICES", { agent: "eli", exp: best.id, base: base.id, scripted: true, voices: demoVoices({ town, residents, mode, best, base, days }),
        note: "Scripted quotes from simulator numbers (each group's stance is computed from 4 matched seeds). They are not real residents." });
      emit("BRIEF", {
        agent: "bo", recommend: best.id, label: best.label,
        summary: `${best.label}: ${fmt(best)} vs ${fmt(base)} for current practice (${P.label}).`,
        assumptions: mode === "service" ? "Arrival patterns are synthetic; staffing cap from a fixture source." : "Channel use and word-of-mouth rates are synthetic.",
        pilot: mode === "service" ? "Pilot for 4 weeks; count evening visitors and ask whether they could have come before 18:00." : "Ask the school to include the notice for 2 weeks; survey parents at pickup.",
      });
      onView(best);
    });
  }

  // Step runner
  let i = 0, timer = 0, started = false;
  function update(dt) {
    if (i >= steps.length) return;
    const s = steps[i];
    if (!started) {
      started = true; timer = s.dur;
      if (s.kind === "say") {
        const r = researchers[s.id];
        if (s.station) r.moveTo(heaven.stations[s.station].stand);
        r.say(s.text, s.dur + 1.5);
      } else s.fn();
    }
    timer -= dt;
    if (timer <= 0) { i++; started = false; }
  }
  return { exps, update, done: () => i >= steps.length, primary: P, days };
}
