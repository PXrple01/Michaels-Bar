import path from "node:path";
import { describe, expect, it } from "vitest";
import { characterRoll, maxHpAtLevel, modifier, skillBonusForLevel } from "../shared/character";
import { applyLevels, chooseLevelReward, effectiveCharacter, levelCap, levelChoiceDue, levelForXp, levelTitle } from "../shared/levels";
import { initWorld, worldSummary, type WorldState } from "../shared/world";
import { buildCharacter } from "../server/characters";
import { RollLog } from "../server/dice/log";
import { runAutoTool } from "../server/gm/world";
import { loadGameData } from "../server/rules/loader";

const data = await loadGameData(path.resolve(__dirname, "../data"));
const { rules } = data;
const ritter = data.classes.find((c) => c.id === "ritter")!;
const hagen = buildCharacter({ name: "Hagen", stand: "bauer", classId: "ritter", attributes: ritter.recommendedAttributes, chosenSkills: ["reiten", "wahrnehmung"] }, data);

const ch = (t: string) => ({ titel: t, ziel: `${t} erreicht` });
async function planned(): Promise<WorldState> {
  const w = initWorld([hagen]);
  await runAutoTool({ id: "toolu_p", name: "kampagne_planen", input: { ziel: "Z", bedrohung: "B", anfang: [ch("A1"), ch("A2")], mitte: [ch("M1"), ch("M2"), ch("M3")], finale: [ch("F1"), ch("F2")] } }, { data, characters: [hagen], world: w, rolls: new RollLog(), onRoll: () => {} });
  return w;
}
const close = (w: WorldState) => runAutoTool({ id: `toolu_k${Math.random()}`, name: "kapitel_abschliessen", input: { rueckblick: "x" } }, { data, characters: [hagen], world: w, rolls: new RollLog(), onRoll: () => {} });

