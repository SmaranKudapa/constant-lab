// Residents' point of view: a concrete everyday role for each resident (display only, drawn from their
// group, never used by the simulator), and the scripted per-group voices used in demo mode. Live mode
// gets LLM-written voices from the backend (VOICES event); in both, each group's stance comes from
// simulator numbers, not from the words.
import { createModel } from "./sim.js";

const ROLES = {
  "day-workers": ["Office worker", "Bank teller", "Mechanic", "Electrician", "Teacher", "Shop assistant", "Accountant"],
  families: ["Parent of two", "Single dad", "Mom of three", "Parent, works retail", "Parent, part-time nurse"],
  seniors: ["Retired teacher", "Retired farmer", "Grandparent", "Retired postal worker", "Widowed retiree"],
  students: ["High-school student", "College student", "Middle-schooler", "Community-college student"],
  "night-shift": ["Night-shift nurse", "Warehouse worker", "Security guard", "Baker (early shift)", "Factory worker"],
  remote: ["Remote developer", "Freelance designer", "Work-from-home accountant", "Online tutor"],
};
const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
export function roleOf(r) { const L = ROLES[r.cohort] || ["Resident"]; return L[hash(r.id) % L.length]; }

const WHY = {
  "day-workers": ["now I can go after work", "it's only open while I'm at work", "my hours haven't changed and neither has this"],
  families: ["it finally fits around the school run", "it's harder to fit around the kids now", "I still can't fit it around the kids"],
  seniors: ["it's easier for me to get there", "I've lost the times I used to go", "I already go during the day"],
  students: ["I can come after class", "it's closed when I'm out of school", "can't make it, I'm in class until then"],
  "night-shift": ["it's open when I'm awake", "it's closed whenever I'm free", "I'm asleep when it's open"],
  remote: ["I can slot it into my day", "it's less convenient for me now", "I can go anytime anyway"],
};
const LABEL = { "day-workers": "Day workers", families: "Working parents", seniors: "Seniors", students: "Students", "night-shift": "Night shift", remote: "Remote workers" };
const STANCES = ["helped", "hurt", "unchanged"];
const ROLE1 = { "day-workers": "Office worker", families: "Parent of two", seniors: "Retired teacher", students: "High-school student", "night-shift": "Night-shift nurse", remote: "Remote developer" };
const stanceOf = (b, a) => (Math.abs(a - b) < Math.max(0.25, 0.05 * Math.abs(b)) ? "unchanged" : a > b ? "helped" : "hurt");

// Demo mode: per-group visits (or awareness) for best vs baseline over a few matched seeds, then scripted quotes.
export function demoVoices({ town, residents, mode, best, base, days }) {
  const per = (policy) => {
    const tot = {}, seeds = [0, 1, 2, 3];
    for (const seed of seeds) {
      const m = createModel({ town, residents, mode, policy, seed, days });
      while (!m.done()) m.step();
      const src = mode === "perception" ? m.state.metrics.awareByCohort : m.state.metrics.byCohort;
      for (const [c, v] of Object.entries(src)) tot[c] = (tot[c] || 0) + v / seeds.length;
    }
    if (mode === "perception") for (const c in tot) tot[c] = (100 * tot[c]) / (residents.filter((r) => r.cohort === c).length || 1);
    return tot;
  };
  const b = per(base.policy), a = per(best.policy);
  return Object.keys(LABEL).filter((c) => residents.some((r) => r.cohort === c)).map((c) => {
    const before = +(b[c] || 0).toFixed(1), after = +(a[c] || 0).toFixed(1), stance = stanceOf(before, after);
    return { cohort: c, label: LABEL[c], role: ROLE1[c], stance, before, after, unit: mode === "perception" ? "% heard about it" : "visits/week",
      quote: { helped: "Good news: ", hurt: "Not great: ", unchanged: "Doesn't change much: " }[stance] + WHY[c][STANCES.indexOf(stance)] + "." };
  });
}

// Short in-town reactions for the replay, from what just happened to the resident in the simulator.
export function reaction(kind, r, voice) {
  if (voice && Math.random() < 0.5) return voice.quote;
  const L = {
    visit: ["Made it!", "Perfect timing.", "Glad it's open."],
    restricted: ["Finally open when I'm free!", "Couldn't come before. Now I can!", "This works with my shift."],
    turned: ["Closed?! Again?", "Can't make it.", "Too full, I'll come back."],
    heard: ["Oh, I didn't know that!", "Good to know.", "Heard about it!"],
  }[kind] || ["Hmm."];
  return L[hash(r.id + kind + Math.floor(Date.now() / 4000)) % L.length];
}
