// Spielwelt-Zustand eines Abenteuers: Lebenspunkte, Kampf, Aufträge, Gedächtnis, Erfahrung, Kampagnenbogen.
// Wird nur vom Server verändert (über Werkzeuge des Spielleiters) und ist signiert bzw. serverseitig gespeichert.
import type { Character, Rules } from "./schema";
import { levelsSummary, type LevelState } from "./levels";
import { upgradesSummary, type Progression } from "./upgrades";
import { usesSummary, type UsedAbilities } from "./abilityUses";
import { timeLine, type GameTime } from "./time";
import type { Inventory } from "./inventory";
import { gearSummary, type Gear, type Shop } from "./shop";
import type { Gamble } from "./gamble";
import type { Person } from "./people";
import type { TravelMap } from "./map";

import type { Companion, Fate, Legacy, Rumor, Standing } from "./standing";

/** `look`: Aussehen (englisch) für ein Gegner-Porträt, `portrait`: das gemalte Bild – nur bei besonderen Gegnern. */
export interface Enemy { id: string; name: string; hp: number; maxHp: number; armor: number; look?: string; portrait?: string }
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
  /** Kampagnenbogen: Anfang, Mitte, Finale – mit festem Ende. Fehlt bei Spielständen von vor dem Bogen. */
  arc?: Arc;
  /** Verbesserte Fähigkeiten je Figur. */
  progress?: Record<string, Progression>;
  /** Stufen je Figur (nur in dieser Kampagne). */
  levels?: Record<string, LevelState>;
  /** Eingesetzte begrenzte Fähigkeiten (1× pro Kampf/Rast/Tag) – bis Kampfende bzw. Rast. */
  used?: UsedAbilities;
  /** Karte der Reise */
  map?: TravelMap;
  /** Personen, denen die Figuren begegnet sind */
  people?: Person[];
  /** Offener Laden (Händler oder Schmied) */
  shop?: Shop | null;
  /** Verbesserungen durch den Schmied je Figur */
  gear?: Record<string, Gear>;
  /** Gepäck und Geld je Figur */
  inventory?: Record<string, Inventory>;
  /** Tag, Tageszeit und Wetter */
  time?: GameTime;
  /** Züge seit dem letzten Szenenbild (für das Mindestmaß an Bildern). */
  sinceImage?: number;
  /** Offener Würfeltisch in der Taverne */
  gamble?: Gamble | null;
  /** Wann der ausführliche Kampagnenstand zuletzt an Claude ging (Prüfsumme und Züge seitdem) – spart Tokens. */
  sent?: { arc: string; turns: number; inv?: string; people?: string; map?: string; standing?: string };
  /** Ruf bei Fraktionen (−10 bis +10). */
  reputation?: Record<string, Standing>;
  /** Große Entscheidungen der Figuren. */
  fates?: Fate[];
  /** Ehrentitel und Erbstücke nach einer siegreichen Kampagne. */
  legacy?: Legacy[];
  /** Begleiter, die mit der Gruppe reisen (höchstens 3). */
  companions?: Companion[];
  /** Gerüchte, die die Figuren aufgeschnappt haben. */
  rumors?: Rumor[];
}

/* ── Kampagnenbogen: drei Akte, gegliedert in Kapitel ── */

/** Drei Akte wie in einer typischen DnD-Kampagne – mit Spanne an geplanten Kapiteln und erlaubten Abzweigungen. */
export const ACTS = [
  { name: "Anfang", goal: "Einführung: Figuren, Ort und Haken der Geschichte; erste Herausforderungen; das große Ziel wird sichtbar.", chapters: [2, 4], detours: 2 },
  { name: "Mitte", goal: "Komplikationen: Hindernisse, Verbündete und Gegenspieler, Geheimnisse; ein Wendepunkt, der alles verschärft.", chapters: [3, 6], detours: 3 },
  { name: "Finale", goal: "Höhepunkt: die Entscheidung gegen die große Bedrohung, danach die Auflösung und ein Epilog.", chapters: [2, 3], detours: 1 },
] as const;
export type ActIndex = 0 | 1 | 2;

