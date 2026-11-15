// Olympus: a floating island above the town where the researcher agents live.
import * as THREE from "three";
import { box, mat } from "./voxel.js";

export const HEAVEN_Y = 72;

export const RESEARCHERS = [
  { id: "exa", name: "Exa Dude", role: "Research god", does: "Searches the web with Exa for local facts, budget records and similar towns, and checks every claim against its source passage, place and date.", robe: 0x59c2ff, skin: 0xf1c7a5, hair: 0x2b1d14, station: "lookout" },
  { id: "bo", name: "Bo", role: "Designer", does: "Turns the idea into allowed policy actions and proposes revisions.", robe: 0xffd34d, skin: 0xb07a55, hair: 0x1b1530, station: "drafting" },
  { id: "cy", name: "Cy", role: "Reviewer", does: "Checks causal assumptions and blocks unsupported changes.", robe: 0xff9f43, skin: 0xd9a07a, hair: 0xb3412f, station: "court" },
  { id: "dee", name: "Dee", role: "Runner", does: "Fans experiments out to Modal workers and collects results.", robe: 0x5be37d, skin: 0x8a5a3c, hair: 0x5a3a22, station: "portal" },
  { id: "eli", name: "Past Dev", role: "Memory & audiences god", does: "Keeps the team's shared memory in past.dev (evidence, handoffs between gods, decisions) and the residents' identities and audiences: who has heard what, and when.", robe: 0xff7ad9, skin: 0xf5d6c0, hair: 0xe0c068, station: "archive" },
  { id: "treasurer", name: "Treasurer", role: "Budget god", does: "Costs every proposal line by line and checks it against the town's sourced budget: a funding source, a gap, or budget unverified. Advises only; never changes the budget.", robe: 0xe8c24a, skin: 0xc68e62, hair: 0x2b2b2b, station: "treasury" },
];

