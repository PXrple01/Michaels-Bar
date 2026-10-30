// Entwicklung über Abenteuer hinweg in der Oberfläche: Fortschritt übernehmen, Meisterschafts-Leisten, Ruhm einlösen,
// Erbstück wählen. Die Regeln selbst stehen in shared/growth.ts (der Server rechnet gleich).
import { FAME_FOR, growthOf, masteredUses, masteryInfo, masteryUses, PERK_IDS, PERKS, SCARS_MAX, buyPerk, syncGrowth, type Growth, type PerkId } from "../../../shared/growth";
import { rarityOf, statsText, type InvItem } from "../../../shared/inventory";
import type { Character } from "../../../shared/schema";
import type { WorldState } from "../../../shared/world";
import { html, type Raw } from "./dom";
import { icon } from "./icons";
import { characterStore } from "./store";
import { toast } from "./ui";

/** Nach einem Zug: Einsätze, Narben und (am Ende) Ruhm an die gespeicherte Figur übernehmen. Gibt die neue Figur zurück. */
export function syncCharacterGrowth(characterId: string, w: WorldState | null | undefined): Character | null {
  const c = characterStore.get(characterId);
  if (!c || !w) return null;
  const next = syncGrowth(c, w);
  if (!next) return null;
  const before = growthOf(c), after = growthOf(next);
  characterStore.save({ ...next, updatedAt: new Date().toISOString() });
  if (after.fame > before.fame) toast(`${c.name} erhält ${after.fame - before.fame} Ruhm – einzulösen auf dem Figurenbogen.`, "success", 7000);
  if (after.scars.length > before.scars.length) toast(`${c.name} trägt jetzt eine Narbe: ${after.scars.at(-1)!.name}`, "info", 6000);
  return next;
}

/** Meisterschafts-Leiste einer Fähigkeit (Einsätze über alle Abenteuer). */
export function masteryBar(baseUses: string, c: { id: string; growth?: Growth | null }, w: WorldState | null | undefined, abilityId: string): Raw {
  const info = masteryInfo(baseUses, masteryUses(c, w, abilityId));
  if (!info) return html`<p class="mastery-none muted small">${icon("info")} Diese Fähigkeit wirkt immer bzw. beliebig oft – sie lässt sich nicht weiter meistern.</p>`;
  const pct = info.next ? Math.min(100, ((info.uses - info.from) / (info.next - info.from)) * 100) : 100;
  return html`<div class="mastery ${info.next ? "" : "done"}">
    <div class="mastery-top"><b>${icon("star")} Meisterschaft ${"★".repeat(info.level)}${"☆".repeat(info.max - info.level)}</b><small>${info.next ? `${info.uses} / ${info.next} Einsätze` : "gemeistert"}</small></div>
    <span class="mastery-bar"><i style="width:${pct}%"></i></span>
    <small class="mastery-text">${info.next ? html`Jetzt <b>${info.now}</b> – nach ${info.next - info.uses} weiteren Einsätzen <b>${info.then}</b>. Jeder Einsatz zählt, auch über mehrere Abenteuer.` : html`Voll gemeistert: <b>${info.now}</b>.`}</small>
  </div>`;
}

/** Effektive Häufigkeit (mit Meisterschaft) – für die Chips. */
export function usesWithMastery(baseUses: string, c: { id: string; growth?: Growth | null }, w: WorldState | null | undefined, abilityId: string): string {
  const info = masteryInfo(baseUses, masteryUses(c, w, abilityId));
  return info ? masteredUses(baseUses, info.level) : baseUses;
}

