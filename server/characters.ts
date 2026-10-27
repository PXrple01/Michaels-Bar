import { randomUUID } from "node:crypto";
import { addMoney, characterProblems, maxHpAtLevel, withClassMods } from "../shared/character";
import { characterInputSchema, characterSchema, type Character, type CharacterInput } from "../shared/schema";
import { dataWithClass, verifySignedClass } from "./classes";
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
/** Eigene Klasse der Figur prüfen und die Spieldaten um sie erweitern. */
function withCustomClass(customClass: unknown, classId: string, data: GameData, secret: string | undefined): GameData {
  if (!customClass) return data;
  const res = verifySignedClass(secret, customClass, data);
  if ("error" in res) throw new ValidationError([res.error]);
  if (res.cls.id !== classId) throw new ValidationError(["Eigene Klasse passt nicht zur Figur"]);
  return dataWithClass(data, res.cls);
}

export function buildCharacter(raw: unknown, baseData: GameData, secret?: string): Character {
  const parsed = characterInputSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(issues(parsed.error));
  const sent = parsed.data;
  const data = withCustomClass(sent.customClass, sent.classId, baseData, secret);
  const { rules, classes, campaign } = data;
  // Der Browser schickt die gekauften Werte; der Server rechnet die Grundwerte der Klasse dazu.
  const klass = classes.find((c) => c.id === sent.classId);
  const input = { ...sent, attributes: withClassMods(sent.attributes, klass?.attributeMods, rules), statsVersion: 2 as const };
  const problems = characterProblems(input as CharacterInput, rules, classes, campaign.magic_level);
  if (problems.length) throw new ValidationError(problems);

  const cls = klass!;
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
/** Prüft eine Figur aus dem Browser und liefert die Spieldaten, mit denen sie gespielt wird (inkl. eigener Klasse). */
export function resolveCharacter(raw: unknown, baseData: GameData, secret?: string): { c: Character; data: GameData } {
  const parsed = characterSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(issues(parsed.error));
  const c = parsed.data;
  const data = withCustomClass(c.customClass, c.classId, baseData, secret);
  const problems = characterProblems(c, data.rules, data.classes, data.campaign.magic_level);
  // Aufstieg gibt es erst mit dem Abenteuer-Teil – bis dahin sind alle Figuren Stufe 1.
  if (c.level !== 1) problems.push("Stufe ist noch nicht freigeschaltet");
  if (problems.length) throw new ValidationError(problems);
  return { c, data };
}

export function verifyCharacter(raw: unknown, data: GameData, secret?: string): Character {
  return resolveCharacter(raw, data, secret).c;
}
