import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildTown, windowMat, libraryWindowMat, lampMat } from "./town.js";
import { townFingerprint, residentScenario } from "./layout.js";
import { Resident, Researcher } from "./people.js";
import { buildHeaven, HEAVEN_Y, RESEARCHERS } from "./heaven.js";
import { makeResidents, createModel, TICKS_PER_DAY, BASELINE_HOURS } from "./sim.js";
import { createResearch, classify } from "./research.js";
import { createLive } from "./live.js";
import * as UI from "./ui.js";
import { box } from "./voxel.js";
import { buildSummary } from "./summary.js";
import { openSummary, closeSummary, remember, initHistory } from "./popup.js";
import { createCelebration } from "./celebrate.js";
import { ANGEL_SCALE } from "./people.js";
import { roleOf, reaction } from "./voices.js";
import { createHover } from "./hover.js";
import { createSky } from "./sky.js";

const PIX = 3;            // render at 1/3 resolution, scale up with nearest-neighbour
const TICK_SEC = 1.6;     // real seconds per 10 simulated minutes at 1x
const START_TICK = 7 * 6; // start the replay at Mon 07:00
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

// ---------- renderer / scene ----------
const canvas = $("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const sky = new THREE.Color(0x8fd3ff);
scene.background = sky;
scene.fog = new THREE.Fog(sky, 170, 380);
const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 900);
camera.position.set(95, 80, 110);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = 1.38;
controls.minDistance = 8;
controls.maxDistance = 280;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.6;

