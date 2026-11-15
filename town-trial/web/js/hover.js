// Hover highlight for clickable things (residents, angels, buildings, Heaven stations): a glowing
// back-face outline that pulses gold-white around the object's silhouette, plus a ring of voxel
// sparkles orbiting its base.
import * as THREE from "three";

const outlineMat = new THREE.MeshBasicMaterial({ color: 0xffd34d, side: THREE.BackSide, transparent: true, opacity: 0.9, depthWrite: false });
const sparkMat = new THREE.MeshBasicMaterial({ color: 0xfff6c8, transparent: true, opacity: 0.95 });
const _bb = new THREE.Box3(), _sz = new THREE.Vector3(), _c = new THREE.Vector3();

export function createHover(scene) {
  const shells = new WeakMap();
  let current = null, currentList = null;
  const ring = new THREE.Group();
  const sparks = [];
  for (let k = 0; k < 18; k++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), sparkMat);
    ring.add(m); sparks.push(m);
  }
  ring.visible = false;
  scene.add(ring);
  let ringR = 2, ringH = 2, base = new THREE.Vector3();

  function build(root) {
    _bb.setFromObject(root); _bb.getSize(_sz);
    const t = THREE.MathUtils.clamp(Math.max(_sz.x, _sz.z) * 0.018, 0.045, 0.28);
    const list = [];
    root.updateMatrixWorld(true);
    const meshes = [];
    root.traverse((o) => { if (o.isMesh && !o.userData.isShell && !o.isSprite && o.visible) meshes.push(o); });
    for (const o of meshes) {
      const g = o.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const b = g.boundingBox, w = b.max.x - b.min.x, h = b.max.y - b.min.y, d = b.max.z - b.min.z;
      const ws = new THREE.Vector3(); o.getWorldScale(ws);
      const sh = new THREE.Mesh(g, outlineMat);
      sh.userData.isShell = true;
      sh.raycast = () => {};
      sh.scale.set((w + 2 * t / ws.x) / Math.max(w, 1e-3), (h + 2 * t / ws.y) / Math.max(h, 1e-3), (d + 2 * t / ws.z) / Math.max(d, 1e-3));
      b.getCenter(_c);
      sh.position.set(_c.x * (1 - sh.scale.x), _c.y * (1 - sh.scale.y), _c.z * (1 - sh.scale.z));
      sh.renderOrder = -1;
      sh.visible = false;
      o.add(sh);
      list.push(sh);
    }
    return list;
  }

  return {
    get current() { return current; },
    set(root) {
      if (root === current) return;
      if (currentList) for (const s of currentList) s.visible = false;
      current = root; currentList = null;
      ring.visible = !!root;
      document.body.style.cursor = root ? "pointer" : "";
      if (!root) return;
      let list = shells.get(root);
      if (!list) { list = build(root); shells.set(root, list); }
      for (const s of list) s.visible = true;
      currentList = list;
      _bb.setFromObject(root); _bb.getSize(_sz);
      ringR = Math.max(1.2, Math.hypot(_sz.x, _sz.z) * 0.55);
      ringH = _sz.y;
      const sc = THREE.MathUtils.clamp(ringR * 0.06, 0.18, 0.7);
      for (const m of sparks) m.scale.setScalar(sc);
    },
    update(time) {
      if (!current) return;
      const pulse = 0.5 + 0.5 * Math.sin(time * 6);
      outlineMat.color.setRGB(1, 0.83 + 0.17 * pulse, 0.3 + 0.7 * pulse);
      outlineMat.opacity = 0.65 + 0.35 * pulse;
      _bb.setFromObject(current);
      base.set((_bb.min.x + _bb.max.x) / 2, _bb.min.y, (_bb.min.z + _bb.max.z) / 2);
      ring.position.copy(base);
      sparks.forEach((m, k) => {
        const a = time * 1.8 + (k / sparks.length) * Math.PI * 2;
        const rise = ((time * 0.6 + k / sparks.length) % 1);
        m.position.set(Math.cos(a) * ringR, 0.2 + rise * Math.min(ringH, 6) * 0.9, Math.sin(a) * ringR);
        m.rotation.set(time * 3 + k, time * 2, 0);
        const fade = 1 - rise;
        m.scale.setScalar(Math.max(0.01, fade) * THREE.MathUtils.clamp(ringR * 0.06, 0.18, 0.7));
      });
    },
  };
}
