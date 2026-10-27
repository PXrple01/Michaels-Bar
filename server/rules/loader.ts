import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";
import { campaignSchema, classSchema, openingsSchema, rulesSchema, type Campaign, type ClassDef, type Openings, type Rules } from "../../shared/schema";
import { attributeProblems } from "../../shared/character";
import { checkClass } from "../../shared/classbuilder";

export class RulesError extends Error {}

export interface GameData { rules: Rules; campaign: Campaign; classes: ClassDef[]; openings: Openings }

async function readJson<T>(file: string, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    throw new RulesError(`${file}: ${(e as Error).message}`);
  }
  const res = schema.safeParse(raw);
  if (!res.success) {
    const lines = res.error.issues.map((i) => `  • ${i.path.join(".") || "(Wurzel)"}: ${i.message}`);
    throw new RulesError(`${file} ist ungültig:\n${lines.join("\n")}`);
  }
  return res.data;
}

/** Prüft Querverweise, die ein Schema allein nicht abdecken kann. */
export function crossCheck(rules: Rules, classes: ClassDef[]): string[] {
  const errs: string[] = [];
  const attrs = new Set(rules.attributes.map((a) => a.id));
  const skills = new Set(rules.skills.map((s) => s.id));
  const items = new Map(rules.items.map((i) => [i.id, i]));
  if (rules.levels.xpTable.length !== rules.levels.max || rules.levels.skillBonus.length !== rules.levels.max)
    errs.push("levels: xpTable und skillBonus brauchen genau einen Eintrag pro Stufe");
  for (const s of rules.skills) if (!attrs.has(s.attribute)) errs.push(`Fertigkeit ${s.id}: unbekanntes Attribut ${s.attribute}`);
  for (const s of rules.stands) if (!skills.has(s.skill)) errs.push(`Stand ${s.id}: unbekannte Fertigkeit ${s.skill}`);
  for (const i of rules.items) if (i.type === "weapon") for (const a of i.attribute) if (!attrs.has(a)) errs.push(`Waffe ${i.id}: unbekanntes Attribut ${a}`);

  const seen = new Set<string>();
  for (const c of classes) {
    const p = `Klasse ${c.id}`;
    if (seen.has(c.id)) errs.push(`${p}: doppelte id`);
    seen.add(c.id);
    if (!rules.classBuilder.hitDie.allowed.includes(c.hitDie)) errs.push(`${p}: Trefferwürfel W${c.hitDie} nicht erlaubt`);
    for (const a of c.primaryAttributes) if (!attrs.has(a)) errs.push(`${p}: unbekanntes Attribut ${a}`);
    for (const s of [...c.trainedSkills, ...c.skillChoices.from]) if (!skills.has(s)) errs.push(`${p}: unbekannte Fertigkeit ${s}`);
    if (c.skillChoices.count > c.skillChoices.from.length) errs.push(`${p}: mehr Fertigkeiten zu wählen als angeboten`);
    for (const id of c.startingEquipment) if (!items.has(id)) errs.push(`${p}: unbekannter Gegenstand ${id}`);
    const w = items.get(c.equippedWeapon);
    if (w?.type !== "weapon" || !c.startingEquipment.includes(c.equippedWeapon)) errs.push(`${p}: equippedWeapon muss eine Waffe aus der Startausrüstung sein`);
    for (const [key, type] of [["equippedArmor", "armor"], ["equippedShield", "shield"]] as const) {
      const id = c[key];
      if (id === null) continue;
      const it = items.get(id);
      if (it?.type !== type || !c.startingEquipment.includes(id)) errs.push(`${p}: ${key} muss ${type} aus der Startausrüstung sein`);
      if (it?.type === "armor" && !c.armor.includes(it.category)) errs.push(`${p}: darf ${it.category}e Rüstung nicht tragen`);
      if (it?.type === "shield" && !c.armor.includes("schild")) errs.push(`${p}: darf keinen Schild tragen`);
    }
    for (const prob of attributeProblems(c.recommendedAttributes, rules)) errs.push(`${p}: empfohlene Attribute – ${prob}`);
    for (const ab of c.abilities) {
      if (!rules.classBuilder.abilityTypes.includes(ab.type)) errs.push(`${p}: Fähigkeit ${ab.id} hat unbekannten Typ ${ab.type}`);
      if (!rules.classBuilder.abilityUses.includes(ab.uses)) errs.push(`${p}: Fähigkeit ${ab.id} hat unbekannte Nutzung ${ab.uses}`);
    }
  }
  // Auch die Grundklassen müssen das Punktebudget einhalten – dieselbe Prüfung wie für eigene Klassen.
  for (const c of classes) {
    const res = checkClass(c, rules, "high");
    for (const e of res.errors) errs.push(`Klasse ${c.id}: ${e}`);
  }
  return errs;
}

export async function loadGameData(dataDir: string): Promise<GameData> {
  const rules = await readJson(path.join(dataDir, "rules.json"), rulesSchema);
  const campaign = await readJson(path.join(dataDir, "campaign.json"), campaignSchema);
  const openings = await readJson(path.join(dataDir, "openings.json"), openingsSchema);
  const classes: ClassDef[] = [];
  for (const sub of ["base", "custom"]) {
    const dir = path.join(dataDir, "classes", sub);
    const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(".json")).sort();
    for (const f of files) {
      const c = await readJson(path.join(dir, f), classSchema);
      classes.push({ ...c, custom: sub === "custom" });
    }
  }
  const base = classes.filter((c) => !c.custom);
  if (base.length === 0) throw new RulesError("Keine Klassen gefunden (data/classes/base)");
  const errs = crossCheck(rules, base);
  if (errs.length) throw new RulesError(`Regeldaten widersprechen sich:\n${errs.map((e) => `  • ${e}`).join("\n")}`);
  // Eigene Klassen, die (z. B. nach Regeländerungen) nicht mehr gültig sind, werden übersprungen statt den Start zu blockieren.
  const custom = classes.filter((c) => c.custom).filter((c) => {
    const res = checkClass(c, rules, campaign.magic_level);
    if (!res.ok) console.warn(`⚠ Eigene Klasse ${c.id} übersprungen: ${res.errors.join(" ")}`);
    return res.ok && !base.some((b) => b.id === c.id);
  });
  return { rules, campaign, classes: [...base, ...custom], openings };
}