const hemi = new THREE.HemisphereLight(0xffffff, 0x6a5a8a, 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2d6, 2.2);
sun.position.set(60, 120, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 10, far: 300 });
scene.add(sun);
const skyDome = createSky(scene, { sun, hemi });

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(1);
  renderer.setSize(Math.max(1, Math.floor(w / PIX)), Math.max(1, Math.floor(h / PIX)), false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// ---------- state ----------
let town = null, residents = [], views = {}, model = null, mode = null, research = null;
let viewExp = null, speed = 1, tickAcc = 0, inTown = false, selected = null, follow = false;
let events = [], flashSlug = null, lastPanel = 0;
let trialPrompt = "", briefAt = 0, summaryDone = true, cheering = false, voicesFor = null, devMode = false;
const heaven = buildHeaven(scene);
const researchers = {};
for (const spec of RESEARCHERS) {
  const st = heaven.stations[spec.station];
  researchers[spec.id] = new Researcher({ ...spec, home: { ...st.stand }, y: HEAVEN_Y }, scene);
}

const celebration = createCelebration({ scene, heavenY: HEAVEN_Y });
const hover = createHover(scene);

// selection marker
const marker = new THREE.Group();
const mMat = new THREE.MeshBasicMaterial({ color: 0xffd34d });
for (const [w, d, x, z] of [[2, 0.2, 0, -1], [2, 0.2, 0, 1], [0.2, 2, -1, 0], [0.2, 2, 1, 0]]) marker.add(box(w, 0.1, d, 0, x, 0.05, z, mMat));
marker.visible = false;
scene.add(marker);

// ---------- events ----------
function emit(type, fields) {
  const e = { seq: events.length + 1, t: new Date().toISOString(), type, clock: model ? UI.clockText(model.state.tick, TICKS_PER_DAY) : "", ...fields };
  events.push(e);
  if (type === "AUDIENCE") { flashSlug = fields.slug; setTimeout(() => (flashSlug = null), 700); }
  if (type === "VOICES") voicesFor = { exp: fields.exp, byCohort: Object.fromEntries((fields.voices || []).map((v) => [v.cohort, v])) };
  if (fields.resident && (type === "VISIT" || type === "TURNED_AWAY" || type === "LEARN")) residentSay(fields.resident, type === "TURNED_AWAY" ? "turned" : type === "LEARN" ? "heard" : fields.restricted ? "restricted" : "visit");
  if (type === "BRIEF" && research !== undefined) { briefAt = performance.now(); if (fields.recommend && fields.recommend !== "none") celebrate(); }
  const log = $("log");
  log.insertAdjacentHTML("afterbegin", UI.entryHTML(e));
  while (log.children.length > 250) log.lastElementChild.remove();
  return e;
}

// ---------- town ----------
// Real town data (OSM + Census) from the backend, when one is configured. Returns null for the synthetic town.
let townSpec = null, townNote = "";
async function loadSpec(name) {
  const api = window.TOWN_TRIAL_API;
  if (!api) return null;
  const base = api.replace(/\/+$/, "");
  const t0 = performance.now();
  while (performance.now() - t0 < 240000) {
    const r = await fetch(`${base}/api/towns?city=${encodeURIComponent(name)}`);
    if (!r.ok) throw new Error(`${r.status}`);
    const d = await r.json();
    if (d.status === "ready") return d.spec;
    if (d.status === "error") throw new Error(d.error);
    toast(`Fetching real map data for ${name} from OpenStreetMap... (${Math.round((performance.now() - t0) / 1000)} s; first visit to a town can take a minute)`, 6000);
    await new Promise((res) => setTimeout(res, 3000));
  }
  throw new Error("timed out");
}

async function makeTown(name, real = false) {
  let spec = null;
  townNote = "";
  if (real) {
    try { spec = await loadSpec(name); }
    catch (err) { townNote = `Couldn't load real map data (${err.message}); this is a synthetic town.`; }
  }
  townSpec = spec;
  if (town) {
    scene.remove(town.group);
    for (const v of Object.values(views)) scene.remove(v.mesh);
  }
  town = buildTown(name, spec);
  scene.add(town.group);
  for (const b of town.buildings) if (b.mesh) b.mesh.traverse((o) => { if (o.isMesh) o.userData.pick = { kind: "building", id: b.id }; });
  residents = makeResidents(town, name, residentScenario(spec));
  views = {};
  for (const r of residents) views[r.id] = new Resident(r, town, scene);
  research = null; mode = null; viewExp = null; events = [];
  endCelebration(); summaryDone = true; hover.set(null);
  $("log").innerHTML = "";
  startReplay(null);
  buildLabels();
}

function startReplay(exp) {
  viewExp = exp;
  const m = mode || "service";
  const policy = exp ? exp.policy : m === "perception" ? { channels: ["online"] } : m === "town" ? { target: research && research.primary && research.primary.target } : { hours: BASELINE_HOURS };
  const live = !!mode;
  const days = research && research.days ? research.days : m === "perception" ? 3 : 7;
  const incomeFactor = townSpec && townSpec.census && townSpec.census.median_income ? townSpec.census.median_income / 70000 : 1;
  model = createModel({ town, residents, mode: m, policy, seed: 0, days, emit: live ? emit : null, incomeFactor });
  for (let k = 0; k < START_TICK; k++) model.step();
  // Teleport everyone to where the model says they are
  for (const s of model.S) {
    const v = views[s.r.id];
    v.path = null; v.at = s.at; v.queueIdx = -1;
    v.pos = { x: s.at.door.x + (Math.random() - 0.5), z: s.at.door.z + (Math.random() - 0.5) };
    v.mesh.visible = !!s.at.outdoor;
  }
  refreshIcons();
  updateRunbar();
}

function stepModel() {
  if (!model) return;
  if (model.done()) { startReplay(viewExp); return; }
  const changes = model.step();
  const arrive = (TICK_SEC / Math.max(1, speed)) * 1.5;
  for (const c of changes) {
    const v = views[c.s.r.id];
    if (c.turned) { v.turnedT = 3; continue; }
    if (c.served) { v.servedT = 2.5; if (v.at === c.b && !v.path) { v.queueIdx = -1; v.mesh.visible = false; } continue; }
    if (c.queue) continue;
    v.goTo(c.b, arrive);
  }
  model.state.queue.forEach((s, i) => views[s.r.id].setQueue(i));
  refreshIcons();
}

function refreshIcons() {
  if (!model) return;
  for (const s of model.S) {
    const v = views[s.r.id];
    let icon = null;
    if (mode === "perception" || (mode === "town" && research && research.awareness)) icon = s.aware ? "aware" : "unaware";
    else if (mode === "service" || mode === "town") {
      if (v.turnedT > 0) icon = "turned";
      else if (s.libState === "going") icon = "going";
      else if (s.libState === "queue") icon = "waiting";
      else if (v.servedT > 0) icon = "served";
    }
    v.setIcon(icon);
  }
}

// ---------- celebration + results ----------
function winningPlace() {
  const P = research && research.primary;
  return (P && P.target && town.byId[P.target]) || town.byId.library || town.byId.plaza || { x: 0, z: 0 };
}
function celebrate() {
  const b = winningPlace();
  cheering = true;
  celebration.start({ target: { x: b.x, z: b.z }, townGroup: town.group, angels: Object.values(researchers) });
  for (const r of Object.values(researchers)) r.cheer = true;
  flyTo(new THREE.Vector3(b.x + 55, 62, b.z + 75), new THREE.Vector3(b.x * 0.5, 4, b.z * 0.5), 2.2);
  setView("town");
  const ban = $("celebrate-banner");
  ban.classList.remove("hidden");
  ban.firstElementChild.style.animation = "none"; void ban.offsetWidth; ban.firstElementChild.style.animation = "";
  setTimeout(() => ban.classList.add("hidden"), 2900);
}
function endCelebration() {
  cheering = false;
  celebration.clear();
  for (const r of Object.values(researchers)) r.cheer = false;
  $("celebrate-banner").classList.add("hidden");
}
function screenOf(p) {
  const v = new THREE.Vector3(p.x, 4, p.z).project(camera);
  return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight };
}
function finishTrial() {
  summaryDone = true;
  const sum = buildSummary({ prompt: trialPrompt, city: town.name, mode, events, exps: research.exps, primary: research.primary });
  remember(sum);
  openSummary(sum, screenOf(winningPlace()));
}

