// Entwicklung über Abenteuer hinweg in der Oberfläche: Fortschritt übernehmen, Meisterschafts-Leisten, Ruhm einlösen,
// Erbstück wählen. Die Regeln selbst stehen in shared/growth.ts (der Server rechnet gleich).
import { legacyOf } from "./legacy";
import { streamGm } from "./gm";
import { LIMIT_AFTER, limitBroken, MASTERY_BOOST, perkMax, FAME_FOR, HEIRLOOM_TWO_AFTER, heirloomSlots, toggleHeirloom, growthOf, masteredUses, masteryInfo, masteryUses, PERK_IDS, PERKS, SCARS_MAX, buyPerk, syncGrowth, type Growth, type PerkId } from "../../../shared/growth";
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
  // Erwachte Erbstücke
  for (const h of after.heirlooms) {
    const old = before.heirlooms.find((x) => x.name === h.name);
    if (old && JSON.stringify(old.stats) !== JSON.stringify(h.stats)) toast(`Das Erbstück „${h.name}“ ist erwacht: ${statsText(h.stats as InvItem["stats"])}`, "success", 8000);
  }
  // Drittes bestandenes Abenteuer: Limit Break
  if (limitBroken(after) && !after.limitSeen) void maybeLimitBreak(c.id);
  return next;
}

/** Meisterschafts-Leiste einer Fähigkeit (Einsätze über alle Abenteuer). */
export function masteryBar(baseUses: string, c: { id: string; growth?: Growth | null }, w: WorldState | null | undefined, abilityId: string): Raw {
  const info = masteryInfo(baseUses, masteryUses(c, w, abilityId), limitBroken(growthOf(c)));
  if (!info) return html`<p class="mastery-none muted small">${icon("info")} Diese Fähigkeit wirkt immer bzw. beliebig oft – sie lässt sich nicht weiter meistern.</p>`;
  const pct = info.next ? Math.min(100, ((info.uses - info.from) / (info.next - info.from)) * 100) : 100;
  return html`<div class="mastery ${info.next ? "" : "done"}">
    <div class="mastery-top"><b>${icon("star")} Meisterschaft ${"★".repeat(info.level)}${"☆".repeat(info.max - info.level)}</b><small>${info.next ? `${info.uses} / ${info.next} Einsätze` : "gemeistert"}</small></div>
    <span class="mastery-bar"><i style="width:${pct}%"></i></span>
    <small class="mastery-text">${info.next ? html`Jetzt <b>${info.now}</b> – nach ${info.next - info.uses} weiteren Einsätzen <b>${info.then}</b>. Jeder Einsatz zählt, auch über mehrere Abenteuer.` : info.locked ? html`Gemeistert: <b>${info.now}</b>. ${icon("lock")} Meisterschaft III (verstärkte Wirkung ab ${MASTERY_BOOST} Einsätzen) öffnet sich nach dem Limit Break.` : html`Voll gemeistert: <b>${info.now}</b>.`}</small>
  </div>`;
}

/** Effektive Häufigkeit (mit Meisterschaft) – für die Chips. */
export function usesWithMastery(baseUses: string, c: { id: string; growth?: Growth | null }, w: WorldState | null | undefined, abilityId: string): string {
  const info = masteryInfo(baseUses, masteryUses(c, w, abilityId), limitBroken(growthOf(c)));
  return info ? masteredUses(baseUses, info.level - (info.boost ? 1 : 0)) : baseUses;
}

/** Limit-Break-Szene zeigen, falls noch nicht gesehen (danach gemerkt). */
export async function maybeLimitBreak(characterId: string, again = false): Promise<void> {
  const c = characterStore.get(characterId);
  if (!c || !limitBroken(growthOf(c)) || (growthOf(c).limitSeen && !again)) return;
  characterStore.save({ ...c, growth: { ...growthOf(c), limitSeen: true }, updatedAt: new Date().toISOString() });
  const { playLimitBreak } = await import("../fx/limitBreak");
  await playLimitBreak(c.name, growthOf(c).legend ? undefined : () => void forgeLegend(characterId));
}

/** Legendäre Fähigkeit erschaffen lassen (Claude) und an der Figur speichern. */
export async function forgeLegend(characterId: string, onDone?: (c: Character) => void): Promise<void> {
  const c = characterStore.get(characterId);
  if (!c) return;
  toast(`Die Legende von ${c.name} nimmt Gestalt an …`, "info", 6000);
  let saved: Character | null = null;
  await streamGm("legend", { character: c, titles: legacyOf(c.id).map((l) => l.title) }, (ev) => {
    if (ev.type === "error") toast(ev.message, "error", 7000);
    if (ev.type !== "legend") return;
    const fresh = characterStore.get(characterId) ?? c;
    saved = { ...fresh, growth: { ...growthOf(fresh), legend: ev.legend }, updatedAt: new Date().toISOString() };
    characterStore.save(saved);
    toast(`Legendäre Fähigkeit: „${ev.legend.name}“ – ${ev.legend.beginnerText}`, "success", 10000);
  });
  if (saved) onDone?.(saved);
}

