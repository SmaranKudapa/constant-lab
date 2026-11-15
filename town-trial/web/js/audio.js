// Sound: every effect and the music are synthesised with Web Audio (no audio files, nothing to license).
// Browsers only allow sound after the user interacts, so the context starts on the first click or key press.
// One mute switch (the ♪ button) covers effects and music; the choice is remembered in this browser.

let ctx = null, master = null, sfxBus = null, musicBus = null, noiseBuf = null;
let muted = false;
try { muted = localStorage.getItem("tt-sound") === "off"; } catch (e) { /* storage blocked */ }

function init() {
  if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = muted ? 0 : 0.8; master.connect(ctx.destination);
  sfxBus = ctx.createGain(); sfxBus.gain.value = 0.55; sfxBus.connect(master);
  musicBus = ctx.createGain(); musicBus.gain.value = 0.16; musicBus.connect(master);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  startMusic();
}
for (const ev of ["pointerdown", "keydown"]) window.addEventListener(ev, init, { passive: true });

const ready = () => ctx && !muted && ctx.state === "running";
const now = () => ctx.currentTime;

function tone({ f = 440, f2 = null, type = "square", t = 0, dur = 0.12, vol = 0.3, attack = 0.005, bus = sfxBus }) {
  const o = ctx.createOscillator(), g = ctx.createGain(), s = now() + t;
  o.type = type; o.frequency.setValueAtTime(f, s);
  if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), s + dur);
  g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(vol, s + attack); g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
  o.connect(g); g.connect(bus); o.start(s); o.stop(s + dur + 0.05);
}
function noise({ t = 0, dur = 0.3, vol = 0.3, f = 1200, f2 = null, q = 1, type = "bandpass" }) {
  const n = ctx.createBufferSource(), flt = ctx.createBiquadFilter(), g = ctx.createGain(), s = now() + t;
  n.buffer = noiseBuf; flt.type = type; flt.Q.value = q; flt.frequency.setValueAtTime(f, s);
  if (f2) flt.frequency.exponentialRampToValueAtTime(Math.max(20, f2), s + dur);
  g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(vol, s + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
  n.connect(flt); flt.connect(g); g.connect(sfxBus); n.start(s); n.stop(s + dur + 0.05);
}

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);  // MIDI note -> Hz
let lastBlip = 0;

export const sfx = {
  click() { if (ready()) tone({ f: 900, f2: 1300, dur: 0.05, vol: 0.12 }); },
  blip(pitch = 0) {  // a god acts (rate-limited so a busy log stays pleasant)
    if (!ready() || now() - lastBlip < 0.35) return;
    lastBlip = now();
    tone({ f: NOTE(76 + pitch), type: "triangle", dur: 0.07, vol: 0.06 });
  },
  whoosh() { if (ready()) { noise({ dur: 0.45, vol: 0.35, f: 3000, f2: 300, q: 2 }); tone({ f: 1200, f2: 200, type: "sine", dur: 0.4, vol: 0.12 }); } },
  boom() {
    if (!ready()) return;
    tone({ f: 120, f2: 35, type: "sine", dur: 0.7, vol: 0.6 });
    noise({ dur: 0.5, vol: 0.4, f: 500, f2: 80, type: "lowpass" });
    tone({ f: NOTE(84), type: "triangle", t: 0.02, dur: 0.6, vol: 0.08 });
  },
  thud(strength = 1) { if (ready()) { const v = Math.min(0.35, 0.08 + 0.05 * strength); tone({ f: 180, f2: 70, type: "sine", dur: 0.12, vol: v }); noise({ dur: 0.08, vol: v * 0.6, f: 700, type: "lowpass" }); } },
  coin() { if (ready()) { tone({ f: NOTE(88), type: "square", dur: 0.08, vol: 0.12 }); tone({ f: NOTE(95), type: "square", t: 0.08, dur: 0.25, vol: 0.12 }); } },
  chime() { if (ready()) [72, 76, 79, 84].forEach((n, k) => tone({ f: NOTE(n), type: "triangle", t: k * 0.09, dur: 0.5, vol: 0.16 })); },
  fanfare() {
    if (!ready()) return;
    [[67, 0], [72, 0.12], [76, 0.24], [79, 0.36], [84, 0.55]].forEach(([n, t]) => { tone({ f: NOTE(n), type: "square", t, dur: n === 84 ? 0.7 : 0.16, vol: 0.12 }); tone({ f: NOTE(n - 12), type: "triangle", t, dur: 0.3, vol: 0.1 }); });
    noise({ t: 0.55, dur: 0.6, vol: 0.12, f: 6000, type: "highpass" });
  },
  fail() { if (ready()) { tone({ f: 220, f2: 110, type: "sawtooth", dur: 0.45, vol: 0.12 }); tone({ f: 207, f2: 104, type: "sawtooth", t: 0.05, dur: 0.45, vol: 0.1 }); } },
  build() { if (ready()) [60, 64, 67, 72].forEach((n, k) => tone({ f: NOTE(n), type: "triangle", t: k * 0.07, dur: 0.7, vol: 0.1 })); },
};

// Music: a slow, quiet pentatonic loop (pluck arpeggio over a soft bass), scheduled ahead on the audio clock.
const SCALE = [0, 2, 4, 7, 9];
const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];  // Am F C G
let musicTimer = null, nextT = 0, step = 0;
function startMusic() {
  if (musicTimer) return;
  nextT = now() + 0.3;
  musicTimer = setInterval(() => {
    if (!ctx || ctx.state !== "running") return;
    while (nextT < now() + 0.6) {
      const bar = Math.floor(step / 8) % CHORDS.length, ch = CHORDS[bar], beat = step % 8;
      if (beat === 0) tone({ f: NOTE(ch[0] - 12), type: "sine", t: nextT - now(), dur: 2.2, vol: 0.5, attack: 0.08, bus: musicBus });
      if (beat % 2 === 0 || Math.random() < 0.35) {
        const n = ch[0] + 12 + SCALE[(beat * 3 + bar) % SCALE.length];
        tone({ f: NOTE(n), type: "triangle", t: nextT - now(), dur: 0.5, vol: 0.32, attack: 0.01, bus: musicBus });
      }
      nextT += 0.3; step++;
    }
  }, 120);
}

export function isMuted() { return muted; }
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem("tt-sound", m ? "off" : "on"); } catch (e) { /* storage blocked */ }
  if (master) master.gain.setTargetAtTime(m ? 0 : 0.8, now(), 0.05);
  if (!m) init();
}
