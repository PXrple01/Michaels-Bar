// Kurzes Tutorial beim ersten Besuch – Schritt für Schritt, jederzeit überspringbar.
import { $, fragment, html } from "./dom";
import { icon } from "./icons";

export interface TutorialStep { icon: string; title: string; text: string; example?: string }

const seenKey = (key: string) => `wus.tutorial.${key}`;

export function tutorialSeen(key: string): boolean {
  try { return localStorage.getItem(seenKey(key)) === "1"; } catch { return true; }
}

export function showTutorial(key: string, steps: TutorialStep[], force = false): void {
  if (!force && tutorialSeen(key)) return;
  let i = 0;
  const el = fragment(html`<div class="modal-backdrop tutorial" role="dialog" aria-modal="true" aria-label="Kurze Einführung"><div class="modal card glow-border"></div></div>`);
  const box = el.querySelector<HTMLElement>(".modal")!;
  const close = () => {
    try { localStorage.setItem(seenKey(key), "1"); } catch { /* egal */ }
    el.remove();
    removeEventListener("keydown", onKey);
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
  const render = () => {
    const s = steps[i];
    box.innerHTML = html`
      <div class="tut-step" style="animation: pop-in 0.4s var(--ease-spring) both">
        <div class="tut-icon">${icon(s.icon)}</div>
        <div class="eyebrow">Kurze Einführung · ${i + 1} von ${steps.length}</div>
        <h3>${s.title}</h3>
        <p>${s.text}</p>
        ${s.example ? html`<p class="tut-example">${icon("feather")} ${s.example}</p>` : ""}
      </div>
      <div class="tut-dots">${steps.map((_, j) => html`<span class="${j === i ? "on" : ""}"></span>`)}</div>
      <div class="tut-actions">
        <button class="btn btn-ghost btn-sm" data-t="skip">Überspringen</button>
        <button class="btn btn-sm" data-t="next">${i < steps.length - 1 ? html`Weiter ${icon("arrowRight")}` : html`Los geht's ${icon("check")}`}</button>
      </div>`.value;
    box.querySelector<HTMLButtonElement>('[data-t="next"]')?.focus();
  };
  el.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-t]");
    if (!b) return;
    if (b.dataset.t === "skip" || i === steps.length - 1) close();
    else { i++; render(); }
  });
  addEventListener("keydown", onKey);
  render();
  $("#modal-root").append(el);
}
