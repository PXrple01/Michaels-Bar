import { randomUUID } from "node:crypto";
import { NotationError, parseNotation, type DieResult, type DieSides, type RollMode, type RollRecord } from "../../shared/dice";
import { cryptoRandomInt, type RandomInt } from "./rng";

interface Group { value: number; dice: Omit<DieResult, "group" | "kept">[] }

function rollGroup(sides: DieSides, rng: RandomInt): Group {
  if (sides === 100) {
    const tens = rng(10) - 1; // 0–9
    const units = rng(10) - 1; // 0–9
    const value = tens * 10 + units || 100; // "00" + "0" = 100
    return { value, dice: [{ kind: "d10t", face: tens * 10 }, { kind: "d10u", face: units }] };
  }
  const value = rng(sides);
  return { value, dice: [{ kind: `d${sides}` as DieResult["kind"], face: value }] };
}

export interface RollSpec {
  requestId: string;
  kind: RollRecord["kind"];
  label: string;
  notation: string;
  mode?: RollMode;
  modifierParts?: { label: string; value: number }[];
  dc?: number | null;
}

/**
 * Würfelt eine Spezifikation aus. Vorteil/Nachteil ist nur für einen einzelnen W20 erlaubt.
 * Das Ergebnis steht fest, sobald diese Funktion zurückkehrt.
 */
export function performRoll(spec: RollSpec, rng: RandomInt = cryptoRandomInt): RollRecord {
  const parsed = parseNotation(spec.notation);
  const mode = spec.mode ?? "normal";
  const isSingleD20 = parsed.terms.length === 1 && parsed.terms[0].sides === 20 && parsed.terms[0].count === 1;
  if (mode !== "normal" && !isSingleD20) throw new NotationError("Vorteil und Nachteil gelten nur für einen einzelnen W20");

  const groups: { sides: DieSides; group: Group }[] = [];
  for (const t of parsed.terms) {
    const n = mode === "normal" ? t.count : 2;
    for (let i = 0; i < n; i++) groups.push({ sides: t.sides, group: rollGroup(t.sides, rng) });
  }

  // Bei Vorteil/Nachteil wird genau einer der beiden W20 behalten.
  let keptIndex = -1;
  if (mode !== "normal") {
    const [a, b] = groups.map((g) => g.group.value);
    keptIndex = mode === "advantage" ? (b > a ? 1 : 0) : (b < a ? 1 : 0);
  }

  const dice: DieResult[] = [];
  groups.forEach((g, gi) => {
    for (const d of g.group.dice) dice.push({ ...d, group: gi, kept: keptIndex < 0 || keptIndex === gi });
  });
  const values = groups.map((g) => g.group.value);
  const keptValues = keptIndex < 0 ? values : [values[keptIndex]];

  const modifierParts = [...(spec.modifierParts ?? [])];
  if (parsed.modifier !== 0) modifierParts.push({ label: "Modifikator", value: parsed.modifier });
  const modifier = modifierParts.reduce((s, p) => s + p.value, 0);
  const total = keptValues.reduce((s, v) => s + v, 0) + modifier;

  const natural = isSingleD20 ? keptValues[0] : null;
  const critical = natural === 20 ? "hit" : natural === 1 ? "fumble" : null;
  const dc = natural !== null ? spec.dc ?? null : null; // Schwierigkeit nur bei einzelnen W20-Proben
  let success: boolean | null = null;
  if (dc !== null && natural !== null) success = natural === 20 ? true : natural === 1 ? false : total >= dc;

  return {
    id: randomUUID(),
    requestId: spec.requestId,
    createdAt: new Date().toISOString(),
    kind: spec.kind,
    label: spec.label,
    notation: parsed.text,
    mode,
    dice,
    values,
    modifier,
    modifierParts,
    total,
    natural,
    dc,
    success,
    critical,
  };
}
