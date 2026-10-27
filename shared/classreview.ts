// Typen für den Klassen-Editor: Claude begutachtet, der Code entscheidet.
import type { ClassCheck } from "./classbuilder";
import type { BudgetInfo } from "./campaign";
import type { ClassDef } from "./schema";

export const MAX_REVIEW_ROUNDS = 5;

/** Was der Spieler eingibt – Freitext und/oder Formularfelder. */
export interface ClassDraftInput {
  freitext: string;
  formular: {
    name?: string;
    trefferwuerfel?: number;
    attribute?: string[];
    ruestung?: string[];
    faehigkeiten?: { name: string; beschreibung: string }[];
  };
  /** Bei Folgerunden: die zuletzt bewertete Klasse, an der weitergearbeitet wird. */
  vorher?: ClassDef | null;
}

export interface ClaudeAssessment {
  zusammenfassung: string;
  staerke: { punkte: number; urteil: "zu_schwach" | "ausgewogen" | "zu_stark"; begruendung: string };
  probleme: { schwere: "fehler" | "warnung" | "hinweis"; text: string }[];
  vorschlaege: string[];
  gegenvorschlag: string | null;
}

export interface ReviewRequest {
  draftId: string;
  round: number;
  token: string | null;
  input: ClassDraftInput;
}

export interface ReviewResult {
  draftId: string;
  round: number;
  maxRounds: number;
  /** Nachweis für die nächste Runde (verhindert mehr als fünf Runden pro Entwurf). */
  nextToken: string | null;
  assessment: ClaudeAssessment;
  /** Ergebnis der harten Regelprüfung – nur wenn ok, darf gespeichert werden. */
  check: ClassCheck;
  budget: BudgetInfo;
}

export type ReviewEvent =
  | { type: "progress" }
  | { type: "review"; result: ReviewResult }
  | { type: "error"; message: string; code?: string };

export interface SignedClass { cls: ClassDef; sig: string }