// ---------- residents' point of view: short reaction bubbles ----------
const saySlots = [];
let lastSay = 0;
function residentSay(id, kind) {
  const v = views[id], now = performance.now();
  if (!v || now - lastSay < 900 / Math.max(1, Math.sqrt(speed))) return;
  const slot = saySlots.find((q) => q.until < now);
  if (!slot) return;
  const voice = voicesFor && viewExp && viewExp.id === voicesFor.exp ? voicesFor.byCohort[v.data.cohort] : null;
  if (!voice && kind === "visit" && Math.random() < 0.6) return; // ordinary visits are common; keep the chatter readable
  lastSay = now;
  slot.until = now + 3600;
  slot.pos = new THREE.Vector3(v.pos.x, 3.4, v.pos.z);
  slot.html = `<b>${UI.esc(v.data.name)} · ${UI.esc(roleOf(v.data))}</b>${UI.esc(reaction(kind, v.data, voice))}`;
  slot.cls = `lbl say ${kind === "turned" ? "hurt" : voice ? voice.stance : kind === "restricted" ? "helped" : ""}`;
}

// ---------- day / night ----------
function lighting() {
  // Smooth clock between simulator ticks so the sun glides instead of stepping every 10 minutes
  const m = model ? (model.state.tick % TICKS_PER_DAY) * 10 + Math.min(1, tickAcc / TICK_SEC) * 10 : 12 * 60;
  const h = params.has("hour") ? +params.get("hour") : (m / 60) % 24; // ?hour=18.5 pins the time of day (screenshots, testing)
  const night = skyDome.update(h, camera, scene.fog);
  scene.background = null;
  const dl = 1 - night;
  windowMat.emissiveIntensity = night * 0.95;
  lampMat.emissiveIntensity = Math.min(1, night * 1.4) * 1.3;
  const open = model && town ? model.isOpen(Math.floor(model.state.tick / TICKS_PER_DAY) % 7, m) : false;
  libraryWindowMat.emissiveIntensity = open ? 0.35 + (1 - dl) * 0.9 : 0;
  libraryOpen = open;
}
let libraryOpen = false;

