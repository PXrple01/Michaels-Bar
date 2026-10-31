// Entwicklung über Abenteuer hinweg in der Oberfläche: Fortschritt übernehmen, Meisterschafts-Leisten, Ruhm einlösen,
// Erbstück wählen. Die Regeln selbst stehen in shared/growth.ts (der Server rechnet gleich).
import { legacyOf } from "./legacy";
import { streamGm } from "./gm";
import { imagesEnabled, paintPortrait, portraitOf } from "./portraits";
import { canLimitAttack, fullName, LIMIT2_AFTER, limitTier, LIMIT_AFTER, limitBroken, MASTERY_BOOST, perkMax, FAME_FOR, HEIRLOOM_TWO_AFTER, heirloomSlots, toggleHeirloom, growthOf, masteredUses, masteryInfo, masteryUses, PERK_IDS, PERKS, SCARS_MAX, buyPerk, syncGrowth, companionLevel, CALLING_AFTER, type Growth, type LifeCompanion, type PerkId } from "../../../shared/growth";
import { rarityOf, statsText, type InvItem } from "../../../shared/inventory";
import type { Character, ClassDef } from "../../../shared/schema";
import type { LegendOption } from "../../../shared/growth";
import type { WorldState } from "../../../shared/world";
import { $, fragment, html, type Raw } from "./dom";
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
  if ((limitBroken(after) && !after.limitSeen) || (limitTier(after) >= 2 && !after.limitSeen2)) void maybeLimitBreak(c.id);
  return next;
}

/** Ruf & Vermächtnis in einer Liste: Taten (an der Figur) plus Ehrentitel und Vermächtnis-Erbstücke, neueste zuerst. */
export function renown(c: { id: string; growth?: Growth | null }) {
  const legacy = legacyOf(c.id);
  const deeds = (growthOf(c).deeds ?? []).map((d) => ({ ...d, legacy: legacy.find((l) => l.title === d.title) }));
  // Ältere Vermächtnisse ohne passende Tat (vor dem Ruf-System) nicht verlieren
  const extra = legacy.filter((l) => !deeds.some((d) => d.legacy === l)).map((l) => ({ title: l.title, outcome: "sieg" as const, line: undefined as string | undefined, legacy: l }));
  return [...extra, ...deeds].reverse();
}
export function renownList(c: { id: string; growth?: Growth | null }): Raw {
  const list = renown(c);
  if (!list.length) return html`<p class="muted small">Noch unbekannt. Jedes abgeschlossene Abenteuer wird zur Geschichte, die man sich erzählt – Wirte, Barden und alte Feinde kennen sie. Nach einem Sieg gibt es dazu einen Ehrentitel und ein Erbstück.</p>`;
  return html`<ul class="deeds">${list.map((d) => html`<li class="${d.outcome}"><b>${d.legacy ? html`${icon("crown")} ` : ""}${d.title}</b>${d.line ? html`<small>${d.line}</small>` : ""}${d.legacy ? html`<small>${icon("star")} Erbstück: ${d.legacy.heirloom} – aus „${d.legacy.campaignTitle}“</small>` : ""}</li>`)}</ul><small class="muted">Davon hat man in künftigen Abenteuern gehört.</small>`;
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
  if (!c) return;
  const g = growthOf(c), tier = limitTier(g);
  if (!tier) return;
  // Die höchste noch nicht gesehene Stufe (beim Wiederansehen: die höchste erreichte)
  const show: 1 | 2 | 0 = again ? tier : tier >= 2 && !g.limitSeen2 ? 2 : !g.limitSeen ? 1 : 0;
  if (!show) return;
  characterStore.save({ ...c, growth: { ...g, limitSeen: true, ...(show === 2 ? { limitSeen2: true } : {}) }, updatedAt: new Date().toISOString() });
  const { playLimitBreak } = await import("../fx/limitBreak");
  const missing = show === 2 ? !g.legend2 : !g.legend;
  await playLimitBreak(fullName(c), missing ? () => void forgeLegend(characterId, undefined, show) : undefined, show);
  // Neues Porträt: älter, gezeichnet, mit Erbstücken (nur beim ersten Erleben)
  if (!again) void repaintLegend(characterId, show);
}

/** Porträt neu malen lassen (altes Porträt als Vorlage). Fehler sind still – das alte bleibt. */
async function repaintLegend(characterId: string, tier: 1 | 2) {
  const c = characterStore.get(characterId);
  if (!c || !(await imagesEnabled())) return;
  toast(`Ein neues Porträt von ${fullName(c)} wird gemalt …`, "info", 6000);
  try { await paintPortrait(c, tier); toast("Das neue Porträt ist fertig.", "success", 5000); dispatchEvent(new Event("wus:portrait")); }
  catch (e) { console.warn("[Porträt]", (e as Error).message); }
}

