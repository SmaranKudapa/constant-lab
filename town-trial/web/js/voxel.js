// Small helpers for blocky geometry and pixel-font sprites.
import * as THREE from "three";

const geoCache = new Map();
const matCache = new Map();

// Box geometry whose origin sits at the bottom centre, so y = ground level.
export function boxGeo(w, h, d) {
  const key = `${w}|${h}|${d}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d);
    g.translate(0, h / 2, 0);
    geoCache.set(key, g);
  }
  return g;
}

export function mat(color, emissive = null) {
  const key = `${color}|${emissive}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color });
    if (emissive !== null) { m.emissive = new THREE.Color(emissive); m.emissiveIntensity = 0; }
    matCache.set(key, m);
  }
  return m;
}

export function box(w, h, d, color, x = 0, y = 0, z = 0, material = null) {
  const m = new THREE.Mesh(boxGeo(w, h, d), material || mat(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// Text drawn on a tiny canvas and scaled up with nearest-neighbour filtering.
export function textTexture(text, { fg = "#ffd34d", bg = "#1b1530", border = "#0d0a18", size = 8, pad = 3 } = {}) {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  ctx.font = `${size}px "Press Start 2P"`;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2 + 2;
  const h = size + pad * 2 + 2;
  c.width = w; c.height = h;
  ctx.fillStyle = border; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = bg; ctx.fillRect(1, 1, w - 2, h - 2);
  ctx.font = `${size}px "Press Start 2P"`;
  ctx.textBaseline = "top";
  ctx.fillStyle = fg;
  ctx.fillText(text, pad + 1, pad + 1);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, aspect: w / h };
}

const iconCache = new Map();
// Status icons that float above residents.
const ICONS = {
  unaware: { text: "?", fg: "#cfc6e6", bg: "#3a3158" },
  aware: { text: "!", fg: "#1b1530", bg: "#ffd34d" },
  acted: { text: "*", fg: "#1b1530", bg: "#5be37d" },
  going: { text: ">", fg: "#1b1530", bg: "#59c2ff" },
  waiting: { text: "~", fg: "#1b1530", bg: "#ffffff" },
  served: { text: "+", fg: "#1b1530", bg: "#5be37d" },
  turned: { text: "x", fg: "#ffffff", bg: "#ff5d6c" },
};
export function iconSprite(kind) {
  let entry = iconCache.get(kind);
  if (!entry) {
    const spec = ICONS[kind];
    entry = textTexture(spec.text, { fg: spec.fg, bg: spec.bg, size: 8, pad: 2 });
    entry.material = new THREE.SpriteMaterial({ map: entry.tex, depthTest: true });
    iconCache.set(kind, entry);
  }
  const s = new THREE.Sprite(entry.material);
  s.scale.set(0.9, 0.9, 1);
  return s;
}
export function iconMaterial(kind) {
  if (!iconCache.has(kind)) iconSprite(kind);
  return iconCache.get(kind).material;
}

export function signSprite(text, opts = {}) {
  const { tex, aspect } = textTexture(text, opts);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
  const h = opts.height || 1.6;
  s.scale.set(h * aspect, h, 1);
  return s;
}
