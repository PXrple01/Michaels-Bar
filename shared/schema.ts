import { z } from "zod";

const id = z.string().regex(/^[a-z0-9_]+$/, "nur Kleinbuchstaben, Ziffern und _");
const diceExpr = z.string().regex(/^\d+W\d+([+-]\d+)?$/, "Würfelausdruck wie 1W8 oder 2W6+1");
const money = z.object({ gulden: z.number().int().min(0), groschen: z.number().int().min(0), pfennig: z.number().int().min(0) });
export const magicLevel = z.enum(["none", "low", "medium", "high"]);

export const attributeSchema = z.object({
  id, name: z.string(), short: z.string().max(4), icon: z.string(),
  description: z.string(), examples: z.array(z.string()),
});

export const itemSchema = z.discriminatedUnion("type", [
  z.object({ id, name: z.string(), type: z.literal("weapon"), damage: diceExpr, attribute: z.array(id).min(1), properties: z.array(z.string()) }),
  z.object({ id, name: z.string(), type: z.literal("armor"), category: z.enum(["leicht", "mittel", "schwer"]), armorBonus: z.number().int().min(0), maxDexBonus: z.number().int().min(0).nullable() }),
  z.object({ id, name: z.string(), type: z.literal("shield"), armorBonus: z.number().int().min(0) }),
  z.object({ id, name: z.string(), type: z.literal("gear") }),
  z.object({ id, name: z.string(), type: z.literal("consumable"), effect: z.string() }),
]);

export const rulesSchema = z.object({
  version: z.number().int(),
  name: z.string(),
  attributes: z.array(attributeSchema).length(6),
  attributeRules: z.object({
    base: z.number().int(), min: z.number().int(), max: z.number().int(), pointBudget: z.number().int().positive(),
    costPerPointUpTo13: z.number().int().positive(), costPerPointAbove13: z.number().int().positive(),
    refundPerPointBelowBase: z.number().int().min(0), maxLoweredAttributes: z.number().int().min(0),
    modifierFormula: z.string(), explanation: z.string(),
  }),
  levels: z.object({
    min: z.literal(1), max: z.number().int().min(1),
    xpTable: z.array(z.number().int().min(0)), skillBonus: z.array(z.number().int().min(0)),
    titles: z.array(z.string()),
    extraSkillAt: z.number().int(), attributeIncreaseAt: z.number().int(),
    /** So viele „volle“ Trefferpunkt-Aufstiege verteilen sich auf die Stufen 2 bis max. */
    hpLevelUps: z.number().int().min(0),
    /** Höchste Stufe je Akt (Anfang, Mitte, Finale); die letzte Stufe gibt es erst im letzten Kapitel. */
    actCap: z.tuple([z.number().int(), z.number().int(), z.number().int()]),
    chapterXp: z.number().int().min(0), actXp: z.number().int().min(0),
    explanation: z.string(),
  }),
  checks: z.object({
    die: z.literal(20),
    difficulties: z.array(z.object({ id, name: z.string(), dc: z.number().int(), example: z.string() })).min(1),
    naturalTwenty: z.string(), naturalOne: z.string(), advantage: z.string(), disadvantage: z.string(),
  }),
  combat: z.object({ baseArmor: z.number().int(), unarmedDamage: diceExpr, criticalHit: z.string(), deathAtZero: z.string() }),
  skills: z.array(z.object({ id, name: z.string(), attribute: id, description: z.string() })),
  stands: z.array(z.object({ id, name: z.string(), description: z.string(), skill: id, feature: z.string(), money })),
  currency: z.object({
    units: z.array(z.object({ id, name: z.string(), symbol: z.string(), valueInPfennig: z.number().int().positive() })),
    examples: z.array(z.string()),
  }),
  items: z.array(itemSchema),
  magicLevels: z.array(z.object({ id: magicLevel, name: z.string(), description: z.string() })),
  classBuilder: z.object({
    pointBudgetPerLevel: z.array(z.number().int().positive()),
    hitDie: z.object({ min: z.number().int(), max: z.number().int(), allowed: z.array(z.number().int()) }),
    maxDamageDie: z.number().int(), maxDamageDiceCount: z.number().int(), maxFlatDamageBonus: z.number().int(),
    armorBonus: z.object({ min: z.number().int(), max: z.number().int() }),
    attackBonus: z.object({ min: z.number().int(), max: z.number().int() }),
    maxTrainedSkills: z.number().int(), maxAbilitiesAtLevel1: z.number().int(),
    abilityTypes: z.array(z.string()).min(1), abilityUses: z.array(z.string()).min(1),
    forbiddenEffects: z.array(z.string()),
    /** Grundwerte der Klassen: Zu- und Abschläge auf die Startattribute. */
    attributeMods: z.object({ min: z.number().int(), max: z.number().int(), maxBonusTotal: z.number().int(), finalMin: z.number().int(), finalMax: z.number().int() }),
    costs: z.object({
      hitDie: z.record(z.string(), z.number()),
      perTrainedSkill: z.number(),
      armor: z.record(z.string(), z.number()),
      abilityBase: z.number(),
      extraDamagePerAverage: z.number(), healPerAverage: z.number(), bonusDiePerAverage: z.number(),
      flatBonus: z.number(), advantage: z.number(), imposeDisadvantage: z.number(), armorBonus: z.number(), attackBonus: z.number(),
      attributeBonus: z.number(), attributePenaltyRefund: z.number(),
      usesMultiplier: z.record(z.string(), z.number()),
      scopeMultiplier: z.object({ eng: z.number(), breit: z.number() }),
    }),
    explanation: z.string(),
  }),
});

