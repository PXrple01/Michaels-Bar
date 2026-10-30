// Laden-Karte: Waren mit Preis und „Kaufen“, darunter eigenes Gepäck zum Verkaufen. Ohne Claude, sofort.
import { moneyText, rarityOf, statsText } from "../../../shared/inventory";
import { BONUS_NAME, gearOf, GEAR_MAX, priceFor, sellPrice } from "../../../shared/shop";
import type { Character } from "../../../shared/schema";
import type { WorldState } from "../../../shared/world";
import { html, type Raw } from "./dom";
import { icon } from "./icons";

const KIND_ICON: Record<string, string> = { waffe: "sword", ruestung: "shield", schild: "shield", trank: "potion", werkzeug: "bag", schatz: "coins", gegenstand: "star", verbesserung: "fist" };

export function shopCard(w: WorldState | null | undefined, characterId: string, who?: { growth?: Character["growth"] } | null): Raw {
  const shop = w?.shop;
  if (!w || !shop) return html``;
  const inv = w.inventory?.[characterId];
  const money = inv?.money ?? 0;
  const gear = gearOf(w, characterId);
  return html`<div class="card shop-card glow-border">
    <div class="shop-head">
      <span class="shop-icon">${icon(shop.kind === "schmied" ? "fist" : "coins")}</span>
      <div><div class="eyebrow">${shop.kind === "schmied" ? "Schmiede" : "Händler"}</div><h3>${shop.name}</h3></div>
      <span class="shop-purse" title="Dein Geld">${icon("coins")} ${moneyText(money)}</span>
    </div>
    <div class="shop-wares">${shop.wares.map((x) => {
      const maxed = x.bonus ? gear[x.bonus.target] + x.bonus.value > GEAR_MAX : false;
      const soldOut = x.stock !== undefined && x.stock <= 0;
      const price = priceFor(x.price, who);
      const tooPoor = money < price;
      return html`<div class="ware k-${x.kind} r-${rarityOf(x)}">
        <span class="ware-icon">${icon(KIND_ICON[x.kind] ?? "star")}</span>
        <span class="ware-text"><b>${x.name}</b><small>${x.bonus ? `${BONUS_NAME[x.bonus.target]} +${x.bonus.value} – dauerhaft` : [statsText(x.stats), x.note].filter(Boolean).join(" · ")}${x.stock !== undefined ? ` · noch ${x.stock}` : ""}</small></span>
        <span class="ware-price">${price < x.price ? html`<s class="muted">${moneyText(x.price, true)}</s> ` : ""}${moneyText(price, true)}</span>
        <button class="btn btn-sm" data-buy="${x.id}" ${tooPoor || soldOut || maxed ? "disabled" : ""} title="${soldOut ? "ausverkauft" : maxed ? `höchstens +${GEAR_MAX}` : tooPoor ? "zu teuer" : ""}">${soldOut ? "aus" : maxed ? "max." : "Kaufen"}</button>
      </div>`;
    })}</div>
    ${inv?.items.length ? html`<details class="shop-sell"><summary>${icon("bag")} Etwas verkaufen</summary>
      <div class="shop-wares">${inv.items.map((i) => html`<div class="ware">
        <span class="ware-text"><b>${i.qty > 1 ? `${i.qty}× ` : ""}${i.name}</b></span>
        <span class="ware-price">+${moneyText(sellPrice(shop, i), true)}</span>
        <button class="btn btn-ghost btn-sm" data-sell="${i.name}">Verkaufen</button>
      </div>`)}</div>
    </details>` : ""}
    <p class="hint">Kaufen und Verkaufen kostet keine Zeit – der Spielleiter erfährt es mit deiner nächsten Handlung.</p>
  </div>`;
}

export function bindShop(root: HTMLElement, send: (action: "kaufen" | "verkaufen", ref: string) => void) {
  root.querySelectorAll<HTMLButtonElement>("[data-buy]").forEach((b) => b.addEventListener("click", () => { b.disabled = true; send("kaufen", b.dataset.buy!); }));
  root.querySelectorAll<HTMLButtonElement>("[data-sell]").forEach((b) => b.addEventListener("click", () => { b.disabled = true; send("verkaufen", b.dataset.sell!); }));
}