// ---------- labels ----------
let labels = [];
function buildLabels() {
  const root = $("labels");
  root.innerHTML = "";
  labels = [];
  const add = (text, getPos, cls = "lbl") => {
    const el = document.createElement("div");
    el.className = cls; el.textContent = text;
    root.appendChild(el);
    const L = { el, getPos, text };
    labels.push(L);
    return L;
  };
  const lib = town.byId.library;
  if (lib) {
    const libL = add("LIBRARY", () => new THREE.Vector3(lib.x, (lib.h || 7) + 2.5, lib.z), "lbl sign");
    const libName = town.real ? lib.name.toUpperCase() : "LIBRARY";
    libL.update = () => { libL.el.textContent = `${libName} · ${libraryOpen ? "OPEN" : "CLOSED"}`; libL.el.className = `lbl ${libraryOpen ? "open" : "closed"}`; };
  }
  // Real towns: label the public places by their real names; synthetic towns: the two landmarks.
  const labelled = town.real ? town.buildings.filter((b) => b.public && b.id !== "library" && (b.kind !== "school" || b.id === "school")).slice(0, 8)
    : ["townhall", "park"].map((id) => town.byId[id]).filter(Boolean);
  for (const b of labelled) add(b.name.toUpperCase(), () => new THREE.Vector3(b.x, (b.h || 0) + 6, b.z));
  for (const st of Object.values(heaven.stations)) add(st.label, () => new THREE.Vector3(st.x, st.labelY, st.z), "lbl sign");
  for (const r of Object.values(researchers)) {
    const L = add("", () => new THREE.Vector3(r.pos.x, r.y + 2.3 * ANGEL_SCALE + 0.6, r.pos.z), "bubble");
    L.update = () => { L.el.style.display = r.bubble ? "" : "none"; if (r.bubble) L.el.textContent = `${r.spec.name}: ${r.bubble}`; };
    const N = add(r.spec.name.toUpperCase(), () => new THREE.Vector3(r.pos.x, r.y + 2.3 * ANGEL_SCALE, r.pos.z), "lbl");
    N.update = () => { N.el.style.display = r.bubble ? "none" : ""; };
  }
  saySlots.length = 0;
  for (let k = 0; k < 5; k++) {
    const slot = { until: 0, pos: new THREE.Vector3(0, -999, 0), html: "", cls: "lbl say", shown: "" };
    const L = add("", () => slot.pos, "lbl say");
    L.update = () => {
      const on = slot.until > performance.now();
      L.el.style.display = on ? "" : "none";
      if (on && slot.shown !== slot.html) { L.el.innerHTML = slot.html; L.el.className = slot.cls; slot.shown = slot.html; }
    };
    saySlots.push(slot);
  }
  const sel = add("", () => selectedPos() || new THREE.Vector3(0, -999, 0), "lbl sign");
  sel.update = () => { sel.el.style.display = selected && selected.kind === "resident" ? "" : "none"; if (selected && selected.kind === "resident") sel.el.textContent = `${views[selected.id].data.name} · ${roleOf(views[selected.id].data)}`; };
}
const tmpV = new THREE.Vector3();
function placeLabels() {
  const w = window.innerWidth, h = window.innerHeight;
  for (const L of labels) {
    if (L.update) L.update();
    if (L.el.style.display === "none") continue;
    tmpV.copy(L.getPos());
    const dist = tmpV.distanceTo(camera.position);
    tmpV.project(camera);
    const vis = tmpV.z < 1 && Math.abs(tmpV.x) < 1.1 && Math.abs(tmpV.y) < 1.1 && dist < 240;
    L.el.style.visibility = vis ? "visible" : "hidden";
    if (vis) { L.el.style.left = `${((tmpV.x + 1) / 2) * w}px`; L.el.style.top = `${((1 - tmpV.y) / 2) * h}px`; }
  }
}

// ---------- camera moves ----------
let fly = null;
function flyTo(pos, target, dur = 1.6) {
  fly = { t: 0, dur, p0: camera.position.clone(), t0: controls.target.clone(), p1: pos.clone(), t1: target.clone() };
}
const TOWN_VIEW = () => flyTo(new THREE.Vector3(70, 72, 92), new THREE.Vector3(0, 0, 0));
const HEAVEN_VIEW = () => flyTo(new THREE.Vector3(48, HEAVEN_Y + 44, 66), new THREE.Vector3(0, HEAVEN_Y - 2, 0));

