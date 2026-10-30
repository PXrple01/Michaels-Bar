// Inventar und Geld je Figur – nur innerhalb einer Kampagne. Der Server führt Buch: Claude sagt, was gefunden,
// verbraucht oder ausgegeben wird; was nicht da ist, kann man nicht benutzen, was man nicht bezahlen kann, nicht kaufen.
import type { Character, Money, Rules } from "./schema";
import type { WorldState } from "./world";

export const ITEM_KINDS = ["waffe", "ruestung", "trank", "werkzeug", "schatz", "gegenstand"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
/** Werte eines Gegenstands: Boni zählen bei den Würfen mit (je Wert gilt das beste Stück), Heilung würfelt der Server beim Verbrauchen. */
export interface ItemStats { angriff?: number; schaden?: number; ruestung?: number; heilung?: string }
export interface InvItem { name: string; qty: number; kind: ItemKind; note?: string; stats?: ItemStats }
/** Geld in Pfennig (1 Gulden = 20 Groschen = 240 Pfennig, 1 Groschen = 12 Pfennig). */
export interface Inventory { items: InvItem[]; money: number }

export const MAX_ITEMS = 40;
const PF = { gulden: 240, groschen: 12, pfennig: 1 };

export const toPfennig = (m: Partial<Money>) => Math.max(0, Math.round((m.gulden ?? 0) * PF.gulden + (m.groschen ?? 0) * PF.groschen + (m.pfennig ?? 0)));
export function fromPfennig(pf: number): Money {
  const gulden = Math.floor(pf / PF.gulden), rest = pf % PF.gulden;
  return { gulden, groschen: Math.floor(rest / PF.groschen), pfennig: rest % PF.groschen };
}
/** „1 Gulden, 3 Groschen“ – leere Stellen fallen weg. */
export function moneyText(pf: number, short = false): string {
  const m = fromPfennig(pf);
  const parts = short
    ? [m.gulden && `${m.gulden} G`, m.groschen && `${m.groschen} g`, m.pfennig && `${m.pfennig} Pf`]
    : [m.gulden && `${m.gulden} Gulden`, m.groschen && `${m.groschen} Groschen`, m.pfennig && `${m.pfennig} Pfennig`];
  return parts.filter(Boolean).join(short ? " " : ", ") || (short ? "0 Pf" : "kein Geld");
}

const KIND_OF: Record<string, ItemKind> = { weapon: "waffe", armor: "ruestung", shield: "ruestung", consumable: "trank", gear: "werkzeug" };
export const kindOf = (v: unknown): ItemKind => ((ITEM_KINDS as readonly string[]).includes(String(v)) ? (v as ItemKind) : "gegenstand");

/** Startausrüstung und -geld der Figur übernehmen (einmal je Kampagne). */
export function ensureInventory(w: WorldState, characters: Pick<Character, "id" | "equipment" | "money">[], rules: Rules): void {
  w.inventory ??= {};
  for (const c of characters) {
    if (w.inventory[c.id]) continue;
    const items: InvItem[] = [];
    for (const id of c.equipment ?? []) {
      const it = rules.items.find((i) => i.id === id);
      if (it) addItem({ items, money: 0 }, { name: it.name, qty: 1, kind: KIND_OF[it.type] ?? "gegenstand" });
    }
    w.inventory[c.id] = { items, money: toPfennig(c.money ?? {}) };
  }
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
export const findItem = (inv: Inventory, name: string) => inv.items.find((i) => same(i.name, name)) ?? inv.items.find((i) => i.name.toLowerCase().includes(name.trim().toLowerCase()) && name.trim().length >= 4);

export function addItem(inv: Inventory, item: InvItem): string | null {
  const has = inv.items.find((i) => same(i.name, item.name));
  if (has) { has.qty += item.qty; if (item.note) has.note = item.note; if (item.stats) has.stats = item.stats; return null; }
  if (inv.items.length >= MAX_ITEMS) return `Das Gepäck ist voll (höchstens ${MAX_ITEMS} verschiedene Dinge).`;
  inv.items.push({ ...item });
  return null;
}

/** Entfernen – Fehlertext, wenn es nicht (genug) da ist. */
export function removeItem(inv: Inventory, name: string, qty: number): { item: InvItem } | { error: string } {
  const has = findItem(inv, name);
  if (!has) return { error: `„${name}“ ist nicht im Gepäck. Vorhanden: ${inv.items.map((i) => (i.qty > 1 ? `${i.qty}× ${i.name}` : i.name)).join(", ") || "nichts"}.` };
  if (has.qty < qty) return { error: `Nur ${has.qty}× „${has.name}“ vorhanden.` };
  has.qty -= qty;
  if (has.qty <= 0) inv.items.splice(inv.items.indexOf(has), 1);
  return { item: has };
}

export const itemText = (i: InvItem) => (i.qty > 1 ? `${i.qty}× ${i.name}` : i.name);

export const ITEM_STAT_MAX = 3;
export type StatTarget = "angriff" | "schaden" | "ruestung";
export const STAT_TARGETS: readonly StatTarget[] = ["angriff", "schaden", "ruestung"];
const STAT_NAME: Record<StatTarget, string> = { angriff: "Angriff", schaden: "Schaden", ruestung: "Rüstung" };
const HEAL_RE = /^(\d)\s*[wWdD]\s*(4|6|8)\s*([+-]\s*\d)?$|^([1-9])$/;

/** Werte von Claude prüfen und begrenzen (Boni 1–3, Heilung höchstens 2W8+5 oder eine feste Zahl bis 9). */
export function cleanStats(raw: Record<string, unknown> | null | undefined): ItemStats | undefined {
  if (!raw) return undefined;
  const s: ItemStats = {};
  for (const k of STAT_TARGETS) {
    const v = Math.round(Number(raw[k]) || 0);
    if (v > 0) s[k] = Math.min(ITEM_STAT_MAX, v);
  }
  const h = String(raw.heilung ?? "").trim().replace(/\s+/g, "");
  const m = HEAL_RE.exec(h);
  if (m) s.heilung = m[4] ?? `${Math.min(2, Math.max(1, Number(m[1])))}W${m[2]}${m[3] ? (Number(m[3]) > 0 ? `+${Math.min(5, Number(m[3]))}` : String(Math.max(-5, Number(m[3])))) : ""}`;
  return Object.keys(s).length ? s : undefined;
}

/** „+1 Angriff, heilt 2W4+2“ */
export function statsText(s: ItemStats | undefined): string {
  if (!s) return "";
  return [...STAT_TARGETS.filter((k) => s[k]).map((k) => `+${s[k]} ${STAT_NAME[k]}`), ...(s.heilung ? [`heilt ${s.heilung}`] : [])].join(", ");
}

/** Bester Bonus je Wert aus dem Gepäck (mehrere Schwerter zählen nicht doppelt) – mit dem Namen des Stücks. */
export function itemBonus(inv: Inventory | undefined, target: StatTarget): { value: number; name: string } | null {
  let best: { value: number; name: string } | null = null;
  for (const i of inv?.items ?? []) {
    const v = i.stats?.[target] ?? 0;
    if (v > (best?.value ?? 0)) best = { value: v, name: i.name };
  }
  return best;
}

const itemWithStats = (i: InvItem) => (i.stats ? `${itemText(i)} [${statsText(i.stats)}]` : itemText(i));

/** Für Claude: wer trägt was (kompakt). */
export function inventorySummary(w: WorldState, characters: Pick<Character, "id" | "name">[]): string {
  if (!w.inventory) return "";
  const parts = characters.filter((c) => w.inventory![c.id]).map((c) => {
    const inv = w.inventory![c.id];
    return `${c.name}: ${inv.items.map(itemWithStats).join(", ") || "nichts"}; ${moneyText(inv.money, true)}`;
  });
  return parts.length ? `Inventar – ${parts.join(" | ")}${/ \[/.test(parts.join("")) ? " (Werte in [] zählen bei den Würfen schon mit – je Wert das beste Stück)" : ""}` : "";
}
