// Spielwelt-Zustand eines Abenteuers: Lebenspunkte, Kampf, Aufträge, Gedächtnis, Erfahrung.
// Wird nur vom Server verändert (über Werkzeuge des Spielleiters) und ist signiert bzw. serverseitig gespeichert.
import type { Character } from "./schema";

export interface Enemy { id: string; name: string; hp: number; maxHp: number; armor: number }
export interface Quest { id: string; title: string; description: string; status: "offen" | "erledigt" | "gescheitert"; notes: string[] }

export interface WorldState {
  hp: Record<string, number>;
  maxHp: Record<string, number>;
  xp: Record<string, number>;
  combat: { round: number; enemies: Enemy[] } | null;
  quests: Quest[];
  memory: string[];
  /** War der letzte Angriff dieser Figur ein kritischer Treffer? Dann zählt der Schaden doppelt. */
  critPending: Record<string, boolean>;
}

export const MAX_MEMORY = 30;
export const MAX_QUESTS = 20;

export function initWorld(characters: Pick<Character, "id" | "hp">[]): WorldState {
  return {
    hp: Object.fromEntries(characters.map((c) => [c.id, c.hp.max])),
    maxHp: Object.fromEntries(characters.map((c) => [c.id, c.hp.max])),
    xp: Object.fromEntries(characters.map((c) => [c.id, 0])),
    combat: null,
    quests: [],
    memory: [],
    critPending: {},
  };
}

/** Kurzer Spielstand für Claude – wird jeder Handlung angehängt, damit Zahlen auch nach einer Zusammenfassung stimmen. */
export function worldSummary(w: WorldState, characters: Pick<Character, "id" | "name">[]): string {
  const hp = characters.map((c) => `${c.name} ${w.hp[c.id] ?? 0}/${w.maxHp[c.id] ?? 0} TP${(w.hp[c.id] ?? 0) <= 0 ? " (kampfunfähig)" : ""}`).join(", ");
  const lines = [`Lebenspunkte: ${hp}`];
  if (w.combat) lines.push(`Kampf (Runde ${w.combat.round}): ${w.combat.enemies.map((e) => `${e.name} ${e.hp}/${e.maxHp} TP, Rüstung ${e.armor}${e.hp <= 0 ? " – besiegt" : ""}`).join("; ")}`);
  const open = w.quests.filter((q) => q.status === "offen");
  // Nur Titel: Notizen und Gemerktes stehen schon im Verlauf (und in der Zusammenfassung) – jede Wiederholung kostet bei jedem Zug.
  if (open.length) lines.push(`Offene Aufträge: ${open.map((q) => q.title).join(" | ")}`);
  return lines.join("\n");
}