// ---------- picking ----------
const ray = new THREE.Raycaster();
let downAt = null;
canvas.addEventListener("pointerdown", (e) => (downAt = { x: e.clientX, y: e.clientY }));
function pickAt(x, y) {
  const ndc = new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const targets = [...Object.values(views).filter((v) => v.mesh.visible).map((v) => v.mesh), ...Object.values(researchers).map((r) => r.mesh), heaven.group, town.group];
  const hits = ray.intersectObjects(targets, true);
  for (const h of hits) {
    let o = h.object;
    while (o && !o.userData.pick) o = o.parent;
    if (o) return { pick: o.userData.pick, obj: o };
  }
  return null;
}
// The whole clickable thing (a resident, an angel, a building, a station) for the hover highlight
function pickRoot(hit) {
  const p = hit.pick;
  if (p.kind === "resident") return views[p.id] && views[p.id].mesh;
  if (p.kind === "researcher") return researchers[p.id] && researchers[p.id].mesh;
  if (p.kind === "building") return (town.byId[p.id] && town.byId[p.id].mesh) || null;
  if (p.kind === "station") { let o = hit.obj; while (o.parent && o.parent !== heaven.group) o = o.parent; return o; }
  return null;
}
canvas.addEventListener("pointerup", (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6 || !inTown) return;
  const hit = pickAt(e.clientX, e.clientY);
  if (hit) select(hit.pick);
});
let hoverAt = null;
canvas.addEventListener("pointermove", (e) => { hoverAt = e.buttons ? null : { x: e.clientX, y: e.clientY }; });
canvas.addEventListener("pointerleave", () => { hoverAt = null; hover.set(null); });
let lastHover = 0;
function updateHover(t) {
  if (!inTown || !$("landing").classList.contains("hidden")) { hover.set(null); return; }
  const now = performance.now();
  if (hoverAt && now - lastHover > 70) {
    lastHover = now;
    const hit = pickAt(hoverAt.x, hoverAt.y);
    hover.set(hit ? pickRoot(hit) : null);
  } else if (!hoverAt) hover.set(null);
  hover.update(t);
}

function select(pick) {
  selected = pick;
  follow = pick && pick.kind === "resident";
  renderSelected();
}
function selectedPos() {
  if (!selected) return null;
  if (selected.kind === "resident") { const v = views[selected.id]; return v.mesh.visible ? new THREE.Vector3(v.pos.x, 2.6, v.pos.z) : null; }
  if (selected.kind === "researcher") { const r = researchers[selected.id]; return new THREE.Vector3(r.pos.x, r.y, r.pos.z); }
  if (selected.kind === "building") { const b = town.byId[selected.id]; return new THREE.Vector3(b.x, 0, b.z); }
  if (selected.kind === "station") { const s = heaven.stations[selected.id]; return new THREE.Vector3(s.x, HEAVEN_Y, s.z); }
  return null;
}
function renderSelected() {
  const el = $("selected");
  if (!selected) { el.classList.add("hidden"); el._html = null; marker.visible = false; return; }
  el.classList.remove("hidden");
  $("side").classList.remove("collapsed");
  let html = "";
  if (selected.kind === "resident") { const v = views[selected.id]; html = UI.residentHTML(v.data, model && model.S.find((s) => s.r.id === selected.id), mode, events); }
  else if (selected.kind === "researcher") html = UI.researcherHTML(researchers[selected.id].spec, events);
  else if (selected.kind === "station") html = UI.stationHTML(selected.id, heaven.stations[selected.id].label, events);
  else if (selected.kind === "building") html = UI.buildingHTML(town.byId[selected.id], model, events);
  if (el._html !== html) { const top = el.scrollTop; el.innerHTML = html; el._html = html; el.scrollTop = top; }
}
$("selected").addEventListener("click", (e) => { if (e.target.closest("[data-close]")) select(null); });

// ---------- panels ----------
function renderPanels(force = false) {
  const now = performance.now();
  if (!force && now - lastPanel < 400) return;
  lastPanel = now;
  if (research) $("tab-exp").innerHTML = UI.experimentsHTML(research.exps, viewExp && viewExp.id, research.primary, events, openWhy);
  $("tab-aud").innerHTML = UI.audiencesHTML(mode || "service", model, residents, flashSlug);
  if (selected) renderSelected();
}
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === t));
  for (const id of ["log", "exp", "aud"]) $("tab-" + id).classList.toggle("hidden", id !== t.dataset.tab);
  renderPanels(true);
}));
const openWhy = new Set(); // experiments whose reasoning panel is open
$("tab-exp").addEventListener("click", (e) => {
  const why = e.target.closest("[data-why]");
  if (why) { const id = why.dataset.why; openWhy.has(id) ? openWhy.delete(id) : openWhy.add(id); renderPanels(true); return; }
  if (e.target.closest(".why-panel")) return; // reading the reasoning (or clicking a source link) doesn't start a replay
  const card = e.target.closest("[data-exp]");
  if (!card || !research) return;
  const x = research.exps.find((q) => q.id === card.dataset.exp);
  if (x && x.result) { startReplay(x); toast(`Replaying ${x.id}: ${x.label}`); renderPanels(true); }
});