const diceOrNull = z.string().regex(/^\d+W\d+([+-]\d+)?$/).nullable();

/** Messbare Wirkung einer Fähigkeit – danach berechnet der Code die Punktkosten. */
export const mechanicsSchema = z.object({
  extraDamage: diceOrNull, heal: diceOrNull, bonusDie: diceOrNull,
  flatBonus: z.number().int().min(0), advantage: z.boolean(), imposeDisadvantage: z.boolean(),
  armorBonus: z.number().int().min(0), attackBonus: z.number().int().min(0),
});

export const abilitySchema = z.object({
  id, name: z.string().min(1).max(60), type: z.string(), uses: z.string(), level: z.number().int().min(1),
  text: z.string().min(1).max(600), beginnerText: z.string().min(1).max(300),
  scope: z.enum(["eng", "breit"]).default("breit"),
  mechanics: mechanicsSchema.optional(),
  magic: z.boolean().default(false),
});

export const classSchema = z.object({
  id, name: z.string(), sigil: z.string(), tagline: z.string(), description: z.string(), role: z.string(),
  difficulty: z.number().int().min(1).max(3), beginnerTip: z.string(),
  hitDie: z.number().int(), primaryAttributes: z.array(id).min(1),
  recommendedAttributes: z.record(z.string(), z.number().int()),
  /** Grundwerte der Klasse: kommen nach dem Punktekauf auf die Attribute (z. B. Stärke +2, Weisheit −1). */
  attributeMods: z.record(z.string(), z.number().int()).default({}),
  trainedSkills: z.array(id), skillChoices: z.object({ count: z.number().int().min(0), from: z.array(id) }),
  armor: z.array(z.enum(["leicht", "mittel", "schwer", "schild"])),
  startingEquipment: z.array(id), equippedWeapon: id, equippedArmor: id.nullable(), equippedShield: id.nullable(),
  startingMoney: money, requiresMagic: magicLevel,
  abilities: z.array(abilitySchema).min(1),
  custom: z.boolean().optional(),
});

export const campaignSchema = z.object({
  title: z.string(), magic_level: magicLevel, tone: z.string(),
  difficulty: z.enum(["leicht", "normal", "schwer"]), taboos: z.array(z.string()),
  language: z.string(), notes: z.string().optional(),
});

export const characterInputSchema = z.object({
  name: z.string().trim().min(1, "Name fehlt").max(40),
  stand: id,
  classId: id,
  attributes: z.record(z.string(), z.number().int()),
  /** 2 = `attributes` enthalten die Grundwerte der Klasse (Figuren von davor: ohne). */
  statsVersion: z.literal(2).optional(),
  chosenSkills: z.array(id),
  personality: z.object({
    trait: z.string().max(200).default(""),
    ideal: z.string().max(200).default(""),
    bond: z.string().max(200).default(""),
    flaw: z.string().max(200).default(""),
  }).default({ trait: "", ideal: "", bond: "", flaw: "" }),
  appearance: z.string().max(400).default(""),
  /** Signierte Kopie einer eigenen Klasse – nur bei selbst gebauten Klassen. */
  customClass: z.object({ cls: classSchema, sig: z.string() }).optional(),
});

export const characterSchema = characterInputSchema.extend({
  id: z.string().uuid(),
  level: z.number().int().min(1),
  xp: z.number().int().min(0),
  hp: z.object({ current: z.number().int(), max: z.number().int().positive() }),
  equipment: z.array(id),
  money,
  createdAt: z.string(),
  updatedAt: z.string(),
});

const table = z.array(z.string().min(1)).min(3);
export const openingsSchema = z.object({
  orte: table, zeiten: table, anlaesse: table, npc_namen: table, npc_rollen: table,
  npc_eigenschaften: table, konflikte: table, details: table,
});

export type Rules = z.infer<typeof rulesSchema>;
export type Openings = z.infer<typeof openingsSchema>;
export type Attribute = z.infer<typeof attributeSchema>;
export type Item = z.infer<typeof itemSchema>;
export type ClassDef = z.infer<typeof classSchema>;
export type Ability = z.infer<typeof abilitySchema>;
export type Mechanics = z.infer<typeof mechanicsSchema>;
export type Campaign = z.infer<typeof campaignSchema>;
export type CharacterInput = z.input<typeof characterInputSchema>;
export type Character = z.infer<typeof characterSchema>;
export type MagicLevel = z.infer<typeof magicLevel>;
export type Money = z.infer<typeof money>;
