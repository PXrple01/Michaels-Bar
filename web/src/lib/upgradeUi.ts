// Freischaltung verbesserter Fähigkeiten in der Oberfläche – für Solo und Gruppe.
import { upgradeDue, type UpgradeOffer } from "../../../shared/upgrades";
import type { WorldState } from "../../../shared/world";
import { abilityIcon, usesLabel } from "./abilities";
import { html, type Raw } from "./dom";
import { icon } from "./icons";

/** Was gerade zu zeigen ist: nichts, die Freischaltung (Fähigkeit noch geheim) oder die zwei Optionen. */
export function upgradeState(w: WorldState | null | undefined, characterId: string): "none" | "due" | "offer" {
  if (!w) return "none";
  if (w.progress?.[characterId]?.offer) return "offer";
  return upgradeDue(w, characterId) ? "due" : "none";
}

export function upgradeCard(w: WorldState, characterId: string, abilityType: (abilityId: string) => string, generating: boolean): Raw {
  const offer: UpgradeOffer | null | undefined = w.progress?.[characterId]?.offer;
  if (generating) return html`<div class="card upgrade-card forging"><div class="up-icon">${icon("sparkles")}</div><div><div class="eyebrow">Neue Verbesserung</div><h3>Der Spielleiter ersinnt deine Verbesserungen …</h3><p class="muted">Sie passen zu deiner Figur – und vielleicht zur Lage, in der ihr gerade steckt.</p></div></div>`;
  if (!offer) {
    return html`<div class="card upgrade-card due glow-border">
      <div class="up-icon">${icon("star")}</div>
      <div class="up-body">
        <div class="eyebrow">Erfahrung zahlt sich aus</div>
        <h3>Neue Verbesserung freigeschaltet!</h3>
        <p>Eine deiner Fähigkeiten kann sich weiterentwickeln. Du bekommst zwei Möglichkeiten und wählst eine.</p>
      </div>
      <button class="btn magnetic" data-upgrade>${icon("sparkles")} Verbesserungen ansehen</button>
    </div>`;
  }
  const type = abilityType(offer.abilityId);
  return html`<div class="card upgrade-card offer glow-border">
    <div class="up-head">
      <div class="eyebrow">Verbesserung ${offer.tier} von 2 · wähle eine</div>
      <h3>${icon("star")} „${offer.options[0]?.basedOn}“ entwickelt sich weiter</h3>
    </div>
    <div class="up-options">
      ${offer.options.map((o, i) => html`<div class="up-option" style="--i:${i}">
        <div class="up-top"><span class="ab-icon t-${type}">${abilityIcon(type)}</span><b>${o.name}</b><span class="chip">${usesLabel(o.uses)}</span></div>
        ${o.situational ? html`<span class="chip gold up-fit">${icon("target")} passt zur Lage</span>` : ""}
        <p class="up-easy">${o.beginnerText}</p>
        <p class="up-rule">${o.text}</p>
        <button class="btn btn-sm" data-choose="${i}">${icon("check")} Diese wählen</button>
      </div>`)}
    </div>
    <p class="hint center">Die Wahl gilt für den Rest der Kampagne. Du kannst auch erst weiterspielen und später wählen.</p>
  </div>`;
}
