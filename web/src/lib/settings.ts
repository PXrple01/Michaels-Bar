// Einstellungen des Spielers, im Browser gespeichert (localStorage, mit Fallback).

export type DiceThemeId = "obsidian" | "amethyst" | "mitternacht" | "knochen";

export interface Settings {
  diceTheme: DiceThemeId;
  animation: "full" | "short" | "off";
  quality: "auto" | "high" | "simple";
  sound: boolean;
  slowmo: boolean;
  backgroundFx: boolean;
  /** Wird automatisch gesetzt, wenn Würfe auf diesem Gerät ruckeln. */
  lowPerfDetected: boolean;
}

const KEY = "wus.settings.v1";

const defaults = (): Settings => ({
  diceTheme: "obsidian",
  animation: matchMedia("(prefers-reduced-motion: reduce)").matches ? "short" : "full",
  quality: "auto",
  sound: true,
  slowmo: true,
  backgroundFx: true,
  lowPerfDetected: false,
});

let current: Settings = load();
const listeners = new Set<(s: Settings) => void>();

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaults(), ...JSON.parse(raw) };
  } catch { /* privater Modus o. Ä. */ }
  return defaults();
}

export function settings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* ignorieren */ }
  listeners.forEach((l) => l(current));
}

export function onSettings(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Schwaches Gerät? Dann vereinfachte Animation ohne Physik und ohne Schatten. */
export function useSimpleDice(): boolean {
  const s = current;
  if (s.quality === "simple") return true;
  if (s.quality === "high") return false;
  const weak = matchMedia("(pointer: coarse)").matches && (navigator.hardwareConcurrency ?? 8) <= 4;
  return s.lowPerfDetected || weak;
}
