// Time-of-day lighting: a gradient sky dome, a sun that arcs east to west, a moon and stars at night,
// and keyframed light colours so dawn, sunrise, day, sunset, dusk and night each look distinct.
import * as THREE from "three";

// hour, sky top, horizon, sun colour, sun intensity, hemisphere sky, hemisphere ground, hemi intensity, night (0..1)
const KEYS = [
  [0, 0x070820, 0x161a40, 0x8090c0, 0.0, 0x4a5a9a, 0x1a1530, 0.28, 1],
  [4.6, 0x0a0c2a, 0x1d1b45, 0x8090c0, 0.0, 0x4a5a9a, 0x1a1530, 0.28, 1],
  [5.6, 0x3a3f86, 0xf6a0a8, 0xffb0a0, 0.5, 0xa890c8, 0x504060, 0.55, 0.55],
  [6.6, 0x7ab4f2, 0xffd0b0, 0xffd8b0, 1.5, 0xffe2d0, 0x7a6a8a, 0.9, 0.1],
  [8.5, 0x3d9cf5, 0xbfe6ff, 0xfff0d0, 2.1, 0xffffff, 0x6a5a8a, 1.0, 0],
  [16.5, 0x3d9cf5, 0xbfe6ff, 0xfff0d0, 2.1, 0xffffff, 0x6a5a8a, 1.0, 0],
  [18.0, 0x4a68c0, 0xffa060, 0xff9a40, 1.7, 0xffc890, 0x6a4a5a, 0.85, 0.05],
  [19.0, 0x4a2a80, 0xff4a20, 0xff5a20, 1.0, 0xff8a60, 0x4a2a40, 0.65, 0.3],
  [20.0, 0x1c1c55, 0x9a3a6a, 0xc05a6a, 0.15, 0x7a6aa0, 0x2a2040, 0.38, 0.8],
  [21.0, 0x0a0c2a, 0x1d1b45, 0x8090c0, 0.0, 0x4a5a9a, 0x1a1530, 0.28, 1],
  [24, 0x070820, 0x161a40, 0x8090c0, 0.0, 0x4a5a9a, 0x1a1530, 0.28, 1],
];
const SUNRISE = 6.0, SUNSET = 19.3;
const cA = new THREE.Color(), cB = new THREE.Color();

function sample(h) {
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1][0] <= h) i++;
  const a = KEYS[i], b = KEYS[i + 1], u = (h - a[0]) / Math.max(1e-6, b[0] - a[0]);
  const s = u * u * (3 - 2 * u);
  const col = (k) => cA.setHex(a[k]).lerp(cB.setHex(b[k]), s).getHex();
  const num = (k) => a[k] + (b[k] - a[k]) * s;
  return { top: col(1), horizon: col(2), sun: col(3), sunI: num(4), hemiSky: col(5), hemiGround: col(6), hemiI: num(7), night: num(8) };
}

export function createSky(scene, { sun, hemi }) {
  const uniforms = { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color() } };
  const dome = new THREE.Mesh(new THREE.SphereGeometry(800, 32, 16), new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: "varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunCol; varying vec3 vDir;
      void main(){ float y = clamp(vDir.y, -0.2, 1.0); float t = pow(max(y, 0.0), 0.55);
        vec3 c = mix(horizon, top, t);
        float glow = pow(max(dot(normalize(vDir), normalize(sunDir)), 0.0), 8.0);
        c += sunCol * glow * 0.45 * smoothstep(-0.25, 0.1, sunDir.y);
        if (vDir.y < 0.0) c = mix(c, horizon * 0.8, clamp(-vDir.y * 4.0, 0.0, 1.0));
        gl_FragColor = vec4(c, 1.0); }`,
  }));
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  scene.add(dome);

  const discMat = (c) => new THREE.MeshBasicMaterial({ color: c, fog: false, transparent: true, depthWrite: false });
  const sunDisc = new THREE.Mesh(new THREE.PlaneGeometry(46, 46), discMat(0xfff4c0));
  const moonDisc = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), discMat(0xe8ecff));
  const moonBite = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), discMat(0x101438)); // crescent: a dark square overlapping the moon
  moonBite.position.set(9, 6, -0.5); moonDisc.add(moonBite);
  for (const d of [sunDisc, moonDisc]) { d.renderOrder = -9; d.frustumCulled = false; scene.add(d); }

  const starGeo = new THREE.BufferGeometry(), pts = [];
  for (let k = 0; k < 700; k++) {
    const a = Math.random() * Math.PI * 2, y = 0.08 + Math.random() * 0.92, r = Math.sqrt(1 - y * y);
    pts.push(Math.cos(a) * r * 760, y * 760, Math.sin(a) * r * 760);
  }
  starGeo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, fog: false, depthWrite: false }));
  stars.renderOrder = -9; stars.frustumCulled = false;
  scene.add(stars);

  const moon = new THREE.DirectionalLight(0x9fb4ff, 0);
  scene.add(moon);
  const dir = new THREE.Vector3(), mdir = new THREE.Vector3();

  // h: hour of day (0..24). Returns the night factor (0 day .. 1 night) for windows and lamps.
  function update(h, camera, fog) {
    const k = sample(h);
    uniforms.top.value.setHex(k.top); uniforms.horizon.value.setHex(k.horizon); uniforms.sunCol.value.setHex(k.sun);
    // Sun arc: rises in the east (+x), peaks to the south, sets in the west (-x)
    const u = (h - SUNRISE) / (SUNSET - SUNRISE);
    const ang = u * Math.PI;
    dir.set(Math.cos(ang), Math.sin(ang) * 0.85, -0.45).normalize();
    mdir.set(-Math.cos(ang + 0.4), Math.max(0.25, -Math.sin(ang) * 0.8 + 0.2), 0.35).normalize();
    uniforms.sunDir.value.copy(dir);
    sun.color.setHex(k.sun);
    sun.intensity = dir.y > -0.05 ? k.sunI : 0;
    sun.position.copy(dir).multiplyScalar(160);
    sun.target.position.set(0, 0, 0);
    hemi.color.setHex(k.hemiSky); hemi.groundColor.setHex(k.hemiGround); hemi.intensity = k.hemiI;
    moon.intensity = 0.45 * k.night;
    moon.position.copy(mdir).multiplyScalar(160);
    dome.position.copy(camera.position);
    stars.position.copy(camera.position);
    stars.material.opacity = Math.max(0, k.night - 0.15);
    stars.rotation.y = h * 0.02;
    sunDisc.position.copy(camera.position).addScaledVector(dir, 700);
    sunDisc.lookAt(camera.position);
    sunDisc.material.color.setHex(k.sun).lerp(cA.setHex(0xffffff), 0.35);
    sunDisc.material.opacity = THREE.MathUtils.clamp((dir.y + 0.04) * 8, 0, 1);
    moonDisc.position.copy(camera.position).addScaledVector(mdir, 700);
    moonDisc.lookAt(camera.position);
    moonDisc.material.opacity = k.night; moonBite.material.opacity = k.night;
    moonBite.material.color.setHex(k.top);
    if (fog) fog.color.setHex(k.horizon);
    return k.night;
  }
  return { update, sample };
}
