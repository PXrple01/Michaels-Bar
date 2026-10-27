// Gemeinsame Typen für Abenteuer mit Claude als Spielleiter.
import type { RollMode, RollRecord } from "./dice";

/** Vom Code gewürfelter Startimpuls einer neuen Geschichte. */
export interface Opening {
  ort: string;
  zeit: string;
  anlass: string;
  npc: { name: string; rolle: string; eigenschaft: string };
  konflikt: string;
  detail: string;
}

/** Die Probe, die der Spielleiter verlangt hat und die noch gewürfelt werden muss. */
export interface PendingCheck {
  toolUseId: string;
  art: "attribute" | "skill" | "attack" | "damage";
  id: string;
  sg: number | null;
  modus: RollMode;
  grund: string;
  /** Lesbarer Titel, z. B. „Athletik-Probe“. */
  label: string;
}

/**
 * Spielstand, den der Browser speichert. `messages` ist der API-Verlauf (unverändert, inkl. Denkblöcke).
 * `sig` ist die Server-Signatur über Verlauf und Figur – ohne gültige Signatur spielt der Server nicht weiter.
 */
export interface SignedState {
  messages: unknown[];
  characterHash: string;
  sig: string;
}

export type StoryEntry =
  | { type: "gm"; text: string }
  | { type: "player"; text: string }
  | { type: "roll"; record: RollRecord };

export interface CampaignSave {
  id: string;
  characterId: string;
  title: string;
  opening: Opening;
  openingSummary: string;
  state: SignedState;
  pending: PendingCheck | null;
  story: StoryEntry[];
  /** Hat der Spieler schon gehandelt? Vorher darf der Einstieg neu gewürfelt werden. */
  started: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetInfo { spentUsd: number; limitUsd: number }

/** Ereignisse, die der Server beim Erzählen streamt. */
export type GmEvent =
  | { type: "opening"; opening: Opening; summary: string }
  | { type: "text"; text: string }
  | { type: "roll"; record: RollRecord }
  | { type: "done"; state: SignedState; pending: PendingCheck | null; budget: BudgetInfo }
  | { type: "error"; message: string; code?: "no_api_key" | "access" | "budget" | "rate" | "state" | "refusal" | "api" };

export interface StartRequest {
  character: unknown;
  /** Kurzfassungen früherer Einstiege – sie sollen nicht wiederholt werden. */
  previousOpenings: string[];
}

export interface TurnRequest {
  character: unknown;
  state: SignedState;
  action: string;
}

export interface RollRequest {
  character: unknown;
  state: SignedState;
}

/** Trennt die Vorschlagszeile („» Vorschläge: A | B | C“) vom Erzähltext. */
export function splitSuggestions(text: string): { body: string; suggestions: string[] } {
  const m = text.match(/\n?\s*»\s*Vorschläge:\s*(.+)\s*$/);
  if (!m) return { body: text.trimEnd(), suggestions: [] };
  const suggestions = m[1].split("|").map((s) => s.trim()).filter(Boolean).slice(0, 4);
  return { body: text.slice(0, m.index).trimEnd(), suggestions };
}

export const MAX_ACTION_LENGTH = 800;