/** Figurenbogen: Ruhm, Vorteile, Narben, Erbstück. */
export function growthSection(c: Character): Raw {
  const g = growthOf(c);
  return html`<section class="sheet-section card growth">
    <h2 class="sec-title">${icon("crown")} Ruhm &amp; Entwicklung</h2>
    <p class="muted small">Was ${c.name} von Abenteuer zu Abenteuer mitnimmt. Ruhm gibt es am Ende jedes Abenteuers (Sieg +${FAME_FOR.sieg}, Niederlage +${FAME_FOR.niederlage}). Vorteile gelten ab dem nächsten Abenteuer.</p>
    <div class="fame-purse">${icon("crown")} <b>${g.fame}</b> Ruhm verfügbar</div>
    ${limitBroken(g) ? html`<div class="limit-box">
      <div class="limit-badge">LIMIT BREAK</div>
      ${g.legend ? html`<div class="legend-ab"><b>${icon("crown")} ${g.legend.name}</b> <small class="chip gold">legendär · ${({ einmal_pro_kampf: "1× pro Kampf", einmal_pro_rast: "1× pro Rast", einmal_pro_tag: "1× pro Tag" } as Record<string, string>)[g.legend.uses]}</small><p>${g.legend.beginnerText}</p><details><summary>Genaue Regel</summary><p class="rule-text">${g.legend.text}</p></details></div>`
        : html`<p class="small">Das Limit ist gebrochen – erwecke die legendäre Fähigkeit von ${c.name}. Der Spielleiter entwirft sie aus der Geschichte der Figur (kostet etwa 1 Cent).</p><button class="btn btn-sm glow-border" data-legend>${icon("crown")} Legendäre Fähigkeit erwecken</button>`}
      <button class="btn btn-ghost btn-sm" data-limit-replay>${icon("play")} Limit Break noch einmal ansehen</button>
    </div>` : html`<p class="muted small">${icon("lock")} Limit Break nach ${LIMIT_AFTER} bestandenen Abenteuern (bisher ${g.earned.length}): Vorteile über die Obergrenze, legendäre Fähigkeit, Meisterschaft III.</p>`}
    <div class="perks">${PERK_IDS.map((p) => {
      const perk = PERKS[p], have = g.perks[p] ?? 0, max = perkMax(p, g), full = have >= max;
      return html`<div class="perk ${have ? "owned" : ""} ${have > perk.max ? "beyond" : ""}">
        <div><b>${perk.name}</b> <small class="muted">${have}/${max}${limitBroken(g) ? " · über dem Limit" : ""}</small><p class="small">${perk.text}</p></div>
        <button class="btn btn-sm ${full ? "btn-ghost" : ""}" data-perk="${p}" ${full || g.fame < perk.cost ? "disabled" : ""}>${full ? "voll" : `${perk.cost} Ruhm`}</button>
      </div>`;
    })}</div>
    <div class="growth-cols">
      <div><h3 class="small-head">${icon("star")} Erbstück-Truhe <small class="muted">${g.heirlooms.length}/${heirloomSlots(g)}</small></h3>
        ${g.heirlooms.length ? html`<ul class="heirlooms">${g.heirlooms.map((h) => html`<li class="heirloom r-${rarityOf(h as InvItem)}"><b>${h.name}</b>${h.stats ? html` <small>${statsText(h.stats as InvItem["stats"])}</small>` : ""}</li>`)}</ul><small class="muted">Reist in jedes neue Abenteuer mit.</small>` : html`<p class="muted small">Leer. Am Ende eines Abenteuers kannst du einen Gegenstand hineinlegen.</p>`}
        <p class="muted small">${heirloomSlots(g) > 1 ? "Zwei Plätze – freigeschaltet durch drei bestandene Abenteuer." : `Ab ${HEIRLOOM_TWO_AFTER} bestandenen Abenteuern fasst die Truhe zwei Gegenstände (bisher ${g.earned.length}).`}</p></div>
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
  const g = growthOf(characterStore.get(c.id));
  const inChest = new Set(g.heirlooms.map((h) => h.name));
  const slots = heirloomSlots(g);
  return html`<div class="heirloom-pick">
    <div class="eyebrow">${icon("star")} Erbstück-Truhe · ${slots} ${slots === 1 ? "Platz" : "Plätze"}</div>
    <p class="small">Wähle ${slots === 1 ? "einen Gegenstand" : "bis zu zwei Gegenstände"}, die ${c.name} in jedes künftige Abenteuer mitnimmt. Antippen legt hinein oder nimmt wieder heraus${g.heirlooms.length ? html` (in der Truhe: <b>${g.heirlooms.map((h) => h.name).join(", ")}</b>)` : ""}.${slots === 1 ? ` Ab ${HEIRLOOM_TWO_AFTER} bestandenen Abenteuern passen zwei hinein.` : ""}</p>
    <div class="heirloom-list">${items.map((i) => html`<button class="inv-item r-${rarityOf(i)} ${inChest.has(i.name) ? "worn" : ""}" data-heirloom="${JSON.stringify({ name: i.name, kind: i.kind, ...(i.note ? { note: i.note } : {}), ...(i.stats ? { stats: i.stats } : {}) })}" data-char="${c.id}">${i.name}${i.stats && statsText(i.stats) ? html`<small class="inv-stat">${statsText(i.stats)}</small>` : ""}</button>`)}</div>
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
  const before = growthOf(c);
  const next = toggleHeirloom(before, { ...item, qty: 1 } as Growth["heirlooms"][number]);
  characterStore.save({ ...c, growth: next, updatedAt: new Date().toISOString() });
  const names = new Set(next.heirlooms.map((h) => h.name));
  b.parentElement?.querySelectorAll<HTMLElement>("[data-heirloom]").forEach((x) => { try { x.classList.toggle("worn", names.has(JSON.parse(x.dataset.heirloom ?? "{}").name)); } catch { /* egal */ } });
  const out = before.heirlooms.find((h) => !names.has(h.name) && h.name !== item!.name);
  toast(names.has(item.name) ? `„${item.name}“ liegt jetzt in der Erbstück-Truhe${out ? ` (dafür ist „${out.name}“ herausgenommen)` : ""}.` : `„${item.name}“ ist wieder aus der Truhe genommen.`, "success");
});
