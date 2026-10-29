// Erfolge: kleine Meilensteine über alle Figuren und Abenteuer eines Kontos. Geprüft wird im Browser aus den
// gespeicherten Spielständen (Solo) und den zuletzt gesehenen Gruppenständen; einmal freigeschaltet bleibt freigeschaltet.
import type { RollRecord } from "./dice";
import type { WorldState } from "./world";

/** Was aus einem Abenteuer für die Erfolge zählt (für eine Figur). */
export interface RunSummary {
  group: boolean;
  turns: number;
  finished: boolean;
  defeat: boolean;
  level: number;
  places: number;
  friends: number;
  money: number;
  questsDone: number;
  gear: number;
  day: number;
  crits: number;
  fumbles: number;
}

export interface AchievementStats { characters: number; classes: number; runs: RunSummary[] }

export interface Achievement {
  id: string;
  name: string;
  text: string;
  icon: string;
  /** Fortschritt [jetzt, Ziel] – erreicht, wenn jetzt ≥ Ziel. */
  progress(s: AchievementStats): [number, number];
}

/** Ein Abenteuer zusammenfassen. `rolls` = nur eigene Würfe (keine Gegner- oder Schadenswürfe des Servers). */
export function summarizeRun(w: WorldState | null | undefined, charId: string, rolls: RollRecord[], turns: number, group: boolean): RunSummary {
  const gear = w?.gear?.[charId];
  return {
    group, turns,
    finished: !!w?.arc?.finished && w.arc.outcome !== "niederlage",
    defeat: w?.arc?.outcome === "niederlage",
    level: w?.levels?.[charId]?.level ?? 1,
    places: w?.map?.places.length ?? 0,
    friends: w?.people?.filter((p) => p.attitude === "freund").length ?? 0,
    money: w?.inventory?.[charId]?.money ?? 0,
    questsDone: w?.quests.filter((q) => q.status === "erledigt").length ?? 0,
    gear: gear ? gear.angriff + gear.schaden + gear.ruestung : 0,
    day: w?.time?.day ?? 1,
    crits: rolls.filter((r) => r.critical === "hit").length,
    fumbles: rolls.filter((r) => r.critical === "fumble").length,
  };
}

const count = (s: AchievementStats, f: (r: RunSummary) => boolean) => s.runs.filter(f).length;
const sum = (s: AchievementStats, f: (r: RunSummary) => number) => s.runs.reduce((n, r) => n + f(r), 0);
const best = (s: AchievementStats, f: (r: RunSummary) => number) => Math.max(0, ...s.runs.map(f));

export const ACHIEVEMENTS: Achievement[] = [
  { id: "erste-figur", name: "Ein Name in der Chronik", text: "Erschaffe deine erste Figur.", icon: "feather", progress: (s) => [s.characters, 1] },
  { id: "gefolge", name: "Gefolgschaft", text: "Erschaffe drei Figuren.", icon: "users", progress: (s) => [s.characters, 3] },
  { id: "eigene-klasse", name: "Zunftmeister", text: "Erfinde eine eigene Klasse.", icon: "wand", progress: (s) => [s.classes, 1] },
  { id: "erster-zug", name: "Der erste Schritt", text: "Beginne dein erstes Abenteuer und handle.", icon: "play", progress: (s) => [count(s, (r) => r.turns > 0), 1] },
  { id: "krit", name: "Gesegneter Wurf", text: "Erziele einen kritischen Erfolg.", icon: "dice", progress: (s) => [sum(s, (r) => r.crits), 1] },
  { id: "patzer", name: "Pechvogel", text: "Erleide einen Patzer. Passiert den Besten.", icon: "x", progress: (s) => [sum(s, (r) => r.fumbles), 1] },
  { id: "fuenf-krits", name: "Fortunas Liebling", text: "Erziele insgesamt fünf kritische Erfolge.", icon: "star", progress: (s) => [sum(s, (r) => r.crits), 5] },
  { id: "abgeschlossen", name: "Ende gut", text: "Schließe eine Kampagne siegreich ab.", icon: "crown", progress: (s) => [count(s, (r) => r.finished), 1] },
  { id: "drei-kampagnen", name: "Sagenschmied", text: "Schließe drei Kampagnen siegreich ab.", icon: "scroll", progress: (s) => [count(s, (r) => r.finished), 3] },
  { id: "niederlage", name: "Gefallen, nicht vergessen", text: "Erlebe eine Niederlage – auch das gehört zur Sage.", icon: "moon", progress: (s) => [count(s, (r) => r.defeat), 1] },
  { id: "gruppe", name: "Gemeinsam am Feuer", text: "Spiele eine Runde in einer Gruppe.", icon: "users", progress: (s) => [count(s, (r) => r.group && r.turns > 0), 1] },
  { id: "gruppe-sieg", name: "Bund der Gefährten", text: "Schließe eine Kampagne in der Gruppe ab.", icon: "shield", progress: (s) => [count(s, (r) => r.group && r.finished), 1] },
  { id: "stufe-3", name: "Aufstieg", text: "Erreiche mit einer Figur Stufe 3.", icon: "zap", progress: (s) => [best(s, (r) => r.level), 3] },
  { id: "stufe-5", name: "Held des Landes", text: "Erreiche mit einer Figur Stufe 5.", icon: "crown", progress: (s) => [best(s, (r) => r.level), 5] },
  { id: "orte", name: "Weitgereist", text: "Besuche acht Orte in einer Kampagne.", icon: "map", progress: (s) => [best(s, (r) => r.places), 8] },
  { id: "freunde", name: "Freund des Volkes", text: "Gewinne drei Freunde in einer Kampagne.", icon: "heart", progress: (s) => [best(s, (r) => r.friends), 3] },
  { id: "reich", name: "Prall gefüllter Beutel", text: "Besitze fünf Gulden auf einmal.", icon: "coins", progress: (s) => [Math.floor(best(s, (r) => r.money) / 240), 5] },
  { id: "schmied", name: "Beim Schmied", text: "Lass deine Ausrüstung verbessern.", icon: "hammer", progress: (s) => [best(s, (r) => r.gear), 1] },
  { id: "auftraege", name: "Verlässlich", text: "Erledige insgesamt zehn Aufträge.", icon: "check", progress: (s) => [sum(s, (r) => r.questsDone), 10] },
  { id: "lange-reise", name: "Lange Reise", text: "Erlebe den siebten Tag einer Kampagne.", icon: "sun", progress: (s) => [best(s, (r) => r.day), 7] },
  { id: "ausdauer", name: "Unermüdlich", text: "Handle insgesamt hundertmal.", icon: "fist", progress: (s) => [sum(s, (r) => r.turns), 100] },
];

export const isDone = (a: Achievement, s: AchievementStats) => { const [cur, max] = a.progress(s); return cur >= max; };
