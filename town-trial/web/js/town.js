// Renders the procedural town from layout.js. All randomness lives in
// layout.js (pure data, also used by the Node simulator workers), so the
// renderer draws exactly the town the backend simulates.
// Real street maps (OpenStreetMap) can replace layoutTown later: the rest of the
// app only needs town.buildings, town.pathBetween and the landmark ids.
import * as THREE from "three";
import { layoutTown, GRID, PITCH, ROAD, HALF, road, blockCentre } from "./layout.js";
import { box, mat } from "./voxel.js";

export { GRID, PITCH, ROAD, HALF };

export const windowMat = new THREE.MeshLambertMaterial({ color: 0x3a4a6a, emissive: 0xffd77a, emissiveIntensity: 0 });
export const libraryWindowMat = new THREE.MeshLambertMaterial({ color: 0x3a4a6a, emissive: 0xffe9a8, emissiveIntensity: 0 });
export const lampMat = new THREE.MeshLambertMaterial({ color: 0xfff3c4, emissive: 0xffe08a, emissiveIntensity: 0 });

export function buildTown(cityName, spec = null) {
  const town = layoutTown(cityName, spec);
  const group = new THREE.Group();

  // Ground and water
  const ground = new THREE.Mesh(new THREE.BoxGeometry(420, 1, 420), mat(0x6cc24a));
  ground.position.y = -0.5; ground.receiveShadow = true; group.add(ground);
  const townBase = new THREE.Mesh(new THREE.BoxGeometry(GRID * PITCH + ROAD + 8, 0.2, GRID * PITCH + ROAD + 8), mat(0x7fcf5a));
  townBase.position.y = -0.05; townBase.receiveShadow = true; group.add(townBase);

  // Roads
  const roadMat = mat(0x4b4860), lineMat = mat(0xf2e3a0);
  for (let i = 0; i <= GRID; i++) {
    const len = GRID * PITCH + ROAD;
    const h = new THREE.Mesh(new THREE.BoxGeometry(len, 0.12, ROAD), roadMat);
    h.position.set(0, 0.06, road(i)); h.receiveShadow = true; group.add(h);
    const v = new THREE.Mesh(new THREE.BoxGeometry(ROAD, 0.13, len), roadMat);
    v.position.set(road(i), 0.065, 0); v.receiveShadow = true; group.add(v);
    for (let k = 0; k < GRID; k++) {
      for (const off of [-5, 0, 5]) {
        const dh = new THREE.Mesh(new THREE.BoxGeometry(2, 0.14, 0.3), lineMat);
        dh.position.set(blockCentre(k) + off, 0.07, road(i)); group.add(dh);
        const dv = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, 2), lineMat);
        dv.position.set(road(i), 0.075, blockCentre(k) + off); group.add(dv);
      }
    }
  }
  // Street lamps at intersections
  for (let i = 0; i <= GRID; i++) for (let j = 0; j <= GRID; j++) {
    if ((i + j) % 2) continue;
    const x = road(i) + 2.6, z = road(j) + 2.6;
    group.add(box(0.3, 3.2, 0.3, 0x2b2840, x, 0, z));
    group.add(box(0.8, 0.5, 0.8, 0, x, 3.2, z, lampMat));
  }

  const windowsOn = (g, w, h, d, rows, m = windowMat) => {
    for (let r = 0; r < rows; r++) {
      const y = 1.2 + r * 2.2;
      if (y > h - 0.8) break;
      for (let k = -1; k <= 1; k += 2) {
        g.add(box(1.1, 0.9, 0.12, 0, k * w * 0.25, y, d / 2 + 0.02, m));
        g.add(box(1.1, 0.9, 0.12, 0, k * w * 0.25, y, -d / 2 - 0.02, m));
      }
    }
  };

  // Trees
  for (const t of town.trees) {
    const { x, z, s } = t;
    group.add(box(0.6 * s, 1.6 * s, 0.6 * s, 0x7a5232, x, 0, z));
    group.add(box(2.4 * s, 2 * s, 2.4 * s, t.color, x, 1.5 * s, z));
    group.add(box(1.4 * s, 1 * s, 1.4 * s, 0x5cc454, x, 3.4 * s, z));
  }

  // Lakes (no building, just water)
  for (const b of town.blocks) {
    if (b.use !== "lake") continue;
    const cx = blockCentre(b.i), cz = blockCentre(b.j);
    group.add(box(15, 0.25, 15, 0x3fa7e0, cx, -0.05, cz));
    group.add(box(3, 0.4, 1.4, 0xffffff, cx + 2, 0.1, cz - 1));
  }

  // Buildings
  for (const b of town.buildings) {
    const { x: cx, z: cz, w, d, h } = b;
    const g = new THREE.Group();
    if (b.kind === "home") {
      g.add(box(w, h, d, b.wall));
      g.add(box(w + 0.6, 0.7, d + 0.6, b.roof, 0, h, 0));
      g.add(box(w * 0.65, 0.7, d * 0.65, b.roof, 0, h + 0.7, 0));
      g.add(box(w * 0.3, 0.6, d * 0.3, b.roof, 0, h + 1.4, 0));
      windowsOn(g, w, h, d, 1);
      g.add(box(0.9, 1.6, 0.2, 0x5a3a2a, 0, 0, d / 2 + 0.05));
      g.rotation.y = Math.round(b.facing / (Math.PI / 2)) * (Math.PI / 2);
    } else if (b.lot && b.kind !== "food") {
      // A real place on a lot (real-town layout): body, roof, door, and a small marker for its kind.
      g.add(box(w, h, d, b.wall));
      g.add(box(w + 0.4, 0.5, d + 0.4, b.roof, 0, h, 0));
      windowsOn(g, w, h, d, b.kind === "office" ? 4 : 1, b.kind === "library" ? libraryWindowMat : windowMat);
      g.add(box(1.1, 1.8, 0.2, 0x4a3a2a, 0, 0, d / 2 + 0.05));
      if (b.kind === "clinic" || b.kind === "pharmacy") { g.add(box(1.6, 0.5, 0.3, 0xffffff, 0, h + 0.8, 0)); g.add(box(0.5, 1.6, 0.3, 0xffffff, 0, h + 0.35, 0)); }
      else if (b.kind === "worship") { g.add(box(1.4, 3.2, 1.4, b.wall, 0, h + 0.5, -d / 4)); g.add(box(1.8, 0.6, 1.8, b.roof, 0, h + 3.7, -d / 4)); }
      else if (b.kind === "fire_station") g.add(box(w * 0.6, 2.2, 0.15, 0xb02a2a, 0, 0, d / 2 + 0.1));
      else if (b.kind === "police") g.add(box(0.8, 0.5, 0.8, 0x3f7fd6, 0, h + 0.5, 0));
      else if (b.kind === "post_office") g.add(box(0.7, 1.1, 0.6, 0x2f5fb3, w / 2 - 0.6, 0, d / 2 + 0.6));
      else if (b.kind === "townhall") { g.add(box(2, 3, 2, b.wall, 0, h + 0.5, 0)); g.add(box(2.4, 0.5, 2.4, b.roof, 0, h + 3.5, 0)); }
      else if (b.kind === "library") for (let k = -1; k <= 1; k++) g.add(box(0.5, h - 0.6, 0.5, 0xffffff, k * 2, 0, d / 2 + 0.4));
      g.rotation.y = Math.round(b.facing / (Math.PI / 2)) * (Math.PI / 2);
    } else if (b.id.startsWith("work-")) {
      g.add(box(w, h, d, b.color));
      g.add(box(w + 0.4, 0.5, d + 0.4, 0x6e6a8a, 0, h, 0));
      windowsOn(g, w, h, d, 6);
    } else if (b.id === "cafe" || b.kind === "food") {
      g.add(box(6, 3.6, 6, 0xf5e6d0));
      for (let k = 0; k < 6; k++) g.add(box(1, 0.5, 1.6, k % 2 ? 0xff5d6c : 0xffffff, -2.5 + k, 2.8, 3.6));
      g.add(box(6.4, 0.4, 6.4, 0x8c5a2b, 0, 3.6, 0));
      windowsOn(g, 6, 3.6, 6, 1);
    } else if (b.id === "library") {
      g.add(box(16, 0.6, 16, 0xd8d2c0));
      g.add(box(12, 5.5, 8, 0xe9dcc0, 0, 0.6, -1));
      g.add(box(13, 0.8, 9, 0x7a6a9a, 0, 6.1, -1));
      g.add(box(9, 0.8, 6, 0x7a6a9a, 0, 6.9, -1));
      for (let k = -2; k <= 2; k++) g.add(box(0.8, 5, 0.8, 0xffffff, k * 2.4, 0.6, 3.6));
      g.add(box(12.4, 0.6, 1.6, 0xffffff, 0, 5.6, 3.6));
      g.add(box(6, 0.3, 2, 0xcfc8b4, 0, 0.6, 5.2));
      for (let r = 0; r < 2; r++) for (let k = -2; k <= 2; k++) g.add(box(1.4, 1.4, 0.15, 0, k * 2.3, 1.6 + r * 2.1, 3.02, libraryWindowMat));
      for (let r = 0; r < 2; r++) for (let k = -2; k <= 2; k++) g.add(box(1.4, 1.4, 0.15, 0, k * 2.3, 1.6 + r * 2.1, -5.02, libraryWindowMat));
      g.rotation.y = Math.round(b.facing / (Math.PI / 2)) * (Math.PI / 2);
    } else if (b.id === "townhall") {
      g.add(box(11, 6, 10, 0xe0d6c8));
      g.add(box(11.6, 0.6, 10.6, 0x5a4a8a, 0, 6, 0));
      g.add(box(3, 6, 3, 0xe0d6c8, 0, 6.6, 0));
      g.add(box(3.4, 0.6, 3.4, 0x5a4a8a, 0, 12.6, 0));
      g.add(box(1.6, 1.6, 0.2, 0xffffff, 0, 10.2, 1.55));
      windowsOn(g, 11, 6, 10, 2);
    } else if (b.kind === "school") {
      g.add(box(13, 5, 8, 0xc8664e));
      g.add(box(13.6, 0.6, 8.6, 0x6e3b2e, 0, 5, 0));
      g.add(box(0.2, 8, 0.2, 0xdddddd, 7.5, 0, 4.5));
      g.add(box(1.8, 1.1, 0.1, 0x59c2ff, 8.4, 6.8, 4.5));
      windowsOn(g, 13, 5, 8, 2);
    } else if (b.id === "plaza") {
      group.add(box(16, 0.2, 16, 0xd8cfc0, cx, 0, cz));
      group.add(box(4, 0.8, 4, 0x9aa3b8, cx, 0.2, cz));
      group.add(box(3, 0.3, 3, 0x59c2ff, cx, 1, cz));
      group.add(box(0.6, 2.2, 0.6, 0x9aa3b8, cx, 1, cz));
      b.mesh = null;
      continue;
    } else if (b.kind === "sports") {
      group.add(box(16, 0.15, 16, 0x4fae4a, cx, 0, cz));
      for (const [lw, ld, ox, oz] of [[12, 0.25, 0, -5], [12, 0.25, 0, 5], [0.25, 10, -6, 0], [0.25, 10, 6, 0], [0.25, 10, 0, 0]]) group.add(box(lw, 0.18, ld, 0xffffff, cx + ox, 0.02, cz + oz));
      b.mesh = null;
      continue;
    } else if (b.kind === "park") {
      group.add(box(16, 0.15, 16, 0x5fb84a, cx, 0, cz));
      group.add(box(5, 0.2, 4, 0x59c2ff, cx + 2, 0.05, cz + 2));
      b.mesh = null;
      continue;
    }
    g.position.set(cx, 0, cz);
    group.add(g);
    b.mesh = g;
  }

  return { ...town, group };
}