/** Legendäre Fähigkeit erschaffen lassen (Claude) und an der Figur speichern. */
export async function forgeLegend(characterId: string, onDone?: (c: Character) => void, tier: 1 | 2 = 1): Promise<void> {
  const c = characterStore.get(characterId);
  if (!c) return;
  toast(`Die Legende von ${c.name} nimmt Gestalt an …`, "info", 6000);
  let options: LegendOption[] = [];
  await streamGm("legend", { character: c, titles: legacyOf(c.id).map((l) => l.title), tier }, (ev) => {
    if (ev.type === "error") toast(ev.message, "error", 7000);
    if (ev.type === "legend") options = ev.options;
  });
  if (!options.length) return;
  const pick = await chooseLegend(c.name, options, tier);
  if (!pick) { toast("Keine Wahl getroffen – du kannst die Fähigkeit später auf dem Figurenbogen erwecken.", "info", 6000); return; }
  const fresh = characterStore.get(characterId) ?? c;
  const { beiname, ...legend } = pick;
  const saved = { ...fresh, growth: { ...growthOf(fresh), ...(tier === 2 ? { legend2: legend } : { legend }), epithet: beiname }, updatedAt: new Date().toISOString() };
  characterStore.save(saved);
  toast(`${c.name} ${beiname} – legendäre Fähigkeit „${pick.name}“: ${pick.beginnerText}`, "success", 10000);
  onDone?.(saved);
}

const USES_DE: Record<string, string> = { einmal_pro_kampf: "1× pro Kampf", einmal_pro_rast: "1× pro Rast", einmal_pro_tag: "1× pro Tag" };

/** Zwei Vorschläge – eine Wahl (für immer). null = abgebrochen. */
function chooseLegend(name: string, options: LegendOption[], tier: 1 | 2 = 1): Promise<LegendOption | null> {
  return new Promise((resolve) => {
    const el = fragment(html`
      <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Legendäre Fähigkeit wählen">
        <div class="modal card glow-border legend-pick">
          <div class="limit-badge">${tier === 2 ? "ZWEITE LEGENDÄRE FÄHIGKEIT" : "LEGENDÄRE FÄHIGKEIT"}</div>
          <p>Wähle die Fähigkeit, die ${name} für immer begleitet – mit ihr kommt ein Beiname. Die Wahl gilt endgültig.</p>
          <div class="legend-options">${options.map((o, i) => html`<button class="legend-option" data-pick-legend="${i}">
            <em class="legend-epithet">${name} ${o.beiname}</em>
            <b>${icon("crown")} ${o.name}</b><small class="chip gold">${USES_DE[o.uses] ?? o.uses}</small>
            <span>${o.beginnerText}</span><small class="muted">${o.text}</small>
          </button>`)}</div>
          <div style="display:flex;justify-content:flex-end;margin-top:10px"><button class="btn btn-ghost btn-sm" data-pick-legend="">Später entscheiden</button></div>
        </div>
      </div>`);
    const close = (l: LegendOption | null) => { el.remove(); removeEventListener("keydown", onKey); resolve(l); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(null); };
    el.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-pick-legend]");
      if (b) close(b.dataset.pickLegend ? options[Number(b.dataset.pickLegend)] ?? null : null);
    });
    addEventListener("keydown", onKey);
    $("#modal-root").append(el);
  });
}

/** Knopf „Limit-Angriff“ (im Kampf, einmal pro Abenteuer, nach dem Limit Break). */
export function limitAttackButton(w: WorldState | null | undefined, c: { id: string; growth?: Growth | null }): Raw {
  if (!canLimitAttack(w, c)) return html``;
  return html`<div class="limit-attack-row"><button type="button" class="limit-attack-btn ${limitTier(growthOf(c)) >= 2 ? "gold" : ""}" data-limit-attack title="Einmal pro Abenteuer: garantierter kritischer Treffer. Schreib vorher ins Feld, wen du angreifst – sonst trifft es den gefährlichsten Gegner.">⚡ LIMIT-ANGRIFF</button></div>`;
}

