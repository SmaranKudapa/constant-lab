// The policy ritual: whenever a policy starts running (or the user switches to another experiment), a scroll is
// laid on the altar in the middle of Olympus, a beam fires from the altar down onto the town, and a shockwave
// ripples out across the streets. Purely visual: it marks "a new policy is being run".
import * as THREE from "three";

export function createRitual(scene, { altarWorld }) {
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
  let t = -1, target = new THREE.Vector3(), shake = 0;
  const top = altarWorld.clone(), end = new THREE.Vector3(), dir = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

  return {
    get shake() { return shake; },
    // Fire the beam from the altar to a point in town; delay lets the scroll land first.
    fire(to, delay = 0.35) { target.set(to.x, 0, to.z); t = -delay; },
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
      const fade = hit < 0 ? 1 : Math.max(0, 1 - hit / 1.6);
      beamMat.opacity = 0.55 * fade; coreMat.opacity = 0.95 * fade;
      if (hit >= 0) {
        if (hit < 0.05 && shake < 0.5) shake = 0.9;
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
      if (hit > 1.8) { beam.visible = core.visible = false; rings.forEach((r) => (r.visible = false)); dome.visible = false; flash.intensity = 0; t = -1; }
    },
  };
}
