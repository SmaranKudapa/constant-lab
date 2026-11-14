// Blocky humans: town residents (who walk the streets) and Heaven researchers.
import * as THREE from "three";
import { box, mat, iconMaterial } from "./voxel.js";

export const SKIN = [0xf1c7a5, 0xd9a07a, 0xb07a55, 0x8a5a3c, 0x5e3b26, 0xf5d6c0];
export const HAIR = [0x2b1d14, 0x5a3a22, 0x8c5a2b, 0xe0c068, 0x1b1530, 0xb3412f, 0xdedede];

export function makeHuman({ shirt, pants = 0x3b3f6b, skin = SKIN[0], hair = HAIR[0], robe = false, halo = false, scale = 1 }) {
  const g = new THREE.Group();
  const legL = new THREE.Group(), legR = new THREE.Group(), armL = new THREE.Group(), armR = new THREE.Group();
  const legColor = robe ? shirt : pants;
  legL.add(box(0.32, 0.75, 0.34, legColor, 0, -0.75, 0)); legL.position.set(-0.19, 0.75, 0);
  legR.add(box(0.32, 0.75, 0.34, legColor, 0, -0.75, 0)); legR.position.set(0.19, 0.75, 0);
  armL.add(box(0.24, 0.62, 0.26, shirt, 0, -0.62, 0)); armL.position.set(-0.43, 1.32, 0);
  armR.add(box(0.24, 0.62, 0.26, shirt, 0, -0.62, 0)); armR.position.set(0.43, 1.32, 0);
  armL.children[0].add(box(0.22, 0.14, 0.24, skin, 0, -0.14, 0));
  armR.children[0].add(box(0.22, 0.14, 0.24, skin, 0, -0.14, 0));
  const body = box(0.64, 0.62, 0.36, shirt, 0, 0.72, 0);
  const head = box(0.5, 0.48, 0.48, skin, 0, 1.36, 0);
  const hairTop = box(0.54, 0.16, 0.52, hair, 0, 1.78, 0);
  const hairBack = box(0.54, 0.34, 0.12, hair, 0, 1.46, -0.22);
  const eyeL = box(0.08, 0.08, 0.02, 0x1b1530, -0.11, 1.56, 0.245);
  const eyeR = box(0.08, 0.08, 0.02, 0x1b1530, 0.11, 1.56, 0.245);
  g.add(legL, legR, armL, armR, body, head, hairTop, hairBack, eyeL, eyeR);
  if (robe) g.add(box(0.72, 0.5, 0.42, shirt, 0, 0.32, 0));
  if (halo) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.06, 4, 8), mat(0xffd34d, 0xffd34d));
    ring.material.emissiveIntensity = 0.8;
    ring.rotation.x = Math.PI / 2; ring.position.y = 2.08;
    g.add(ring);
  }
  g.scale.setScalar(scale);
  g.userData.parts = { legL, legR, armL, armR };
  return g;
}

export function animateWalk(g, phase, amount) {
  const { legL, legR, armL, armR } = g.userData.parts;
  const s = Math.sin(phase) * 0.7 * amount;
  legL.rotation.x = s; legR.rotation.x = -s;
  armL.rotation.x = -s; armR.rotation.x = s;
}

// A resident walking around town. The logic model decides *where* they are;
// this class only animates the walk there.
export class Resident {
  constructor(data, town, scene) {
    this.data = data;
    this.town = town;
    this.mesh = makeHuman({ shirt: data.shirt, pants: data.pants, skin: data.skin, hair: data.hair, scale: 1.3 });
    this.mesh.userData.pick = { kind: "resident", id: data.id };
    this.icon = new THREE.Sprite(iconMaterial("unaware"));
    this.icon.scale.set(1.1, 1.1, 1);
    this.icon.position.y = 2.4;
    this.icon.visible = false;
    this.mesh.add(this.icon);
    scene.add(this.mesh);
    this.at = data.home;
    this.pos = { x: data.home.door.x, z: data.home.door.z };
    this.path = null; this.seg = 0; this.speed = 5;
    this.phase = Math.random() * 6;
    this.jitter = { x: (Math.random() - 0.5) * 2.4, z: (Math.random() - 0.5) * 2.4 };
    this.xFirst = Math.random() < 0.5;
    this.wanderT = 0; this.wanderTo = null;
    this.queueIdx = -1;
    this.mesh.position.set(this.pos.x, 0, this.pos.z);
    this.mesh.visible = false;
  }

  setIcon(kind) {
    if (!kind) { this.icon.visible = false; return; }
    this.icon.material = iconMaterial(kind);
    this.icon.visible = true;
  }