describe("Stufen 1 bis 10", () => {
  it("Tabelle, Titel und Können: nur Stufe 10 gibt +3", () => {
    expect([0, 59, 60, 900, 5000].map((x) => levelForXp(x, rules))).toEqual([1, 1, 2, 10, 10]);
    expect(levelTitle(10, rules)).toBe("Legende");
    expect([1, 5, 9].map((l) => skillBonusForLevel(l, rules))).toEqual([2, 2, 2]);
    expect(skillBonusForLevel(10, rules)).toBe(3);
  });

  it("Trefferpunkte steigen jede Stufe ein wenig – insgesamt um vier volle Aufstiege", () => {
    const kon = hagen.attributes.konstitution;
    const per = Math.max(1, Math.floor(ritter.hitDie / 2) + 1 + modifier(kon));
    const hp = Array.from({ length: 10 }, (_, i) => maxHpAtLevel(ritter, kon, i + 1, rules));
    for (let i = 1; i < 10; i++) expect(hp[i]).toBeGreaterThanOrEqual(hp[i - 1]);
    expect(hp[9] - hp[0]).toBe(4 * per);
    expect(hp[0]).toBe(hagen.hp.max); // Stufe 1 unverändert
  });

  it("der Kampagnenbogen deckelt: Anfang 3, Mitte 6, Finale 9, Stufe 10 erst im letzten Kapitel", async () => {
    const w = await planned();
    w.xp[hagen.id] = 5000;
    expect(levelCap(w, rules)).toBe(3);
    applyLevels(w, [hagen], data.classes, rules);
    expect(w.levels![hagen.id].level).toBe(3);
    await close(w); await close(w); // → Mitte
    expect(levelCap(w, rules)).toBe(6);
    await close(w); await close(w); await close(w); // → Finale, erstes Kapitel
    expect(levelCap(w, rules)).toBe(9);
    await close(w); // letztes Kapitel
    expect(levelCap(w, rules)).toBe(10);
  });

  it("Kapitel und Akte bringen feste Erfahrung", async () => {
    const w = await planned();
    await close(w);
    expect(w.xp[hagen.id]).toBe(50);
    await close(w); // Akt-Wechsel
    expect(w.xp[hagen.id]).toBe(50 + 50 + 100);
  });

  it("Aufstieg: Trefferpunkte kommen dazu, Claude erfährt die Stufe", async () => {
    const w = await planned();
    w.hp[hagen.id] = 5;
    w.xp[hagen.id] = 130; // Stufe 3
    const ups = applyLevels(w, [hagen], data.classes, rules);
    expect(ups).toEqual([{ characterId: hagen.id, from: 1, to: 3 }]);
    const gain = maxHpAtLevel(ritter, hagen.attributes.konstitution, 3, rules) - hagen.hp.max;
    expect(w.maxHp[hagen.id]).toBe(hagen.hp.max + gain);
    expect(w.hp[hagen.id]).toBe(5 + gain);
    expect(worldSummary(w, [hagen], rules)).toContain("Hagen Stufe 3 (Knappe)");
  });

  it("Stufe 4: eine zusätzliche Fertigkeit – sie zählt dann bei Proben", async () => {
    const w = await planned();
    await close(w); await close(w);
    w.xp[hagen.id] = 210;
    applyLevels(w, [hagen], data.classes, rules);
    expect(levelChoiceDue(w, hagen.id, rules)).toBe("skill");
    expect(chooseLevelReward(w, hagen, data.classes, rules, { skill: "reiten" })).toMatch(/schon/);
    const before = characterRoll(effectiveCharacter(hagen, w), rules, data.classes, "skill", "heimlichkeit").parts.length;
    expect(chooseLevelReward(w, hagen, data.classes, rules, { skill: "heimlichkeit" })).toBeNull();
    expect(characterRoll(effectiveCharacter(hagen, w), rules, data.classes, "skill", "heimlichkeit").parts.length).toBe(before + 1); // + Können
    // Die Attributsteigerung von Stufe 3 steht danach noch aus
    expect(levelChoiceDue(w, hagen.id, rules)).toBe("attrs");
  });

  it("Stufe 3 und 6: je +2 auf eins oder +1 auf zwei, Stufe 9: +1 – höchstens 18; Konstitution erhöht die Trefferpunkte", async () => {
    const w = await planned();
    for (let i = 0; i < 5; i++) await close(w); // Finale
    w.xp[hagen.id] = 510; // Stufe 7: Steigerungen von Stufe 3 und 6 fällig
    applyLevels(w, [hagen], data.classes, rules);
    chooseLevelReward(w, hagen, data.classes, rules, { skill: "heimlichkeit" });
    expect(levelChoiceDue(w, hagen.id, rules)).toBe("attrs");
    expect(chooseLevelReward(w, hagen, data.classes, rules, { attrs: { staerke: 3 } })).toMatch(/\+2/);
    expect(chooseLevelReward(w, hagen, data.classes, rules, { attrs: { staerke: 1, geschick: 2 } })).toMatch(/\+2/);
    // Über 18 geht es nicht (geprüft an einer Figur mit Stärke 17)
    expect(chooseLevelReward(structuredClone(w), { ...hagen, attributes: { ...hagen.attributes, staerke: 17 } }, data.classes, rules, { attrs: { staerke: 2 } })).toMatch(/18/);
    const hpBefore = w.maxHp[hagen.id];
    expect(chooseLevelReward(w, hagen, data.classes, rules, { attrs: { konstitution: 2 } })).toBeNull();
    expect(w.maxHp[hagen.id]).toBeGreaterThan(hpBefore); // Konstitution +2 → Bonus +1 → mehr Trefferpunkte
    // Zweite Steigerung (Stufe 6) – zählt zur ersten dazu
    expect(levelChoiceDue(w, hagen.id, rules)).toBe("attrs");
    expect(chooseLevelReward(w, hagen, data.classes, rules, { attrs: { konstitution: 1, geschick: 1 } })).toBeNull();
    expect(effectiveCharacter(hagen, w).attributes.konstitution).toBe(hagen.attributes.konstitution + 3);
    expect(effectiveCharacter(hagen, w).attributes.geschick).toBe(hagen.attributes.geschick + 1);
    expect(levelChoiceDue(w, hagen.id, rules)).toBeNull();
    // Stufe 9: dritte Steigerung, nur +1
    w.levels![hagen.id].level = 9;
    expect(levelChoiceDue(w, hagen.id, rules)).toBe("attrs");
    expect(chooseLevelReward(w, hagen, data.classes, rules, { attrs: { weisheit: 2 } })).toMatch(/\+1/);
    expect(chooseLevelReward(w, hagen, data.classes, rules, { attrs: { weisheit: 1 } })).toBeNull();
    expect(effectiveCharacter(hagen, w).attributes.weisheit).toBe(hagen.attributes.weisheit + 1);
    expect(levelChoiceDue(w, hagen.id, rules)).toBeNull();
  });

  it("ältere Stände: eine schon gewählte Steigerung zählt als die erste", () => {
    const st = { level: 7, skill: "heimlichkeit", attrs: { staerke: 2 } };
    const w = { levels: { [hagen.id]: st } } as never;
    expect(levelChoiceDue(w, hagen.id, rules)).toBe("attrs"); // Stufe 6 noch offen
  });
});
