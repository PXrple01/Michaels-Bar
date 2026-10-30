// Herausforderungen vor dem Start eines Abenteuers: freiwillige Erschwernisse für doppelten Ruhm. Die Auswahl merkt sich
// der Browser; gilt für das nächste neue Abenteuer (allein oder als Gastgeber einer Gruppe).
import { CHALLENGE_IDS, CHALLENGES, cleanChallenges, type ChallengeId } from "../../../shared/growth";
import { html, type Raw } from "./dom";
import { icon } from "./icons";

const KEY = "wus.challenges.v1";
export function selectedChallenges(): ChallengeId[] {
  try { return cleanChallenges(JSON.parse(localStorage.getItem(KEY) ?? "[]")); } catch { return []; }
}
function save(list: ChallengeId[]) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* egal */ } }

export function challengePicker(): Raw {
  const on = new Set(selectedChallenges());
  return html`<div class="challenges card" data-challenges>
    <div class="ch-head"><b>${icon("fist")} Herausforderungen</b><small class="muted">freiwillig · ${on.size ? html`<span class="chip gold">doppelter Ruhm</span>` : "doppelter Ruhm, wenn mindestens eine gewählt ist"}</small></div>
    <div class="ch-list">${CHALLENGE_IDS.map((id) => html`<button type="button" class="ch-opt ${on.has(id) ? "on" : ""}" data-challenge="${id}" aria-pressed="${on.has(id)}"><b>${CHALLENGES[id].name}</b><small>${CHALLENGES[id].text}</small></button>`)}</div>
  </div>`;
}

/** Klicks auf die Herausforderungen (überall, wo die Auswahl steht). */
document.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-challenge]");
  if (!b) return;
  const id = b.dataset.challenge as ChallengeId;
  const list = new Set(selectedChallenges());
  if (list.has(id)) list.delete(id); else list.add(id);
  save([...list]);
  const box = b.closest<HTMLElement>("[data-challenges]");
  if (box) box.outerHTML = challengePicker().value;
});
