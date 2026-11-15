// Heaven: a floating island above the town where the researcher agents live.
import * as THREE from "three";
import { box, mat } from "./voxel.js";

export const HEAVEN_Y = 72;

export const RESEARCHERS = [
  { id: "ada", name: "Ada", role: "Researcher", does: "Searches the web with Exa for local facts and comparable policies.", robe: 0x59c2ff, skin: 0xf1c7a5, hair: 0x2b1d14, station: "lookout" },
  { id: "bo", name: "Bo", role: "Designer", does: "Turns the idea into allowed policy actions and proposes revisions.", robe: 0xffd34d, skin: 0xb07a55, hair: 0x1b1530, station: "drafting" },
  { id: "cy", name: "Cy", role: "Reviewer", does: "Checks causal assumptions and blocks unsupported changes.", robe: 0xff9f43, skin: 0xd9a07a, hair: 0xb3412f, station: "court" },
  { id: "dee", name: "Dee", role: "Runner", does: "Fans experiments out to Modal workers and collects results.", robe: 0x5be37d, skin: 0x8a5a3c, hair: 0x5a3a22, station: "portal" },
  { id: "eli", name: "Eli", role: "Archivist", does: "Keeps shared memory in past.dev: evidence, handoffs, audiences.", robe: 0xff7ad9, skin: 0xf5d6c0, hair: 0xe0c068, station: "archive" },
];

export function buildHeaven(scene) {
  const group = new THREE.Group();
  group.position.y = HEAVEN_Y;
  scene.add(group);

  // Island voxels (instanced)
  const V = 2, R = 24;
  const cube = new THREE.BoxGeometry(V, V, V);
  const layers = [
    { y: 0, r: R, color: 0x7fd85a },
    { y: -V, r: R - 1, color: 0x9a6a3e },
    { y: -2 * V, r: R - 4, color: 0x8a5a33 },
    { y: -3 * V, r: R - 8, color: 0x7a5032 },
    { y: -4 * V, r: R - 12, color: 0x8e8aa8 },
    { y: -5 * V, r: R - 16, color: 0x7d7896 },
    { y: -6 * V, r: R - 20, color: 0x6e6a8a },
  ];
  for (const L of layers) {
    const cells = [];
    for (let x = -L.r; x <= L.r; x += V) for (let z = -L.r; z <= L.r; z += V) {
      const wob = Math.sin(x * 0.7) * 1.4 + Math.cos(z * 0.5) * 1.4;
      if (Math.hypot(x, z) <= L.r + wob) cells.push([x, z]);
    }
    const im = new THREE.InstancedMesh(cube, mat(L.color), cells.length);
    const m4 = new THREE.Matrix4();
    cells.forEach(([x, z], k) => { m4.makeTranslation(x, L.y - V / 2, z); im.setMatrixAt(k, m4); });
    im.receiveShadow = true; im.castShadow = true;
    group.add(im);
  }
  // Stalactites
  for (let k = 0; k < 18; k++) {
    const a = k * 2.1, r = 4 + (k % 5) * 2.2;
    const len = 2 + (k % 4) * 1.5;
    group.add(box(V, len, V, 0x6e6a8a, Math.cos(a) * r, -7 * V - len + 1, Math.sin(a) * r));
  }

  // Paths and centre fountain
  group.add(box(3, 0.1, 40, 0xf5ecd8, 0, 0, 0));
  group.add(box(40, 0.1, 3, 0xf5ecd8, 0, 0, 0));
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
  station("portal", 0, -19, "MODAL PORTAL", (g) => {
    g.add(box(1.2, 7, 1.2, 0x2b2840, -3, 0, 0));
    g.add(box(1.2, 7, 1.2, 0x2b2840, 3, 0, 0));
    g.add(box(7.2, 1.2, 1.2, 0x2b2840, 0, 7, 0));
    const glow = box(4.8, 6.8, 0.3, 0, 0, 0.1, 0, new THREE.MeshLambertMaterial({ color: 0x5be37d, emissive: 0x5be37d, emissiveIntensity: 0.9, transparent: true, opacity: 0.75 }));
    g.add(glow);
    g.userData.glow = glow;
  });

  // Gate at the south edge
  group.add(box(1, 6, 1, 0xffffff, -4, 0, 21));
  group.add(box(1, 6, 1, 0xffffff, 4, 0, 21));
  group.add(box(9, 1, 1, 0xffd34d, 0, 6, 21));

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

  const heavenLight = new THREE.PointLight(0xfff1c0, 900, 90, 1.6);
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
