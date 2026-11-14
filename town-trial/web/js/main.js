import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildTown, windowMat, libraryWindowMat, lampMat } from "./town.js";
import { townFingerprint } from "./layout.js";
import { Resident, Researcher } from "./people.js";
import { buildHeaven, HEAVEN_Y, RESEARCHERS } from "./heaven.js";
import { makeResidents, createModel, TICKS_PER_DAY, BASELINE_HOURS } from "./sim.js";
import { createResearch, classify } from "./research.js";
import * as UI from "./ui.js";
import { box } from "./voxel.js";

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
const heaven = buildHeaven(scene);
const researchers = {};
for (const spec of RESEARCHERS) {
  const st = heaven.stations[spec.station];
  researchers[spec.id] = new Researcher({ ...spec, home: { ...st.stand }, y: HEAVEN_Y }, scene);
}

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
  const log = $("log");
  log.insertAdjacentHTML("afterbegin", UI.entryHTML(e));
  while (log.children.length > 250) log.lastElementChild.remove();
  return e;
}

// ---------- town ----------
async function makeTown(name) {
  if (town) {
    scene.remove(town.group);
    for (const v of Object.values(views)) scene.remove(v.mesh);
  }
  town = buildTown(name);
  scene.add(town.group);
  for (const b of town.buildings) if (b.mesh) b.mesh.traverse((o) => { if (o.isMesh) o.userData.pick = { kind: "building", id: b.id }; });
  residents = makeResidents(town, name);
  views = {};
  for (const r of residents) views[r.id] = new Resident(r, town, scene);
  research = null; mode = null; viewExp = null; events = [];
  $("log").innerHTML = "";
  startReplay(null);
  buildLabels();
}

function startReplay(exp) {
  viewExp = exp;
  const m = mode || "service";
  const policy = exp ? exp.policy : m === "perception" ? { channels: ["online"] } : { hours: BASELINE_HOURS };
  const live = !!mode;
  model = createModel({ town, residents, mode: m, policy, seed: 0, days: m === "perception" ? 3 : 7, emit: live ? emit : null });
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
    if (mode === "perception") icon = s.aware ? "aware" : "unaware";
    else if (mode === "service") {
      if (v.turnedT > 0) icon = "turned";
      else if (s.libState === "going") icon = "going";
      else if (s.libState === "queue") icon = "waiting";
      else if (v.servedT > 0) icon = "served";
    }
    v.setIcon(icon);
  }
}

// ---------- day / night ----------
const DAY = new THREE.Color(0x8fd3ff), DUSK = new THREE.Color(0xff9f7a), NIGHT = new THREE.Color(0x1d1b45);
function lighting() {
  const m = model ? (model.state.tick % TICKS_PER_DAY) * 10 : 12 * 60;
  const h = m / 60;
  const dl = THREE.MathUtils.clamp(Math.min((h - 5.5) / 2, (20.5 - h) / 2), 0, 1);
  const duskAmt = 1 - Math.abs(dl - 0.5) * 2;
  sky.copy(NIGHT).lerp(DAY, dl).lerp(DUSK, duskAmt * 0.35);
  scene.fog.color.copy(sky);
  sun.intensity = 0.15 + 2.1 * dl;
  hemi.intensity = 0.35 + 0.8 * dl;
  const ang = ((h - 6) / 12) * Math.PI;
  sun.position.set(Math.cos(ang) * 120, 40 + Math.sin(Math.max(0, ang)) * 100, 40);
  windowMat.emissiveIntensity = (1 - dl) * 0.9;
  lampMat.emissiveIntensity = (1 - dl) * 1.2;
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
  const libL = add("LIBRARY", () => new THREE.Vector3(lib.x, 9.5, lib.z), "lbl sign");
  libL.update = () => { libL.el.textContent = `LIBRARY · ${libraryOpen ? "OPEN" : "CLOSED"}`; libL.el.className = `lbl ${libraryOpen ? "open" : "closed"}`; };
  for (const id of ["townhall", "park"]) { const b = town.byId[id]; if (b) add(b.name.toUpperCase(), () => new THREE.Vector3(b.x, (b.h || 0) + 6, b.z)); }
  const pl = town.byId.plaza;
  add("NOTICE BOARD", () => new THREE.Vector3(pl.boardPos.x, 4.2, pl.boardPos.z), "lbl sign");
  for (const st of Object.values(heaven.stations)) add(st.label, () => new THREE.Vector3(st.x, st.labelY, st.z), "lbl sign");
  for (const r of Object.values(researchers)) {
    const L = add("", () => new THREE.Vector3(r.pos.x, HEAVEN_Y + 3.2, r.pos.z), "bubble");
    L.update = () => { L.el.style.display = r.bubble ? "" : "none"; if (r.bubble) L.el.textContent = `${r.spec.name}: ${r.bubble}`; };
    const N = add(r.spec.name.toUpperCase(), () => new THREE.Vector3(r.pos.x, HEAVEN_Y + 2.5, r.pos.z), "lbl");
    N.update = () => { N.el.style.display = r.bubble ? "none" : ""; };
  }
  const sel = add("", () => selectedPos() || new THREE.Vector3(0, -999, 0), "lbl sign");
  sel.update = () => { sel.el.style.display = selected && selected.kind === "resident" ? "" : "none"; if (selected && selected.kind === "resident") sel.el.textContent = views[selected.id].data.name; };
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
canvas.addEventListener("pointerup", (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6 || !inTown) return;
  const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const targets = [...Object.values(views).filter((v) => v.mesh.visible).map((v) => v.mesh), ...Object.values(researchers).map((r) => r.mesh), heaven.group, town.group];
  const hits = ray.intersectObjects(targets, true);
  for (const h of hits) {
    let o = h.object;
    while (o && !o.userData.pick) o = o.parent;
    if (o) { select(o.userData.pick); return; }
  }
});

