// Procedural blocky town, seeded by the city name.
// Real street maps (OpenStreetMap) can replace buildTown later: the rest of the
// app only needs town.buildings, town.pathBetween and the landmark ids.
import * as THREE from "three";
import { makeRng } from "./rng.js";
import { box, mat, signSprite } from "./voxel.js";

export const GRID = 6, PITCH = 20, ROAD = 4, HALF = (GRID * PITCH) / 2;
const road = (i) => -HALF + i * PITCH;          // road centre line i = 0..GRID
const blockCentre = (i) => road(i) + PITCH / 2;  // block i = 0..GRID-1

export const windowMat = new THREE.MeshLambertMaterial({ color: 0x3a4a6a, emissive: 0xffd77a, emissiveIntensity: 0 });
export const libraryWindowMat = new THREE.MeshLambertMaterial({ color: 0x3a4a6a, emissive: 0xffe9a8, emissiveIntensity: 0 });
export const lampMat = new THREE.MeshLambertMaterial({ color: 0xfff3c4, emissive: 0xffe08a, emissiveIntensity: 0 });

const STREETS = ["Main", "Maple", "Oak", "Elm", "Church", "Mill", "River", "Pine", "Park", "School", "Cedar", "Union", "Bridge", "Spring"];
const WALLS = [0xf2e3c6, 0xe8c9a0, 0xd8e6f0, 0xf0d0d8, 0xd6e8c8, 0xf5f0e6, 0xe0d4f0];
const ROOFS = [0xb3412f, 0x5a4a8a, 0x3f6e8c, 0x7a3b2e, 0x4d7a3a, 0x8c5a2b];