/** Animation abspielen und den Text für die Handlung liefern. */
export async function runLimitAttack(c: Character, typed: string): Promise<string> {
  const { playLimitAttack } = await import("../fx/limitAttack");
  const { sigil } = await import("./icons");
  await playLimitAttack({ name: fullName(c), portrait: portraitOf(c.id), sigilSvg: sigil("shield", "").value, tier: limitTier(growthOf(c)) });
  return typed.trim() || "Ich entfessele meinen Limit-Angriff auf den gefährlichsten Gegner!";
}

/** Figurenbogen: Ruhm, Vorteile, Narben, Erbstück. */
const USES_LABEL: Record<string, string> = { passiv: "immer aktiv", beliebig: "beliebig oft", einmal_pro_kampf: "1× pro Kampf", einmal_pro_rast: "1× pro Rast", einmal_pro_tag: "1× pro Tag" };

/** Zweite Berufung: anzeigen oder (ab CALLING_AFTER Abenteuern) aus den Fähigkeiten anderer Klassen wählen. */
function callingBox(c: Character, g: Growth, classes: ClassDef[]): Raw {
  if (g.calling) return html`<div class="calling-box"><h3 class="small-head">${icon("scroll")} Zweite Berufung <small class="chip">${g.calling.className}</small></h3><p class="small"><b>${g.calling.name}</b> <small class="muted">${USES_LABEL[g.calling.uses] ?? g.calling.uses}</small><br>${g.calling.beginnerText}</p></div>`;
  if (g.earned.length < CALLING_AFTER) return html`<p class="muted small">${icon("lock")} Zweite Berufung nach ${CALLING_AFTER} bestandenen Abenteuern (bisher ${g.earned.length}): ${c.name} lernt eine Fähigkeit einer anderen Klasse.</p>`;
  const others = classes.filter((k) => k.id !== c.classId);
  return html`<details class="calling-box calling-pick" open>
    <summary><b>${icon("scroll")} Zweite Berufung wählen</b> <small class="muted">– eine Fähigkeit einer anderen Klasse, für immer</small></summary>
    ${others.map((k) => html`<div class="calling-class"><h4>${k.name}</h4><div class="calling-list">${k.abilities.filter((a) => a.level === 1).map((a) => html`<button class="calling-opt" data-calling="${k.id}:${a.id}"><b>${a.name}</b><small class="muted">${USES_LABEL[a.uses] ?? a.uses}</small><span class="small">${a.beginnerText}</span></button>`)}</div></div>`)}
  </details>`;
}

/** Zweite Berufung festlegen (einmalig). Gibt die neue Figur zurück. */
export function chooseCalling(c: Character, classes: ClassDef[], ref: string): Character | null {
  const [classId, abilityId] = ref.split(":");
  const k = classes.find((x) => x.id === classId);
  const a = k?.abilities.find((x) => x.id === abilityId);
  const g = growthOf(c);
  if (!k || !a || g.calling || g.earned.length < CALLING_AFTER) return null;
  const uses = (["passiv", "beliebig", "einmal_pro_kampf", "einmal_pro_rast", "einmal_pro_tag"] as const).find((u) => u === a.uses) ?? "einmal_pro_tag";
  const next = { ...c, growth: { ...g, calling: { classId: k.id, className: k.name, name: a.name, type: a.type, uses, text: a.text, beginnerText: a.beginnerText } }, updatedAt: new Date().toISOString() };
  characterStore.save(next);
  toast(`${c.name} beherrscht jetzt auch „${a.name}“ (${k.name}).`, "success");
  return next;
}

