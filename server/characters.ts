import { randomUUID } from "node:crypto";
import { addMoney, characterProblems, maxHpAtLevel } from "../shared/character";
import { characterInputSchema, characterSchema, type Character, type CharacterInput } from "../shared/schema";
import type { GameData } from "./rules/loader";

// Figuren werden im Browser gespeichert (es gibt noch keine Konten).
// Der Server rechnet sie beim Anlegen aus und prüft sie bei jeder Probe erneut,
// damit niemand sich Werte jenseits der Regeln in den Browser schreibt.

export class ValidationError extends Error {
  constructor(public problems: string[]) { super(problems.join("; ")); }
}

function issues(e: { issues: { path: PropertyKey[]; message: string }[] }) {
  return e.issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`);
}

/** Legt eine neue Figur an. Alle abgeleiteten Werte berechnet der Server, nicht der Browser. */
export function buildCharacter(raw: unknown, data: GameData): Character {
  const parsed = characterInputSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(issues(parsed.error));
  const input = parsed.data;
  const { rules, classes, campaign } = data;
  const problems = characterProblems(input as CharacterInput, rules, classes, campaign.magic_level);
  if (problems.length) throw new ValidationError(problems);

  const cls = classes.find((c) => c.id === input.classId)!;
  const stand = rules.stands.find((s) => s.id === input.stand)!;
  const hp = maxHpAtLevel(cls, input.attributes.konstitution, 1);
  const now = new Date().toISOString();
  return {
    ...input,
    id: randomUUID(),
    level: 1,
    xp: 0,
    hp: { current: hp, max: hp },
    equipment: [...cls.startingEquipment],
    money: addMoney(cls.startingMoney, stand.money),
    createdAt: now,
    updatedAt: now,
  };
}

/** Prüft eine vom Browser mitgeschickte Figur, bevor ihr Bonus für einen Wurf verwendet wird. */
export function verifyCharacter(raw: unknown, data: GameData): Character {
  const parsed = characterSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(issues(parsed.error));
  const c = parsed.data;
  const problems = characterProblems(c, data.rules, data.classes, data.campaign.magic_level);
  // Aufstieg gibt es erst mit dem Abenteuer-Teil – bis dahin sind alle Figuren Stufe 1.
  if (c.level !== 1) problems.push("Stufe ist noch nicht freigeschaltet");
  if (problems.length) throw new ValidationError(problems);
  return c;
}
