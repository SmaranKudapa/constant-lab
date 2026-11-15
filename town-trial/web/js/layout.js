// Procedural town layout, seeded by the city name. Pure data: no three.js, so
// the same module runs in the browser (town.js renders it) and in Node (the
// simulator workers on Modal). The RNG call order is part of the contract:
// the same city name must give the same town, residents and decorations in
// both places. Check with `node town-trial/tests/parity_check.mjs`.
import { makeRng, hashString } from "./rng.js";

export const GRID = 6, PITCH = 20, ROAD = 4, HALF = (GRID * PITCH) / 2;
export const road = (i) => -HALF + i * PITCH;          // road centre line i = 0..GRID
export const blockCentre = (i) => road(i) + PITCH / 2;  // block i = 0..GRID-1

const STREETS = ["Main", "Maple", "Oak", "Elm", "Church", "Mill", "River", "Pine", "Park", "School", "Cedar", "Union", "Bridge", "Spring"];
const WALLS = [0xf2e3c6, 0xe8c9a0, 0xd8e6f0, 0xf0d0d8, 0xd6e8c8, 0xf5f0e6, 0xe0d4f0];
const ROOFS = [0xb3412f, 0x5a4a8a, 0x3f6e8c, 0x7a3b2e, 0x4d7a3a, 0x8c5a2b];
const TREE_COLORS = [0x3e9a3a, 0x4fb248, 0x2f8a3a];
const OFFICE_COLORS = [0xc9cbe0, 0xb8c4d6, 0xd9cdb8, 0xa9b7c9];

// Doors, road points and walking paths on the schematic grid (shared by both layouts; pure geometry).
function gridHelpers(hStreets, vStreets) {
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

  const placeAt = (b, bi, bj) => {
    const rp = nearestRoadPoint(b.x, b.z, bi, bj);
    const dx = rp.x - b.x, dz = rp.z - b.z;
    const len = Math.hypot(dx, dz) || 1;
    const reach = b.outdoor ? 0 : Math.min(len - ROAD / 2 - 0.4, (Math.abs(dx) > Math.abs(dz) ? b.w : b.d) / 2 + 0.6);
    b.door = { x: b.x + (dx / len) * reach, z: b.z + (dz / len) * reach };
    b.roadPt = { x: rp.x - (dx / len) * (ROAD / 2 - 0.6), z: rp.z - (dz / len) * (ROAD / 2 - 0.6) };
    b.nodes = rp.nodes;
    b.facing = Math.atan2(dx, dz);
    b.street = Math.abs(dx) > Math.abs(dz) ? vStreets[rp.nodes[0][0]] : hStreets[rp.nodes[0][1]];
    return b;
  };

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

  return { placeAt, pathBetween, pathFromPoint };
}