export function buildTown(cityName) {
  const rng = makeRng("town:" + cityName.toLowerCase().trim());
  const group = new THREE.Group();
  const buildings = [];
  const byId = {};
  const add = (b) => { buildings.push(b); byId[b.id] = b; return b; };

  const roofSet = rng.shuffle(ROOFS).slice(0, 3);
  const wallSet = rng.shuffle(WALLS).slice(0, 4);
  const hStreets = rng.shuffle(STREETS).slice(0, GRID + 1);
  const vStreets = rng.shuffle(STREETS.filter((s) => !hStreets.includes(s)).concat(["1st", "2nd", "3rd", "4th", "5th", "6th", "7th"])).slice(0, GRID + 1);

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

  // Assign block uses
  const blocks = [];
  for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) blocks.push({ i, j, use: null });
  const blk = (i, j) => blocks[i * GRID + j];
  const centre = rng.pick([[2, 2], [2, 3], [3, 2], [3, 3]]);
  blk(...centre).use = "plaza";
  const around = rng.shuffle([[1, 0], [-1, 0], [0, 1], [0, -1]]).map(([a, b]) => [centre[0] + a, centre[1] + b]);
  blk(...around[0]).use = "library";
  blk(...around[1]).use = "townhall";
  blk(...around[2]).use = "commercial";
  blk(...around[3]).use = "commercial";
  const free = () => rng.shuffle(blocks.filter((b) => !b.use));
  const ring = (b) => Math.max(Math.abs(b.i - 2.5), Math.abs(b.j - 2.5));
  free().filter((b) => ring(b) <= 1.5).slice(0, 2).forEach((b) => (b.use = "commercial"));
  free().filter((b) => ring(b) > 0.5 && ring(b) <= 2.5)[0].use = "school";
  free().filter((b) => ring(b) > 1.5)[0].use = "park";
  if (rng.chance(0.6)) free().filter((b) => ring(b) > 2)[0].use = "lake";
  blocks.filter((b) => !b.use).forEach((b) => (b.use = "homes"));
  blocks.filter((b) => b.use === "commercial")[0].hasCafe = true;

  // Helpers for doors and paths
  const nearestRoadPoint = (x, z, bi, bj) => {
    // Door faces the closest of the block's four roads.
    const xs = [road(bi), road(bi + 1)], zs = [road(bj), road(bj + 1)];
    const opts = [
      { x: xs[0], z, d: Math.abs(x - xs[0]), axis: "x", line: bi },
      { x: xs[1], z, d: Math.abs(x - xs[1]), axis: "x", line: bi + 1 },
      { x, z: zs[0], d: Math.abs(z - zs[0]), axis: "z", line: bj },
      { x, z: zs[1], d: Math.abs(z - zs[1]), axis: "z", line: bj + 1 },
    ];
    opts.sort((a, b) => a.d - b.d);
    const o = opts[0];
    // Segment end nodes on that road line
    if (o.axis === "x") return { x: o.x, z: o.z, nodes: [[o.line, bj], [o.line, bj + 1]] };
    return { x: o.x, z: o.z, nodes: [[bi, o.line], [bi + 1, o.line]] };
  };

  const place = (b, bi, bj) => {
    const rp = nearestRoadPoint(b.x, b.z, bi, bj);
    const dx = rp.x - b.x, dz = rp.z - b.z;
    const len = Math.hypot(dx, dz) || 1;
    const reach = b.outdoor ? 0 : Math.min(len - ROAD / 2 - 0.4, (Math.abs(dx) > Math.abs(dz) ? b.w : b.d) / 2 + 0.6);
    b.door = { x: b.x + (dx / len) * reach, z: b.z + (dz / len) * reach };
    b.roadPt = { x: rp.x - (dx / len) * (ROAD / 2 - 0.6), z: rp.z - (dz / len) * (ROAD / 2 - 0.6) };
    b.nodes = rp.nodes;
    b.facing = Math.atan2(dx, dz);
    b.street = Math.abs(dx) > Math.abs(dz) ? vStreets[rp.nodes[0][0]] : hStreets[rp.nodes[0][1]];
    return add(b);
  };

  const tree = (x, z, s = 1) => {
    group.add(box(0.6 * s, 1.6 * s, 0.6 * s, 0x7a5232, x, 0, z));
    group.add(box(2.4 * s, 2 * s, 2.4 * s, rng.pick([0x3e9a3a, 0x4fb248, 0x2f8a3a]), x, 1.5 * s, z));
    group.add(box(1.4 * s, 1 * s, 1.4 * s, 0x5cc454, x, 3.4 * s, z));
  };
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

  let homeN = 0, shopN = 0;
  for (const b of blocks) {
    const cx = blockCentre(b.i), cz = blockCentre(b.j);
    if (b.use === "homes") {
      for (const [ox, oz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) {
        if (rng.chance(0.12)) { tree(cx + ox, cz + oz, rng.range(0.8, 1.1)); continue; }
        const w = rng.int(4, 5), d = rng.int(4, 5), h = rng.int(3, 4);
        const g = new THREE.Group();
        const wall = rng.pick(wallSet), roof = rng.pick(roofSet);
        g.add(box(w, h, d, wall));
        g.add(box(w + 0.6, 0.7, d + 0.6, roof, 0, h, 0));
        g.add(box(w * 0.65, 0.7, d * 0.65, roof, 0, h + 0.7, 0));
        g.add(box(w * 0.3, 0.6, d * 0.3, roof, 0, h + 1.4, 0));
        windowsOn(g, w, h, d, 1);
        g.position.set(cx + ox, 0, cz + oz);
        group.add(g);
        const bld = place({ id: `home-${++homeN}`, kind: "home", name: "", x: cx + ox, z: cz + oz, w, d, h, mesh: g }, b.i, b.j);
        bld.name = `Home, ${bld.street} St`;
        g.add(box(0.9, 1.6, 0.2, 0x5a3a2a, 0, 0, d / 2 + 0.05)).rotation.y = 0;
        g.rotation.y = Math.round(bld.facing / (Math.PI / 2)) * (Math.PI / 2);
      }
    } else if (b.use === "commercial") {
      const spots = b.hasCafe ? [[-4, -4], [4, -4], [-4, 4]] : [[-4, -4], [4, -4], [-4, 4], [4, 4]];
      for (const [ox, oz] of spots) {
        const w = 6, d = 6, h = rng.int(6, 13);
        const g = new THREE.Group();
        g.add(box(w, h, d, rng.pick([0xc9cbe0, 0xb8c4d6, 0xd9cdb8, 0xa9b7c9])));
        g.add(box(w + 0.4, 0.5, d + 0.4, 0x6e6a8a, 0, h, 0));
        windowsOn(g, w, h, d, 6);
        g.position.set(cx + ox, 0, cz + oz);
        group.add(g);
        place({ id: `work-${++shopN}`, kind: "work", name: `Offices #${shopN}`, x: cx + ox, z: cz + oz, w, d, h, mesh: g }, b.i, b.j);
      }
      if (b.hasCafe) {
        const g = new THREE.Group();
        g.add(box(6, 3.6, 6, 0xf5e6d0));
        for (let k = 0; k < 6; k++) g.add(box(1, 0.5, 1.6, k % 2 ? 0xff5d6c : 0xffffff, -2.5 + k, 2.8, 3.6));
        g.add(box(6.4, 0.4, 6.4, 0x8c5a2b, 0, 3.6, 0));
        windowsOn(g, 6, 3.6, 6, 1);
        g.position.set(cx + 4, 0, cz + 4);
        group.add(g);
        const s = signSprite("CAFE", { fg: "#ff7ad9", height: 1.3 }); s.position.set(cx + 4, 5.4, cz + 4); group.add(s);
        place({ id: "cafe", kind: "cafe", name: "Corner Cafe", x: cx + 4, z: cz + 4, w: 6, d: 6, h: 3.6, mesh: g }, b.i, b.j);
      }
    } else if (b.use === "library") {
      const g = new THREE.Group();
      g.add(box(16, 0.6, 16, 0xd8d2c0));
      g.add(box(12, 5.5, 8, 0xe9dcc0, 0, 0.6, -1));
      g.add(box(13, 0.8, 9, 0x7a6a9a, 0, 6.1, -1));
      g.add(box(9, 0.8, 6, 0x7a6a9a, 0, 6.9, -1));
      for (let k = -2; k <= 2; k++) g.add(box(0.8, 5, 0.8, 0xffffff, k * 2.4, 0.6, 3.6));
      g.add(box(12.4, 0.6, 1.6, 0xffffff, 0, 5.6, 3.6));
      g.add(box(6, 0.3, 2, 0xcfc8b4, 0, 0.6, 5.2));
      for (let r = 0; r < 2; r++) for (let k = -2; k <= 2; k++) g.add(box(1.4, 1.4, 0.15, 0, k * 2.3, 1.6 + r * 2.1, 3.02, libraryWindowMat));
      for (let r = 0; r < 2; r++) for (let k = -2; k <= 2; k++) g.add(box(1.4, 1.4, 0.15, 0, k * 2.3, 1.6 + r * 2.1, -5.02, libraryWindowMat));
      g.position.set(cx, 0, cz);
      const lib = place({ id: "library", kind: "library", name: "Public Library", x: cx, z: cz, w: 12, d: 8, h: 7, mesh: g }, b.i, b.j);
      g.rotation.y = Math.round(lib.facing / (Math.PI / 2)) * (Math.PI / 2);
      group.add(g);
      tree(cx - 6, cz + 6, 0.8); tree(cx + 6, cz + 6, 0.8);
    } else if (b.use === "townhall") {
      const g = new THREE.Group();
      g.add(box(11, 6, 10, 0xe0d6c8));
      g.add(box(11.6, 0.6, 10.6, 0x5a4a8a, 0, 6, 0));
      g.add(box(3, 6, 3, 0xe0d6c8, 0, 6.6, 0));
      g.add(box(3.4, 0.6, 3.4, 0x5a4a8a, 0, 12.6, 0));
      g.add(box(1.6, 1.6, 0.2, 0xffffff, 0, 10.2, 1.55));
      windowsOn(g, 11, 6, 10, 2);
      g.position.set(cx, 0, cz);
      group.add(g);
      place({ id: "townhall", kind: "work", name: "Town Hall", x: cx, z: cz, w: 11, d: 10, h: 7, mesh: g }, b.i, b.j);
    } else if (b.use === "school") {
      const g = new THREE.Group();
      g.add(box(13, 5, 8, 0xc8664e));
      g.add(box(13.6, 0.6, 8.6, 0x6e3b2e, 0, 5, 0));
      g.add(box(0.2, 8, 0.2, 0xdddddd, 7.5, 0, 4.5));
      g.add(box(1.8, 1.1, 0.1, 0x59c2ff, 8.4, 6.8, 4.5));
      windowsOn(g, 13, 5, 8, 2);
      g.position.set(cx, 0, cz);
      group.add(g);
      const s = signSprite("SCHOOL", { fg: "#ffffff", bg: "#6e3b2e", height: 1.2 }); s.position.set(cx, 7.4, cz); group.add(s);
      place({ id: "school", kind: "school", name: "Elementary School", x: cx, z: cz, w: 13, d: 8, h: 5, mesh: g }, b.i, b.j);
    } else if (b.use === "plaza") {
      group.add(box(16, 0.2, 16, 0xd8cfc0, cx, 0, cz));
      group.add(box(4, 0.8, 4, 0x9aa3b8, cx, 0.2, cz));
      group.add(box(3, 0.3, 3, 0x59c2ff, cx, 1, cz));
      group.add(box(0.6, 2.2, 0.6, 0x9aa3b8, cx, 1, cz));
      for (const [ox, oz] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) tree(cx + ox, cz + oz, 0.8);
      // Notice board
      const nb = new THREE.Group();
      nb.add(box(0.3, 2.4, 0.3, 0x7a5232, -1.2, 0, 0));
      nb.add(box(0.3, 2.4, 0.3, 0x7a5232, 1.2, 0, 0));
      nb.add(box(3, 1.6, 0.25, 0x8c5a2b, 0, 1.4, 0));
      nb.add(box(0.8, 0.9, 0.05, 0xffffff, -0.6, 1.75, 0.15));
      nb.add(box(0.8, 0.6, 0.05, 0xffd34d, 0.5, 1.85, 0.15));
      nb.position.set(cx + 3.5, 0.2, cz - 3.5);
      group.add(nb);
      const plaza = place({ id: "plaza", kind: "plaza", name: "Town Square", x: cx, z: cz, w: 16, d: 16, h: 0, outdoor: true, mesh: null }, b.i, b.j);
      plaza.board = nb;
      plaza.boardPos = { x: cx + 3.5, z: cz - 3.5 };
    } else if (b.use === "park") {
      group.add(box(16, 0.15, 16, 0x5fb84a, cx, 0, cz));
      group.add(box(5, 0.2, 4, 0x59c2ff, cx + 2, 0.05, cz + 2));
      for (let k = 0; k < 7; k++) tree(cx + rng.range(-7, 7), cz + rng.range(-7, -1) * (k % 2 ? 1 : -1), rng.range(0.7, 1.1));
      place({ id: "park", kind: "park", name: "Riverside Park", x: cx, z: cz, w: 16, d: 16, h: 0, outdoor: true, mesh: null }, b.i, b.j);
    } else if (b.use === "lake") {
      group.add(box(15, 0.25, 15, 0x3fa7e0, cx, -0.05, cz));
      group.add(box(3, 0.4, 1.4, 0xffffff, cx + 2, 0.1, cz - 1));
      tree(cx - 6.5, cz - 6.5, 0.8);
    }
  }

  // A few edge trees outside the grid for depth
  for (let k = 0; k < 40; k++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(HALF + 10, HALF + 40);
    tree(Math.cos(a) * r, Math.sin(a) * r, rng.range(0.9, 1.4));
  }

  const homes = buildings.filter((b) => b.kind === "home");
  const works = buildings.filter((b) => b.kind === "work");

  // Walk path between two buildings along the road grid.
  function pathBetween(a, b, xFirst = true, jitter = { x: 0, z: 0 }) {
    const pt = (i, j) => ({ x: road(i) + jitter.x, z: road(j) + jitter.z });
    let best = null;
    for (const na of a.nodes) for (const nb of b.nodes) {
      const d = Math.abs(na[0] - nb[0]) + Math.abs(na[1] - nb[1]);
      const extra = Math.hypot(a.roadPt.x - road(na[0]), a.roadPt.z - road(na[1])) + Math.hypot(b.roadPt.x - road(nb[0]), b.roadPt.z - road(nb[1]));
      const cost = d * PITCH + extra;
      if (!best || cost < best.cost) best = { cost, na, nb };
    }
    const { na, nb } = best;
    const pts = [a.door, a.roadPt, pt(na[0], na[1])];
    if (na[0] !== nb[0] && na[1] !== nb[1]) pts.push(xFirst ? pt(nb[0], na[1]) : pt(na[0], nb[1]));
    pts.push(pt(nb[0], nb[1]), b.roadPt, b.door);
    return pts;
  }

  // Walk path from an arbitrary point on the street (someone re-routed mid-walk).
  function pathFromPoint(p, b, xFirst = true, jitter = { x: 0, z: 0 }) {
    const clampI = (v) => Math.max(0, Math.min(GRID, Math.round((v + HALF) / PITCH)));
    const na = [clampI(p.x), clampI(p.z)];
    let nb = b.nodes[0];
    const dist = (n) => Math.abs(n[0] - na[0]) + Math.abs(n[1] - na[1]);
    if (dist(b.nodes[1]) < dist(nb)) nb = b.nodes[1];
    const pt = (i, j) => ({ x: road(i) + jitter.x, z: road(j) + jitter.z });
    const pts = [{ x: p.x, z: p.z }, pt(na[0], na[1])];
    if (na[0] !== nb[0] && na[1] !== nb[1]) pts.push(xFirst ? pt(nb[0], na[1]) : pt(na[0], nb[1]));
    pts.push(pt(nb[0], nb[1]), b.roadPt, b.door);
    return pts;
  }

  return { name: cityName, group, buildings, byId, homes, works, pathBetween, pathFromPoint, size: GRID * PITCH };
}