/** Ab so vielen Zügen in einem Kapitel bekommt Claude einen unsichtbaren Hinweis, es auf sein Ziel zuzuführen (kein harter Schnitt). */
export const LONG_CHAPTER_TURNS = 20;

export interface Chapter {
  titel: string;
  ziel: string;
  act: ActIndex;
  /** Durch eine Spielerentscheidung eingeschoben – mit Weg zurück zur Hauptlinie. */
  detour: boolean;
  rueckweg: string | null;
  done: boolean;
  rueckblick: string | null;
}

export interface Arc {
  plan: { ziel: string; bedrohung: string } | null;
  /** Lineare Kapitelfolge aller drei Akte; Abzweigungen werden vor dem unterbrochenen Kapitel eingeschoben. */
  chapters: Chapter[];
  /** Index des laufenden Kapitels. */
  current: number;
  /** Genutzte Abzweigungen je Akt. */
  detoursUsed: [number, number, number];
  /** Züge im laufenden Kapitel – nur für den Hinweis bei sehr langen Kapiteln. */
  turnsInChapter: number;
  finished: boolean;
  epilog: string | null;
  /** Was die Spieler sehen dürfen (ohne Geheimnisse aus dem Plan): Kernauftrag und die gerade anstehende Aufgabe. */
  known?: { kern: string | null; aufgabe: string | null };
  /** Wie die Kampagne endete: Sieg im Finale oder Niederlage, weil die ganze Gruppe gefallen ist. Fehlt = Sieg (ältere Stände). */
  outcome?: "sieg" | "niederlage";
}

export function initArc(): Arc {
  return { plan: null, chapters: [], current: 0, detoursUsed: [0, 0, 0], turnsInChapter: 0, finished: false, epilog: null };
}

/** Gültiger Kampagnenbogen? Ältere Formen werden neu angelegt. */
export const isArc = (a: unknown): a is Arc => !!a && Array.isArray((a as Arc).chapters) && Array.isArray((a as Arc).detoursUsed) && typeof (a as Arc).current === "number";

export const currentChapter = (arc: Arc): Chapter | null => arc.chapters[arc.current] ?? null;
export const currentAct = (arc: Arc): ActIndex => currentChapter(arc)?.act ?? 0;

/** Ist die ganze Gruppe kampfunfähig? (Eine einzelne bewusstlose Figur kann noch gerettet werden.) */
export function allDown(w: WorldState, characters: Pick<Character, "id">[]): boolean {
  return characters.length > 0 && characters.every((c) => (w.hp[c.id] ?? 0) <= 0);
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
    arc: initArc(),
  };
}

/** Kurzer Spielstand für Claude – wird jeder Handlung angehängt, damit Zahlen auch nach einer Zusammenfassung stimmen. */
export function worldSummary(w: WorldState, characters: Pick<Character, "id" | "name">[], rules?: Rules, opts: { arc?: boolean } = {}): string {
  const hp = characters.map((c) => `${c.name} ${w.hp[c.id] ?? 0}/${w.maxHp[c.id] ?? 0} TP${(w.hp[c.id] ?? 0) <= 0 ? " (kampfunfähig – bewusstlos, aber rettbar)" : ""}`).join(", ");
  const lines = [`Lebenspunkte: ${hp}`];
  if (w.time) lines.push(`Zeit: ${timeLine(w.time)}`);
  if (w.combat && allDown(w, characters)) lines.push(DEFEAT_WARNING);
  if (w.combat) lines.push(`Kampf (Runde ${w.combat.round}): ${w.combat.enemies.map((e) => `${e.name} ${e.hp}/${e.maxHp} TP, Rüstung ${e.armor}${e.hp <= 0 ? " – besiegt" : ""}`).join("; ")}`);
  const open = w.quests.filter((q) => q.status === "offen");
  // Nur Titel: Notizen und Gemerktes stehen schon im Verlauf (und in der Zusammenfassung) – jede Wiederholung kostet bei jedem Zug.
  if (open.length) lines.push(`Offene Aufträge: ${open.map((q) => q.title).join(" | ")}`);
  if (rules) { const lv = levelsSummary(w, characters, rules); if (lv) lines.push(lv); }
  const upgrades = upgradesSummary(w, characters);
  if (upgrades) lines.push(upgrades);
  const used = usesSummary(w, characters);
  if (used) lines.push(used);
  const gear = gearSummary(w, characters);
  if (gear) lines.push(gear);
  if (w.arc && opts.arc !== false) lines.push(arcSummary(w.arc));
  return lines.join("\n");
}

