// Inventar und Geld je Figur – nur innerhalb einer Kampagne. Der Server führt Buch: Claude sagt, was gefunden,
// verbraucht oder ausgegeben wird; was nicht da ist, kann man nicht benutzen, was man nicht bezahlen kann, nicht kaufen.
import type { Character, Money, Rules } from "./schema";
import type { WorldState } from "./world";
import { heirloomItems, perkCount, startMoneyBonus } from "./growth";

export const ITEM_KINDS = ["waffe", "ruestung", "schild", "trank", "werkzeug", "schatz", "gegenstand"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export const RARITIES = ["gewoehnlich", "ungewoehnlich", "selten", "sagenhaft"] as const;
export type Rarity = (typeof RARITIES)[number];
export const RARITY_NAME: Record<Rarity, string> = { gewoehnlich: "gewöhnlich", ungewoehnlich: "ungewöhnlich", selten: "selten", sagenhaft: "sagenhaft" };
/** Höchste Summe aller Boni je Seltenheit. */
const RARITY_CAP: Record<Rarity, number> = { gewoehnlich: 1, ungewoehnlich: 2, selten: 3, sagenhaft: 6 };
/**
 * Werte eines Gegenstands: Boni zählen bei den Würfen mit, solange das Stück angelegt ist (je eine Waffe, Rüstung, Schild);
 * Heilung würfelt der Server beim Verbrauchen bzw. Trinken.
 */
export interface ItemStats { angriff?: number; schaden?: number; ruestung?: number; heilung?: string; seltenheit?: Rarity }
export interface InvItem { name: string; qty: number; kind: ItemKind; note?: string; stats?: ItemStats; equipped?: boolean }
export type Slot = "waffe" | "ruestung" | "schild";
export const SLOTS: readonly Slot[] = ["waffe", "ruestung", "schild"];
export const SLOT_NAME: Record<Slot, string> = { waffe: "Waffe", ruestung: "Rüstung", schild: "Schild" };
export const slotOf = (i: Pick<InvItem, "kind">): Slot | null => ((SLOTS as readonly string[]).includes(i.kind) ? (i.kind as Slot) : null);
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

const KIND_OF: Record<string, ItemKind> = { weapon: "waffe", armor: "ruestung", shield: "schild", consumable: "trank", gear: "werkzeug" };
export const kindOf = (v: unknown): ItemKind => ((ITEM_KINDS as readonly string[]).includes(String(v)) ? (v as ItemKind) : "gegenstand");

/** Kann die Klasse andere heilen (nicht nur sich selbst)? Solche Figuren starten mit einem Heiltrank. */
export const isHealer = (cls: { abilities: { type: string; text: string }[] } | null | undefined) =>
  !!cls?.abilities.some((a) => a.type === "heilung" && !/\bdich\b/i.test(a.text));

export const START_POTION: InvItem = { name: "Heiltrank", qty: 1, kind: "trank", note: "Kann auch einer anderen Figur gegeben werden", stats: { heilung: "2W4+2" } };

/**
 * Startausrüstung und -geld der Figur übernehmen (einmal je Kampagne). Heiltränke sind selten: Heiler-Klassen starten
 * mit genau einem, Heil-Verbrauchsgüter aus der Startausrüstung werden zu einem einzigen Trank.
 */
export function ensureInventory(w: WorldState, characters: (Pick<Character, "id" | "equipment" | "money"> & { classId?: string; growth?: Character["growth"] })[], rules: Rules, classes?: { id: string; abilities: { type: string; text: string }[] }[]): void {
  w.inventory ??= {};
  for (const c of characters) {
    if (w.inventory[c.id]) continue;
    const items: InvItem[] = [];
    let potion: InvItem | null = null;
    for (const id of c.equipment ?? []) {
      const it = rules.items.find((i) => i.id === id);
      if (!it) continue;
      if (it.type === "consumable") {
        const heal = cleanStats({ heilung: /heilt\s+(\S+)/i.exec(it.effect)?.[1] })?.heilung;
        if (heal) { potion ??= { ...START_POTION, stats: { heilung: heal } }; continue; }
        addItem({ items, money: 0 }, { name: it.name.replace(/\s*\(\d+\)$/, ""), qty: 1, kind: "trank", note: it.effect });
      } else addItem({ items, money: 0 }, { name: it.name, qty: 1, kind: KIND_OF[it.type] ?? "gegenstand" });
    }
    const custom = (c as { customClass?: { cls?: { id: string; abilities: { type: string; text: string }[] } } }).customClass?.cls;
    if (!potion && isHealer(classes?.find((x) => x.id === c.classId) ?? custom)) potion = { ...START_POTION };
    if (potion) addItem({ items, money: 0 }, potion);
    // Ruhm-Vorteil „Vorrat“ und das Erbstück aus der Truhe
    if (perkCount(c, "vorrat")) addItem({ items, money: 0 }, { ...START_POTION });
    for (const heir of heirloomItems(c)) { const stats = cleanStats(heir.stats as Record<string, unknown> | undefined); addItem({ items, money: 0 }, { ...heir, ...(stats ? { stats } : { stats: undefined }) }); }
    for (const slot of SLOTS) fillSlot({ items, money: 0 }, slot);
    w.inventory[c.id] = { items, money: toPfennig(c.money ?? {}) + startMoneyBonus(c) };
  }
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
export const findItem = (inv: Inventory, name: string) => inv.items.find((i) => same(i.name, name)) ?? inv.items.find((i) => i.name.toLowerCase().includes(name.trim().toLowerCase()) && name.trim().length >= 4);

export function addItem(inv: Inventory, item: InvItem): string | null {
  const { equipped: _, ...clean } = item;
  const has = inv.items.find((i) => same(i.name, item.name));
  if (has) { has.qty += item.qty; if (item.note) has.note = item.note; if (item.stats) has.stats = item.stats; fillSlot(inv, slotOf(has), has); return null; }
  if (inv.items.length >= MAX_ITEMS) return `Das Gepäck ist voll (höchstens ${MAX_ITEMS} verschiedene Dinge).`;
  const added = { ...clean };
  inv.items.push(added);
  fillSlot(inv, slotOf(added), added);
  return null;
}

const statSum = (i: InvItem) => (i.stats?.angriff ?? 0) + (i.stats?.schaden ?? 0) + (i.stats?.ruestung ?? 0);

/**
 * Einen leeren Platz automatisch belegen: mit dem neuen Stück bzw. dem besten übrigen. Ein neues Stück mit Werten ersetzt
 * außerdem ein angelegtes ohne Werte (z. B. das alte Schwert vom Start). Nur der Platz des neuen bzw. verlorenen Stücks –
 * was ein Spieler selbst abgelegt hat, bleibt abgelegt.
 */
function fillSlot(inv: Inventory, slot: Slot | null, fresh?: InvItem) {
  if (!slot) return;
  const worn = inv.items.find((i) => i.equipped && slotOf(i) === slot);
  if (fresh && fresh !== worn && (!worn || (!statSum(worn) && statSum(fresh)))) {
    if (worn) worn.equipped = false;
    fresh.equipped = true;
    return;
  }
  if (worn || fresh) return;
  const best = inv.items.filter((i) => slotOf(i) === slot).sort((a, b) => statSum(b) - statSum(a))[0];
  if (best) best.equipped = true;
}

/** Anlegen oder ablegen (auch im Kampf). Fehlertext oder null. */
export function equipItem(inv: Inventory, name: string, on: boolean): string | null {
  const item = findItem(inv, name);
  if (!item) return "Das ist nicht in deinem Gepäck.";
  const slot = slotOf(item);
  if (!slot) return `„${item.name}“ kann man nicht anlegen.`;
  if (!!item.equipped === on) return `„${item.name}“ ist schon ${on ? "angelegt" : "abgelegt"}.`;
  if (on) inv.items.forEach((i) => { if (slotOf(i) === slot) i.equipped = false; });
  item.equipped = on;
  return null;
}

/** Entfernen – Fehlertext, wenn es nicht (genug) da ist. */
export function removeItem(inv: Inventory, name: string, qty: number): { item: InvItem } | { error: string } {
  const has = findItem(inv, name);
  if (!has) return { error: `„${name}“ ist nicht im Gepäck. Vorhanden: ${inv.items.map((i) => (i.qty > 1 ? `${i.qty}× ${i.name}` : i.name)).join(", ") || "nichts"}.` };
  if (has.qty < qty) return { error: `Nur ${has.qty}× „${has.name}“ vorhanden.` };
  has.qty -= qty;
  if (has.qty <= 0) { inv.items.splice(inv.items.indexOf(has), 1); if (has.equipped) fillSlot(inv, slotOf(has)); }
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
  const rarity = (RARITIES as readonly string[]).includes(String(raw.seltenheit)) ? (raw.seltenheit as Rarity) : null;
  if (rarity) {
    // Zu starke Boni für die Seltenheit kürzen (zuerst Schaden, dann Rüstung, dann Angriff)
    let over = STAT_TARGETS.reduce((n, k) => n + (s[k] ?? 0), 0) - RARITY_CAP[rarity];
    for (const k of ["schaden", "ruestung", "angriff"] as const) {
      while (over > 0 && s[k]) { s[k]!--; over--; }
      if (!s[k]) delete s[k];
    }
    if (rarity !== "gewoehnlich") s.seltenheit = rarity;
  }
  const h = String(raw.heilung ?? "").trim().replace(/\s+/g, "");
  const m = HEAL_RE.exec(h);
  if (m) s.heilung = m[4] ?? `${Math.min(2, Math.max(1, Number(m[1])))}W${m[2]}${m[3] ? (Number(m[3]) > 0 ? `+${Math.min(5, Number(m[3]))}` : String(Math.max(-5, Number(m[3])))) : ""}`;
  return Object.keys(s).length ? s : undefined;
}

/** Seltenheit: angegeben oder aus der Stärke der Boni geschätzt. */
export function rarityOf(i: Pick<InvItem, "stats">): Rarity {
  if (i.stats?.seltenheit) return i.stats.seltenheit;
  const sum = (i.stats?.angriff ?? 0) + (i.stats?.schaden ?? 0) + (i.stats?.ruestung ?? 0);
  return sum >= 4 ? "sagenhaft" : sum === 3 ? "selten" : sum === 2 ? "ungewoehnlich" : "gewoehnlich";
}

/** „+1 Angriff, heilt 2W4+2“ */
export function statsText(s: ItemStats | undefined): string {
  if (!s) return "";
  return [...STAT_TARGETS.filter((k) => s[k]).map((k) => `+${s[k]} ${STAT_NAME[k]}`), ...(s.heilung ? [`heilt ${s.heilung}`] : [])].join(", ");
}

/** Boni der angelegten Stücke auf einen Wert – mit dem Namen des Stücks. */
export function itemBonuses(inv: Inventory | undefined, target: StatTarget): { value: number; name: string }[] {
  return (inv?.items ?? []).filter((i) => i.equipped && i.stats?.[target]).map((i) => ({ value: i.stats![target]!, name: i.name }));
}

function itemWithStats(i: InvItem): string {
  const r = rarityOf(i);
  const tags = [...(r !== "gewoehnlich" ? [RARITY_NAME[r]] : []), ...(i.stats ? [statsText(i.stats)].filter(Boolean) : []), ...(i.equipped ? ["angelegt"] : [])];
  return tags.length ? `${itemText(i)} [${tags.join(", ")}]` : itemText(i);
}

/** Für Claude: wer trägt was (kompakt). */
export function inventorySummary(w: WorldState, characters: Pick<Character, "id" | "name">[]): string {
  if (!w.inventory) return "";
  const parts = characters.filter((c) => w.inventory![c.id]).map((c) => {
    const inv = w.inventory![c.id];
    return `${c.name}: ${inv.items.map(itemWithStats).join(", ") || "nichts"}; ${moneyText(inv.money, true)}`;
  });
  return parts.length ? `Inventar – ${parts.join(" | ")}${/ \[.*angelegt/.test(parts.join("")) ? " (Boni angelegter Stücke zählen bei den Würfen schon mit; anlegen und Tränke trinken können die Spieler auch selbst über die Oberfläche)" : ""}` : "";
}

export type ItemAction = "trinken" | "anlegen" | "ablegen";
export const ITEM_ACTIONS: readonly string[] = ["trinken", "anlegen", "ablegen"];

/**
 * Über die Oberfläche, ohne Claude: Trank trinken (der Server würfelt die Heilung; im Kampf einmal je Runde) oder
 * Ausrüstung an-/ablegen. Claude erfährt es im nächsten Zug. Fehlertext oder null.
 */
export function useItem(w: WorldState, c: Pick<Character, "id" | "name" | "equipment" | "money" | "classId">, rules: Rules, action: ItemAction, ref: unknown, roll: (notation: string, label: string) => { total: number }, target?: Pick<Character, "id" | "name"> | null): string | null {
  ensureInventory(w, [c], rules);
  const inv = w.inventory![c.id];
  const item = findItem(inv, String(ref ?? ""));
  if (!item) return "Das ist nicht in deinem Gepäck.";
  if (action !== "trinken") {
    const e = equipItem(inv, item.name, action === "anlegen");
    if (e) return e;
    w.itemLog = [...(w.itemLog ?? []), `${c.name} ${action === "anlegen" ? "legt" : "legt ab:"} ${item.name}${action === "anlegen" ? " an" : ""}`].slice(-10);
    return null;
  }
  const heal = item.stats?.heilung;
  if (!heal) return `„${item.name}“ kann man nicht trinken.`;
  // Selbst trinken oder einer anderen Figur geben (auch einer bewusstlosen – das holt sie zurück)
  const t = target && target.id !== c.id ? target : c;
  if (!(t.id in w.hp)) return "Diese Figur ist nicht in der Gruppe.";
  if (w.hp[c.id] <= 0) return `${c.name} ist bewusstlos und kann nichts tun.`;
  if (w.hp[t.id] >= w.maxHp[t.id]) return `${t.name} ist schon unverletzt.`;
  if (w.combat && w.drank?.[c.id] === w.combat.round) return "In dieser Kampfrunde hast du schon einen Trank benutzt.";
  const amount = /^\d$/.test(heal) ? Number(heal) : Math.max(1, roll(heal, `${t.name}: ${item.name}`).total);
  removeItem(inv, item.name, 1);
  const before = w.hp[t.id];
  w.hp[t.id] = Math.min(w.maxHp[t.id], before + amount);
  if (w.combat) w.drank = { ...w.drank, [c.id]: w.combat.round };
  const healed = `${w.hp[t.id] - before} TP (jetzt ${w.hp[t.id]}/${w.maxHp[t.id]})${before <= 0 ? ", wieder bei Bewusstsein" : ""}`;
  w.itemLog = [...(w.itemLog ?? []), t === c ? `${c.name} trinkt ${item.name} und heilt ${healed}` : `${c.name} flößt ${t.name} ${item.name} ein – ${t.name} heilt ${healed}`].slice(-10);
  return null;
}

/** Für Claude: was die Spieler seit dem letzten Zug selbst mit ihren Sachen gemacht haben (danach wird es geleert). */
export function itemLogSummary(w: WorldState): string {
  if (!w.itemLog?.length) return "";
  const line = `Selbst erledigt (schon verbucht, nur erzählen): ${w.itemLog.join("; ")}`;
  w.itemLog = [];
  return line;
}
