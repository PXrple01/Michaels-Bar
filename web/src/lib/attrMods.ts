// Grundwerte einer Klasse als kleine Plaketten („STÄ +2“, „VER −1“).
import type { Rules } from "../../../shared/schema";
import { html, type Raw } from "./dom";

export function modsChips(mods: Record<string, number> | undefined, rules: Rules): Raw {
  const list = rules.attributes.filter((a) => mods?.[a.id]);
  if (!list.length) return html`<span class="muted">keine</span>`;
  return html`<span class="mod-chips">${list.map((a) => {
    const v = mods![a.id];
    return html`<span class="mod-chip ${v > 0 ? "pos" : "neg"}" title="${a.name} ${v > 0 ? "+" : "−"}${Math.abs(v)} durch die Klasse">${a.short} ${v > 0 ? "+" : "−"}${Math.abs(v)}</span>`;
  })}</span>`;
}
