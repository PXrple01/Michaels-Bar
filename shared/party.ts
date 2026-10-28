// Mehrspieler: gemeinsame Abenteuer mit Gruppen-Code. Der Spielstand liegt auf dem Server.
import type { BudgetInfo, Opening, PendingCheck } from "./campaign";
import type { RollRecord } from "./dice";
import type { WorldState } from "./world";

export const MAX_PARTY_SIZE = 4;

export type PartyStoryEntry =
  | { type: "gm"; text: string }
  | { type: "actions"; items: { playerId: string; name: string; text: string }[] }
  | { type: "roll"; record: RollRecord; playerId: string; auto?: boolean }
  | { type: "info"; text: string };

export interface PartyPlayerView {
  id: string;
  host: boolean;
  /** Figuren-ID – Schlüssel für Lebenspunkte im Spielstand. */
  characterId: string;
  name: string;
  classId: string;
  className: string;
  sigil: string;
  /** Hat in dieser Runde schon gehandelt? */
  acted: boolean;
  /** Fähigkeiten der Figur – damit alle sehen, was das Team kann. */
  abilities: { id: string; name: string; type: string; uses: string; text: string; beginnerText: string; upgraded?: boolean }[];
}

/** Was jeder Mitspieler sieht – ohne Geheimnisse wie Tokens oder den rohen API-Verlauf. */
export interface PartyView {
  code: string;
  status: "lobby" | "playing";
  you: string;
  players: PartyPlayerView[];
  opening: Opening | null;
  story: PartyStoryEntry[];
  pending: (PendingCheck & { playerId: string }) | null;
  /** Deine eigene, noch nicht erzählte Handlung. */
  yourAction: string | null;
  busy: boolean;
  /** Gerade entstehender Erzähltext (während der Spielleiter erzählt). */
  live: string;
  version: number;
  budget: BudgetInfo | null;
  lastTurnCostUsd: number | null;
  /** Lebenspunkte, Kampf, Aufträge – erst ab dem Start. */
  world: WorldState | null;
  /** Der letzte Zug ist gescheitert (für alle sichtbar, mit „Erneut versuchen“). */
  failed: string | null;
}

/** Eintrag in „Deine Gruppen“: Status vom Server (nur mit gültigem Zugang). */
export interface PartyOverview {
  code: string;
  status: "lobby" | "playing" | "finished" | "gone";
  outcome?: "sieg" | "niederlage";
  title?: string;
  players?: string[];
  host?: boolean;
}

export interface PartyJoinResult { code: string; playerId: string; token: string; view: PartyView }

export type PartyEvent =
  | { type: "text"; text: string }
  | { type: "roll"; record: RollRecord }
  | { type: "autoroll"; record: RollRecord }
  | { type: "view"; view: PartyView }
  | { type: "error"; message: string; code?: string };