  goTo(building, secondsToArrive) {
    if (building === this.at && !this.path) return;
    const walking = !!this.path;
    const pts = walking
      ? this.town.pathFromPoint(this.pos, building, this.xFirst, this.jitter)
      : this.town.pathBetween(this.at, building, this.xFirst, this.jitter);
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    this.speed = Math.max(4, len / Math.max(0.3, secondsToArrive));
    this.path = pts; this.seg = 1;
    this.at = building;
    this.queueIdx = -1;
    this.wanderTo = null;
    this.mesh.visible = true;
  }

  setQueue(idx) { this.queueIdx = idx; }

  update(dt) {
    let moving = false;
    if (this.path) {
      let step = this.speed * dt;
      while (step > 0 && this.path) {
        const tgt = this.path[this.seg];
        const dx = tgt.x - this.pos.x, dz = tgt.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        if (d <= step) {
          this.pos.x = tgt.x; this.pos.z = tgt.z; step -= d;
          this.seg++;
          if (this.seg >= this.path.length) { this.path = null; this.arrived(); }
        } else {
          this.pos.x += (dx / d) * step; this.pos.z += (dz / d) * step;
          this.mesh.rotation.y = Math.atan2(dx, dz);
          step = 0;
        }
      }
      moving = true;
    } else if (this.at.outdoor) {
      // Mill about outdoors
      this.wanderT -= dt;
      if (!this.wanderTo || this.wanderT <= 0) {
        const b = this.at;
        const target = b.id === "plaza" && Math.random() < 0.3 ? { x: b.boardPos.x, z: b.boardPos.z + 1.6 } : null;
        this.wanderTo = target || { x: b.x + (Math.random() - 0.5) * (b.w - 3), z: b.z + (Math.random() - 0.5) * (b.d - 3) };
        this.wanderT = 2 + Math.random() * 4;
      }
      const dx = this.wanderTo.x - this.pos.x, dz = this.wanderTo.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.1) {
        const s = Math.min(d, 1.6 * dt);
        this.pos.x += (dx / d) * s; this.pos.z += (dz / d) * s;
        this.mesh.rotation.y = Math.atan2(dx, dz);
        moving = true;
      }
    } else if (this.queueIdx >= 0) {
      const b = this.at;
      const ox = Math.sin(b.facing), oz = Math.cos(b.facing);
      const tx = b.door.x + ox * (1.2 + this.queueIdx * 0.9) + oz * 0.8 * ((this.queueIdx % 2) - 0.5);
      const tz = b.door.z + oz * (1.2 + this.queueIdx * 0.9) - ox * 0.8 * ((this.queueIdx % 2) - 0.5);
      const dx = tx - this.pos.x, dz = tz - this.pos.z, d = Math.hypot(dx, dz);
      if (d > 0.05) { const s = Math.min(d, 3 * dt); this.pos.x += (dx / d) * s; this.pos.z += (dz / d) * s; moving = true; }
      this.mesh.rotation.y = b.facing + Math.PI;
    }
    if (moving) this.phase += dt * Math.min(18, 6 + this.speed);
    animateWalk(this.mesh, this.phase, moving ? 1 : 0);
    this.mesh.position.set(this.pos.x, 0, this.pos.z);
  }

  arrived() {
    if (!this.at.outdoor && this.queueIdx < 0) this.mesh.visible = false;
  }
}

// A researcher in Heaven: walks in straight lines between stations.
export class Researcher {
  constructor(spec, scene) {
    this.spec = spec;
    this.mesh = makeHuman({ shirt: spec.robe, skin: spec.skin, hair: spec.hair, robe: true, halo: true });
    this.mesh.userData.pick = { kind: "researcher", id: spec.id };
    this.pos = { ...spec.home };
    this.target = null;
    this.phase = Math.random() * 6;
    this.bubble = null; this.bubbleT = 0;
    this.mesh.position.set(this.pos.x, spec.y, this.pos.z);
    scene.add(this.mesh);
  }
  moveTo(p) { this.target = { x: p.x + (Math.random() - 0.5) * 1.5, z: p.z + (Math.random() - 0.5) * 1.5 }; }
  say(text, seconds = 4) { this.bubble = text; this.bubbleT = seconds; }
  update(dt) {
    let moving = false;
    if (this.target) {
      const dx = this.target.x - this.pos.x, dz = this.target.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.1) this.target = null;
      else { const s = Math.min(d, 4.5 * dt); this.pos.x += (dx / d) * s; this.pos.z += (dz / d) * s; this.mesh.rotation.y = Math.atan2(dx, dz); moving = true; }
    }
    if (this.bubbleT > 0) { this.bubbleT -= dt; if (this.bubbleT <= 0) this.bubble = null; }
    this.phase += dt * 8;
    animateWalk(this.mesh, this.phase, moving ? 1 : 0);
    const bob = Math.sin(this.phase * 0.25) * 0.08;
    this.mesh.position.set(this.pos.x, this.spec.y + bob, this.pos.z);
  }
}
