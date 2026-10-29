// Stufenaufstieg innerhalb einer Kampagne: Stufe 1 bis 10 aus der Erfahrung – gedeckelt durch den Kampagnenbogen.
// Trefferpunkte jede Stufe, Attribute (+2 auf Stufe 3, 6 und 9 – je am Ende eines Akts), Fertigkeit (4), Können (10).
import { maxHpAtLevel } from "./character";
import type { Character, ClassDef, Rules } from "./schema";
import { currentChapter, isArc, type WorldState } from "./world";

export interface LevelState {
  level: number;
  /** Zusätzliche geübte Fertigkeit ab der Stufe `extraSkillAt` (null = noch nicht gewählt). */
  skill: string | null;
  /** Alle Attributsteigerungen dieser Kampagne zusammengezählt (null = noch keine). */
  attrs: Record<string, number> | null;
  /** Wie viele der Steigerungen (Stufe 3, 6, 9) schon gewählt sind. Fehlt bei älteren Ständen: dann zählt `attrs` als eine. */
  attrPicks?: number;
}

export const emptyLevel = (): LevelState => ({ level: 1, skill: null, attrs: null, attrPicks: 0 });

/** Gewählte und fällige Attributsteigerungen. */
const attrPicksDone = (st: LevelState) => st.attrPicks ?? (st.attrs ? 1 : 0);
export const attrPicksDue = (st: LevelState, rules: Rules) => rules.levels.attributeIncreaseAt.filter((l) => st.level >= l).length;

export const levelTitle = (level: number, rules: Rules) => rules.levels.titles[Math.min(Math.max(level, 1), rules.levels.max) - 1] ?? `Stufe ${level}`;

/** Höchste Stufe, die der Kampagnenbogen gerade erlaubt: Anfang 3, Mitte 6, Finale 9 – die letzte erst im letzten Kapitel. */
export function levelCap(w: WorldState, rules: Rules): number {
  const arc = w.arc;
  if (!isArc(arc) || !arc.plan) return rules.levels.actCap[0];
  const ch = currentChapter(arc);
  if (arc.finished || (ch && arc.current === arc.chapters.length - 1)) return rules.levels.max;
  return rules.levels.actCap[ch?.act ?? 0];
}

/** Stufe nach Erfahrung (ohne Deckel). */
export function levelForXp(xp: number, rules: Rules): number {
  let level = 1;
  rules.levels.xpTable.forEach((need, i) => { if (xp >= need) level = i + 1; });
  return level;
}

/** Erfahrung bis zur nächsten Stufe – für die Anzeige. */
export function xpProgress(xp: number, level: number, rules: Rules): { from: number; to: number | null } {
  const t = rules.levels.xpTable;
  return { from: t[level - 1] ?? 0, to: level < rules.levels.max ? t[level] : null };
}

/** Die Figur, wie sie in dieser Kampagne gerade ist: Stufe, zusätzliche Fertigkeit, gesteigerte Attribute. */
export function effectiveCharacter(c: Character, w: WorldState | null | undefined): Character {
  const st = w?.levels?.[c.id];
  if (!st) return c;
  const attributes = { ...c.attributes };
  for (const [k, v] of Object.entries(st.attrs ?? {})) attributes[k] = (attributes[k] ?? 10) + v;
  return { ...c, level: st.level, attributes, chosenSkills: st.skill ? [...c.chosenSkills, st.skill] : c.chosenSkills };
}

/** Steht für diese Figur eine Wahl an? */
export function levelChoiceDue(w: WorldState | null | undefined, characterId: string, rules: Rules): "skill" | "attrs" | null {
  const st = w?.levels?.[characterId];
  if (!st) return null;
  if (st.level >= rules.levels.extraSkillAt && !st.skill) return "skill";
  if (attrPicksDue(st, rules) > attrPicksDone(st)) return "attrs";
  return null;
}

/**
 * Stufen anhand der Erfahrung nachziehen. Neue Trefferpunkte gibt es sofort dazu.
 * Gibt die Aufstiege zurück (für Hinweise in der Oberfläche und an Claude).
 */
