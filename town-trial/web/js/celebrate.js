// Best-policy celebration: a light beam onto the winning place, voxel confetti that falls with gravity
// and settles on roofs and streets (it stays until the next trial), angels circling the town dropping
// confetti that fades, and everyone jumping with their arms up.
import * as THREE from "three";

const COLORS = [0xffd34d, 0xff7ad9, 0x59c2ff, 0x5be37d, 0xff9f43, 0xff5d6c, 0xffffff, 0xb48ce6];
const CELL = 0.5, EXT = 110, N = Math.round((2 * EXT) / CELL);
const MAIN = 1800, TRAIL = 1400;

function heightField(group) {
  const hf = new Float32Array(N * N);
  const bb = new THREE.Box3();
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return;
    bb.setFromObject(o);
    if (bb.max.x - bb.min.x > 40 || bb.max.z - bb.min.z > 40 || bb.max.y < 0.05) return; // ground slabs and roads stay at 0
    const i0 = Math.max(0, Math.floor((bb.min.x + EXT) / CELL)), i1 = Math.min(N - 1, Math.floor((bb.max.x + EXT) / CELL));
    const j0 = Math.max(0, Math.floor((bb.min.z + EXT) / CELL)), j1 = Math.min(N - 1, Math.floor((bb.max.z + EXT) / CELL));
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) if (hf[i * N + j] < bb.max.y) hf[i * N + j] = bb.max.y;
  });
  return (x, z) => {
    const i = Math.floor((x + EXT) / CELL), j = Math.floor((z + EXT) / CELL);
    return i < 0 || j < 0 || i >= N || j >= N ? 0 : hf[i * N + j];
  };
}

function pool(scene, n) {
  const geo = new THREE.BoxGeometry(0.42, 0.06, 0.26);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff }), n);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  const c = new THREE.Color();
  for (let k = 0; k < n; k++) mesh.setColorAt(k, c.setHex(COLORS[k % COLORS.length]));
  mesh.count = 0;
  scene.add(mesh);
  return { mesh, P: [] };
}

