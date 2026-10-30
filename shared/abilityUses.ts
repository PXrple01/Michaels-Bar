// Begrenzte Fähigkeiten (1× pro Kampf, Rast oder Tag): Der Server zählt mit – fälschungssicher im Spielstand.
// Kampfende und Rasten machen sie wieder verfügbar. Passive Fähigkeiten wirken immer und werden nie verbraucht.
import type { Character, ClassDef } from "./schema";
import { applyMastery } from "./growth";
import { effectiveAbilities } from "./upgrades";
import { newWorldId, type WorldState } from "./world";

/** „zweimal_pro_kampf“ entsteht nur durch Meisterschaft. */
export type UseKind = "zweimal_pro_kampf" | "einmal_pro_kampf" | "einmal_pro_rast" | "einmal_pro_tag";
/** Eingesetzte Fähigkeiten je Figur: Fähigkeits-ID → Häufigkeit (zum Zeitpunkt des Einsatzes), Name und wie oft schon. */
export type UsedAbilities = Record<string, Record<string, { uses: UseKind; name: string; count?: number }>>;

const LIMITED: readonly string[] = ["zweimal_pro_kampf", "einmal_pro_kampf", "einmal_pro_rast", "einmal_pro_tag"];

/** Aktiv = muss bewusst eingesetzt werden (alles außer „passiv“). */
export const isActive = (uses: string) => uses !== "passiv";
export const isLimited = (uses: string): uses is UseKind => LIMITED.includes(uses);

export function isUsed(w: WorldState | null | undefined, characterId: string, abilityId: string): boolean {
  return !!w?.used?.[characterId]?.[abilityId];
}

/** Wann eine verbrauchte Fähigkeit wieder bereitsteht – in einfachen Worten. */
export function recoverText(uses: string): string {
  return uses === "einmal_pro_kampf" || uses === "zweimal_pro_kampf" ? "nach dem Kampf" : uses === "einmal_pro_rast" ? "nach einer Rast" : uses === "einmal_pro_tag" ? "nach einer langen Rast (Nacht)" : "";
}

/** Kampfende: „1× pro Kampf“ ist wieder frei. Kurze Rast: zusätzlich „1× pro Rast“. Lange Rast: alles. */
export function resetUses(w: WorldState, event: "kampf" | "kurz" | "lang"): void {
  if (!w.used) return;
  const freed: UseKind[] = event === "kampf" ? ["zweimal_pro_kampf", "einmal_pro_kampf"] : event === "kurz" ? ["zweimal_pro_kampf", "einmal_pro_kampf", "einmal_pro_rast"] : ["zweimal_pro_kampf", "einmal_pro_kampf", "einmal_pro_rast", "einmal_pro_tag"];
  for (const [cid, list] of Object.entries(w.used)) {
    for (const [aid, u] of Object.entries(list)) if (freed.includes(u.uses)) delete list[aid];
    if (!Object.keys(list).length) delete w.used[cid];
  }
}

/** Die Fähigkeiten einer Figur in dieser Kampagne (mit Verbesserungen und Meisterschaft). */
export function abilitiesOf(c: Character, classes: ClassDef[], w: WorldState) {
  const cls = classes.find((x) => x.id === c.classId) ?? c.customClass?.cls;
  return applyMastery(effectiveAbilities(cls?.abilities ?? [], w.progress?.[c.id]), c, w);
}

/**
 * Einsatz verbuchen. Ergebnis für Claude; `error`, wenn die Fähigkeit gerade nicht geht (schon verbraucht, unbekannt).
 */
export function useAbility(w: WorldState, c: Character, classes: ClassDef[], wanted: string): { text: string; error?: boolean } {
  const list = abilitiesOf(c, classes, w);
  const key = wanted.trim().toLowerCase();
  const a = list.find((x) => x.name.toLowerCase() === key || x.id === key) ?? list.find((x) => x.name.toLowerCase().includes(key) && key.length >= 4);
  if (!a) return { error: true, text: `${c.name} hat keine Fähigkeit „${wanted}“. Vorhanden: ${list.map((x) => x.name).join(", ")}.` };
  if (!isActive(a.uses)) return { text: `„${a.name}“ ist passiv und wirkt immer – sie muss nicht eingesetzt werden.` };
  if (!isLimited(a.uses)) return { text: `${c.name} setzt „${a.name}“ ein (beliebig oft). Regel: ${a.text}` };
  const prev = w.used?.[c.id]?.[a.id];
  // Gemeistert: zweimal pro Kampf – der erste Einsatz sperrt noch nicht
  const allowed = a.uses === "zweimal_pro_kampf" ? 2 : 1;
  if (prev && (prev.count ?? 1) < allowed) {
    w.used![c.id][a.id] = { ...prev, count: (prev.count ?? 1) + 1 };
    w.abilityUses = { ...w.abilityUses, [c.id]: { ...w.abilityUses?.[c.id], [a.id]: Math.min(999, (w.abilityUses?.[c.id]?.[a.id] ?? 0) + 1) } };
    return { text: `${c.name} setzt „${a.name}“ ein zweites Mal ein (gemeistert: 2× pro Kampf) – danach wieder ${recoverText(a.uses)}. Regel: ${a.text}` };
  }
  if (prev) return { error: true, text: `${c.name} hat „${a.name}“ schon eingesetzt – wieder verfügbar ${recoverText(prev.uses)}. Erzähle, dass es diesmal nicht gelingt, und biete etwas anderes an.` };
  w.used = { ...w.used, [c.id]: { ...w.used?.[c.id], [a.id]: { uses: a.uses as UseKind, name: a.name, count: 1 } } };
  // Meisterschaft: Einsätze zählen (über alle Abenteuer)
  w.id ??= newWorldId();
  w.abilityUses = { ...w.abilityUses, [c.id]: { ...w.abilityUses?.[c.id], [a.id]: Math.min(999, (w.abilityUses?.[c.id]?.[a.id] ?? 0) + 1) } };
  return { text: `${c.name} setzt „${a.name}“ ein – wieder verfügbar ${recoverText(a.uses)}. Regel: ${a.text}` };
}

/** Für den <spielstand>: was gerade verbraucht ist. */
export function usesSummary(w: WorldState, characters: Pick<Character, "id" | "name">[]): string {
  const parts = characters.flatMap((c) => Object.values(w.used?.[c.id] ?? {}).map((u) => `${c.name}: ${u.name} (wieder ${recoverText(u.uses)})`));
  return parts.length ? `Verbrauchte Fähigkeiten: ${parts.join(" | ")}` : "";
}