export function growthSection(c: Character, classes: ClassDef[] = []): Raw {
  const g = growthOf(c);
  return html`<section class="sheet-section card growth">
    <h2 class="sec-title">${icon("crown")} Ruhm &amp; Entwicklung</h2>
    ${g.resting ? html`<p class="resting-note">${icon("candle")} ${c.name} ruht seit ${new Date(g.resting.since).toLocaleDateString("de-DE")}. Das Erbe trägt <a href="#/figur/${g.resting.heirId}">${g.resting.heirName}</a> weiter.</p>` : ""}
    ${g.lineage ? html`<p class="lineage-note">${icon("users")} Nachfahre von <a href="#/figur/${g.lineage.ancestorId}">${g.lineage.name}</a> · ${g.lineage.generation}. Generation</p>` : ""}
    <p class="muted small">Was ${c.name} von Abenteuer zu Abenteuer mitnimmt. Ruhm gibt es am Ende jedes Abenteuers (Sieg +${FAME_FOR.sieg}, Niederlage +${FAME_FOR.niederlage}). Vorteile gelten ab dem nächsten Abenteuer.</p>
    <div class="fame-purse">${icon("crown")} <b>${g.fame}</b> Ruhm verfügbar</div>
    ${limitBroken(g) ? html`<div class="limit-box ${limitTier(g) >= 2 ? "gold" : ""}">
      <div class="limit-badge">LIMIT BREAK${limitTier(g) >= 2 ? " II" : ""}</div>
      ${g.legend ? html`<div class="legend-ab"><b>${icon("crown")} ${g.legend.name}</b> <small class="chip gold">legendär · ${({ einmal_pro_kampf: "1× pro Kampf", einmal_pro_rast: "1× pro Rast", einmal_pro_tag: "1× pro Tag" } as Record<string, string>)[g.legend.uses]}</small><p>${g.legend.beginnerText}</p><details><summary>Genaue Regel</summary><p class="rule-text">${g.legend.text}</p></details></div>`
        : html`<p class="small">Das Limit ist gebrochen – erwecke die legendäre Fähigkeit von ${c.name}. Der Spielleiter entwirft zwei Vorschläge aus der Geschichte der Figur, du wählst einen (kostet etwa 1–2 Cent).</p><button class="btn btn-sm glow-border" data-legend>${icon("crown")} Legendäre Fähigkeit erwecken</button>`}
      ${limitTier(g) >= 2 ? (g.legend2 ? html`<div class="legend-ab"><b>${icon("crown")} ${g.legend2.name}</b> <small class="chip gold">zweite Legende · ${({ einmal_pro_kampf: "1× pro Kampf", einmal_pro_rast: "1× pro Rast", einmal_pro_tag: "1× pro Tag" } as Record<string, string>)[g.legend2.uses]}</small><p>${g.legend2.beginnerText}</p><details><summary>Genaue Regel</summary><p class="rule-text">${g.legend2.text}</p></details></div>`
        : html`<button class="btn btn-sm glow-border" data-legend2>${icon("crown")} Zweite legendäre Fähigkeit erwecken</button>`)
        : html`<p class="muted small">${icon("lock")} Limit Break II nach ${LIMIT2_AFTER} bestandenen Abenteuern (bisher ${g.earned.length}): zweite legendäre Fähigkeit, neuer Beiname, dritter Truhenplatz, goldener Rand.</p>`}
      <button class="btn btn-ghost btn-sm" data-limit-replay>${icon("play")} Limit Break${limitTier(g) >= 2 ? " II" : ""} noch einmal ansehen</button>
    </div>` : html`<p class="muted small">${icon("lock")} Limit Break nach ${LIMIT_AFTER} bestandenen Abenteuern (bisher ${g.earned.length}): Vorteile über die Obergrenze, legendäre Fähigkeit, Meisterschaft III.</p>`}
    <div class="perks">${PERK_IDS.map((p) => {
      const perk = PERKS[p], have = g.perks[p] ?? 0, max = perkMax(p, g), full = have >= max;
      return html`<div class="perk ${have ? "owned" : ""} ${have > perk.max ? "beyond" : ""}">
        <div><b>${perk.name}</b> <small class="muted">${have}/${max}${limitBroken(g) ? " · über dem Limit" : ""}</small><p class="small">${perk.text}</p></div>
        <button class="btn btn-sm ${full ? "btn-ghost" : ""}" data-perk="${p}" ${full || g.fame < perk.cost ? "disabled" : ""}>${full ? "voll" : `${perk.cost} Ruhm`}</button>
      </div>`;
    })}</div>
    ${callingBox(c, g, classes)}
    <div class="growth-cols">
      <div><h3 class="small-head">${icon("feather")} Ruf &amp; Vermächtnis <small class="muted">${renown(c).length} Taten</small></h3>${renownList(c)}</div>
      <div><h3 class="small-head">${icon("star")} Erbstück-Truhe <small class="muted">${g.heirlooms.length}/${heirloomSlots(g)}</small></h3>
        ${g.heirlooms.length ? html`<ul class="heirlooms">${g.heirlooms.map((h) => html`<li class="heirloom r-${rarityOf(h as InvItem)}"><b>${h.name}</b>${h.stats ? html` <small>${statsText(h.stats as InvItem["stats"])}</small>` : ""}</li>`)}</ul><small class="muted">Reist in jedes neue Abenteuer mit.</small>` : html`<p class="muted small">Leer. Am Ende eines Abenteuers kannst du einen Gegenstand hineinlegen.</p>`}
        <p class="muted small">${heirloomSlots(g) > 2 ? "Drei Plätze – freigeschaltet durch den Limit Break II." : heirloomSlots(g) > 1 ? `Zwei Plätze – ab ${LIMIT2_AFTER} bestandenen Abenteuern drei.` : `Ab ${HEIRLOOM_TWO_AFTER} bestandenen Abenteuern fasst die Truhe zwei Gegenstände (bisher ${g.earned.length}).`}</p></div>
      <div><h3 class="small-head">${icon("users")} Gefährte fürs Leben</h3>${g.companion ? html`<p class="small"><b>${g.companion.name}</b> <small class="muted">${g.companion.role}</small><br><span class="chip gold">Stufe ${companionLevel(g.companion.journeys)}/5</span> <small class="muted">${g.companion.journeys} Abenteuer gemeinsam</small></p><button class="btn btn-ghost btn-sm" data-companion-drop="${c.id}">${icon("x")} Ziehen lassen</button>` : html`<p class="muted small">Noch keiner. Am Ende eines Abenteuers kannst du einen Begleiter einladen, ${c.name} in alle künftigen Abenteuer zu folgen. Alle zwei Abenteuer steigt er eine Stufe.</p>`}</div>
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

/** Abschluss-Karte: einen Begleiter aus diesem Abenteuer als Gefährten fürs Leben mitnehmen. */
export function companionPicker(w: WorldState, c: { id: string; name: string }): Raw {
  const list = w.companions ?? [];
  if (!list.length) return html``;
  const mine = growthOf(characterStore.get(c.id)).companion;
  return html`<div class="heirloom-pick companion-pick">
    <div class="eyebrow">${icon("users")} Gefährte fürs Leben</div>
    <p class="small">Wer soll ${c.name} in jedes künftige Abenteuer folgen? Alle zwei gemeinsamen Abenteuer wird der Gefährte stärker (Stufe 1–5). Es geht nur einer – ein neuer ersetzt den alten.${mine ? html` Jetzt dabei: <b>${mine.name}</b> (Stufe ${companionLevel(mine.journeys)}).` : ""}</p>
    <div class="heirloom-list">${list.map((k) => html`<button class="inv-item ${mine?.name === k.name ? "worn" : ""}" data-companion="${JSON.stringify({ name: k.name, role: k.role, skill: k.skill.replace(/\s*\(Gefährten-Stufe \d\)$/, ""), ...(k.look ? { look: k.look } : {}), ...(k.portrait && k.portrait.length <= 200 ? { portrait: k.portrait } : {}) })}" data-char="${c.id}">${k.name}<small class="inv-stat">${k.role}</small></button>`)}</div>
  </div>`;
}

/** Gefährten fürs Leben setzen oder (mit null) ziehen lassen. Gibt die neue Figur zurück. */
export function setCompanion(id: string, k: LifeCompanion | null): Character | null {
  const c = characterStore.get(id);
  if (!c) return null;
  const g = growthOf(c);
  const next = { ...c, growth: { ...g, companion: k }, updatedAt: new Date().toISOString() };
  characterStore.save(next);
  return next;
}

document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const b = t.closest<HTMLElement>("[data-companion]");
  if (!b) return;
  let k: Omit<LifeCompanion, "journeys"> | null = null;
  try { k = JSON.parse(b.dataset.companion ?? ""); } catch { /* kaputt */ }
  const c = characterStore.get(b.dataset.char ?? "");
  if (!c || !k?.name) return;
  const old = growthOf(c).companion;
  if (old?.name === k.name) {
    // Kein Antippen-zum-Entfernen: das würde die gemeinsamen Reisen löschen (ziehen lassen geht auf dem Figurenbogen)
    toast(`${k.name} ist schon ${c.name}s Gefährte fürs Leben. Ziehen lassen kannst du ${k.name} auf dem Figurenbogen.`, "info", 6000);
    return;
  } else {
    // Dieses Abenteuer zählt schon als erste gemeinsame Reise
    setCompanion(c.id, { name: k.name.slice(0, 60), role: k.role.slice(0, 60), skill: k.skill.slice(0, 120), ...(k.look ? { look: k.look.slice(0, 300) } : {}), ...(k.portrait ? { portrait: k.portrait } : {}), journeys: 1 });
    toast(`${k.name} folgt ${c.name} ab jetzt in jedes Abenteuer${old ? ` (statt ${old.name})` : ""}.`, "success");
  }
  const now = growthOf(characterStore.get(c.id)).companion?.name;
  b.parentElement?.querySelectorAll<HTMLElement>("[data-companion]").forEach((x) => { try { x.classList.toggle("worn", JSON.parse(x.dataset.companion ?? "{}").name === now); } catch { /* egal */ } });
});

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
