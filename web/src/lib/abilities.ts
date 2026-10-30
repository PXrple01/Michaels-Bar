// Fähigkeiten verständlich anzeigen: Liste mit Erklärung (eigene Figur) und kleine Symbole (Mitspieler).
import type { Ability } from "../../../shared/schema";
import type { WorldState } from "../../../shared/world";
import { isActive, isLimited, recoverText } from "../../../shared/abilityUses";
import type { Growth } from "../../../shared/growth";
import { html, type Raw } from "./dom";
import { masteryBar, usesWithMastery } from "./growthUi";
import { icon } from "./icons";

export type AbilityInfo = Pick<Ability, "id" | "name" | "type" | "uses" | "text" | "beginnerText"> & { upgraded?: unknown };

/** Zustand einer Fähigkeit in dieser Kampagne – für Rand, Ausgrauen und Hinweis. */
function state(a: AbilityInfo, w: WorldState | null | undefined, characterId: string) {
  const entry = w?.used?.[characterId]?.[a.id];
  // Gemeistert (2× pro Kampf): nach dem ersten Einsatz noch nicht gesperrt
  const used = entry && !(entry.uses === "zweimal_pro_kampf" && (entry.count ?? 1) < 2) ? entry : undefined;
  const active = isActive(a.uses);
  return {
    active, used: !!used,
    text: !active ? "Passiv – wirkt immer von selbst" : used ? `Schon eingesetzt – wieder verfügbar ${recoverText(used.uses)}` : isLimited(a.uses) ? `Aktiv – bereit (danach wieder ${recoverText(a.uses)})` : "Aktiv – beliebig oft einsetzbar",
  };
}

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
  return ({ passiv: "immer aktiv", zweimal_pro_kampf: "2× pro Kampf", einmal_pro_kampf: "1× pro Kampf", einmal_pro_rast: "1× pro Rast", einmal_pro_tag: "1× pro Tag", beliebig: "beliebig oft" } as Record<string, string>)[u] ?? u;
}

/** Ausführliche Liste für die eigene Figur. */
export function abilityList(name: string, abilities: AbilityInfo[], w?: WorldState | null, characterId = "", who?: { id: string; growth?: Growth | null }): Raw {
  if (!abilities.length) return html``;
  return html`<section class="abilities card" aria-label="Fähigkeiten von ${name}">
    <div class="ab-head">
      <h3>${icon("sparkles")} Fähigkeiten von ${name}</h3>
      <p class="muted small">So setzt du sie ein: Schreib einfach in deine Handlung, dass du sie nutzt – z. B. „Ich setze ${abilities.find((a) => a.uses !== "passiv")?.name ?? abilities[0].name} ein“. Passive Fähigkeiten wirken von selbst.</p>
    </div>
    <div class="ab-grid">
      ${abilities.map((a, i) => { const st = state(a, w, characterId); const uses = who ? usesWithMastery(a.uses, who, w, a.id) : a.uses; return html`<div class="ab ${a.upgraded ? "upgraded" : ""} ${st.active ? "active" : ""} ${st.used ? "used" : ""}" style="--i:${i}" data-ab-card>
        <div class="ab-top">
          <span class="ab-icon t-${a.type}">${abilityIcon(a.type)}</span>
          <span class="ab-title"><b>${a.name}${a.upgraded ? html` <span class="chip gold ab-up">${icon("star")} verbessert</span>` : ""}</b><small>${TYPES[a.type] ?? a.type}</small></span>
          <span class="chip ab-uses ${uses !== a.uses ? "gold" : ""}" title="${uses !== a.uses ? "Durch Meisterschaft häufiger einsetzbar" : ""}">${usesLabel(uses)}</span>
        </div>
        ${st.used ? html`<span class="ab-state">${icon("lock")} ${st.text}</span>` : ""}
        <p class="ab-easy">${a.beginnerText}</p>
        <details class="ab-more"><summary>${who ? "Regel & Meisterschaft" : "Genaue Regel"}</summary><p>${a.text}</p>${who ? masteryBar(a.uses, who, w, a.id) : ""}</details>
      </div>`; })}
    </div>
  </section>`;
}