// Returns { name, buildings, byId, homes, works, blocks, trees, pathBetween, pathFromPoint, size }.
// Buildings carry what the renderer needs (sizes, colours); `mesh` is added by town.js.
export function layoutTown(cityName, spec = null) {
  if (spec && spec.blocks) return layoutFromSpec(cityName, spec);
  const rng = makeRng("town:" + cityName.toLowerCase().trim());
  const buildings = [];
  const byId = {};
  const trees = [];
  const add = (b) => { buildings.push(b); byId[b.id] = b; return b; };

  const roofSet = rng.shuffle(ROOFS).slice(0, 3);
  const wallSet = rng.shuffle(WALLS).slice(0, 4);
  const hStreets = rng.shuffle(STREETS).slice(0, GRID + 1);
  const vStreets = rng.shuffle(STREETS.filter((s) => !hStreets.includes(s)).concat(["1st", "2nd", "3rd", "4th", "5th", "6th", "7th"])).slice(0, GRID + 1);

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

  // Doors and paths (shared with the real-town layout; no RNG involved)
  const grid = gridHelpers(hStreets, vStreets);
  const place = (b, bi, bj) => add(grid.placeAt(b, bi, bj));

  // Trees draw one colour from the RNG; the scale argument is drawn by the caller first.
  const tree = (x, z, s = 1) => { trees.push({ x, z, s, color: rng.pick(TREE_COLORS) }); };

  let homeN = 0, shopN = 0;
  for (const b of blocks) {
    const cx = blockCentre(b.i), cz = blockCentre(b.j);
    if (b.use === "homes") {
      for (const [ox, oz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) {
        if (rng.chance(0.12)) { tree(cx + ox, cz + oz, rng.range(0.8, 1.1)); continue; }
        const w = rng.int(4, 5), d = rng.int(4, 5), h = rng.int(3, 4);
        const wall = rng.pick(wallSet), roof = rng.pick(roofSet);
        const bld = place({ id: `home-${++homeN}`, kind: "home", name: "", x: cx + ox, z: cz + oz, w, d, h, wall, roof }, b.i, b.j);
        bld.name = `Home, ${bld.street} St`;
      }
    } else if (b.use === "commercial") {
      const spots = b.hasCafe ? [[-4, -4], [4, -4], [-4, 4]] : [[-4, -4], [4, -4], [-4, 4], [4, 4]];
      for (const [ox, oz] of spots) {
        const w = 6, d = 6, h = rng.int(6, 13);
        const color = rng.pick(OFFICE_COLORS);
        place({ id: `work-${++shopN}`, kind: "work", name: `Offices #${shopN}`, x: cx + ox, z: cz + oz, w, d, h, color }, b.i, b.j);
      }
      if (b.hasCafe) place({ id: "cafe", kind: "cafe", name: "Corner Cafe", x: cx + 4, z: cz + 4, w: 6, d: 6, h: 3.6 }, b.i, b.j);
    } else if (b.use === "library") {
      place({ id: "library", kind: "library", name: "Public Library", x: cx, z: cz, w: 12, d: 8, h: 7 }, b.i, b.j);
      tree(cx - 6, cz + 6, 0.8); tree(cx + 6, cz + 6, 0.8);
    } else if (b.use === "townhall") {
      place({ id: "townhall", kind: "work", name: "Town Hall", x: cx, z: cz, w: 11, d: 10, h: 7 }, b.i, b.j);
    } else if (b.use === "school") {
      place({ id: "school", kind: "school", name: "Elementary School", x: cx, z: cz, w: 13, d: 8, h: 5 }, b.i, b.j);
    } else if (b.use === "plaza") {
      for (const [ox, oz] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) tree(cx + ox, cz + oz, 0.8);
      const plaza = place({ id: "plaza", kind: "plaza", name: "Town Square", x: cx, z: cz, w: 16, d: 16, h: 0, outdoor: true }, b.i, b.j);
      plaza.boardPos = { x: cx + 3.5, z: cz - 3.5 };
    } else if (b.use === "park") {
      for (let k = 0; k < 7; k++) tree(cx + rng.range(-7, 7), cz + rng.range(-7, -1) * (k % 2 ? 1 : -1), rng.range(0.7, 1.1));
      place({ id: "park", kind: "park", name: "Riverside Park", x: cx, z: cz, w: 16, d: 16, h: 0, outdoor: true }, b.i, b.j);
    } else if (b.use === "lake") {
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

  const { pathBetween, pathFromPoint } = grid;
  for (const x of buildings) { x.employs = x.kind === "work"; x.public = x.kind === "library" || x.kind === "park"; }
  const facilities = buildings.filter((x) => x.public);

  return { name: cityName, buildings, byId, homes, works, facilities, blocks, trees, pathBetween, pathFromPoint, size: GRID * PITCH };
}

// ---------- real towns (2A) ----------
// Sizes and colours of the place kinds a real-town spec can contain (see backend/towns.py).
const KIND_STYLE = {
  library: { w: 7, d: 6, h: 5, wall: 0xe9dcc0, roof: 0x7a6a9a }, clinic: { w: 6, d: 6, h: 4, wall: 0xf4f4f4, roof: 0xd94a4a },
  pharmacy: { w: 5, d: 5, h: 3.5, wall: 0xeaf6ea, roof: 0x3fae5a }, community: { w: 6, d: 6, h: 4.5, wall: 0xf0d8b0, roof: 0xb36b2f },
  townhall: { w: 6, d: 6, h: 6, wall: 0xe0d6c8, roof: 0x5a4a8a }, post_office: { w: 5, d: 5, h: 4, wall: 0xdbe6f5, roof: 0x2f5fb3 },
  police: { w: 5, d: 5, h: 4, wall: 0xd0d8e8, roof: 0x24346e }, fire_station: { w: 6, d: 6, h: 4.5, wall: 0xe8c8c0, roof: 0xb02a2a },
  worship: { w: 5, d: 6, h: 5, wall: 0xf2ece0, roof: 0x6b4a3a }, food: { w: 5, d: 5, h: 3.6, wall: 0xf5e6d0, roof: 0x8c5a2b },
  shop: { w: 5, d: 5, h: 3.6, wall: 0xe6e0f0, roof: 0x7a5aa8 }, bank: { w: 5, d: 5, h: 4.5, wall: 0xe8e8e0, roof: 0x6e6a5a },
  office: { w: 6, d: 6, h: 8, wall: 0xc9cbe0, roof: 0x6e6a8a },
};
export const PUBLIC_KINDS = ["library", "clinic", "community", "townhall", "post_office", "sports", "park", "school", "pharmacy"];
const LOTS = [[-4, -4], [4, -4], [-4, 4], [4, 4]];

// The resident sample for a town: real-town specs carry the demographic mix and sample size.
export function residentScenario(spec, scenario = null) {
  if (!spec || !spec.cohort_mix) return scenario || {};
  const base = { mix: { ...spec.cohort_mix }, count: spec.residents };
  if (!scenario) return base;
  return { ...base, ...scenario, mix: { ...base.mix, ...(scenario.mix || {}) } };
}

function layoutFromSpec(cityName, spec) {
  const rng = makeRng("town:" + cityName.toLowerCase().trim());
  const buildings = [], byId = {}, trees = [];
  const add = (b) => { buildings.push(b); byId[b.id] = b; return b; };
  const roofSet = rng.shuffle(ROOFS).slice(0, 3);
  const wallSet = rng.shuffle(WALLS).slice(0, 4);
  // Real street names (from OSM) on the schematic grid lines; fall back to generic names if too few.
  const names = (spec.street_names || []).slice();
  while (names.length < 2 * (GRID + 1)) names.push(`${names.length + 1}${["st", "nd", "rd"][names.length] || "th"} St`.replace(/ St$/, ""));
  const hStreets = names.slice(0, GRID + 1), vStreets = names.slice(GRID + 1, 2 * (GRID + 1));
  const grid = gridHelpers(hStreets, vStreets);
  const place = (b, bi, bj) => add(grid.placeAt(b, bi, bj));
  const tree = (x, z, s = 1) => { trees.push({ x, z, s, color: rng.pick(TREE_COLORS) }); };
  const P = Object.fromEntries((spec.places || []).map((p) => [p.id, p]));
  // Stand-in places keep short labels ("School"); that they are stand-ins is explained in the building's panel
  const meta = (p) => ({ name: p.synthetic ? String(p.name).replace(/\s*\(synthetic[^)]*\)/i, "") : p.name, realName: p.named ? p.name : null, osm: p.osm, synthetic: !!p.synthetic, employs: !!p.employs,
    public: PUBLIC_KINDS.includes(p.kind), hoursOsm: p.hours_osm || null });

  let homeN = 0;
  const blocks = spec.blocks.map((b) => ({ ...b }));
  for (const b of blocks) {
    const cx = blockCentre(b.i), cz = blockCentre(b.j);
    if (b.use === "plaza") {
      for (const [ox, oz] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) tree(cx + ox, cz + oz, 0.8);
      const plaza = place({ id: "plaza", kind: "plaza", name: "Town centre (schematic)", x: cx, z: cz, w: 16, d: 16, h: 0, outdoor: true }, b.i, b.j);
      plaza.boardPos = { x: cx + 3.5, z: cz - 3.5 };
    } else if (b.use === "homes") {
      for (const [ox, oz] of LOTS) {
        if (rng.chance(0.12)) { tree(cx + ox, cz + oz, rng.range(0.8, 1.1)); continue; }
        const w = rng.int(4, 5), d = rng.int(4, 5), h = rng.int(3, 4);
        const wall = rng.pick(wallSet), roof = rng.pick(roofSet);
        const bld = place({ id: `home-${++homeN}`, kind: "home", name: "", x: cx + ox, z: cz + oz, w, d, h, wall, roof }, b.i, b.j);
        bld.name = `Home, ${bld.street}`;
      }
    } else if (b.use === "mixed") {
      b.lots.forEach((id, k) => {
        const p = P[id], st = KIND_STYLE[p.kind] || KIND_STYLE.shop;
        const [ox, oz] = LOTS[k];
        place({ id, kind: p.kind, x: cx + ox, z: cz + oz, w: st.w, d: st.d, h: st.h, wall: st.wall, roof: st.roof, lot: true, ...meta(p) }, b.i, b.j);
      });
      for (let k = b.lots.length; k < 4; k++) tree(cx + LOTS[k][0], cz + LOTS[k][1], 0.9);
    } else if (b.use === "school") {
      const p = P[b.place];
      place({ id: p.id, kind: "school", x: cx, z: cz, w: 13, d: 8, h: 5, ...meta(p) }, b.i, b.j);
    } else if (b.use === "park" || b.use === "sports") {
      const p = P[b.place];
      if (b.use === "park") for (let k = 0; k < 5; k++) tree(cx + rng.range(-7, 7), cz + rng.range(-7, -1) * (k % 2 ? 1 : -1), rng.range(0.7, 1.1));
      place({ id: p.id, kind: b.use, x: cx, z: cz, w: 16, d: 16, h: 0, outdoor: true, ...meta(p) }, b.i, b.j);
    }
  }
  for (let k = 0; k < 40; k++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(HALF + 10, HALF + 40);
    tree(Math.cos(a) * r, Math.sin(a) * r, rng.range(0.9, 1.4));
  }
  for (const x of buildings) if (x.employs === undefined) x.employs = false;
  const homes = buildings.filter((b) => b.kind === "home");
  const works = buildings.filter((b) => b.employs && b.kind !== "school");
  const facilities = buildings.filter((b) => b.public);
  return { name: cityName, real: true, spec, buildings, byId, homes, works, facilities, blocks, trees,
    pathBetween: grid.pathBetween, pathFromPoint: grid.pathFromPoint, size: GRID * PITCH };
}

// Fingerprint of a town and its residents, for browser/Node parity checks.
const BUILDING_KEYS = ["id", "kind", "name", "x", "z", "w", "d", "h", "door", "roadPt", "nodes", "street", "facing", "outdoor", "boardPos"];
export function townFingerprint(town, residents) {
  const b = town.buildings.map((x) => Object.fromEntries(BUILDING_KEYS.map((k) => [k, x[k]])));
  const r = residents.map((x) => ({ ...x, home: x.home.id, work: x.work && x.work.id }));
  return {
    buildings: hashString(JSON.stringify(b)).toString(16),
    residents: hashString(JSON.stringify(r)).toString(16),
    // Edge trees use Math.cos/sin, whose last bit can differ between JS engines; round them.
    trees: hashString(JSON.stringify(town.trees.map((t) => [t.x.toFixed(6), t.z.toFixed(6), t.s.toFixed(6), t.color]))).toString(16),
  };
}
