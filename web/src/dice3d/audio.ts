// Würfelgeräusche, live mit der Web Audio API erzeugt (keine Audiodateien nötig).

import { onSettings, settings } from "../lib/settings";

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
/** Gesamtlautstärke aller Geräusche (Regler „Sounds“). */
let out: GainNode | null = null;
const level = () => settings().soundVolume / 100;
onSettings(() => { if (out) out.gain.value = level(); });

function ac(): AudioContext | null {
  if (!ctx) {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    out = ctx.createGain();
    out.gain.value = level();
    out.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate * 0.25, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Muss innerhalb einer Nutzeraktion aufgerufen werden (Browser-Regel für Audio). */
export function unlockAudio() { ac(); }

export function playImpact(kind: "table" | "wall" | "die", strength: number) {
  const a = ac();
  if (!a || !noise) return;
  const t = a.currentTime;
  const vol = Math.min(0.55, (strength / 22) ** 1.3);
  if (vol < 0.012) return;
  const src = a.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.8 + Math.random() * 0.5;
  const bp = a.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = kind === "die" ? 3200 + Math.random() * 1500 : kind === "wall" ? 1400 + Math.random() * 400 : 900 + Math.random() * 500;
  bp.Q.value = kind === "die" ? 6 : 2.2;
  const g = a.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === "die" ? 0.06 : 0.12));
  src.connect(bp).connect(g).connect(out!);
  src.start(t);
  src.stop(t + 0.2);
  if (kind !== "die") {
    // dumpfer Anteil: Holztisch
    const o = a.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(140 + Math.random() * 60, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.08);
    const og = a.createGain();
    og.gain.setValueAtTime(vol * 0.6, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(og).connect(out!);
    o.start(t);
    o.stop(t + 0.12);
  }
}

function tone(freq: number, start: number, dur: number, vol: number, type: OscillatorType = "sine") {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + start;
  const o = a.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out!);
  o.start(t);
  o.stop(t + dur + 0.05);
  return o;
}

export function playCrit() {
  [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(f, i * 0.07, 1.1, 0.12, "triangle"));
  tone(2093, 0.4, 1.4, 0.04);
}

export function playFumble() {
  const o = tone(220, 0, 0.9, 0.16, "sawtooth");
  const a = ac();
  if (o && a) o.frequency.exponentialRampToValueAtTime(55, a.currentTime + 0.9);
  tone(110, 0.05, 0.8, 0.12, "sine");
}

export function playSettle() {
  tone(880, 0, 0.35, 0.05, "sine");
  tone(1320, 0.05, 0.4, 0.035, "sine");
}

/** Feuer fängt: anschwellendes Fauchen mit Knistern (Seitenübergang „Wegbrennen“). */
export function playIgnite(dur = 1.7) {
  const a = ac();
  if (!a || !out || !noise) return;
  const t = a.currentTime;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buf;
  // Fauchen: Rauschen durch einen Bandpass, der nach oben wandert, während das Feuer wächst
  const bp = a.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 0.8;
  bp.frequency.setValueAtTime(200, t);
  bp.frequency.exponentialRampToValueAtTime(1600, t + dur * 0.75);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.34, t + dur * 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(g).connect(out);
  src.start(t);
  src.stop(t + dur);
  // Knistern: kurze, helle Knackser zu zufälligen Zeiten
  for (let i = 0; i < 28; i++) {
    const at = t + 0.08 + Math.random() * dur * 0.85;
    const c = a.createBufferSource();
    c.buffer = noise;
    c.playbackRate.value = 1.5 + Math.random();
    const hp = a.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2200 + Math.random() * 2500;
    const cg = a.createGain();
    const v = 0.05 + Math.random() * 0.14;
    cg.gain.setValueAtTime(v, at);
    cg.gain.exponentialRampToValueAtTime(0.0001, at + 0.03 + Math.random() * 0.04);
    c.connect(hp).connect(cg).connect(out);
    c.start(at);
    c.stop(at + 0.1);
  }
}