/** Kleine Symbolreihe – Name und Erklärung erscheinen in einem Hinweisfenster (Darüberfahren am PC, Antippen am Handy). */
export function abilityChips(abilities: AbilityInfo[], w?: WorldState | null, characterId = ""): Raw {
  ensurePopover();
  return html`<span class="ab-chips">${abilities.map((a) => {
    const st = state(a, w, characterId);
    return html`<button type="button" class="ab-chip t-${a.type} ${a.upgraded ? "upgraded" : ""} ${st.active ? "active" : ""} ${st.used ? "used" : ""}"
    data-ab-name="${a.name}" data-ab-type="${TYPES[a.type] ?? a.type}" data-ab-uses="${usesLabel(a.uses)}" data-ab-text="${a.beginnerText}" data-ab-state="${st.text}" ${a.upgraded ? "data-ab-up" : ""}
    aria-label="${a.name} (${usesLabel(a.uses)}): ${st.text}. ${a.beginnerText}">${abilityIcon(a.type)}</button>`;
  })}</span>`;
}

/* ── Hinweisfenster für die Symbole: ein einziges Element am <body>, damit es nie von Leisten abgeschnitten wird ── */

let pop: HTMLElement | null = null;
let current: HTMLElement | null = null;

function ensurePopover() {
  if (pop || typeof document === "undefined") return;
  pop = document.createElement("div");
  pop.className = "ab-pop";
  pop.setAttribute("role", "tooltip");
  pop.hidden = true;
  document.body.append(pop);
  const chipOf = (e: Event) => (e.target as HTMLElement | null)?.closest?.<HTMLElement>(".ab-chip") ?? null;
  document.addEventListener("pointerover", (e) => { if (e.pointerType === "mouse") { const c = chipOf(e); if (c) show(c); } });
  document.addEventListener("pointerout", (e) => {
    // Wechsel auf das Symbol im Knopf ist kein Verlassen
    if (e.pointerType !== "mouse" || chipOf(e) !== current || current?.contains(e.relatedTarget as Node | null) || current?.matches(":focus-visible")) return;
    hide();
  });
  document.addEventListener("focusin", (e) => { const c = chipOf(e); if (c && c.matches(":focus-visible")) show(c); });
  document.addEventListener("focusout", (e) => { if (chipOf(e) === current) hide(); });
  // Antippen: öffnen bzw. wieder schließen; Tippen daneben schließt
  document.addEventListener("click", (e) => {
    const c = chipOf(e);
    if (c) { if (current === c && (e as PointerEvent).pointerType !== "mouse") hide(); else show(c); return; }
    hide();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
  addEventListener("scroll", () => hide(), { passive: true, capture: true });
  addEventListener("hashchange", () => hide());
}

function show(chip: HTMLElement) {
  if (!pop || (current === chip && !pop.hidden)) return;
  current = chip;
  const d = chip.dataset;
  pop.innerHTML = html`<div class="ab-pop-head"><b>${d.abName}</b>${"abUp" in d ? html`<span class="chip gold ab-up">${icon("star")} verbessert</span>` : ""}</div>
    <div class="ab-pop-meta"><span>${d.abType}</span><span class="chip">${d.abUses}</span></div>
    ${d.abState ? html`<div class="ab-pop-state">${d.abState}</div>` : ""}
    <p>${d.abText}</p>`.value;
  pop.hidden = false;
  const r = chip.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight, m = 8;
  const left = Math.max(m, Math.min(innerWidth - w - m, r.left + r.width / 2 - w / 2));
  const below = r.bottom + m + h <= innerHeight - m;
  pop.style.left = `${left}px`;
  pop.style.top = `${below ? r.bottom + m : Math.max(m, r.top - m - h)}px`;
  pop.classList.toggle("above", !below);
}

function hide() {
  if (pop) pop.hidden = true;
  current = null;
}

// Fähigkeit antippen: Regel und Meisterschafts-Leiste auf- und zuklappen
document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  if (t.closest("summary, a, button")) return;
  const card = t.closest<HTMLElement>("[data-ab-card]");
  const d = card?.querySelector<HTMLDetailsElement>("details.ab-more");
  if (d) d.open = !d.open;
});
