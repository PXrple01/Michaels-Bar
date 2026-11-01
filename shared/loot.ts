// Beute zum Mitnehmen: Ausrüstung besiegter Gegner oder Fundstücke (Truhe, Leiche, Versteck). Claude legt sie bereit,
// die Spieler entscheiden selbst über die Oberfläche, was sie mitnehmen – ohne Modellaufruf. Claude erfährt es im nächsten Zug.
import { addItem, ensureInventory, itemText, type InvItem } from "./inventory";
import type { Character, Rules } from "./schema";
import type { WorldState } from "./world";

export interface Loot { source: string; items: InvItem[]; log: string[] }
export const MAX_LOOT = 8;

/** Mitnehmen (ref = Nummer des Gegenstands) oder den Rest liegen lassen. Fehlertext oder null. */
export function lootAction(w: WorldState, c: Pick<Character, "id" | "name" | "equipment" | "money">, rules: Rules, action: unknown, ref: unknown): string | null {
  const loot = w.loot;
  if (!loot?.items.length) return "Hier liegt nichts mehr zum Mitnehmen.";
  if (action === "liegenlassen") {
    loot.log.push(`${c.name} lässt den Rest liegen (${loot.items.map((i) => itemText(i)).join(", ")})`);
    loot.items = [];
    return null;
  }
  const i = Number(ref);
  const item = Number.isInteger(i) ? loot.items[i] : undefined;
  if (!item) return "Diesen Gegenstand gibt es hier nicht (mehr).";
  ensureInventory(w, [c], rules);
  const e = addItem(w.inventory![c.id], { ...item });
  if (e) return e;
  loot.items.splice(i, 1);
  loot.log.push(`${c.name} nimmt ${itemText(item)} mit`);
  return null;
}

/** Für Claude: was bereitliegt und was seit dem letzten Zug mitgenommen wurde (Protokoll wird danach geleert). */
export function lootSummary(w: WorldState): string {
  const loot = w.loot;
  if (!loot) return "";
  const lines: string[] = [];
  if (loot.log.length) lines.push(`Beute (${loot.source}): ${loot.log.join("; ")}`);
  if (loot.items.length) lines.push(`Liegt noch bereit zum Mitnehmen (${loot.source}): ${loot.items.map((i) => itemText(i)).join(", ")} – die Spieler entscheiden per Knopf.`);
  loot.log = [];
  if (!loot.items.length) w.loot = null;
  return lines.join("\n");
}
