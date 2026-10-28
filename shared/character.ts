// Regelberechnungen, die Server (Validierung) und Browser (Anzeige) gleich ausführen.
import type { Character, CharacterInput, ClassDef, Item, MagicLevel, Money, Rules } from "./schema";

export const MAGIC_ORDER: MagicLevel[] = ["none", "low", "medium", "high"];

export function modifier(value: number): number {
  return Math.floor((value - 10) / 2);
}

export function attributeCost(value: number, rules: Rules): number {
  const r = rules.attributeRules;
  if (value < r.base) return -(r.base - value) * r.refundPerPointBelowBase;
  const upTo13 = Math.min(value, 13) - r.base;
  const above = Math.max(0, value - 13);
  return Math.max(0, upTo13) * r.costPerPointUpTo13 + above * r.costPerPointAbove13;
}

export function pointsSpent(attrs: Record<string, number>, rules: Rules): number {
  return rules.attributes.reduce((s, a) => s + attributeCost(attrs[a.id] ?? rules.attributeRules.base, rules), 0);
}

/** Grundwerte einer Klasse auf gekaufte Attribute anwenden (fehlende Einträge = 0). */
export function withClassMods(bought: Record<string, number>, mods: Record<string, number> | undefined, rules: Rules): Record<string, number> {
  return Object.fromEntries(rules.attributes.map((a) => [a.id, (bought[a.id] ?? rules.attributeRules.base) + (mods?.[a.id] ?? 0)]));
}

/** Gekaufte Werte einer Figur: bei neuen Figuren die Attribute ohne die Grundwerte der Klasse. */
export function boughtAttributes(c: Pick<CharacterInput, "attributes" | "statsVersion">, cls: Pick<ClassDef, "attributeMods"> | undefined, rules: Rules): Record<string, number> {
  if (c.statsVersion !== 2) return c.attributes;
  return Object.fromEntries(rules.attributes.map((a) => [a.id, (c.attributes[a.id] ?? rules.attributeRules.base) - (cls?.attributeMods?.[a.id] ?? 0)]));
}

export function attributeProblems(attrs: Record<string, number>, rules: Rules): string[] {
  const r = rules.attributeRules;
  const problems: string[] = [];
  const known = new Set(rules.attributes.map((a) => a.id));
  for (const key of Object.keys(attrs)) if (!known.has(key)) problems.push(`Unbekanntes Attribut: ${key}`);
  let lowered = 0;
  for (const a of rules.attributes) {
    const v = attrs[a.id];
    if (v === undefined) { problems.push(`${a.name} fehlt`); continue; }
    if (v < r.min || v > r.max) problems.push(`${a.name} muss zwischen ${r.min} und ${r.max} liegen`);
    if (v < r.base) lowered++;
  }
  if (lowered > r.maxLoweredAttributes) problems.push(`Höchstens ${r.maxLoweredAttributes} Attribute dürfen unter ${r.base} liegen`);
  const spent = pointsSpent(attrs, rules);
  if (spent > r.pointBudget) problems.push(`Zu viele Punkte ausgegeben (${spent} von ${r.pointBudget})`);
  return problems;
}

export function skillBonusForLevel(level: number, rules: Rules): number {
  return rules.levels.skillBonus[Math.min(Math.max(level, 1), rules.levels.max) - 1];
}

export function magicAllowed(cls: ClassDef, campaignMagic: MagicLevel): boolean {
  return MAGIC_ORDER.indexOf(cls.requiresMagic) <= MAGIC_ORDER.indexOf(campaignMagic);
}

export function characterProblems(input: CharacterInput, rules: Rules, classes: ClassDef[], campaignMagic: MagicLevel): string[] {
  const problems: string[] = [];
  const cls = classes.find((c) => c.id === input.classId);
  if (!cls) problems.push("Unbekannte Klasse");
  else if (!magicAllowed(cls, campaignMagic)) problems.push(`${cls.name} braucht mehr Magie in der Welt (campaign.json → magic_level)`);
  const stand = rules.stands.find((s) => s.id === input.stand);
  if (!stand) problems.push("Unbekannter Stand");
  // Punktekauf prüfen (ohne die Grundwerte der Klasse), danach die Endwerte gegen die harten Grenzen
  problems.push(...attributeProblems(boughtAttributes(input, cls, rules), rules));
  if (input.statsVersion === 2) {
    const lim = rules.classBuilder.attributeMods;
    for (const a of rules.attributes) {
      const v = input.attributes[a.id];
      if (v !== undefined && (v < lim.finalMin || v > lim.finalMax)) problems.push(`${a.name} muss mit den Grundwerten der Klasse zwischen ${lim.finalMin} und ${lim.finalMax} liegen`);
    }
  }
  if (cls) {
    const chosen = input.chosenSkills ?? [];
    if (new Set(chosen).size !== chosen.length) problems.push("Fertigkeit doppelt gewählt");
    if (chosen.length !== cls.skillChoices.count) problems.push(`Wähle genau ${cls.skillChoices.count} Fertigkeiten`);
    for (const s of chosen) if (!cls.skillChoices.from.includes(s)) problems.push(`Fertigkeit ${s} gehört nicht zur Auswahl der Klasse`);
  }
  return problems;
}

