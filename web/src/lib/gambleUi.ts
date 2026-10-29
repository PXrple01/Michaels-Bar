// Würfeltisch in der Taverne: Einsatz wählen, beide werfen 2W6 (3D-Würfel), der höhere Wurf gewinnt. Ohne Claude, sofort.
import { BET_STEPS, type GambleGame } from "../../../shared/gamble";
import { moneyText } from "../../../shared/inventory";
import type { WorldState } from "../../../shared/world";
import { rollWithOverlay } from "../dice3d/roller";
import { html, type Raw } from "./dom";
import { icon } from "./icons";
import { toast } from "./ui";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function gambleCard(w: WorldState | null | undefined, characterId: string): Raw {
  const g = w?.gamble;
  if (!w || !g) return html``;
  const money = w.inventory?.[characterId]?.money ?? 0;
  const steps = BET_STEPS.filter((b) => b <= g.maxBet);
  if (!steps.includes(g.maxBet)) steps.push(g.maxBet);
  return html`<div class="card shop-card gamble-card glow-border">
    <div class="shop-head">
      <span class="shop-icon">${icon("dice")}</span>
      <div><div class="eyebrow">Würfelspiel – dein Gegner</div><h3>${cap(g.opponent)}</h3></div>
      <span class="shop-purse" title="Dein Geld">${icon("coins")} ${moneyText(money)}</span>
    </div>
    <p class="muted small">Beide werfen zwei sechsseitige Würfel. Der höhere Wurf gewinnt den Einsatz, bei Gleichstand bekommst du ihn zurück.</p>
    <div class="bet-steps"><span class="muted small">Einsatz:</span>${steps.map((b) => html`<button class="chip" data-bet="${b}" ${money < b ? "disabled" : ""}>${moneyText(b, true)}</button>`)}</div>
    <p class="hint">Spielen kostet keine Zeit – der Spielleiter erfährt mit deiner nächsten Handlung, wie es ausging.</p>
  </div>`;
}

export function bindGamble(root: HTMLElement, play: (bet: number) => void) {
  root.querySelectorAll<HTMLButtonElement>("[data-bet]").forEach((b) => b.addEventListener("click", () => {
    root.querySelectorAll<HTMLButtonElement>("[data-bet]").forEach((x) => (x.disabled = true));
    play(Number(b.dataset.bet));
  }));
}

/** Beide Würfe als 3D-Wurf zeigen (eigener zuerst), danach das Ergebnis. `game` kommt vom Server. */
export async function showGamble(game: Promise<GambleGame | null>, opponent: string) {
  const mine = await rollWithOverlay("Dein Wurf", async () => {
    const g = await game;
    if (!g) throw new Error("Das Spiel hat nicht geklappt.");
    return g.mine;
  });
  if (!mine) return;
  const g = (await game)!;
  await rollWithOverlay(`${cap(opponent)} würfelt`, () => Promise.resolve(g.theirs));
  if (g.outcome === "sieg") toast(`Gewonnen! ${g.mine.total} gegen ${g.theirs.total} – du bekommst ${moneyText(g.bet)}.`, "success", 5000);
  else if (g.outcome === "niederlage") toast(`Verloren: ${g.mine.total} gegen ${g.theirs.total} – ${moneyText(g.bet)} sind weg.`, "error", 5000);
  else toast(`Gleichstand (${g.mine.total}) – du bekommst deinen Einsatz zurück.`, "info", 5000);
}
