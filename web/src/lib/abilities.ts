// Fähigkeiten verständlich anzeigen: Liste mit Erklärung (eigene Figur) und kleine Symbole (Mitspieler).
import type { Ability } from "../../../shared/schema";
import { html, type Raw } from "./dom";
import { icon } from "./icons";

export type AbilityInfo = Pick<Ability, "name" | "type" | "uses" | "text" | "beginnerText">;

const ICONS: Record<string, string> = {
  angriff: "sword", verteidigung: "shield", heilung: "heart", unterstuetzung: "star", kontrolle: "target",
  bewegung: "feather", wissen: "book", sozial: "users", handwerk: "fist", magie: "wand",
};
const TYPES: Record<string, string> = {
  angriff: "Angriff", verteidigung: "Verteidigung", heilung: "Heilung", unterstuetzung: "Unterstützung", kontrolle: "Kontrolle",
  bewegung: "Bewegung", wissen: "Wissen", sozial: "Umgang mit Menschen", handwerk: "Handwerk", magie: "Magie",
};

export const abilityIcon = (type: string) => icon(ICONS[type] ?? "sparkles");

export function usesLabel(u: string): string {
  return ({ passiv: "immer aktiv", einmal_pro_kampf: "1× pro Kampf", einmal_pro_rast: "1× pro Rast", einmal_pro_tag: "1× pro Tag", beliebig: "beliebig oft" } as Record<string, string>)[u] ?? u;
}

/** Ausführliche Liste für die eigene Figur. */
export function abilityList(name: string, abilities: AbilityInfo[]): Raw {
  if (!abilities.length) return html``;
  return html`<section class="abilities card" aria-label="Fähigkeiten von ${name}">
    <div class="ab-head">
      <h3>${icon("sparkles")} Fähigkeiten von ${name}</h3>
      <p class="muted small">So setzt du sie ein: Schreib einfach in deine Handlung, dass du sie nutzt – z. B. „Ich setze ${abilities.find((a) => a.uses !== "passiv")?.name ?? abilities[0].name} ein“. Passive Fähigkeiten wirken von selbst.</p>
    </div>
    <div class="ab-grid">
      ${abilities.map((a, i) => html`<div class="ab" style="--i:${i}">
        <div class="ab-top">
          <span class="ab-icon t-${a.type}">${abilityIcon(a.type)}</span>
          <span class="ab-title"><b>${a.name}</b><small>${TYPES[a.type] ?? a.type}</small></span>
          <span class="chip ab-uses">${usesLabel(a.uses)}</span>
        </div>
        <p class="ab-easy">${a.beginnerText}</p>
        <details class="ab-more"><summary>Genaue Regel</summary><p>${a.text}</p></details>
      </div>`)}
    </div>
  </section>`;
}

/** Kleine Symbolreihe – Name und Erklärung erscheinen beim Antippen/Darüberfahren. */
export function abilityChips(abilities: AbilityInfo[]): Raw {
  return html`<span class="ab-chips">${abilities.map((a) => html`<span class="ab-chip t-${a.type}" tabindex="0" title="${a.name} (${usesLabel(a.uses)}): ${a.beginnerText}" aria-label="${a.name}: ${a.beginnerText}">${abilityIcon(a.type)}</span>`)}</span>`;
}
