// Abstimmung in der Gruppe: Frage des Spielleiters mit Knöpfen; wer abstimmt, hat damit auch seine Handlung abgegeben.
import type { WorldState } from "../../../shared/world";
import { html, type Raw } from "./dom";
import { icon } from "./icons";

export function voteCard(w: WorldState | null | undefined, myCharId: string, names: Record<string, string>, total: number): Raw {
  const v = w?.vote;
  if (!v || v.result) return html``;
  const mine = v.votes[myCharId];
  const count = Object.keys(v.votes).length;
  return html`<div class="card vote-card glow-border" role="group" aria-label="Abstimmung">
    <div class="eyebrow">${icon("users")} Abstimmung · ${count} von ${total} ${total === 1 ? "Stimme" : "Stimmen"}</div>
    <h3>${v.question}</h3>
    <div class="vote-options">${v.options.map((o, i) => {
      const who = Object.entries(v.votes).filter(([, x]) => x === i).map(([id]) => names[id] ?? "?");
      return html`<button type="button" class="vote-opt ${mine === i ? "chosen" : ""}" data-vote="${i}" aria-pressed="${mine === i}">
        <b>${o}</b>
        <span class="vote-bar"><i style="width:${count ? (who.length / total) * 100 : 0}%"></i></span>
        <small>${who.length ? who.join(", ") : "noch keine Stimme"}</small>
      </button>`;
    })}</div>
    <p class="hint">${mine === undefined ? "Deine Stimme zählt zugleich als deine Handlung." : "Du kannst deine Stimme noch ändern, bis ausgezählt wird."} Die Mehrheit entscheidet, bei Gleichstand der Würfel.</p>
  </div>`;
}

export function bindVote(root: HTMLElement, send: (option: number) => void) {
  root.querySelectorAll<HTMLButtonElement>("[data-vote]").forEach((b) => b.addEventListener("click", () => {
    root.querySelectorAll<HTMLButtonElement>("[data-vote]").forEach((x) => { x.disabled = true; });
    send(Number(b.dataset.vote));
  }));
}