/** Hinweis an Claude, sobald die ganze Gruppe im Kampf gefallen ist. */
export const DEFEAT_WARNING = "ALLE Figuren sind kampfunfähig. Nur ein glaubwürdiger Verbündeter vor Ort kann sie jetzt noch retten (mit heilen, oder kampf_beenden, weil Hilfe eintrifft oder die Gegner sie gefangen nehmen). Sonst erzähle jetzt ein kurzes, würdiges Ende mit Epilog und rufe abenteuer_beenden mit ausgang niederlage auf – ohne Vorschlagszeile. Bleibt beides aus, beendet der Server die Kampagne als Niederlage.";

/** Kampagnenstand für Claude – Teil jedes <spielstand>. So weiß Claude auch in einer Abzweigung, wo die Geschichte steht. */
export function arcSummary(arc: Arc): string {
  const ch = currentChapter(arc);
  if (!arc.plan || !ch) return "Kampagne: Noch kein Plan – lege ihn jetzt mit kampagne_planen an (Ziel, Bedrohung, Kapitel je Akt).";
  const act = ch.act;
  const inAct = arc.chapters.filter((c) => c.act === act);
  const lines = [
    `Kampagne – Akt ${act + 1} von 3 „${ACTS[act].name}“, Kapitel ${inAct.indexOf(ch) + 1} von ${inAct.length} dieses Akts: „${ch.titel}“. Ziel: ${ch.ziel}${ch.detour ? ` – ABZWEIGUNG; danach zurück zur Hauptlinie: ${ch.rueckweg ?? "das nächste Kapitel"}` : ""}`,
    `Ziel der Kampagne: ${arc.plan.ziel} | Bedrohung: ${arc.plan.bedrohung}`,
    `Kapitelplan: ${ACTS.map((a, i) => `${a.name}: ${arc.chapters.filter((c) => c.act === i).map((c) => `${c.done ? "✓" : c === ch ? "▶" : "○"} ${c.titel}${c.detour ? " (Abzweigung)" : ""}`).join(", ") || "–"}`).join(" | ")}`,
  ];
  const recaps = arc.chapters.filter((c) => c.done && c.rueckblick).slice(-6);
  if (recaps.length) lines.push(`Bisher: ${recaps.map((c) => `${c.titel} – ${c.rueckblick}`).join(" | ")}`);
  const left = ACTS[act].detours - arc.detoursUsed[act];
  const tempo = [`TEMPO: ${ACTS[act].goal}`];
  tempo.push(left > 0
    ? `Abzweigungen in diesem Akt: noch ${left} von ${ACTS[act].detours}.`
    : "Keine Abzweigungen mehr in diesem Akt: Weichen die Spieler ab, haben ihre Entscheidungen Folgen innerhalb dieses Kapitels – lenke dabei zurück zur Hauptlinie.");
  const lastOfAct = inAct.indexOf(ch) === inAct.length - 1;
  if (lastOfAct) tempo.push(act < 2 ? `Dies ist das letzte Kapitel des Akts – danach beginnt „${ACTS[act + 1].name}“.` : "Dies ist das letzte Kapitel des Finales: Führe die Entscheidung herbei, erzähle den Ausgang und einen Epilog, dann rufe abenteuer_beenden auf.");
  if (arc.turnsInChapter >= LONG_CHAPTER_TURNS) tempo.push("Dieses Kapitel läuft schon lange – führe es auf sein Ziel zu, mit den Folgen der Entscheidungen der Spieler.");
  lines.push(tempo.join(" "));
  return lines.join("\n");
}
