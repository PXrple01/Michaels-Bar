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

/** Gemaltes Bild zur Szene (Link zu /api/images/…). */
export interface SceneImage { url: string; caption: string }

export type StoryEntry =
  | { type: "gm"; text: string }
  | ({ type: "image" } & SceneImage)
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
  /** Bisherige Claude-Kosten dieser Kampagne in Dollar (alle Züge zusammen). */
  costUsd?: number;
  /** Bisherige Bildkosten dieser Kampagne in Dollar (fal.ai). */
  imageUsd?: number;
  createdAt: string;
  updatedAt: string;
}

/** limitUsd 0 = ohne Monatsgrenze. */
export interface BudgetInfo { spentUsd: number; limitUsd: number }

/** Kosten lesbar: unter einem Dollar in Cent, sonst in Dollar. */
export const costText = (usd: number) => (usd <= 0 ? "0 ct" : usd < 1 ? `${(usd * 100).toFixed(usd < 0.1 ? 1 : 0)} ct` : `${usd.toFixed(2)} $`);
/** Anzeige oben im Abenteuer: Claude- und Bildkosten dieser Kampagne getrennt, dazu der letzte Zug; das Gesamtbudget steht im Hinweis. */
export function costChip(c: { claudeUsd: number; imageUsd: number; lastUsd: number | null; lastImageUsd: number | null }, budget: BudgetInfo | null): { text: string; title: string } {
  const last = c.lastUsd !== null ? ` · Letzter Zug ${costText(c.lastUsd)}${c.lastImageUsd ? ` + Bild ${costText(c.lastImageUsd)}` : ""}` : "";
  return {
    text: `Claude ${costText(c.claudeUsd)} · Bilder ${costText(c.imageUsd)}${last}`,
    title: `Kosten dieser Kampagne: Claude (Spielleiter) ${costText(c.claudeUsd)}, Bilder (fal.ai) ${costText(c.imageUsd)}.${budget ? ` Diesen Monat insgesamt: ${budget.spentUsd.toFixed(2)} $${budget.limitUsd > 0 ? ` von ${budget.limitUsd.toFixed(0)} $` : ""}.` : ""}`,
  };
}

/** Ereignisse, die der Server beim Erzählen streamt. */
export type GmEvent =
  | { type: "opening"; opening: Opening; summary: string }
  | { type: "text"; text: string }
  | { type: "roll"; record: RollRecord }
  /** Vom Server ausgelöster Wurf (Gegnerangriff, Heilung, Rast) – mitten in der Erzählung. */
  | { type: "autoroll"; record: RollRecord }
  /** Szenenbild fertig – erscheint nach dem Text dieser Antwort. */
  | ({ type: "image" } & SceneImage)
  /** turnCostUsd: Claude, turnImageUsd: Bilder dieses Zugs */
  | { type: "done"; state: SignedState; pending: PendingCheck | null; budget: BudgetInfo; turnCostUsd?: number; turnImageUsd?: number }
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

/** Wahl beim Stufenaufstieg: Fertigkeit (Stufe 4) oder Attributsteigerung (Stufe 3, 6, 9). */
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
  // Eine einzelne Idee („» Ozula greift an“) zählt auch – mit Leerzeichen nach », das haben echte Zitate nie.
  const m = text.match(/\n?[ \t*_]*»(?:[ \t]*\*{0,2}(?:Vorschläge|Ideen|Optionen|Möglichkeiten)\*{0,2}:\*{0,2}[ \t]*(.+?)|[ \t]*([^\n«]*\|[^\n«]*)|[ \t]+([^\n«|]+))[ \t*_]*$/);
  if (!m) return { body: stripMarkers(text), suggestions: [] };
  const suggestions = (m[1] ?? m[2] ?? m[3]).split("|").map((s) => s.trim()).filter(Boolean).slice(0, 4);
  return { body: stripMarkers(text.slice(0, m.index)), suggestions };
}

/** Übrig gebliebene Vorschlagszeilen mitten im Text (z. B. wenn die Erzählung danach weiterging) ausblenden. */
export const stripMarkers = (text: string) => text.replace(/^[ \t*_]*»[ \t]+[^\n«]*(?:\n|$)/gm, "").replace(/\n{3,}/g, "\n\n").trimEnd();

export const MAX_ACTION_LENGTH = 800;
