// Würfelspiel in der Taverne: Claude stellt einen Würfeltisch auf (Gegner und Höchsteinsatz), gespielt wird über die
// Oberfläche – ohne Modellaufruf. Beide werfen 2W6, der höhere Wurf gewinnt den Einsatz, bei Gleichstand gibt es ihn zurück.
// Der Server würfelt fair und führt das Geld; Claude erfährt im nächsten Zug, wie die Spiele ausgingen.
import type { RollRecord } from "./dice";
import { ensureInventory, moneyText } from "./inventory";
import type { Character, Rules } from "./schema";
import type { WorldState } from "./world";

export interface GambleGame { characterId: string; bet: number; mine: RollRecord; theirs: RollRecord; outcome: "sieg" | "niederlage" | "gleichstand" }
export interface Gamble { opponent: string; maxBet: number; log: string[]; last?: GambleGame | null }

export const GAMBLE_DICE = "2W6";
/** Höchsteinsatz, den Claude festlegen kann (in Pfennig): 1 Gulden. */
export const GAMBLE_MAX = 240;
/** Einsätze, die die Oberfläche anbietet (in Pfennig). */
export const BET_STEPS = [1, 3, 6, 12, 24, 60, 120, 240];

/** Ein Spiel abrechnen. Die Würfe kommen vom Server. Fehlertext oder null. */
export function playGamble(w: WorldState, c: Pick<Character, "id" | "name" | "equipment" | "money">, rules: Rules, betRaw: unknown, roll: (who: string) => RollRecord): string | null {
  const g = w.gamble;
  if (!g) return "Gerade wird hier nicht gewürfelt.";
  if (w.combat) return "Mitten im Kampf wird nicht gespielt.";
  const bet = Math.round(Number(betRaw));
  if (!Number.isFinite(bet) || bet < 1) return "Wie viel setzt du?";
  if (bet > g.maxBet) return `${g.opponent} spielt höchstens um ${moneyText(g.maxBet)}.`;
  ensureInventory(w, [c], rules);
  const inv = w.inventory![c.id];
  if (inv.money < bet) return `Dafür reicht dein Geld nicht (${moneyText(inv.money)}).`;
  const mine = roll(c.name), theirs = roll(g.opponent);
  const outcome = mine.total > theirs.total ? "sieg" : mine.total < theirs.total ? "niederlage" : "gleichstand";
  if (outcome === "sieg") inv.money += bet;
  if (outcome === "niederlage") inv.money -= bet;
  g.last = { characterId: c.id, bet, mine, theirs, outcome };
  g.log = [...g.log, `${c.name} ${outcome === "sieg" ? "gewinnt" : outcome === "niederlage" ? "verliert" : "spielt unentschieden um"} ${moneyText(bet)} (${mine.total} gegen ${theirs.total})`].slice(-10);
  return null;
}

/** Für Claude: offener Würfeltisch und die Spiele seit dem letzten Zug (danach wird das Protokoll geleert). */
export function gambleSummary(w: WorldState): string {
  if (!w.gamble) return "";
  const lines = [`Würfeltisch offen: gegen ${w.gamble.opponent}, höchstens ${moneyText(w.gamble.maxBet)} – schließe ihn mit gluecksspiel schliessen, wenn die Figuren weitergehen.`];
  if (w.gamble.log.length) lines.push(`Gespielt (Geld ist schon verbucht; lass ${w.gamble.opponent} darauf reagieren): ${w.gamble.log.join("; ")}`);
  w.gamble.log = [];
  return lines.join("\n");
}