function viewable() { return research ? research.exps.filter((x) => x.result) : []; }
function updateRunbar() {
  const list = viewable();
  $("runbar").classList.toggle("hidden", !research);
  $("run-label").textContent = viewExp ? `Watching ${viewExp.id}: ${viewExp.label} (seed 0)` : mode ? "Watching: starting conditions" : "";
  $("run-prev").disabled = list.length < 2; $("run-next").disabled = list.length < 2;
}
function cycleRun(dir) {
  const list = viewable();
  if (!list.length) return;
  let i = list.indexOf(viewExp);
  i = (i + dir + list.length) % list.length;
  startReplay(list[i]);
  renderPanels(true);
}
$("run-prev").addEventListener("click", () => cycleRun(-1));
$("run-next").addEventListener("click", () => cycleRun(1));

// ---------- controls ----------
document.querySelectorAll("[data-speed]").forEach((b) => b.addEventListener("click", () => {
  speed = +b.dataset.speed;
  document.querySelectorAll("[data-speed]").forEach((x) => x.classList.toggle("active", x === b));
}));
$("view-town").addEventListener("click", () => { TOWN_VIEW(); setView("town"); });
$("view-heaven").addEventListener("click", () => { HEAVEN_VIEW(); setView("heaven"); });
function setView(v) { $("view-town").classList.toggle("active", v === "town"); $("view-heaven").classList.toggle("active", v === "heaven"); follow = false; }
$("toggle-panel").addEventListener("click", () => $("side").classList.toggle("collapsed"));

let toastT = null;
function toast(msg, ms = 3200) {
  const t = $("toast");
  t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.add("hidden"), ms);
}

// Landing
document.querySelectorAll("[data-city]").forEach((a) => a.addEventListener("click", () => { $("city-input").value = a.dataset.city; }));
$("city-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("city-input").value.trim() || "Anytown";
  if (name.toUpperCase() === "DEV67") { // dev mode: the sample town and the scripted demo loop, no backend
    devMode = true; liveDisabled = true;
    await enterTown("Anytown", false);
    return;
  }
  await enterTown(name);
});
async function enterTown(name, real = true) {
  await makeTown(name, real);
  $("town-name").textContent = name.toUpperCase();
  $("landing").classList.add("hidden");
  $("hud").classList.remove("hidden");
  controls.autoRotate = false;
  inTown = true;
  TOWN_VIEW();
  const sp = townSpec;
  setBanner(!!window.TOWN_TRIAL_API && !liveDisabled);
  toast(sp ? `Built ${sp.display_name.split(",").slice(0, 2).join(",")}: ${sp.places.length} real places, ${residents.length} residents` +
             (sp.population ? ` (each represents ~${Math.round(sp.population / residents.length)} people; mix: ${sp.census ? "Census" : "model default"}).` : ".") +
             " Type an idea below to test it." :
             `${townNote ? townNote + " " : ""}Built ${name}: ${residents.length} residents. Type an idea below to test it.`, 7000);
}

