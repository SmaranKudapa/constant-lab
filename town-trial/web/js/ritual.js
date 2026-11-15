// The policy ritual: whenever a policy starts running (or the user switches to another experiment), a scroll is
// laid on the altar in the middle of Olympus, a beam fires from the altar down onto the town, and a shockwave
// ripples out across the streets. Purely visual: it marks "a new policy is being run".
import * as THREE from "three";

export function createRitual(scene, { altarWorld, getBuildings = () => [], onFire = () => {}, onImpact = () => {}, onBounce = () => {} }) {
  const add = (m) => (scene.add(m), m);
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xbff6ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const beam = add(new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.6, 1, 14, 1, true), beamMat));
  const core = add(new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 1, 8, 1, true), coreMat));
  beam.visible = core.visible = false;
  const rings = [0, 1, 2].map((k) => {
    const m = add(new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 64), new THREE.MeshBasicMaterial({ color: k === 1 ? 0xffd34d : 0x9ff0ff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })));
    m.rotation.x = -Math.PI / 2; m.visible = false;
    return m;
  });
  const dome = add(new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xbff6ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })));
  dome.visible = false;
  const flash = add(new THREE.PointLight(0xbff6ff, 0, 60, 1.5));
  // A scroll rides the beam down, lands like a ragdoll (tumbling, bouncing), then shrinks away
  const scroll = new THREE.Group();
  const parch = new THREE.MeshLambertMaterial({ color: 0xf6e7c1, emissive: 0xffe2a0, emissiveIntensity: 0.35 });
  const gold = new THREE.MeshLambertMaterial({ color: 0xffd34d, emissive: 0xffc23a, emissiveIntensity: 0.4 });
  const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 4.4, 10), parch); roll.rotation.z = Math.PI / 2; scroll.add(roll);
  for (const x of [-2.4, 2.4]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.45, 10), gold); c.rotation.z = Math.PI / 2; c.position.x = x; scroll.add(c); }
  const ribbon = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.5, 1.5), new THREE.MeshLambertMaterial({ color: 0xd94a5a })); scroll.add(ribbon);
  scroll.visible = false; add(scroll);
  const rag = { on: false, v: new THREE.Vector3(), w: new THREE.Vector3(), t: 0 };
  // Collisions: buildings are boxes (x, z, w, d, h; roofs add a little). The scroll lands on roofs and bounces off walls.
  const R = 0.9, ROOF = 1.2;
  const solids = () => (getBuildings() || []).filter((b) => b && !b.outdoor && b.h > 0);
  const inside = (b, x, z, r = R) => Math.abs(x - b.x) < b.w / 2 + r && Math.abs(z - b.z) < b.d / 2 + r;
  const groundAt = (x, z) => { let y = 0; for (const b of solids()) if (inside(b, x, z, 0)) y = Math.max(y, b.h + ROOF); return y; };
  const prev = new THREE.Vector3();
  function scrollUpdate(dt, down, landed) {
    if (!landed) {  // riding the beam
      scroll.visible = true; scroll.scale.setScalar(1);
      scroll.position.copy(end); scroll.position.y = Math.max(end.y + 1.5, groundAt(target.x, target.z) + 1.5);  // never through the roof
      scroll.rotation.x += dt * 6; scroll.rotation.y += dt * 3;
      return;
    }
    if (!rag.on) {  // impact: thrown off with a random tumble
      rag.on = true; rag.t = 0;
      scroll.position.set(target.x, groundAt(target.x, target.z) + 1.5, target.z);  // starts where the beam hits (on the roof if it hits a building)
      const a = Math.random() * Math.PI * 2;
      rag.v.set(Math.cos(a) * 7, 9, Math.sin(a) * 7);
      rag.w.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 14);
    }
    rag.t += dt;
    rag.v.y -= 32 * dt;
    prev.copy(scroll.position);
    scroll.position.addScaledVector(rag.v, dt);
    const p = scroll.position;
    for (const b of solids()) {
      const top = b.h + ROOF;
      if (!inside(b, p.x, p.z) || p.y > top + 0.7) continue;
      if (prev.y >= top + 0.6) {  // came down onto the roof: land on it
        p.y = top + 0.7;
        if (Math.abs(rag.v.y) > 3) onBounce(Math.abs(rag.v.y) / 6);
        rag.v.y = Math.abs(rag.v.y) * 0.38; rag.v.x *= 0.6; rag.v.z *= 0.6; rag.w.multiplyScalar(0.55);
      } else if (!inside(b, prev.x, p.z)) { onBounce(Math.abs(rag.v.x) / 6); p.x = prev.x; rag.v.x *= -0.45; rag.w.multiplyScalar(0.7); }  // hit a wall side-on: bounce back
      else { onBounce(Math.abs(rag.v.z) / 6); p.z = prev.z; rag.v.z *= -0.45; rag.w.multiplyScalar(0.7); }
    }
    if (p.y < 0.7) {  // bounce on the ground, losing energy, spin damped
      p.y = 0.7;
      if (Math.abs(rag.v.y) > 3) onBounce(Math.abs(rag.v.y) / 6);
      rag.v.y = Math.abs(rag.v.y) * 0.38; rag.v.x *= 0.6; rag.v.z *= 0.6; rag.w.multiplyScalar(0.55);
    }
    scroll.rotation.x += rag.w.x * dt; scroll.rotation.y += rag.w.y * dt; scroll.rotation.z += rag.w.z * dt;
    const shrink = rag.t > 1.1 ? Math.max(0, 1 - (rag.t - 1.1) / 0.3) : 1;  // then it disappears quickly by shrinking
    scroll.scale.setScalar(shrink);
    if (shrink <= 0) { scroll.visible = false; }
  }
  let t = -1, target = new THREE.Vector3(), shake = 0;
  const top = altarWorld.clone(), end = new THREE.Vector3(), dir = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

  return {
    get shake() { return shake; },
    get scroll() { return scroll; },  // for tests
    // Fire the beam from the altar to a point in town; delay lets the scroll land first.
    fire(to, delay = 0.35) { target.set(to.x, 0, to.z); t = -delay; rag.on = false; scroll.visible = false; setTimeout(onFire, Math.max(0, delay * 1000)); },
    update(dt) {
      shake = Math.max(0, shake - dt * 2.2);
      if (t === -1 && !beam.visible) return;
      t += dt;
      if (t < 0) return;
      const down = Math.min(1, t / 0.35);             // the beam shoots down from the altar
      end.lerpVectors(top, target, down);
      dir.subVectors(top, end);
      const len = Math.max(0.01, dir.length());
      for (const m of [beam, core]) {
        m.visible = true;
        m.position.addVectors(top, end).multiplyScalar(0.5);
        m.quaternion.setFromUnitVectors(UP, dir.normalize());
        m.scale.set(1, len, 1);
      }
      const hit = t - 0.35;                             // impact: shockwave rings, dome flash, light
      if (!rag.on || scroll.visible) scrollUpdate(dt, down, hit >= 0);
      const fade = hit < 0 ? 1 : Math.max(0, 1 - hit / 1.6);
      beamMat.opacity = 0.55 * fade; coreMat.opacity = 0.95 * fade;
      if (hit >= 0) {
        if (hit < 0.05 && shake < 0.5) { shake = 0.9; onImpact(); }
        rings.forEach((r, k) => {
          const u = Math.max(0, hit - k * 0.18) / 1.5;
          r.visible = u > 0 && u < 1;
          r.position.set(target.x, 0.35 + k * 0.02, target.z);
          r.scale.setScalar(2 + u * (60 + k * 14));
          r.material.opacity = (1 - u) * 0.85;
        });
        const u = Math.min(1, hit / 0.7);
        dome.visible = u < 1; dome.position.copy(target); dome.scale.setScalar(2 + u * 18); dome.material.opacity = (1 - u) * 0.5;
        flash.position.set(target.x, 6, target.z); flash.intensity = Math.max(0, 1 - hit / 0.8) * 1800;
      }
      if (hit > 1.8 && !scroll.visible) { beam.visible = core.visible = false; rings.forEach((r) => (r.visible = false)); dome.visible = false; flash.intensity = 0; t = -1; }
    },
  };
}
