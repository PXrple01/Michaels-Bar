// Tageszeit und Wetter einer Kampagne: Der Server zählt die Tage, Claude sagt, wie viel Zeit vergeht.
// Eine lange Rast (Nacht) beginnt einen neuen Tag – dann sind auch „1× pro Tag“-Fähigkeiten wieder frei.
import type { WorldState } from "./world";

export const PHASES = ["morgen", "mittag", "abend", "nacht"] as const;
export type Phase = (typeof PHASES)[number];
export interface GameTime { day: number; phase: Phase; weather: string }

export const PHASE_NAME: Record<Phase, string> = { morgen: "Morgen", mittag: "Mittag", abend: "Abend", nacht: "Nacht" };

/** Startzeit aus dem gewürfelten Einstieg (z. B. „die Nacht vor einem hohen Kirchenfest“, „ein verregneter Herbstmorgen“). */
export function initTime(zeit = ""): GameTime {
  const z = zeit.toLowerCase();
  const phase: Phase = /nacht|mitternacht|finster/.test(z) ? "nacht" : /abend|dämmer|sonnenuntergang|zwielicht/.test(z) ? "abend" : /morgen|früh|sonnenaufgang|tagesanbruch/.test(z) ? "morgen" : "mittag";
  const weather = /regen|verregnet|niesel/.test(z) ? "Regen" : /schnee|frost|eis|winter/.test(z) ? "kalt und klar" : /nebel|dunst/.test(z) ? "Nebel" : /sturm|gewitter|wind/.test(z) ? "stürmisch" : /hitze|sommer|sonnig|schwül/.test(z) ? "warm und sonnig" : "wechselhaft";
  return { day: 1, phase, weather };
}

export type TimeStep = "kurz" | "stunden" | "bis_abend" | "bis_nacht" | "bis_morgen";

/** Zeit vergehen lassen. Gibt zurück, ob ein neuer Tag begonnen hat. */
export function advanceTime(t: GameTime, step: TimeStep): boolean {
  const i = PHASES.indexOf(t.phase);
  const goTo = (target: Phase, alwaysForward = false) => {
    const j = PHASES.indexOf(target);
    const newDay = j < i || (alwaysForward && j === i);
    if (newDay) t.day++;
    t.phase = target;
    return newDay;
  };
  switch (step) {
    case "kurz": return false;
    case "stunden": return goTo(PHASES[(i + 1) % 4]);
    case "bis_abend": return goTo("abend");
    case "bis_nacht": return goTo("nacht");
    case "bis_morgen": return goTo("morgen", true);
  }
}

export const timeLine = (t: GameTime) => `Tag ${t.day}, ${PHASE_NAME[t.phase]} · Wetter: ${t.weather}`;

export function ensureTime(w: WorldState): GameTime {
  w.time ??= { day: 1, phase: "mittag", weather: "wechselhaft" };
  return w.time;
}
