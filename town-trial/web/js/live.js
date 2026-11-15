// Live mode: the research loop runs on the backend (Modal) and this module
// replays its event log in the browser. Used only when window.TOWN_TRIAL_API
// is set; demo mode (research.js) is untouched.
//
// Returns the same shape main.js expects from createResearch:
//   { exps, update(dt), done(), primary, days, mode, stop() }
// The town replay (seed 0, same residents via layout.js) stays in the browser.

const STATION = {
  EXA: "lookout", CONSTRAINT: "lookout",
  MEMORY_WRITE: "archive", MEMORY_READ: "archive", AUDIENCE: "archive",
  CLAIM: "drafting", PROPOSE: "drafting", BRIEF: "drafting",
  REVIEW: "court", FAILURE: "court", HELD_OUT: "court",
  RUN_START: "portal", RUN_DONE: "portal",
};
const STATE_EVENTS = new Set(["EXPERIMENT", "HELD_OUT_TABLE"]); // rebuild panels, not log cards
const POLL_MS = 1000;
const STEP_SEC = 1.6; // pacing between visible events, like the demo

async function request(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).detail || ""; } catch { /* not JSON */ }
    throw new Error(`${res.status} ${detail || res.statusText}`);
  }
  return res.json();
}

export async function createLive({ api, city, prompt, emit, heaven, researchers, town, onChange, onView, onError }) {
  const base = api.replace(/\/+$/, "");
  const start = await request(`${base}/api/trials`, { method: "POST", body: JSON.stringify({ city, prompt }) });
  const { trial_id: id, mode, primary } = start;
  const exps = [];
  const queue = [];
  let since = 0, serverDone = false, failures = 0, timer = 0, stopped = false, pollT = null;

  async function poll() {
    if (stopped) return;
    try {
      const r = await request(`${base}/api/trials/${id}/events?since=${since}`);
      failures = 0;
      for (const e of r.events) { queue.push(e); since = Math.max(since, e.seq); }
      serverDone = r.done;
    } catch (err) {
      if (++failures >= 3) { stopped = true; onError(err); return; }
    }
    if (!serverDone) pollT = setTimeout(poll, POLL_MS);
  }
  poll();

  function upsert(e) {
    const { seq, t, type, clock, ...x } = e;
    const i = exps.findIndex((q) => q.id === x.id);
    if (i >= 0) Object.assign(exps[i], x); else exps.push(x);
  }

  function animate(e) {
    const r = e.agent && researchers[e.agent];
    if (!r) return;
    const st = STATION[e.type];
    if (st) r.moveTo(heaven.stations[st].stand);
    r.say(e.say || `${e.type.replace("_", " ")}${e.exp ? " " + e.exp : ""}`, STEP_SEC + 1.5);
    if (e.type === "EXA") heaven.drop(heaven.stations.lookout, town.byId.library, 3, 0x59c2ff);
    if (e.type === "RUN_START") heaven.drop(heaven.stations.portal, town.byId.library, 12, 0x5be37d);
  }

  function apply(e) {
    if (e.type === "EXPERIMENT") { upsert(e); onChange(); return false; }
    if (e.type === "HELD_OUT_TABLE") { exps.heldOut = { finalists: e.finalists, table: e.table, metric: e.metric }; onChange(); return false; }
    const { seq, t, clock, type, ...fields } = e;
    emit(type, fields);
    animate(e);
    const view = e.type === "BRIEF" ? e.recommend : e.view;
    if (view) { const x = exps.find((q) => q.id === view); if (x && x.result) onView(x); }
    return true;
  }

  function update(dt) {
    timer -= dt;
    // Apply state events immediately; pace the visible ones so the researchers can act them out.
    while (queue.length && (STATE_EVENTS.has(queue[0].type) || timer <= 0)) {
      const visible = apply(queue.shift());
      if (visible) { timer = queue.length > 25 ? 0.25 : STEP_SEC; break; }
    }
  }

  return {
    exps, update, primary, mode, id,
    days: mode === "service" ? 7 : 3,
    done: () => serverDone && !queue.length,
    stop: () => { stopped = true; clearTimeout(pollT); return request(`${base}/api/trials/${id}/stop`, { method: "POST" }).catch(() => {}); },
  };
}
