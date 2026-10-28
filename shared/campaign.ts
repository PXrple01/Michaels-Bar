// Gemeinsame Typen für Abenteuer mit Claude als Spielleiter.
import type { RollMode, RollRecord } from "./dice";
import type { UpgradeOffer } from "./upgrades";
import type { WorldState } from "./world";

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
  /** Wer würfeln muss (in der Gruppe wichtig). */
  characterId: string;
  characterName: string;
  art: "attribute" | "skill" | "attack" | "damage";
  id: string;
  sg: number | null;
  modus: RollMode;
  grund: string;
  /** Lesbarer Titel, z. B. „Athletik-Probe“. */
  label: string;
  /** Gegner bei Angriff/Schaden im Kampf (dann gilt seine Rüstung als SG). */
  ziel: string | null;
}

/**
 * Spielstand, den der Browser speichert. `messages` ist der API-Verlauf (unverändert, inkl. Denkblöcke).
 * `sig` ist die Server-Signatur über Verlauf und Figur – ohne gültige Signatur spielt der Server nicht weiter.
 */
export interface SignedState {
  messages: unknown[];
  characterHash: string;
  sig: string;
  /** Lebenspunkte, Kampf, Aufträge, Gedächtnis (ab Werkzeugstand 2). */
  world?: WorldState;
  /** Ergebnisse sofort ausgeführter Werkzeuge, die mit dem Probenergebnis zusammen zurückgehen. */
  held?: unknown[];
  toolset?: number;
  /** Modell, das zuletzt erzählt hat. Wechselt es, werden dessen Denkblöcke entfernt (sie gelten nur für dieses Modell). */
  model?: string;
}

export type StoryEntry =
  | { type: "gm"; text: string }
  | { type: "player"; text: string }
  | { type: "roll"; record: RollRecord; auto?: boolean };

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
  /** Bisherige Kosten dieser Kampagne in Dollar (alle Züge zusammen). */
  costUsd?: number;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetInfo { spentUsd: number; limitUsd: number }

/** Kosten lesbar: unter einem Dollar in Cent, sonst in Dollar. */
export const costText = (usd: number) => (usd < 1 ? `${(usd * 100).toFixed(usd < 0.1 ? 1 : 0)} ct` : `${usd.toFixed(2)} $`);
/** Anzeige oben im Abenteuer: Kosten dieser Kampagne und des letzten Zugs; das Gesamtbudget steht im Hinweis. */
export function costChip(campaignUsd: number, lastUsd: number | null, budget: BudgetInfo | null): { text: string; title: string } {
  return {
    text: `Diese Kampagne ${costText(campaignUsd)}${lastUsd !== null ? ` · Letzter Zug ${costText(lastUsd)}` : ""}`,
    title: `Was der Spielleiter (Claude) in diesem Abenteuer bisher gekostet hat.${budget ? ` Gesamtbudget aller Abenteuer: ${budget.spentUsd.toFixed(2)} $ von ${budget.limitUsd.toFixed(0)} $.` : ""}`,
  };
}

/** Ereignisse, die der Server beim Erzählen streamt. */
export type GmEvent =
  | { type: "opening"; opening: Opening; summary: string }
  | { type: "text"; text: string }
  | { type: "roll"; record: RollRecord }
  /** Vom Server ausgelöster Wurf (Gegnerangriff, Heilung, Rast) – mitten in der Erzählung. */
  | { type: "autoroll"; record: RollRecord }
  | { type: "done"; state: SignedState; pending: PendingCheck | null; budget: BudgetInfo; turnCostUsd?: number }
  /** Verbesserungen erstellt (offer) oder gewählt (offer = null) – neuer signierter Spielstand. */
  | { type: "upgrade"; state: SignedState; offer: UpgradeOffer | null; budget: BudgetInfo; turnCostUsd?: number }
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

/** Wahl beim Stufenaufstieg: Fertigkeit (Stufe 4) oder Attributsteigerung (Stufe 7). */
/** Kaufen oder verkaufen im offenen Laden (ohne Claude). */
export interface ShopRequest { character: unknown; state: SignedState; action?: unknown; ref?: unknown }

export interface LevelRequest {
  character: unknown;
  state: SignedState;
  skill?: string;
  attrs?: Record<string, number>;
}

/** Verbesserungen erstellen lassen (upgrade) bzw. eine davon wählen (choose, mit `option`). */
export interface UpgradeRequest {
  character: unknown;
  state: SignedState;
  option?: number;
}

/** Trennt die Vorschlagszeile („» Vorschläge: A | B | C“) vom Erzähltext. */
export function splitSuggestions(text: string): { body: string; suggestions: string[] } {
  // Normal: „» Vorschläge: A | B“. Manchmal lässt Claude das Wort weg („» A | B“) oder schreibt „Ideen:“/„Optionen:“ –
  // ohne Wort zählt die Zeile nur mit „|“ und ohne schließendes „«“ (sonst wäre es ein Zitat in »Anführungszeichen«).
  const m = text.match(/\n?[ \t*_]*»[ \t]*(?:\*{0,2}(?:Vorschläge|Ideen|Optionen|Möglichkeiten)\*{0,2}:\*{0,2}[ \t]*(.+?)|([^\n«]*\|[^\n«]*))[ \t*_]*$/);
  if (!m) return { body: text.trimEnd(), suggestions: [] };
  const suggestions = (m[1] ?? m[2]).split("|").map((s) => s.trim()).filter(Boolean).slice(0, 4);
  return { body: text.slice(0, m.index).trimEnd(), suggestions };
}

export const MAX_ACTION_LENGTH = 800;
