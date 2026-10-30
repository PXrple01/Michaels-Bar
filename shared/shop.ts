// Händler und Schmiede: Claude öffnet einen Laden mit Waren und Preisen, gekauft und verkauft wird über die Oberfläche –
// ohne Modellaufruf und ohne Mogeln (der Server prüft Geld, Bestand und Grenzen). Claude erfährt die Einkäufe im nächsten Zug.
import { addItem, ensureInventory, findItem, itemBonuses, itemText, moneyText, rarityOf, removeItem, type InvItem, type ItemKind, type ItemStats, type Rarity } from "./inventory";
import type { Character, Rules } from "./schema";
import type { WorldState } from "./world";
import { legendDiscount } from "./growth";

export type BonusTarget = "angriff" | "schaden" | "ruestung";
export interface Ware { id: string; name: string; kind: ItemKind | "verbesserung"; price: number; note?: string; stock?: number; bonus?: { target: BonusTarget; value: number }; stats?: ItemStats }
export interface Shop { name: string; kind: "haendler" | "schmied"; wares: Ware[]; log: string[] }
/** Dauerhafte Verbesserungen durch den Schmied (je Figur, je Wert höchstens +2). */
export interface Gear { angriff: number; schaden: number; ruestung: number }

export const GEAR_MAX = 2;
export const BONUS_NAME: Record<BonusTarget, string> = { angriff: "Angriff", schaden: "Schaden", ruestung: "Rüstung" };
/** Ankaufspreis, wenn der Händler die Sache nicht selbst führt (in Pfennig). */
const RESALE: Record<ItemKind, number> = { waffe: 72, ruestung: 120, schild: 60, trank: 36, werkzeug: 24, schatz: 240, gegenstand: 12 };

export const gearOf = (w: WorldState | null | undefined, id: string): Gear => w?.gear?.[id] ?? { angriff: 0, schaden: 0, ruestung: 0 };

/** Alle Ausrüstungs-Boni auf einen Wert: Schmied plus die angelegten Stücke (für Würfe und Anzeige). */
export function bonusParts(w: WorldState | null | undefined, id: string, target: BonusTarget): { label: string; value: number }[] {
  const smith = gearOf(w, id)[target];
  const fame = target === "angriff" ? w?.fameBonus?.[id]?.angriff ?? 0 : 0;
  return [...(smith ? [{ label: "Schmied", value: smith }] : []), ...(fame ? [{ label: "Kampferprobt", value: fame }] : []), ...itemBonuses(w?.inventory?.[id], target).map((i) => ({ label: i.name, value: i.value }))];
}
export const bonusTotal = (w: WorldState | null | undefined, id: string, target: BonusTarget) => bonusParts(w, id, target).reduce((n, p) => n + p.value, 0);

const RARITY_PRICE: Record<Rarity, number> = { gewoehnlich: 1, ungewoehnlich: 2, selten: 4, sagenhaft: 10 };

/** Was ein Händler für einen Gegenstand zahlt: die Hälfte seines eigenen Preises, sonst ein fester Satz je Art (seltenere Stücke mehr). */
export function sellPrice(shop: Shop, item: Pick<InvItem, "name" | "kind" | "stats">): number {
  const ware = shop.wares.find((x) => x.name.toLowerCase() === item.name.toLowerCase());
  return Math.max(1, Math.floor(ware ? ware.price / 2 : (RESALE[item.kind] ?? 12) * RARITY_PRICE[rarityOf(item)]));
}

/** Kaufen oder verkaufen. Gibt einen Fehlertext zurück – oder null, wenn es geklappt hat. */
/** Preis für diese Figur: Legenden bekommen Rabatt (Ruf eilt voraus). */
export const priceFor = (price: number, c: { growth?: Character["growth"] } | null | undefined) => Math.max(1, Math.round((price * (100 - legendDiscount(c?.growth ?? null))) / 100));

export function trade(w: WorldState, c: Pick<Character, "id" | "name" | "equipment" | "money"> & { growth?: Character["growth"] }, rules: Rules, action: unknown, ref: unknown): string | null {
  const shop = w.shop;
  if (!shop) return "Gerade ist kein Laden offen.";
  ensureInventory(w, [c], rules);
  const inv = w.inventory![c.id];
  if (action === "kaufen") {
    const ware = shop.wares.find((x) => x.id === ref);
    if (!ware) return "Diese Ware gibt es nicht (mehr).";
    if (ware.stock !== undefined && ware.stock <= 0) return `„${ware.name}“ ist ausverkauft.`;
    if (w.challenges?.includes("keine_traenke") && (ware.stats?.heilung || ware.kind === "trank")) return "Herausforderung „Ohne Heiltränke“: Tränke kannst du in diesem Abenteuer nicht kaufen.";
    const price = priceFor(ware.price, c);
    if (inv.money < price) return `Dafür reicht dein Geld nicht (${moneyText(inv.money)} von ${moneyText(price)}).`;
    if (ware.kind === "verbesserung") {
      if (!ware.bonus) return "Diese Verbesserung ist ungültig.";
      const gear = { ...gearOf(w, c.id) };
      if (gear[ware.bonus.target] + ware.bonus.value > GEAR_MAX) return `${BONUS_NAME[ware.bonus.target]} ist schon so gut verbessert, wie es geht (+${GEAR_MAX}).`;
      gear[ware.bonus.target] += ware.bonus.value;
      w.gear = { ...w.gear, [c.id]: gear };
    } else {
      const e = addItem(inv, { name: ware.name, qty: 1, kind: ware.kind, ...(ware.note ? { note: ware.note } : {}), ...(ware.stats ? { stats: ware.stats } : {}) });
      if (e) return e;
    }
    inv.money -= price;
    if (ware.stock !== undefined) ware.stock--;
    shop.log.push(`${c.name} kauft ${ware.name} für ${moneyText(price)}${price < ware.price ? " (Legenden-Rabatt)" : ""}`);
    return null;
  }
  if (action === "verkaufen") {
    const item = findItem(inv, String(ref ?? ""));
    if (!item) return "Das ist nicht in deinem Gepäck.";
    const price = sellPrice(shop, item);
    const r = removeItem(inv, item.name, 1);
    if ("error" in r) return r.error;
    inv.money += price;
    shop.log.push(`${c.name} verkauft ${itemText({ ...item, qty: 1 })} für ${moneyText(price)}`);
    return null;
  }
  return "Unbekannte Aktion.";
}

/** Für Claude: offener Laden und was seit dem letzten Zug gekauft/verkauft wurde (danach wird das Protokoll geleert). */
export function shopSummary(w: WorldState): string {
  if (!w.shop) return "";
  const lines = [`Offener Laden: ${w.shop.name} (${w.shop.kind === "schmied" ? "Schmied" : "Händler"}) – schließe ihn mit laden schliessen, wenn die Figuren weitergehen.`];
  if (w.shop.log.length) lines.push(`Einkäufe der Spieler: ${w.shop.log.join("; ")}`);
  w.shop.log = [];
  return lines.join("\n");
}

export function gearSummary(w: WorldState, characters: Pick<Character, "id" | "name">[]): string {
  const parts = characters.filter((c) => w.gear?.[c.id]).map((c) => {
    const g = gearOf(w, c.id);
    return `${c.name}: ${(Object.keys(BONUS_NAME) as BonusTarget[]).filter((k) => g[k]).map((k) => `${BONUS_NAME[k]} +${g[k]}`).join(", ")}`;
  });
  return parts.length ? `Verbesserte Ausrüstung (zählt bei den Würfen schon mit): ${parts.join(" | ")}` : "";
}
