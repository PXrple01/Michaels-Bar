// Der „Richter“ für selbst gebaute Klassen: Punktkosten, harte Grenzen, Kürzungen und Ablehnungen.
// Läuft auf dem Server (verbindlich) und im Browser (Vorschau). Claude bewertet nur – entscheiden tut dieser Code.
import { attributeProblems, MAGIC_ORDER } from "./character";
import { parseNotation } from "./dice";
import type { Ability, ClassDef, MagicLevel, Mechanics, Rules } from "./schema";

export interface CostItem { label: string; points: number }
export interface ClassCost { total: number; budget: number; items: CostItem[] }

export interface ClassCheck {
  /** Die Klasse nach allen automatischen Kürzungen. */
  cls: ClassDef;
  cost: ClassCost;
  /** Gründe für eine Ablehnung – solange welche da sind, kann die Klasse nicht gespeichert werden. */
  errors: string[];
  /** Was der Code automatisch gekürzt oder ergänzt hat. */
  adjustments: string[];
  warnings: string[];
  ok: boolean;
}

export const EMPTY_MECHANICS: Mechanics = {
  extraDamage: null, heal: null, bonusDie: null, flatBonus: 0, advantage: false, imposeDisadvantage: false, armorBonus: 0, attackBonus: 0,
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Durchschnitt eines Würfelausdrucks wie „1W8+2“. */
export function averageRoll(expr: string | null): number {
  if (!expr) return 0;
  const p = parseNotation(expr);
  return p.terms.reduce((s, t) => s + (t.count * (t.sides + 1)) / 2, 0) + p.modifier;
}

export function abilityCost(a: Ability, rules: Rules): number {
  const c = rules.classBuilder.costs;
  const m = a.mechanics ?? EMPTY_MECHANICS;
  let value =
    averageRoll(m.extraDamage) * c.extraDamagePerAverage +
    averageRoll(m.heal) * c.healPerAverage +
    averageRoll(m.bonusDie) * c.bonusDiePerAverage +
    m.flatBonus * c.flatBonus +
    (m.advantage ? c.advantage : 0) +
    (m.imposeDisadvantage ? c.imposeDisadvantage : 0) +
    m.armorBonus * c.armorBonus +
    m.attackBonus * c.attackBonus;
  if (value === 0) value = c.abilityBase; // reines Wissen oder Erzählwirkung
  return round1(value * (c.usesMultiplier[a.uses] ?? 1) * c.scopeMultiplier[a.scope ?? "breit"]);
}

export function classCost(cls: ClassDef, rules: Rules, level = 1): ClassCost {
  const c = rules.classBuilder.costs;
  const items: CostItem[] = [];
  items.push({ label: `Trefferwürfel W${cls.hitDie}`, points: c.hitDie[String(cls.hitDie)] ?? 99 });
  const skills = cls.trainedSkills.length + cls.skillChoices.count;
  items.push({ label: `${skills} geübte Fertigkeiten`, points: skills * c.perTrainedSkill });
  const body = cls.armor.filter((a) => a !== "schild");
  const heaviest = body.reduce((m, a) => Math.max(m, c.armor[a] ?? 0), 0);
  const armorPts = heaviest + (cls.armor.includes("schild") ? c.armor.schild : 0);
  items.push({ label: `Rüstung: ${cls.armor.join(", ") || "keine"}`, points: armorPts });
  for (const a of cls.abilities) items.push({ label: `Fähigkeit „${a.name}“`, points: abilityCost(a, rules) });
  const total = round1(items.reduce((s, i) => s + i.points, 0));
  return { total, budget: rules.classBuilder.pointBudgetPerLevel[level - 1], items };
}

/** Würfelausdruck auf die erlaubten Grenzen kürzen. */
function clampDice(expr: string | null, rules: Rules, label: string, notes: string[]): string | null {
  if (!expr) return null;
  const cb = rules.classBuilder;
  let p;
  try { p = parseNotation(expr); } catch { notes.push(`${label}: „${expr}“ ist kein gültiger Würfel und wurde entfernt`); return null; }
  const t = p.terms[0];
  const allowedDice = [4, 6, 8, 10, 12].filter((d) => d <= cb.maxDamageDie);
  const sides = allowedDice.includes(t.sides) ? t.sides : allowedDice[allowedDice.length - 1];
  const count = Math.min(t.count, cb.maxDamageDiceCount);
  const mod = Math.max(-cb.maxFlatDamageBonus, Math.min(cb.maxFlatDamageBonus, p.modifier));
  const out = `${count}W${sides}${mod ? (mod > 0 ? `+${mod}` : String(mod)) : ""}`;
  const original = `${p.terms.map((x) => `${x.count}W${x.sides}`).join("+")}${p.modifier ? (p.modifier > 0 ? `+${p.modifier}` : p.modifier) : ""}`;
  if (p.terms.length > 1 || out !== original) notes.push(`${label}: ${expr} → ${out} gekürzt`);
  return out;
}

const clampInt = (v: number, min: number, max: number, label: string, notes: string[]) => {
  const r = Math.max(min, Math.min(max, Math.round(v)));
  if (r !== v) notes.push(`${label}: ${v} → ${r} gekürzt`);
  return r;
};

/** Würfel und Boni einer Fähigkeit auf die Grenzen aus rules.json kürzen (auch für Verbesserungen). */
export function clampMechanics(a: Pick<Ability, "name" | "mechanics">, rules: Rules, notes: string[]): Mechanics {
  const cb = rules.classBuilder;
  const label = `„${a.name}“`;
  const m = { ...EMPTY_MECHANICS, ...(a.mechanics ?? {}) };
  m.extraDamage = clampDice(m.extraDamage, rules, `${label} Zusatzschaden`, notes);
  m.heal = clampDice(m.heal, rules, `${label} Heilung`, notes);
  m.bonusDie = clampDice(m.bonusDie, rules, `${label} Bonuswürfel`, notes);
  m.flatBonus = clampInt(m.flatBonus, 0, cb.maxFlatDamageBonus, `${label} fester Bonus`, notes);
  m.armorBonus = clampInt(m.armorBonus, cb.armorBonus.min, cb.armorBonus.max, `${label} Rüstungsbonus`, notes);
  m.attackBonus = clampInt(m.attackBonus, cb.attackBonus.min, cb.attackBonus.max, `${label} Angriffsbonus`, notes);
  return m;
}

/** Legale Start-Attribute, wenn die angegebenen das Punktebudget sprengen. */
export function defaultAttributes(cls: Pick<ClassDef, "primaryAttributes">, rules: Rules): Record<string, number> {
  const out = Object.fromEntries(rules.attributes.map((a) => [a.id, rules.attributeRules.base]));
  const [p1, p2] = [...cls.primaryAttributes, "konstitution", "geschick"].filter((v, i, arr) => arr.indexOf(v) === i);
  out[p1] = 15;
  out[p2] = 14;
  return out;
}

export function forbiddenHits(text: string, rules: Rules): string[] {
  const lower = text.toLowerCase();
  return rules.classBuilder.forbiddenEffects.filter((w) => new RegExp(`(^|[^a-zäöüß])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(lower));
}

/** Prüft eine Klasse hart gegen rules.json. Was sich kürzen lässt, wird gekürzt; der Rest führt zur Ablehnung. */
export function checkClass(input: ClassDef, rules: Rules, campaignMagic: MagicLevel, level = 1): ClassCheck {
  const cb = rules.classBuilder;
  const errors: string[] = [];
  const adjustments: string[] = [];
  const warnings: string[] = [];
  const cls: ClassDef = structuredClone(input);
  const attrs = new Set(rules.attributes.map((a) => a.id));
  const skills = new Set(rules.skills.map((s) => s.id));
  const items = new Map(rules.items.map((i) => [i.id, i]));

  if (!cls.name.trim()) errors.push("Die Klasse braucht einen Namen.");

  // Trefferwürfel
  if (!cb.hitDie.allowed.includes(cls.hitDie)) {
    const nearest = cb.hitDie.allowed.reduce((a, b) => (Math.abs(b - cls.hitDie) < Math.abs(a - cls.hitDie) ? b : a));
    adjustments.push(`Trefferwürfel W${cls.hitDie} → W${nearest} (erlaubt: ${cb.hitDie.allowed.map((d) => `W${d}`).join(", ")})`);
    cls.hitDie = nearest;
  }

  // Attribute und Fertigkeiten
  cls.primaryAttributes = cls.primaryAttributes.filter((a) => attrs.has(a)).slice(0, 2);
  if (!cls.primaryAttributes.length) cls.primaryAttributes = ["konstitution"];
  for (const s of [...cls.trainedSkills, ...cls.skillChoices.from]) if (!skills.has(s)) errors.push(`Unbekannte Fertigkeit: ${s}`);
  cls.trainedSkills = [...new Set(cls.trainedSkills)];
  cls.skillChoices.from = [...new Set(cls.skillChoices.from)].filter((s) => !cls.trainedSkills.includes(s));
  if (cls.skillChoices.count > cls.skillChoices.from.length) {
    adjustments.push(`Fertigkeiten zur Wahl: ${cls.skillChoices.count} → ${cls.skillChoices.from.length} (nicht genug Auswahl)`);
    cls.skillChoices.count = cls.skillChoices.from.length;
  }
  const skillTotal = cls.trainedSkills.length + cls.skillChoices.count;
  if (skillTotal > cb.maxTrainedSkills) errors.push(`Zu viele geübte Fertigkeiten (${skillTotal}, erlaubt sind ${cb.maxTrainedSkills}).`);
  if (attributeProblems(cls.recommendedAttributes, rules).length) {
    cls.recommendedAttributes = defaultAttributes(cls, rules);
    adjustments.push("Empfohlene Attribute passten nicht zum Punktekauf und wurden neu verteilt.");
  }

  // Ausrüstung
  cls.startingEquipment = cls.startingEquipment.filter((id) => {
    if (items.has(id)) return true;
    adjustments.push(`Unbekannter Gegenstand „${id}“ entfernt`);
    return false;
  });
  const weapon = items.get(cls.equippedWeapon);
  if (weapon?.type !== "weapon") {
    const first = cls.startingEquipment.find((id) => items.get(id)?.type === "weapon") ?? "dolch";
    adjustments.push(`Waffe: ${first} angelegt`);
    cls.equippedWeapon = first;
  }
  if (!cls.startingEquipment.includes(cls.equippedWeapon)) cls.startingEquipment.unshift(cls.equippedWeapon);
  for (const key of ["equippedArmor", "equippedShield"] as const) {
    const id = cls[key];
    if (id === null) continue;
    const it = items.get(id);
    const allowed = it?.type === "armor" ? cls.armor.includes(it.category) : it?.type === "shield" ? cls.armor.includes("schild") : false;
    if (!allowed || (key === "equippedArmor" ? it?.type !== "armor" : it?.type !== "shield")) {
      adjustments.push(`${key === "equippedArmor" ? "Rüstung" : "Schild"} „${id}“ passt nicht zur Rüstungsübung und wurde abgelegt`);
      cls[key] = null;
    } else if (!cls.startingEquipment.includes(id)) cls.startingEquipment.push(id);
  }
  const money = cls.startingMoney;
  const pf = money.gulden * 240 + money.groschen * 12 + money.pfennig;
  if (pf > 480) { cls.startingMoney = { gulden: 2, groschen: 0, pfennig: 0 }; adjustments.push("Startgeld auf 2 Gulden begrenzt"); }

  // Fähigkeiten
  if (cls.abilities.length === 0) errors.push("Die Klasse braucht mindestens eine Fähigkeit.");
  if (cls.abilities.length > cb.maxAbilitiesAtLevel1) errors.push(`Zu viele Fähigkeiten auf Stufe 1 (${cls.abilities.length}, erlaubt sind ${cb.maxAbilitiesAtLevel1}).`);
  for (const a of cls.abilities) {
    const label = `„${a.name}“`;
    if (!cb.abilityTypes.includes(a.type)) errors.push(`${label}: unbekannter Fähigkeitstyp „${a.type}“`);
    if (!cb.abilityUses.includes(a.uses)) errors.push(`${label}: unbekannte Nutzung „${a.uses}“`);
    const m = clampMechanics(a, rules, adjustments);
    if (a.uses === "beliebig" && (m.extraDamage || m.heal || m.advantage || m.imposeDisadvantage)) {
      errors.push(`${label}: Schaden, Heilung oder Vorteil/Nachteil beliebig oft einsetzbar wäre spielbrechend – höchstens einmal pro Kampf.`);
    }
    a.mechanics = m;
    if (a.type === "magie") a.magic = true;
  }

  // Spielbrechende Effekte
  const allText = [cls.name, cls.tagline, cls.description, ...cls.abilities.flatMap((a) => [a.name, a.text, a.beginnerText])].join(" \n ");
  const hits = forbiddenHits(allText, rules);
  if (hits.length) errors.push(`Spielbrechende Effekte sind nicht erlaubt (${hits.join(", ")}).`);

  // Magie
  if (cls.abilities.some((a) => a.magic) && cls.requiresMagic === "none") {
    cls.requiresMagic = "low";
    adjustments.push("Klasse hat magische Fähigkeiten und braucht deshalb mindestens „Wenig Magie“");
  }
  if (MAGIC_ORDER.indexOf(cls.requiresMagic) > MAGIC_ORDER.indexOf(campaignMagic)) {
    warnings.push("In der aktuellen Welt gibt es zu wenig Magie – die Klasse ist gespeichert, aber erst spielbar, wenn campaign.json mehr Magie erlaubt.");
  }

  // Budget
  const cost = classCost(cls, rules, level);
  if (cost.total > cost.budget) {
    const top = [...cost.items].sort((a, b) => b.points - a.points).slice(0, 3).map((i) => `${i.label} (${i.points})`).join(", ");
    errors.push(`Zu stark: ${cost.total} von ${cost.budget} Punkten. Am teuersten: ${top}.`);
  }

  return { cls, cost, errors, adjustments, warnings, ok: errors.length === 0 };
}
