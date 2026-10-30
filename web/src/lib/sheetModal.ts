import { avatar } from "./portraits";
// Figurenblatt im Abenteuer: Name in der Seitenleiste antippen → Werte der Figur auf einen Blick
// (mit Stufenaufstiegen, Schmied-Verbesserungen, Boni aus dem Gepäck und aufgewerteten Fähigkeiten dieser Kampagne).
import { armorValue, attackInfo, modifier, skillBonusForLevel, trainedSkills } from "../../../shared/character";
import { formatModifier } from "../../../shared/dice";
import { levelTitle, xpProgress } from "../../../shared/levels";
import type { Character } from "../../../shared/schema";
import { bonusParts } from "../../../shared/shop";
import { effectiveAbilities } from "../../../shared/upgrades";
import type { WorldState } from "../../../shared/world";
import { abilityIcon, usesLabel } from "./abilities";
import type { GameData } from "./api";
import { dataFor } from "./customClasses";
import { $, fragment, html, type Raw } from "./dom";
import { icon } from "./icons";

function sheetBody(c: Character, data: GameData, w: WorldState | null | undefined): Raw {
  const { rules, classes } = dataFor(data, c);
  const cls = classes.find((x) => x.id === c.classId);
  if (!cls) return html`<p class="muted">Die Klasse dieser Figur ist unbekannt.</p>`;
  const stand = rules.stands.find((s) => s.id === c.stand);
  const parts = { angriff: bonusParts(w, c.id, "angriff"), schaden: bonusParts(w, c.id, "schaden"), ruestung: bonusParts(w, c.id, "ruestung") };
  const sum = (k: keyof typeof parts) => parts[k].reduce((n, p) => n + p.value, 0);
  const gear = { angriff: sum("angriff"), schaden: sum("schaden"), ruestung: sum("ruestung") };
  const armor = armorValue(c, rules, cls), atk = attackInfo(c, rules, cls);
  const trained = trainedSkills(c, rules, classes), sb = skillBonusForLevel(c.level, rules);
  const hp = w?.hp[c.id] ?? c.hp.current, maxHp = w?.maxHp[c.id] ?? c.hp.max;
  const xp = w?.xp[c.id] ?? c.xp;
  const { from, to } = xpProgress(xp, c.level, rules);
  const abilities = effectiveAbilities(cls.abilities, w?.progress?.[c.id]);
  const skills = rules.skills.filter((s) => trained.has(s.id));
  const persona = ([["Eigenart", c.personality.trait], ["Glaube", c.personality.ideal], ["Bindung", c.personality.bond], ["Schwäche", c.personality.flaw], ["Aussehen", c.appearance]] as const).filter(([, v]) => v);
  return html`
    <div class="cs-head">
      <span class="cs-sigil">${avatar(c.id, cls.sigil, { probe: true })}</span>
      <div class="cs-id">
        <h3>${c.name}</h3>
        <small class="muted">${cls.name}${stand ? ` · ${stand.name}` : ""}</small>
        <div class="cs-lv"><b>Stufe ${c.level}</b> · ${levelTitle(c.level, rules)}<span class="lv-bar"><i style="width:${to === null ? 100 : Math.max(0, Math.min(100, ((xp - from) / (to - from)) * 100))}%"></i></span><small>${to === null ? `${xp} EP` : `${xp} / ${to} EP`}</small></div>
      </div>
    </div>
    <div class="cs-vitals">
      <div title="Trefferpunkte – bei 0 ist die Figur bewusstlos">${icon("heart")}<b>${hp}/${maxHp}</b><small>Trefferpunkte</small></div>
      <div title="${[...armor.parts.map((p) => `${p.label} ${formatModifier(p.value)}`), ...parts.ruestung.map((p) => `${p.label} +${p.value}`)].join(", ")}">${icon("shield")}<b>${armor.total + gear.ruestung}</b><small>Rüstung</small></div>
      ${atk ? html`<div title="${atk.weapon}">${icon("sword")}<b>${formatModifier(atk.attackBonus + gear.angriff)}</b><small>Angriff</small></div>
        <div title="${atk.weapon}">${icon("zap")}<b>${atk.damage}${atk.damageBonus + gear.schaden ? formatModifier(atk.damageBonus + gear.schaden) : ""}</b><small>Schaden</small></div>` : ""}
    </div>
    ${atk ? html`<small class="muted cs-weapon">Waffe: ${atk.weapon}${gear.angriff || gear.schaden || gear.ruestung ? ` · Boni: ${[...new Set([...parts.angriff, ...parts.schaden, ...parts.ruestung].map((p) => p.label))].join(", ")}` : ""}</small>` : ""}
    <div class="cs-sec">${icon("star")} Attribute</div>
    <div class="cs-attrs">${rules.attributes.map((a) => html`<div class="${cls.primaryAttributes.includes(a.id) ? "primary" : ""}" title="${a.description}">
      <small>${a.short}</small><b>${formatModifier(modifier(c.attributes[a.id]))}</b><span>${c.attributes[a.id]}</span></div>`)}</div>
    <div class="cs-sec">${icon("feather")} Geübte Fertigkeiten</div>
    <div class="cs-skills">${skills.length ? skills.map((s) => {
      const a = rules.attributes.find((x) => x.id === s.attribute);
      return html`<span class="cs-skill" title="${s.description}">${s.name} <b>${formatModifier(modifier(c.attributes[s.attribute]) + sb)}</b>${a ? html`<small>${a.short}</small>` : ""}</span>`;
    }) : html`<small class="muted">keine</small>`}</div>
    <div class="cs-sec">${icon("sparkles")} Fähigkeiten</div>
    <ul class="cs-abilities">${abilities.map((a) => html`<li><span class="cs-ab-icon">${abilityIcon(a.type)}</span><div><b>${a.name}</b> <small class="chip">${usesLabel(a.uses)}</small>${a.upgraded ? html` <small class="chip good">verbessert</small>` : ""}<p>${a.beginnerText}</p></div></li>`)}
      ${stand ? html`<li><span class="cs-ab-icon">${icon("crown")}</span><div><b>${stand.name}</b> <small class="chip">Herkunft</small><p>${stand.feature}</p></div></li>` : ""}</ul>
    ${persona.length ? html`<div class="cs-sec">${icon("user")} Persönlichkeit</div><dl class="cs-persona">${persona.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>` : ""}`;
}

/** Figurenblatt öffnen. `load` liefert die Figur (bei Mitspielern vom Server). */
export function openSheet(load: () => Promise<Character | null>, data: GameData, world: () => WorldState | null | undefined) {
  const el = fragment(html`<div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Figurenblatt">
    <div class="modal card char-sheet-modal">
      <button class="icon-btn cs-close" data-close aria-label="Schließen">${icon("x")}</button>
      <div class="cs-content"><div class="spinner"></div></div>
    </div>
  </div>`);
  const close = () => { el.remove(); removeEventListener("keydown", onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
  el.addEventListener("click", (e) => { if (e.target === el || (e.target as HTMLElement).closest("[data-close]")) close(); });
  addEventListener("keydown", onKey);
  $("#modal-root").append(el);
  load().then((c) => {
    $(".cs-content", el).innerHTML = (c ? sheetBody(c, data, world()) : html`<p class="muted">Diese Figur ist nicht verfügbar.</p>`).value;
  }).catch((e) => { $(".cs-content", el).innerHTML = html`<p class="muted">${(e as Error).message}</p>`.value; });
}