// Prompt
document.querySelectorAll("[data-prompt]").forEach((c) => c.addEventListener("click", () => { $("prompt-input").value = c.dataset.prompt; }));
$("prompt-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const prompt = $("prompt-input").value.trim();
  if (!prompt) { toast("Type a policy idea first, or pick an example."); return; }
  trialPrompt = prompt;
  startTrial(prompt);
});
// Live mode: the backend (Modal) runs the research loop when TOWN_TRIAL_API is set.
// Any network error offers to continue in demo mode, which needs no backend.
let liveDisabled = false;
const DEMO_BANNER = $("demo-banner").textContent;
const LIVE_BANNER = "LIVE: research loop on the backend. Scripted steps and FIXTURE sources are labelled in the log.";
function setBanner(live) {
  $("demo-banner").textContent = (devMode ? "DEV MODE (DEV67): sample town, scripted demo loop, no backend. " : "") + (live ? LIVE_BANNER : DEMO_BANNER) +
    (townSpec ? " · REAL TOWN (streets schematic) · Map data © OpenStreetMap contributors" : "");
}
function startTrial(prompt) {
  if (window.TOWN_TRIAL_API && !liveDisabled) { startLiveTrial(prompt); return; }
  setBanner(false);
  beginTrial(classify(prompt));
  research = createResearch({
    mode, prompt, town, residents, emit, heaven, researchers,
    onChange: () => renderPanels(true),
    onView: (x) => { startReplay(x); renderPanels(true); },
    setBusy: (b) => b && toast("Dee is fanning experiments out to Modal..."),
  });
  afterTrialStart();
}
async function startLiveTrial(prompt) {
  if (research && research.stop) research.stop();
  toast("Starting a live trial on the backend...");
  try {
    const live = await createLive({
      api: window.TOWN_TRIAL_API, city: town.name, prompt, emit, heaven, researchers, town,
      onChange: () => renderPanels(true),
      onView: (x) => { startReplay(x); renderPanels(true); },
      onError: (err) => offerDemo(err, prompt),
    });
    beginTrial(live.mode);
    research = live;
    setBanner(true);
    afterTrialStart();
  } catch (err) { offerDemo(err, prompt); }
}
function offerDemo(err, prompt) {
  const t = $("toast");
  t.innerHTML = "";
  t.append(`Backend error: ${err.message}. `);
  const b = document.createElement("button");
  b.textContent = "Continue in demo mode";
  b.className = "chip";
  b.addEventListener("click", () => { liveDisabled = true; t.classList.add("hidden"); startTrial(prompt); });
  t.append(b);
  t.classList.remove("hidden");
  clearTimeout(toastT);
}
function beginTrial(m) {
  mode = m;
  endCelebration();
  closeSummary();
  briefAt = 0; summaryDone = false;
  openWhy.clear();
  events = [];
  $("log").innerHTML = "";
  const badge = $("mode-badge");
  badge.classList.remove("hidden");
  badge.classList.toggle("perception", mode === "perception");
  badge.textContent = mode === "perception" ? "PERCEPTION TRIAL" : mode === "town" ? "TOWN TRIAL" : "SERVICE TRIAL";
  startReplay(null);
}
function afterTrialStart() {
  for (const r of Object.values(researchers)) r.moveTo(heaven.stations[r.spec.station].stand);
  updateRunbar();
  toast(mode === "perception"
    ? "Perception trial: each resident is a past.dev identity. Watch ? turn into ! as the notice spreads. Researchers work in HEAVEN."
    : mode === "town" ? "Town trial: Bo is framing your question (which places, which metric, any budget limit). Researchers work in HEAVEN."
    : "Service trial: watch residents visit the library. Researchers work in HEAVEN.", 5200);
  renderPanels(true);
}

// ---------- keyboard camera ----------
// WASD pan (relative to the view), E/Q up/down, arrows orbit/tilt, O/I zoom out/in.
const keys = new Set();
const CAM_KEYS = new Set(["w", "a", "s", "d", "e", "q", "o", "i", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);
const keyName = (e) => (e.key.length === 1 ? e.key.toLowerCase() : e.key);
const typing = () => { const a = document.activeElement; return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable); };
window.addEventListener("keydown", (e) => {
  if (typing() || e.ctrlKey || e.metaKey || e.altKey || !inTown || !$("landing").classList.contains("hidden")) return;
  const k = keyName(e);
  if (!CAM_KEYS.has(k)) return;
  keys.add(k); e.preventDefault(); fly = null; follow = false; controls.autoRotate = false;
});
window.addEventListener("keyup", (e) => keys.delete(keyName(e)));
window.addEventListener("blur", () => keys.clear());
const _off = new THREE.Vector3(), _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _mv = new THREE.Vector3(), _sph = new THREE.Spherical();
function keyboardCamera(dt) {
  if (!keys.size || typing()) return;
  _off.copy(camera.position).sub(controls.target);
  const pan = Math.max(12, _off.length() * 0.9) * dt;
  _fwd.set(-_off.x, 0, -_off.z).normalize();
  _right.crossVectors(_fwd, camera.up).normalize();
  _mv.set(0, 0, 0);
  if (keys.has("w")) _mv.addScaledVector(_fwd, pan);
  if (keys.has("s")) _mv.addScaledVector(_fwd, -pan);
  if (keys.has("d")) _mv.addScaledVector(_right, pan);
  if (keys.has("a")) _mv.addScaledVector(_right, -pan);
  if (keys.has("e")) _mv.y += pan;
  if (keys.has("q")) _mv.y -= pan;
  controls.target.add(_mv);
  controls.target.y = THREE.MathUtils.clamp(controls.target.y, -2, HEAVEN_Y + 20);
  _sph.setFromVector3(_off);
  if (keys.has("ArrowLeft")) _sph.theta -= 1.6 * dt;
  if (keys.has("ArrowRight")) _sph.theta += 1.6 * dt;
  if (keys.has("ArrowUp")) _sph.phi -= 1.0 * dt;
  if (keys.has("ArrowDown")) _sph.phi += 1.0 * dt;
  if (keys.has("o")) _sph.radius *= 1 + 1.4 * dt;
  if (keys.has("i")) _sph.radius *= 1 - 1.4 * dt;
  _sph.phi = THREE.MathUtils.clamp(_sph.phi, 0.08, controls.maxPolarAngle);
  _sph.radius = THREE.MathUtils.clamp(_sph.radius, controls.minDistance, controls.maxDistance);
  camera.position.copy(controls.target).add(_off.setFromSpherical(_sph));
}