/** Alle Fertigkeiten, in denen die Figur geübt ist (Klasse fest + gewählt + Stand). */
export function trainedSkills(c: Pick<Character, "classId" | "chosenSkills" | "stand">, rules: Rules, classes: ClassDef[]): Set<string> {
  const cls = classes.find((x) => x.id === c.classId);
  const stand = rules.stands.find((s) => s.id === c.stand);
  return new Set([...(cls?.trainedSkills ?? []), ...c.chosenSkills, ...(stand ? [stand.skill] : [])]);
}

/** Trefferpunkte auf einer Stufe: Die `hpLevelUps` vollen Aufstiege verteilen sich gleichmäßig auf die Stufen 2 bis max. */
export function maxHpAtLevel(cls: ClassDef, konValue: number, level: number, rules?: Rules): number {
  const kon = modifier(konValue);
  const perLevel = Math.max(1, Math.floor(cls.hitDie / 2) + 1 + kon);
  const max = rules?.levels.max ?? 10, ups = rules?.levels.hpLevelUps ?? 4;
  const steps = Math.min(Math.max(level, 1), max) - 1;
  return Math.max(1, cls.hitDie + kon + Math.floor((ups * perLevel * steps) / (max - 1)));
}

export function addMoney(a: Money, b: Money): Money {
  return { gulden: a.gulden + b.gulden, groschen: a.groschen + b.groschen, pfennig: a.pfennig + b.pfennig };
}

export interface ArmorBreakdown { total: number; parts: { label: string; value: number }[] }

export function armorValue(c: Character, rules: Rules, cls: ClassDef): ArmorBreakdown {
  const ges = modifier(c.attributes.geschick);
  const parts: { label: string; value: number }[] = [{ label: "Grundwert", value: rules.combat.baseArmor }];
  const armor = cls.equippedArmor ? findItem(rules, cls.equippedArmor) : undefined;
  if (armor && armor.type === "armor") {
    parts.push({ label: armor.name, value: armor.armorBonus });
    const dex = armor.maxDexBonus === null ? ges : Math.min(ges, armor.maxDexBonus);
    if (dex !== 0) parts.push({ label: "Geschick", value: dex });
  } else if (ges !== 0) parts.push({ label: "Geschick", value: ges });
  const shield = cls.equippedShield ? findItem(rules, cls.equippedShield) : undefined;
  if (shield && shield.type === "shield") parts.push({ label: shield.name, value: shield.armorBonus });
  return { total: parts.reduce((s, p) => s + p.value, 0), parts };
}

export function findItem(rules: Rules, id: string): Item | undefined {
  return rules.items.find((i) => i.id === id);
}

export interface AttackInfo { weapon: string; attackBonus: number; damage: string; damageBonus: number; attribute: string }

export function attackInfo(c: Character, rules: Rules, cls: ClassDef): AttackInfo | null {
  const w = findItem(rules, cls.equippedWeapon);
  if (!w || w.type !== "weapon") return null;
  const best = w.attribute.reduce((a, b) => (c.attributes[b] > c.attributes[a] ? b : a));
  const mod = modifier(c.attributes[best]);
  return {
    weapon: w.name,
    attackBonus: mod + skillBonusForLevel(c.level, rules),
    damage: w.damage,
    damageBonus: mod,
    attribute: rules.attributes.find((a) => a.id === best)?.name ?? best,
  };
}

export type CharacterRollType = "attribute" | "skill" | "attack" | "damage";

export interface CharacterRollSpec { label: string; notation: string; parts: { label: string; value: number }[]; d20: boolean }

/** Würfelausdruck und Modifikatoren für einen Wurf einer Figur, zerlegt in nachvollziehbare Teile. */
export function characterRoll(c: Character, rules: Rules, classes: ClassDef[], type: CharacterRollType, id: string): CharacterRollSpec {
  if (type === "attribute") {
    const a = rules.attributes.find((x) => x.id === id);
    if (!a) throw new Error(`Unbekanntes Attribut ${id}`);
    return { label: `${a.name}-Probe`, notation: "1W20", d20: true, parts: [{ label: a.name, value: modifier(c.attributes[id]) }] };
  }
  if (type === "skill") {
    const s = rules.skills.find((x) => x.id === id);
    if (!s) throw new Error(`Unbekannte Fertigkeit ${id}`);
    const a = rules.attributes.find((x) => x.id === s.attribute)!;
    const parts = [{ label: a.name, value: modifier(c.attributes[a.id]) }];
    if (trainedSkills(c, rules, classes).has(id)) parts.push({ label: "Können", value: skillBonusForLevel(c.level, rules) });
    return { label: `${s.name}-Probe`, notation: "1W20", d20: true, parts };
  }
  const cls = classes.find((x) => x.id === c.classId);
  const atk = cls ? attackInfo(c, rules, cls) : null;
  if (!atk) throw new Error("Keine Waffe ausgerüstet");
  if (type === "attack") {
    return {
      label: `Angriff mit ${atk.weapon}`, notation: "1W20", d20: true,
      parts: [{ label: atk.attribute, value: atk.attackBonus - skillBonusForLevel(c.level, rules) }, { label: "Können", value: skillBonusForLevel(c.level, rules) }],
    };
  }
  return { label: `Schaden mit ${atk.weapon}`, notation: atk.damage, d20: false, parts: [{ label: atk.attribute, value: atk.damageBonus }] };
}