export function buildHeaven(scene) {
  const group = new THREE.Group();
  group.position.y = HEAVEN_Y;
  scene.add(group);

  // Cloud floor (instanced voxels): a flat walkable top with soft puffs, billowing layers underneath
  const V = 2, R = 24;
  const cube = new THREE.BoxGeometry(V, V, V);
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), s4 = new THREE.Vector3(), p4 = new THREE.Vector3();
  const tints = [0xffffff, 0xf6f4ff, 0xeef2ff, 0xfff8ee];
  const cloudLayer = (cells, color) => {
    const im = new THREE.InstancedMesh(cube, new THREE.MeshLambertMaterial({ color, emissive: 0xffffff, emissiveIntensity: 0.18 }), cells.length);
    cells.forEach(([x, y, z, sc], k) => { p4.set(x, y, z); s4.set(sc, sc, sc); m4.compose(p4, q4, s4); im.setMatrixAt(k, m4); });
    im.receiveShadow = true;
    group.add(im);
  };
  const noise = (x, z) => Math.sin(x * 0.7) * 1.4 + Math.cos(z * 0.5) * 1.4 + Math.sin((x + z) * 0.31) * 0.8;
  const byTint = tints.map(() => []);
  // top: flat where people walk, puffier toward the rim
  for (let x = -R; x <= R; x += V) for (let z = -R; z <= R; z += V) {
    const r = Math.hypot(x, z);
    if (r > R + noise(x, z)) continue;
    const rim = Math.max(0, (r - (R - 7)) / 7);
    const puff = rim * (0.6 + 0.6 * Math.abs(Math.sin(x * 1.3 + z * 0.9)));
    byTint[(Math.abs(x * 3 + z * 7) / V) % tints.length | 0].push([x, -V / 2 + puff * 1.4, z, 1 + puff * 0.5]);
  }
  // billows below: each layer narrower, offset and slightly bluer
  const below = [[-V, R - 1, 0xe9ecfb], [-2 * V, R - 3, 0xdfe4f8], [-3 * V, R - 7, 0xd3daf3], [-4 * V, R - 12, 0xc8d0ee], [-5 * V, R - 17, 0xbcc6ea]];
  for (const [y, rr, color] of below) {
    const cells = [];
    for (let x = -rr; x <= rr; x += V) for (let z = -rr; z <= rr; z += V) {
      const w = noise(x + y, z - y);
      if (Math.hypot(x, z) <= rr + w) cells.push([x, y - V / 2 + Math.sin(x * 0.9 + z) * 0.4, z, 1.1]);
    }
    cloudLayer(cells, color);
  }
  byTint.forEach((cells, k) => cloudLayer(cells, tints[k]));
  // big rim puffs and hanging wisps
  const puffs = [];
  for (let k = 0; k < 40; k++) {
    const a = k * 2.399, r = R - 1 + (k % 3) * 1.6;
    puffs.push([Math.cos(a) * r, -0.6 + (k % 4) * 0.5, Math.sin(a) * r, 1.6 + (k % 3) * 0.5]);
  }
  for (let k = 0; k < 22; k++) {
    const a = k * 1.7, r = 3 + (k % 6) * 2.6;
    puffs.push([Math.cos(a) * r, -12 - (k % 4) * 1.6, Math.sin(a) * r, 1 + (k % 3) * 0.45]);
  }
  cloudLayer(puffs, 0xffffff);

  // Paths and centre fountain
  const gold = new THREE.MeshLambertMaterial({ color: 0xffd34d, emissive: 0xffc23a, emissiveIntensity: 0.35 });
  group.add(box(3, 0.12, 40, 0xf7f1e6, 0, 0, 0));
  group.add(box(40, 0.12, 3, 0xf7f1e6, 0, 0, 0));
  for (const o of [-1.7, 1.7]) { group.add(box(0.3, 0.16, 40, 0, o, 0, 0, gold)); group.add(box(40, 0.16, 0.3, 0, 0, 0, o, gold)); }
  group.add(box(5, 0.8, 5, 0xffffff, 0, 0, 0));
  group.add(box(3.6, 0.3, 3.6, 0x8fd3ff, 0, 0.8, 0));
  group.add(box(0.8, 2.6, 0.8, 0xffffff, 0, 0.8, 0));
  group.add(box(1.6, 0.4, 1.6, 0xffd34d, 0, 3.4, 0));

  const stations = {};
  const station = (id, x, z, label, build) => {
    const g = new THREE.Group();
    build(g);
    g.position.set(x, 0, z);
    g.traverse((o) => { if (o.isMesh) o.userData.pick = { kind: "station", id }; });
    group.add(g);
    const len = Math.hypot(x, z) || 1;
    stations[id] = { id, x, z, label, stand: { x: x - (x / len) * 7, z: z - (z / len) * 7 }, labelY: HEAVEN_Y + 10 };
  };

  station("archive", -13, -10, "PAST.DEV ARCHIVE", (g) => {
    g.add(box(10, 0.6, 8, 0xffffff));
    g.add(box(8, 5, 5, 0xf3eefc, 0, 0.6, -0.8));
    for (let k = -1.5; k <= 1.5; k++) g.add(box(0.7, 4.4, 0.7, 0xffffff, k * 2.4, 0.6, 2.6));
    g.add(box(10, 0.8, 7, 0xff7ad9, 0, 5.6, 0));
    g.add(box(7, 0.8, 4.6, 0xff7ad9, 0, 6.4, 0));
    for (let k = 0; k < 4; k++) g.add(box(0.5, 1.2, 0.3, [0xff5d6c, 0x59c2ff, 0xffd34d, 0x5be37d][k], -3 + k * 0.6, 0.6, 1.6));
  });
  station("lookout", 14, -10, "EXA LOOKOUT", (g) => {
    g.add(box(5, 9, 5, 0xe8e2f5));
    g.add(box(6.4, 0.6, 6.4, 0x59c2ff, 0, 9, 0));
    for (const [a, b] of [[-2.8, -2.8], [2.8, -2.8], [-2.8, 2.8], [2.8, 2.8]]) g.add(box(0.5, 1.2, 0.5, 0xffffff, a, 9.6, b));
    const scope = box(0.8, 0.8, 4, 0x1b1530, 1.2, 10.4, 1.4);
    scope.rotation.x = 0.6; g.add(scope);
    g.add(box(1.2, 1.8, 0.2, 0x59c2ff, 0, 0, 2.55));
  });
  station("drafting", -14, 10, "DESIGN HALL", (g) => {
    g.add(box(8, 4, 6, 0xfff3c4));
    g.add(box(8.6, 0.6, 6.6, 0xffd34d, 0, 4, 0));
    g.add(box(5.6, 0.6, 4, 0xffd34d, 0, 4.6, 0));
    g.add(box(2.4, 1, 1.4, 0x8c5a2b, 0, 0, 4.5));
    g.add(box(2.2, 0.08, 1.2, 0xffffff, 0, 1, 4.5));
  });
  station("court", 13, 11, "REVIEW COURT", (g) => {
    g.add(box(10, 0.5, 8, 0xffffff));
    for (const [a, b] of [[-4, -3], [4, -3], [-4, 3], [4, 3], [0, -3]]) g.add(box(0.8, 5, 0.8, 0xffffff, a, 0.5, b));
    g.add(box(10, 0.6, 8, 0xff9f43, 0, 5.5, 0));
    g.add(box(4, 1.4, 1.2, 0x8c5a2b, 0, 0.5, -1.5));
  });
  station("treasury", -20, 1, "TREASURY", (g) => {
    const goldM = new THREE.MeshLambertMaterial({ color: 0xffd34d, emissive: 0xffc23a, emissiveIntensity: 0.3 });
    g.add(box(7, 0.6, 7, 0xffffff));
    g.add(box(5.6, 4.2, 5, 0xf3eefc, 0, 0.6, 0));
    for (const x of [-2.2, 0, 2.2]) g.add(box(0.7, 4.2, 0.7, 0xffffff, x, 0.6, 2.7));
    g.add(box(6.6, 0.7, 6, 0, 0, 4.8, 0, goldM));
    g.add(box(4, 0.7, 4, 0, 0, 5.5, 0, goldM));
    for (let k = 0; k < 4; k++) g.add(box(0.9, 0.3 + k * 0.25, 0.9, 0, -2.4 + k * 1.6, 0.6, 3.6, goldM)); // coin stacks
  });
  station("portal", 0, -19, "MODAL PORTAL", (g) => {
    g.add(box(1.2, 7, 1.2, 0x2b2840, -3, 0, 0));
    g.add(box(1.2, 7, 1.2, 0x2b2840, 3, 0, 0));
    g.add(box(7.2, 1.2, 1.2, 0x2b2840, 0, 7, 0));
    const glow = box(4.8, 6.8, 0.3, 0, 0, 0.1, 0, new THREE.MeshLambertMaterial({ color: 0x5be37d, emissive: 0x5be37d, emissiveIntensity: 0.9, transparent: true, opacity: 0.75 }));
    g.add(glow);
    g.userData.glow = glow;
  });

  // Pearly gates at the south edge
  const pearl = new THREE.MeshLambertMaterial({ color: 0xfff8f0, emissive: 0xfff0e0, emissiveIntensity: 0.4 });
  for (const x of [-5, 5]) {
    group.add(box(1.6, 8, 1.6, 0xffffff, x, 0, 21));
    group.add(box(2.2, 0.6, 2.2, 0, x, 8, 21, gold));
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), pearl); ball.position.set(x, 9.5, 21); group.add(ball);
  }
  for (let k = 0; k < 7; k++) { const t = k / 6, x = -4 + t * 8, y = 7 + Math.sin(t * Math.PI) * 2.2; group.add(box(1.3, 0.6, 0.6, 0, x, y, 21, gold)); }
  for (let k = -3; k <= 3; k++) if (k) group.add(box(0.18, 6.4 + Math.cos(k * 0.45) * 1.2, 0.18, 0, k * 1.15 + (k > 0 ? 0.6 : -0.6), 0, 21, gold));
  for (let k = -3; k <= 3; k++) { const ball = new THREE.Mesh(new THREE.SphereGeometry(0.28, 6, 4), pearl); ball.position.set(k * 1.25, 3.2, 21.2); group.add(ball); }

  // Drifting sparkle motes
  const motePts = [];
  for (let k = 0; k < 260; k++) motePts.push((Math.random() - 0.5) * 50, Math.random() * 16, (Math.random() - 0.5) * 50);
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute("position", new THREE.Float32BufferAttribute(motePts, 3));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ color: 0xfff1a8, size: 0.35, transparent: true, opacity: 0.9, depthWrite: false }));
  group.add(motes);

  // Clouds around the island
  const clouds = [];
  const cloudMat = mat(0xffffff);
  for (let k = 0; k < 16; k++) {
    const c = new THREE.Group();
    const n = 3 + (k % 3);
    for (let q = 0; q < n; q++) {
      const s = 3 + ((k * 7 + q * 3) % 4);
      const m = new THREE.Mesh(new THREE.BoxGeometry(s * 1.6, s * 0.7, s), cloudMat);
      m.position.set(q * 2.6 - n, (q % 2) * 0.8, (q % 3) - 1);
      c.add(m);
    }
    const a = (k / 16) * Math.PI * 2, r = 32 + (k % 4) * 9;
    c.position.set(Math.cos(a) * r, -6 + (k % 5) * 3, Math.sin(a) * r);
    c.userData.a = a; c.userData.r = r; c.userData.v = 0.01 + (k % 3) * 0.006;
    group.add(c); clouds.push(c);
  }

  const heavenLight = new THREE.PointLight(0xfff1c0, 300, 90, 1.6);
  heavenLight.position.set(0, 20, 0);
  group.add(heavenLight);

  // Falling cubes: findings dropped to town / Modal workers fanning out
  const drops = [];
  function drop(fromLocal, toWorld, count = 8, color = 0x5be37d) {
    if (!toWorld) return; // e.g. a real town without a library
    for (let k = 0; k < count; k++) {
      const m = box(0.7, 0.7, 0.7, 0, 0, 0, 0, new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.7 }));
      m.castShadow = false;
      scene.add(m);
      drops.push({
        m, t: -k * 0.12, dur: 2.2,
        a: new THREE.Vector3(fromLocal.x, HEAVEN_Y + 2, fromLocal.z),
        b: new THREE.Vector3(toWorld.x + (Math.random() - 0.5) * 6, 0.5, toWorld.z + (Math.random() - 0.5) * 6),
      });
    }
  }

  function update(dt, time) {
    for (const c of clouds) {
      c.userData.a += c.userData.v * dt;
      c.position.x = Math.cos(c.userData.a) * c.userData.r;
      c.position.z = Math.sin(c.userData.a) * c.userData.r;
    }
    const mp = moteGeo.attributes.position;
    for (let k = 0; k < mp.count; k++) { let y = mp.getY(k) + dt * 0.6; if (y > 16) y = 0; mp.setY(k, y); mp.setX(k, mp.getX(k) + Math.sin(time + k) * dt * 0.2); }
    mp.needsUpdate = true;
    const glow = group.children.find((g) => g.userData && g.userData.glow);
    if (glow) glow.userData.glow.material.opacity = 0.55 + Math.sin(time * 3) * 0.2;
    for (let k = drops.length - 1; k >= 0; k--) {
      const d = drops[k];
      d.t += dt;
      if (d.t < 0) { d.m.visible = false; continue; }
      d.m.visible = true;
      const u = Math.min(1, d.t / d.dur);
      d.m.position.lerpVectors(d.a, d.b, u);
      d.m.position.y += Math.sin(u * Math.PI) * 8;
      d.m.rotation.x += dt * 4; d.m.rotation.y += dt * 3;
      if (u >= 1) { scene.remove(d.m); drops.splice(k, 1); }
    }
  }

  return { group, stations, update, drop };
}