export function createCelebration({ scene, heavenY }) {
  const main = pool(scene, MAIN), trail = pool(scene, TRAIL);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
  let heightAt = () => 0, active = false, spawnLeft = 0, spawnT = 0, t = 0, beam = null, flyers = [], center = { x: 0, z: 0 };

  const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff1a8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  beam = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 5.5, heavenY, 16, 1, true), beamMat);
  beam.visible = false;
  scene.add(beam);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(6, 0.4, 6, 32), new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0 }));
  ring.rotation.x = Math.PI / 2; ring.visible = false;
  scene.add(ring);

  function particle(x, y, z, spread = 1) {
    return { x, y, z, vx: (Math.random() - 0.5) * 3 * spread, vy: -Math.random() * 2, vz: (Math.random() - 0.5) * 3 * spread,
      rx: Math.random() * 6, ry: Math.random() * 6, rz: Math.random() * 6, sx: (Math.random() - 0.5) * 12, sy: (Math.random() - 0.5) * 12,
      ph: Math.random() * 6, landed: false, life: 0, color: (Math.random() * COLORS.length) | 0 };
  }

  function step(P, dt, fade) {
    for (const c of P) {
      if (c.landed) { c.life += dt; continue; }
      c.vy = Math.max(-4.5, c.vy - 9 * dt);                       // flutter: low terminal velocity
      c.ph += dt * 5;
      const sway = Math.sin(c.ph) * 1.6;
      c.x += (c.vx + sway) * dt; c.z += (c.vz + Math.cos(c.ph * 0.8) * 1.2) * dt; c.y += c.vy * dt;
      c.vx *= 0.995; c.vz *= 0.995;
      c.rx += c.sx * dt; c.ry += c.sy * dt;
      const floor = heightAt(c.x, c.z) + 0.04;
      if (c.y <= floor) { c.y = floor + Math.random() * 0.02; c.landed = true; c.rx = 0; c.rz = 0; c.life = 0; }
    }
    if (fade) for (let k = P.length - 1; k >= 0; k--) if (P[k].landed && P[k].life > fade) P.splice(k, 1);
  }

  function draw(pl, fade) {
    const { mesh, P } = pl;
    for (let k = 0; k < P.length; k++) {
      const c = P[k];
      const sc = fade && c.landed ? Math.max(0.001, 1 - Math.max(0, c.life - fade + 1)) : 1;
      e.set(c.rx, c.ry, c.rz); q.setFromEuler(e); s.setScalar(sc); p.set(c.x, c.y, c.z);
      m4.compose(p, q, s); mesh.setMatrixAt(k, m4);
    }
    mesh.count = P.length;
    mesh.instanceMatrix.needsUpdate = true;
  }

  return {
    get active() { return active; },
    // target: {x, z} of the winning place; town: the built town group (for roofs); angels: Researcher objects
    start({ target, townGroup, angels }) {
      this.clear();
      heightAt = heightField(townGroup);
      active = true; t = 0; spawnLeft = MAIN; spawnT = 0;
      center = target || { x: 0, z: 0 };
      beam.position.set(center.x, heavenY / 2, center.z); beam.visible = true;
      ring.position.set(center.x, 0.3, center.z); ring.visible = true;
      flyers = angels.map((a, i) => ({ a, r: 26 + (i % 3) * 14, y: 26 + i * 3.5, w: (i % 2 ? -1 : 1) * (0.35 + i * 0.04), ph: (i / angels.length) * Math.PI * 2 }));
      for (const f of flyers) f.a.startFlight({ cx: 0, cz: 0, r: f.r, y: f.y, w: f.w, ph: f.ph, dur: 24 });
    },
    clear() {
      active = false;
      main.P.length = 0; trail.P.length = 0; main.mesh.count = 0; trail.mesh.count = 0;
      beam.visible = false; ring.visible = false;
      for (const f of flyers) f.a.endFlight(true);
      flyers = [];
    },
    update(dt) {
      if (!active && !main.P.length && !trail.P.length) return;
      t += dt;
      // Burst: most confetti falls in the first ~6 s from a wide sky area over town
      if (spawnLeft > 0) {
        spawnT += dt;
        const n = Math.min(spawnLeft, Math.ceil(dt * 340));
        for (let k = 0; k < n; k++) {
          const near = Math.random() < 0.3;
          const x = near ? center.x + (Math.random() - 0.5) * 24 : (Math.random() - 0.5) * 150, z = near ? center.z + (Math.random() - 0.5) * 24 : (Math.random() - 0.5) * 150;
          main.P.push(particle(x, 30 + Math.random() * 35, z));
        }
        spawnLeft -= n;
      }
      // Angels drop a trail while they circle
      for (const f of flyers) {
        if (!f.a.flying || f.a.flight.returning) continue;
        const n = Math.random() < dt * 40 ? 1 : 0;
        for (let k = 0; k < n + 1 && trail.P.length < TRAIL; k++) trail.P.push(particle(f.a.pos.x, f.a.flyY - 0.5, f.a.pos.z, 0.5));
      }
      step(main.P, dt, 0);
      step(trail.P, dt, 3.5);
      draw(main, 0);
      draw(trail, 3.5);
      // Beam: flash in, pulse, fade
      if (beam.visible) {
        const u = t / 6;
        beamMat.opacity = u < 0.1 ? u * 6 : Math.max(0, 0.6 * (1 - (u - 0.1) / 0.9)) * (0.8 + 0.2 * Math.sin(t * 12));
        beam.scale.set(1 + 0.15 * Math.sin(t * 6), 1, 1 + 0.15 * Math.sin(t * 6));
        ring.material.opacity = Math.max(0, 1 - u);
        ring.scale.setScalar(1 + (t % 1.2) * 2);
        if (u >= 1) { beam.visible = false; ring.visible = false; }
      }
    },
  };
}
