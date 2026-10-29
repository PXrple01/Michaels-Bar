import path from "node:path";
import { describe, expect, it } from "vitest";
import { gambleSummary, playGamble } from "../shared/gamble";
import { initWorld } from "../shared/world";
import { ensureInventory } from "../shared/inventory";
import type { RollRecord } from "../shared/dice";
import { buildCharacter } from "../server/characters";
import { loadGameData } from "../server/rules/loader";
import { gambleRoll } from "../server/dice/engine";

const data = await loadGameData(path.resolve(__dirname, "../data"));
const hagen = buildCharacter({ name: "Hagen", stand: "bauer", classId: "ritter", attributes: data.classes.find((c) => c.id === "ritter")!.recommendedAttributes, chosenSkills: ["reiten", "wahrnehmung"] }, data);
const fixed = (...totals: number[]) => () => ({ total: totals.shift()! } as RollRecord);

describe("Würfelspiel", () => {
  it("höherer Wurf gewinnt den Einsatz, Gleichstand gibt ihn zurück", () => {
    const w = initWorld([hagen]);
    ensureInventory(w, [hagen], data.rules);
    w.inventory![hagen.id].money = 100;
    expect(playGamble(w, hagen, data.rules, 6, fixed(7, 5))).toBe("Gerade wird hier nicht gewürfelt.");
    w.gamble = { opponent: "Ruprecht", maxBet: 24, log: [] };
    expect(playGamble(w, hagen, data.rules, 6, fixed(9, 4))).toBeNull();
    expect(w.inventory![hagen.id].money).toBe(106);
    expect(playGamble(w, hagen, data.rules, 12, fixed(3, 11))).toBeNull();
    expect(w.inventory![hagen.id].money).toBe(94);
    expect(playGamble(w, hagen, data.rules, 12, fixed(8, 8))).toBeNull();
    expect(w.inventory![hagen.id].money).toBe(94);
    expect(w.gamble.last?.outcome).toBe("gleichstand");
    expect(playGamble(w, hagen, data.rules, 30, fixed(1, 1))).toContain("höchstens");
    w.inventory![hagen.id].money = 3;
    expect(playGamble(w, hagen, data.rules, 6, fixed(1, 1))).toContain("reicht dein Geld nicht");
    const summary = gambleSummary(w);
    expect(summary).toContain("Hagen gewinnt 6 Pfennig");
    expect(gambleSummary(w)).not.toContain("gewinnt"); // Protokoll geht nur einmal an Claude
  });

  it("im Kampf wird nicht gespielt; der Server würfelt 2W6", () => {
    const w = initWorld([hagen]);
    w.gamble = { opponent: "Ruprecht", maxBet: 24, log: [] };
    w.combat = { round: 1, enemies: [] };
    expect(playGamble(w, hagen, data.rules, 1, gambleRoll)).toContain("Kampf");
    const r = gambleRoll("Hagen");
    expect(r.values).toHaveLength(2);
    expect(r.total).toBeGreaterThanOrEqual(2);
    expect(r.total).toBeLessThanOrEqual(12);
  });
});