/** Figurenbogen: Ruhm, Vorteile, Narben, Erbstück. */
export function growthSection(c: Character): Raw {
  const g = growthOf(c);
  return html`<section class="sheet-section card growth">
    <h2 class="sec-title">${icon("crown")} Ruhm &amp; Entwicklung</h2>
    <p class="muted small">Was ${c.name} von Abenteuer zu Abenteuer mitnimmt. Ruhm gibt es am Ende jedes Abenteuers (Sieg +${FAME_FOR.sieg}, Niederlage +${FAME_FOR.niederlage}). Vorteile gelten ab dem nächsten Abenteuer.</p>
    <div class="fame-purse">${icon("crown")} <b>${g.fame}</b> Ruhm verfügbar</div>
    <div class="perks">${PERK_IDS.map((p) => {
      const perk = PERKS[p], have = g.perks[p] ?? 0, full = have >= perk.max;
      return html`<div class="perk ${have ? "owned" : ""}">
        <div><b>${perk.name}</b> <small class="muted">${have}/${perk.max}</small><p class="small">${perk.text}</p></div>
        <button class="btn btn-sm ${full ? "btn-ghost" : ""}" data-perk="${p}" ${full || g.fame < perk.cost ? "disabled" : ""}>${full ? "voll" : `${perk.cost} Ruhm`}</button>
      </div>`;
    })}</div>
    <div class="growth-cols">
      <div><h3 class="small-head">${icon("star")} Erbstück-Truhe</h3>${g.heirloom ? html`<p class="heirloom r-${rarityOf(g.heirloom as InvItem)}"><b>${g.heirloom.name}</b>${g.heirloom.stats ? html` <small>${statsText(g.heirloom.stats as InvItem["stats"])}</small>` : ""}<br><small class="muted">Reist in jedes neue Abenteuer mit.</small></p>` : html`<p class="muted small">Leer. Am Ende eines Abenteuers kannst du einen Gegenstand hineinlegen.</p>`}</div>
      <div><h3 class="small-head">${icon("fist")} Narben <small class="muted">${g.scars.length}/${SCARS_MAX}</small></h3>${g.scars.length ? html`<ul class="scars">${g.scars.map((s) => html`<li><b>${s.name}</b><small>${s.text}</small></li>`)}</ul>` : html`<p class="muted small">Noch keine. Wer im Kampf zu Boden geht und überlebt, trägt eine Narbe davon (+1 auf Einschüchtern).</p>`}</div>
    </div>
  </section>`;
}

/** Ruhm einlösen (Figurenbogen). Gibt die neue Figur zurück. */
export function redeemPerk(c: Character, p: PerkId): Character | null {
  const r = buyPerk(growthOf(c), p);
  if (typeof r === "string") { toast(r, "error"); return null; }
  const next = { ...c, growth: r, updatedAt: new Date().toISOString() };
  characterStore.save(next);
  toast(`„${PERKS[p].name}“ eingelöst – gilt ab dem nächsten Abenteuer.`, "success");
  return next;
}

/** Abschluss-Karte: Erbstück für die eigene Figur wählen. */
export function heirloomPicker(w: WorldState, c: { id: string; name: string }): Raw {
  const items = (w.inventory?.[c.id]?.items ?? []).filter((i) => i.kind !== "trank");
  if (!items.length) return html``;
  const current = growthOf(characterStore.get(c.id)).heirloom?.name;
  return html`<div class="heirloom-pick">
    <div class="eyebrow">${icon("star")} Erbstück-Truhe</div>
    <p class="small">Wähle einen Gegenstand, den ${c.name} in jedes künftige Abenteuer mitnimmt${current ? html` (bisher: <b>${current}</b>)` : ""}.</p>
    <div class="heirloom-list">${items.map((i) => html`<button class="inv-item r-${rarityOf(i)} ${i.name === current ? "worn" : ""}" data-heirloom="${JSON.stringify({ name: i.name, kind: i.kind, ...(i.note ? { note: i.note } : {}), ...(i.stats ? { stats: i.stats } : {}) })}" data-char="${c.id}">${i.name}${i.stats && statsText(i.stats) ? html`<small class="inv-stat">${statsText(i.stats)}</small>` : ""}</button>`)}</div>
  </div>`;
}

// Klicks auf ein Erbstück (überall, wo die Abschluss-Karte steht)
document.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-heirloom]");
  if (!b) return;
  const c = characterStore.get(b.dataset.char ?? "");
  let item: Pick<InvItem, "name" | "kind" | "note" | "stats"> | null = null;
  try { item = JSON.parse(b.dataset.heirloom ?? ""); } catch { /* kaputt */ }
  if (!c || !item?.name) return;
  characterStore.save({ ...c, growth: { ...growthOf(c), heirloom: { ...item, qty: 1 } as Growth["heirloom"] }, updatedAt: new Date().toISOString() });
  b.parentElement?.querySelectorAll(".worn").forEach((x) => x.classList.remove("worn"));
  b.classList.add("worn");
  toast(`„${item.name}“ liegt jetzt in der Erbstück-Truhe von ${c.name}.`, "success");
});