// ---------- main loop ----------
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.elapsedTime;
  if (model && speed > 0 && inTown) {
    tickAcc += dt * speed;
    let guard = 0;
    while (tickAcc >= TICK_SEC && guard++ < 8) {
      tickAcc -= TICK_SEC;
      stepModel();
    }
  }
  const sdt = speed > 0 ? dt * Math.min(speed, 4) : 0;
  for (const v of Object.values(views)) {
    if (v.turnedT > 0) v.turnedT -= sdt;
    if (v.servedT > 0) v.servedT -= sdt;
    v.update(speed > 0 ? dt : 0);
  }
  for (const r of Object.values(researchers)) r.update(dt);
  for (const v of Object.values(views)) v.cheer = cheering;
  celebration.update(dt);
  if (!summaryDone && briefAt && research && research.done() && performance.now() - briefAt > (cheering ? 3800 : 1200)) finishTrial();
  if (research && speed > 0) research.update(dt * Math.min(speed, 3));
  heaven.update(dt, t);
  lighting();
  if (fly) {
    fly.t += dt;
    const u = Math.min(1, fly.t / fly.dur), e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    camera.position.lerpVectors(fly.p0, fly.p1, e);
    controls.target.lerpVectors(fly.t0, fly.t1, e);
    if (u >= 1) fly = null;
  } else if (follow && selected && selected.kind === "resident") {
    const p = selectedPos();
    if (p) { const d = new THREE.Vector3(p.x, 0, p.z).sub(controls.target); controls.target.add(d.multiplyScalar(0.08)); camera.position.add(d); }
  }
  keyboardCamera(dt);
  updateHover(t);
  const sp = selectedPos();
  marker.visible = !!sp;
  if (sp) { marker.position.set(sp.x, sp.y > 5 ? sp.y + 0.1 : 0.15, sp.z); marker.rotation.y += dt; }
  controls.update();
  if (inTown) { $("clock").textContent = model ? UI.clockText(model.state.tick, TICKS_PER_DAY) : ""; renderPanels(); }
  renderer.render(scene, camera);
  placeLabels();
  requestAnimationFrame(frame);
}

// Debug handle for tests and the console
window.__townTrial = { select: (p) => select(p), get residents() { return residents; }, get research() { return research; }, get town() { return town; }, fingerprint: () => townFingerprint(town, residents) };

initHistory();

// ---------- boot ----------
(async function boot() {
  await Promise.all([document.fonts.load('8px "Press Start 2P"'), document.fonts.load('12px "Silkscreen"')]).catch(() => {});
  await makeTown("Anytown");
  inTown = true; // keep the background town alive behind the landing card
  requestAnimationFrame(frame);
  const city = params.get("city");
  if (city) {
    await enterTown(city);
    if (params.get("prompt")) { $("prompt-input").value = trialPrompt = params.get("prompt"); startTrial(params.get("prompt")); }
    if (params.get("view") === "heaven") { HEAVEN_VIEW(); setView("heaven"); }
    if (params.get("speed")) { const b = document.querySelector(`[data-speed="${params.get("speed")}"]`); if (b) b.click(); }
  } else {
    $("city-input").focus();
  }
})();
