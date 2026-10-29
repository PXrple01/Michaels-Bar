// Stimmungsmusik je Szene: Kampf, Taverne, Wald, Kirche, Stadt, Wildnis, Dunkel, Nacht – gewählt aus Ort,
// Kampf und Tageszeit, sanft übergeblendet. Jede Stimmung wird auf dem Server nur einmal erzeugt.
import { moodOf, type Mood } from "../../../shared/scene";
import type { WorldState } from "../../../shared/world";
import { sessionToken } from "./account";
import { accessCode } from "./gm";
import { settings, onSettings } from "./settings";

const VOLUME = 0.32, FADE_MS = 1800;

const urls = new Map<Mood, Promise<string | null>>();
let wanted: Mood | null = null, playing: { mood: Mood; audio: HTMLAudioElement } | null = null;
let blocked = false;

function fetchUrl(mood: Mood): Promise<string | null> {
  if (!urls.has(mood)) {
    urls.set(mood, fetch(`/api/music/${mood}`, { method: "POST", headers: { "x-access-code": accessCode(), "x-session": sessionToken() } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => (d?.url as string) ?? null)
      .catch(() => null)
      .then((u) => { if (!u) urls.delete(mood); return u; }));
  }
  return urls.get(mood)!;
}

function fade(audio: HTMLAudioElement, to: number, done?: () => void) {
  const from = audio.volume, start = performance.now();
  const step = (t: number) => {
    const k = Math.min(1, (t - start) / FADE_MS);
    audio.volume = Math.max(0, Math.min(1, from + (to - from) * k));
    if (k < 1) requestAnimationFrame(step); else done?.();
  };
  requestAnimationFrame(step);
}

async function apply() {
  const mood = settings().music ? wanted : null;
  if (playing?.mood === mood) return;
  const old = playing;
  playing = null;
  if (old) fade(old.audio, 0, () => old.audio.pause());
  if (!mood) return;
  const url = await fetchUrl(mood);
  if (!url || (settings().music ? wanted : null) !== mood || playing) return;
  const audio = new Audio(url);
  audio.loop = true;
  audio.volume = 0;
  playing = { mood, audio };
  try { await audio.play(); blocked = false; fade(audio, VOLUME); }
  catch { blocked = true; } // Browser erlaubt Ton erst nach einer Berührung – siehe unten
}

/** Musik für diese Szene (null = aus, z. B. beim Verlassen des Abenteuers). */
export function setMusic(w: WorldState | null | undefined) {
  wanted = w === undefined ? null : moodOf(w);
  void apply();
}

// Erst nach der ersten Berührung darf Ton spielen
addEventListener("pointerdown", () => {
  if (blocked && playing) { blocked = false; void playing.audio.play().then(() => fade(playing!.audio, VOLUME)).catch(() => { blocked = true; }); }
}, { passive: true });
onSettings(() => void apply());
