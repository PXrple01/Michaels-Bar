// Gemeinsame Würfel-Typen und der Notations-Parser ("2W6+3", "1d20-1", "W100").

export const DIE_SIDES = [4, 6, 8, 10, 12, 20, 100] as const;
export type DieSides = (typeof DIE_SIDES)[number];

/** Darstellung eines einzelnen physischen Würfels. W100 wird als zwei W10 (Zehner + Einer) gezeigt. */
export type DieKind = "d4" | "d6" | "d8" | "d10" | "d10t" | "d10u" | "d12" | "d20";

export interface DieResult {
  kind: DieKind;
  /** Wert, der auf dem Würfel oben liegen muss (bei d10t: 0, 10, ..., 90; bei d10u: 0–9). */
  face: number;
  /** Zu welcher Gruppe (Index in DiceGroup) der Würfel gehört. */
  group: number;
  /** false = bei Vorteil/Nachteil verworfener Würfel. */
  kept: boolean;
}

export type RollMode = "normal" | "advantage" | "disadvantage";

export interface DiceTerm { count: number; sides: DieSides }

export interface ParsedNotation { terms: DiceTerm[]; modifier: number; text: string }

export class NotationError extends Error {}

const MAX_DICE = 20;

export function parseNotation(input: string): ParsedNotation {
  const src = input.replace(/\s+/g, "").toUpperCase().replace(/D/g, "W");
  if (!src) throw new NotationError("Leerer Würfelausdruck");
  const tokens = src.match(/[+-]?[^+-]+/g);
  if (!tokens || tokens.join("") !== src) throw new NotationError(`Unverständlicher Ausdruck: ${input}`);

  const terms: DiceTerm[] = [];
  let modifier = 0;
  for (const tok of tokens) {
    const sign = tok.startsWith("-") ? -1 : 1;
    const body = tok.replace(/^[+-]/, "");
    const m = body.match(/^(\d*)W(\d+)$/);
    if (m) {
      if (sign < 0) throw new NotationError("Würfel können nicht abgezogen werden");
      const count = m[1] === "" ? 1 : Number(m[1]);
      const sides = Number(m[2]);
      if (!(DIE_SIDES as readonly number[]).includes(sides)) throw new NotationError(`Einen W${sides} gibt es nicht`);
      if (count < 1) throw new NotationError("Mindestens ein Würfel");
      const existing = terms.find((t) => t.sides === sides);
      if (existing) existing.count += count;
      else terms.push({ count, sides: sides as DieSides });
    } else if (/^\d+$/.test(body)) {
      modifier += sign * Number(body);
    } else {
      throw new NotationError(`Unverständlicher Teil: ${tok}`);
    }
  }
  if (terms.length === 0) throw new NotationError("Kein Würfel im Ausdruck");
  const total = terms.reduce((s, t) => s + t.count, 0);
  if (total > MAX_DICE) throw new NotationError(`Höchstens ${MAX_DICE} Würfel auf einmal`);
  if (Math.abs(modifier) > 99) throw new NotationError("Modifikator zu groß");
  return { terms, modifier, text: formatNotation(terms, modifier) };
}

export function formatNotation(terms: DiceTerm[], modifier = 0): string {
  const dice = terms.map((t) => `${t.count}W${t.sides}`).join("+");
  return modifier === 0 ? dice : `${dice}${modifier > 0 ? "+" : ""}${modifier}`;
}

export function formatModifier(n: number): string {
  return n >= 0 ? `+${n}` : `−${Math.abs(n)}`;
}

/** Vom Server zurückgegebener, abgeschlossener Wurf. */
export interface RollRecord {
  id: string;
  requestId: string;
  createdAt: string;
  kind: "free" | "check";
  label: string;
  notation: string;
  mode: RollMode;
  dice: DieResult[];
  /** Ergebnis pro Würfelgruppe (W100 zählt als ein Ergebnis 1–100). */
  values: number[];
  modifier: number;
  modifierParts: { label: string; value: number }[];
  total: number;
  /** Bei W20-Proben: die gezählte natürliche Zahl. */
  natural: number | null;
  dc: number | null;
  success: boolean | null;
  critical: "hit" | "fumble" | null;
  /** Glanzerfolg: Angriff trifft 10 oder mehr über der Rüstung (ohne natürliche 20) – +2 Schaden. */
  brilliant?: boolean;
  /** „Glückskind“: kritisch schon ab dieser natürlichen Zahl (sichtbar im Würfelfenster). */
  critFrom?: number;
  /** true, wenn dieselbe requestId erneut gesendet wurde – es gibt dann KEINEN neuen Wurf. */
  repeated?: boolean;
}

export interface CheckRequest {
  requestId: string;
  /** Die komplette Figur aus dem Browser – der Server prüft sie gegen die Regeln. */
  character: unknown;
  check: { type: "attribute" | "skill" | "attack" | "damage"; id: string };
  mode?: RollMode;
  dc?: number;
}

export interface FreeRollRequest {
  requestId: string;
  notation: string;
  mode?: RollMode;
  label?: string;
  /** Optionaler Schwierigkeitsgrad (nur bei einem einzelnen W20). */
  dc?: number;
}