export function applyLevels(w: WorldState, characters: Character[], classes: ClassDef[], rules: Rules): { characterId: string; from: number; to: number }[] {
  const cap = levelCap(w, rules);
  const ups: { characterId: string; from: number; to: number }[] = [];
  w.levels ??= {};
  for (const c of characters) {
    const st = (w.levels[c.id] ??= emptyLevel());
    const target = Math.min(cap, levelForXp(w.xp[c.id] ?? 0, rules));
    if (target > st.level) { ups.push({ characterId: c.id, from: st.level, to: target }); st.level = target; }
    syncHp(w, c, classes, rules);
  }
  return ups;
}

/** Höchst-TP an Stufe und (gesteigerte) Konstitution angleichen; gewonnene TP kommen auf die aktuellen drauf. */
export function syncHp(w: WorldState, c: Character, classes: ClassDef[], rules: Rules) {
  const cls = classes.find((x) => x.id === c.classId);
  if (!cls) return;
  const eff = effectiveCharacter(c, w);
  const max = maxHpAtLevel(cls, eff.attributes.konstitution, eff.level, rules);
  const before = w.maxHp[c.id] ?? max;
  if (max !== before) {
    w.maxHp[c.id] = max;
    w.hp[c.id] = Math.max(0, Math.min(max, (w.hp[c.id] ?? max) + (max - before)));
  }
}

/** Wahl prüfen und übernehmen. Fehlertext oder null. */
export function chooseLevelReward(w: WorldState, c: Character, classes: ClassDef[], rules: Rules, choice: { skill?: unknown; attrs?: unknown }): string | null {
  const due = levelChoiceDue(w, c.id, rules);
  const st = w.levels?.[c.id];
  if (!due || !st) return "Gerade steht keine Wahl an.";
  if (due === "skill") {
    const id = String(choice.skill ?? "");
    if (!rules.skills.some((s) => s.id === id)) return "Unbekannte Fertigkeit.";
    const eff = effectiveCharacter(c, w);
    const cls = classes.find((x) => x.id === c.classId);
    const stand = rules.stands.find((s) => s.id === c.stand);
    const trained = new Set([...(cls?.trainedSkills ?? []), ...(stand ? [stand.skill] : []), ...eff.chosenSkills]);
    if (trained.has(id)) return "Diese Fertigkeit beherrschst du schon.";
    st.skill = id;
    return null;
  }
  const raw = (choice.attrs ?? {}) as Record<string, unknown>;
  const entries = Object.entries(raw).map(([k, v]) => [k, Math.round(Number(v) || 0)] as const).filter(([, v]) => v > 0);
  const valid = (entries.length === 1 && entries[0][1] === 2) || (entries.length === 2 && entries.every(([, v]) => v === 1));
  if (!valid) return "Wähle +2 auf ein Attribut oder +1 auf zwei verschiedene.";
  const eff = effectiveCharacter(c, w);
  for (const [k, v] of entries) {
    if (!rules.attributes.some((a) => a.id === k)) return "Unbekanntes Attribut.";
    if ((eff.attributes[k] ?? 10) + v > rules.classBuilder.attributeMods.finalMax) return `Höchstens ${rules.classBuilder.attributeMods.finalMax} pro Attribut.`;
  }
  const sum = { ...(st.attrs ?? {}) };
  for (const [k, v] of entries) sum[k] = (sum[k] ?? 0) + v;
  st.attrs = sum;
  st.attrPicks = attrPicksDone(st) + 1;
  syncHp(w, c, classes, rules);
  return null;
}

/** Kurzfassung für Claude im <spielstand>. */
export function levelsSummary(w: WorldState, characters: { id: string; name: string }[], rules: Rules): string {
  const parts = characters.filter((c) => w.levels?.[c.id]).map((c) => `${c.name} Stufe ${w.levels![c.id].level} (${levelTitle(w.levels![c.id].level, rules)})`);
  return parts.length ? `Stufen: ${parts.join(", ")} – stimme Gegner und Herausforderungen darauf ab.` : "";
}
