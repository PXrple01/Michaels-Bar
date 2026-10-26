import path from "node:path";
import { describe, expect, it } from "vitest";
import { attributeCost, attributeProblems, characterProblems, characterRoll, maxHpAtLevel, modifier, pointsSpent, armorValue } from "../shared/character";
import { crossCheck, loadGameData } from "../server/rules/loader";
import type { Character } from "../shared/schema";

const data = await loadGameData(path.resolve(__dirname, "../data"));
const { rules, classes } = data;

describe("Regeldateien", () => {
  it("laden fehlerfrei und sind in sich stimmig", () => {
    expect(rules.attributes).toHaveLength(6);
    expect(classes.length).toBeGreaterThanOrEqual(6);
    expect(crossCheck(rules, classes)).toEqual([]);
  });

  it("finden Widersprüche", () => {
    const broken = structuredClone(classes);
    broken[0].startingEquipment = ["gibt_es_nicht"];
    broken[0].hitDie = 7;
    const errs = crossCheck(rules, broken);
    expect(errs.some((e) => e.includes("gibt_es_nicht"))).toBe(true);
    expect(errs.some((e) => e.includes("W7"))).toBe(true);
  });

  it("jede Klasse hat eine gültige Empfehlung, die das Budget genau ausschöpft", () => {
    for (const c of classes) {
      expect(attributeProblems(c.recommendedAttributes, rules), c.id).toEqual([]);
      expect(pointsSpent(c.recommendedAttributes, rules), c.id).toBe(rules.attributeRules.pointBudget);
    }
  });
});

describe("Attribute und Werte", () => {
  it("Bonus-Formel", () => {
    expect([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].map(modifier)).toEqual([-2, -2, -1, -1, 0, 0, 1, 1, 2, 2, 3]);
  });

  it("Punktkosten", () => {
    expect([8, 9, 10, 11, 13, 14, 15, 16].map((v) => attributeCost(v, rules))).toEqual([-2, -1, 0, 1, 3, 5, 7, 9]);
  });

  it("erkennt Verstöße beim Punktekauf", () => {
    const base = Object.fromEntries(rules.attributes.map((a) => [a.id, 10]));
    expect(attributeProblems({ ...base, staerke: 17 }, rules).length).toBeGreaterThan(0);
    expect(attributeProblems({ ...base, staerke: 16, geschick: 15 }, rules).some((p) => p.includes("Punkte"))).toBe(true);
    expect(attributeProblems({ ...base, staerke: 8, geschick: 8, verstand: 8 }, rules).some((p) => p.includes("Höchstens"))).toBe(true);
  });

  it("validiert neue Figuren", () => {
    const ok = { name: "Hagen", stand: "bauer", classId: "ritter", attributes: classes.find((c) => c.id === "ritter")!.recommendedAttributes, chosenSkills: ["reiten", "wahrnehmung"] };
    expect(characterProblems(ok, rules, classes, "low")).toEqual([]);
    expect(characterProblems({ ...ok, chosenSkills: ["reiten"] }, rules, classes, "low").length).toBeGreaterThan(0);
    expect(characterProblems({ ...ok, chosenSkills: ["reiten", "heimlichkeit"] }, rules, classes, "low").length).toBeGreaterThan(0);
    const hexe = classes.find((c) => c.id === "kraeuterhexe")!;
    const witch = { ...ok, classId: hexe.id, attributes: hexe.recommendedAttributes, chosenSkills: hexe.skillChoices.from.slice(0, hexe.skillChoices.count) };
    expect(characterProblems(witch, rules, classes, "low")).toEqual([]);
    expect(characterProblems(witch, rules, classes, "none").some((p) => p.includes("Magie"))).toBe(true);
  });

  it("berechnet Trefferpunkte, Rüstung und Würfe", () => {
    const ritter = classes.find((c) => c.id === "ritter")!;
    expect(maxHpAtLevel(ritter, 14, 1)).toBe(12);
    const c: Character = {
      id: "00000000-0000-4000-8000-000000000000", name: "Hagen", stand: "bauer", classId: "ritter",
      attributes: ritter.recommendedAttributes, chosenSkills: ["reiten", "wahrnehmung"],
      personality: { trait: "", ideal: "", bond: "", flaw: "" }, appearance: "", level: 1, xp: 0,
      hp: { current: 12, max: 12 }, equipment: ritter.startingEquipment, money: { gulden: 1, groschen: 0, pfennig: 0 },
      createdAt: "", updatedAt: "",
    };
    expect(armorValue(c, rules, ritter).total).toBe(16); // 10 + Kettenhemd 4 + Schild 2 (GES 0)
    expect(characterRoll(c, rules, classes, "skill", "athletik").parts.map((p) => p.value)).toEqual([2, 2]);
    expect(characterRoll(c, rules, classes, "skill", "heimlichkeit").parts.map((p) => p.value)).toEqual([0]);
    expect(characterRoll(c, rules, classes, "attack", "x")).toMatchObject({ notation: "1W20", d20: true });
    expect(characterRoll(c, rules, classes, "damage", "x")).toMatchObject({ notation: "1W8", d20: false });
  });
});