function select(pick) {
  selected = pick;
  follow = pick && pick.kind === "resident";
  renderSelected();
}
function selectedPos() {
  if (!selected) return null;
  if (selected.kind === "resident") { const v = views[selected.id]; return v.mesh.visible ? new THREE.Vector3(v.pos.x, 2.6, v.pos.z) : null; }
  if (selected.kind === "researcher") { const r = researchers[selected.id]; return new THREE.Vector3(r.pos.x, HEAVEN_Y, r.pos.z); }
  if (selected.kind === "building") { const b = town.byId[selected.id]; return new THREE.Vector3(b.x, 0, b.z); }
  if (selected.kind === "station") { const s = heaven.stations[selected.id]; return new THREE.Vector3(s.x, HEAVEN_Y, s.z); }
  return null;
}
function renderSelected() {
  const el = $("selected");
  if (!selected) { el.classList.add("hidden"); marker.visible = false; return; }
  el.classList.remove("hidden");
  $("side").classList.remove("collapsed");
  let html = "";
  if (selected.kind === "resident") { const v = views[selected.id]; html = UI.residentHTML(v.data, model && model.S.find((s) => s.r.id === selected.id), mode, events); }
  else if (selected.kind === "researcher") html = UI.researcherHTML(researchers[selected.id].spec, events);
  else if (selected.kind === "station") html = UI.stationHTML(selected.id, heaven.stations[selected.id].label, events);
  else if (selected.kind === "building") html = UI.buildingHTML(town.byId[selected.id], model, events);
  el.innerHTML = html;
}
$("selected").addEventListener("click", (e) => { if (e.target.closest("[data-close]")) select(null); });

// ---------- panels ----------
function renderPanels(force = false) {
  const now = performance.now();
  if (!force && now - lastPanel < 400) return;
  lastPanel = now;
  if (research) $("tab-exp").innerHTML = UI.experimentsHTML(research.exps, viewExp && viewExp.id, research.primary);
  $("tab-aud").innerHTML = UI.audiencesHTML(mode || "service", model, residents, flashSlug);
  if (selected) renderSelected();
}
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === t));
  for (const id of ["log", "exp", "aud"]) $("tab-" + id).classList.toggle("hidden", id !== t.dataset.tab);
  renderPanels(true);
}));
$("tab-exp").addEventListener("click", (e) => {
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
  await enterTown(name);
});
async function enterTown(name) {
  await makeTown(name);
  $("town-name").textContent = name.toUpperCase();
  $("landing").classList.add("hidden");
  $("hud").classList.remove("hidden");
  controls.autoRotate = false;
  inTown = true;
  TOWN_VIEW();
  toast(`Built ${name}: ${residents.length} residents. Type an idea below to test it.`);
}

// Prompt
document.querySelectorAll("[data-prompt]").forEach((c) => c.addEventListener("click", () => { $("prompt-input").value = c.dataset.prompt; }));
$("prompt-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const prompt = $("prompt-input").value.trim();
  if (!prompt) { toast("Type a policy idea first, or pick an example."); return; }
  startTrial(prompt);
});
function startTrial(prompt) {
  mode = classify(prompt);
  events = [];
  $("log").innerHTML = "";
  const badge = $("mode-badge");
  badge.classList.remove("hidden");
  badge.classList.toggle("perception", mode === "perception");
  badge.textContent = mode === "perception" ? "PERCEPTION TRIAL" : "SERVICE TRIAL";
  startReplay(null);
  research = createResearch({
    mode, prompt, town, residents, emit, heaven, researchers,
    onChange: () => renderPanels(true),
    onView: (x) => { startReplay(x); renderPanels(true); },
    setBusy: (b) => b && toast("Dee is fanning experiments out to Modal..."),
  });
  for (const r of Object.values(researchers)) r.moveTo(heaven.stations[r.spec.station].stand);
  updateRunbar();
  toast(mode === "perception"
    ? "Perception trial: each resident is a past.dev identity. Watch ? turn into ! as the notice spreads. Researchers work in HEAVEN."
    : "Service trial: watch residents visit the library. Researchers work in HEAVEN.", 5200);
  renderPanels(true);
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
  const sp = selectedPos();
  marker.visible = !!sp;
  if (sp) { marker.position.set(sp.x, sp.y > HEAVEN_Y - 5 ? HEAVEN_Y + 0.1 : 0.15, sp.z); marker.rotation.y += dt; }
  controls.update();
  if (inTown) { $("clock").textContent = model ? UI.clockText(model.state.tick, TICKS_PER_DAY) : ""; renderPanels(); }
  renderer.render(scene, camera);
  placeLabels();
  requestAnimationFrame(frame);
}

// Debug handle for tests and the console
window.__townTrial = { select: (p) => select(p), get residents() { return residents; }, get research() { return research; }, get town() { return town; }, fingerprint: () => townFingerprint(town, residents) };

// ---------- boot ----------
(async function boot() {
  await Promise.all([document.fonts.load('8px "Press Start 2P"'), document.fonts.load('12px "Silkscreen"')]).catch(() => {});
  await makeTown("Anytown");
  inTown = true; // keep the background town alive behind the landing card
  requestAnimationFrame(frame);
  const city = params.get("city");
  if (city) {
    await enterTown(city);
    if (params.get("prompt")) { $("prompt-input").value = params.get("prompt"); startTrial(params.get("prompt")); }
    if (params.get("view") === "heaven") { HEAVEN_VIEW(); setView("heaven"); }
    if (params.get("speed")) { const b = document.querySelector(`[data-speed="${params.get("speed")}"]`); if (b) b.click(); }
  } else {
    $("city-input").focus();
  }
})();
