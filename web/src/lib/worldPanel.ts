// Spielstand-Leiste für Solo und Gruppe: Lebenspunkte, Kampf, Aufträge, Gedächtnis, Erfahrung.
import type { WorldState } from "../../../shared/world";
import { html, type Raw } from "./dom";
import { term } from "./glossary";
import { icon } from "./icons";
import { arcProgress } from "./arc";
import { levelTitle, xpProgress } from "../../../shared/levels";
import type { Rules } from "../../../shared/schema";

function bar(cur: number, max: number, cls = ""): Raw {
  const pct = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
  const tone = pct <= 0 ? "down" : pct < 34 ? "low" : pct < 67 ? "mid" : "";
  return html`<span class="hp-bar ${cls} ${tone}" role="meter" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${cur}"><span style="width:${pct}%"></span></span>`;
}

export function worldPanel(w: WorldState | null | undefined, characters: { id: string; name: string }[], meId?: string, rules?: Rules): Raw {
  if (!w) return html``;
  const open = w.quests.filter((q) => q.status === "offen");
  const closed = w.quests.filter((q) => q.status !== "offen");
  // Stufe und Erfahrung der eigenen Figur (Solo: die einzige)
  const mine = characters.find((c) => c.id === meId) ?? characters[0];
  const xp = mine ? w.xp[mine.id] ?? 0 : 0;
  const level = (mine && w.levels?.[mine.id]?.level) || 1;
  return html`<section class="world card ${w.combat ? "in-combat" : ""}" aria-label="Spielstand">
    ${w.arc ? arcProgress(w.arc) : ""}
    <div class="world-heroes">
      ${characters.map((c) => {
        const hp = w.hp[c.id] ?? 0, max = w.maxHp[c.id] ?? 0;
        return html`<div class="wh ${c.id === meId ? "me" : ""} ${hp <= 0 ? "down" : ""}">
          <span class="wh-name">${icon("heart")} ${c.name}${characters.length > 1 && w.levels?.[c.id] ? html` <small class="wh-lv">St. ${w.levels[c.id].level}</small>` : ""}</span>
          ${bar(hp, max)}
          <span class="wh-num">${hp}/${max} ${term("tp", "TP")}${hp <= 0 ? " · kampfunfähig" : ""}</span>
        </div>`;
      })}
      ${rules ? levelBadge(level, xp, rules) : html`<span class="chip xp" title="Erfahrungspunkte">${icon("star")} ${xp} EP</span>`}
    </div>
    ${w.combat ? html`<div class="world-combat">
      <div class="wc-head">${icon("sword")} Kampf · Runde ${w.combat.round}</div>
      <div class="wc-enemies">${w.combat.enemies.map((e) => html`<div class="we ${e.hp <= 0 ? "down" : ""}">
        <span class="we-name">${e.name}</span>${bar(e.hp, e.maxHp, "enemy")}
        <span class="we-num">${e.hp <= 0 ? "besiegt" : `${e.hp}/${e.maxHp} TP`} · ${icon("shield")} ${e.armor}</span>
      </div>`)}</div>
    </div>` : ""}
    ${w.quests.length || w.memory.length ? html`<details class="world-log">
      <summary>${icon("scroll")} Auftragsbuch${open.length ? ` · ${open.length} offen` : ""}${w.memory.length ? ` · ${w.memory.length} Notizen` : ""}</summary>
      ${open.length ? html`<ul class="quests">${open.map((q) => html`<li><b>${q.title}</b><span>${q.description}</span>${q.notes.length ? html`<small>${q.notes.at(-1)}</small>` : ""}</li>`)}</ul>` : ""}
      ${closed.length ? html`<ul class="quests closed">${closed.map((q) => html`<li class="${q.status}"><b>${q.status === "erledigt" ? "✓" : "✗"} ${q.title}</b></li>`)}</ul>` : ""}
      ${w.memory.length ? html`<div class="memory"><div class="eyebrow">Der Spielleiter merkt sich</div><ul>${w.memory.slice().reverse().map((m) => html`<li>${m}</li>`)}</ul></div>` : ""}
    </details>` : ""}
  </section>`;
}

/** Stufe, Titel und Balken bis zur nächsten Stufe. */
export function levelBadge(level: number, xp: number, rules: Rules): Raw {
  const { from, to } = xpProgress(xp, level, rules);
  const pct = to === null ? 100 : Math.max(0, Math.min(100, ((xp - from) / (to - from)) * 100));
  return html`<div class="lv-badge" title="${to === null ? `${xp} EP – höchste Stufe` : `${xp} von ${to} EP bis Stufe ${level + 1}`}">
    <span class="lv-num">${level}</span>
    <span class="lv-text"><b>${levelTitle(level, rules)}</b><span class="lv-bar"><i style="width:${pct}%"></i></span><small>${to === null ? `${xp} EP` : `${xp} / ${to} EP`}</small></span>
  </div>`;
}
