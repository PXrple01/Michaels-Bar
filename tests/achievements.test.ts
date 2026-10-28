import path from "node:path";
import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS, isDone, summarizeRun, type AchievementStats } from "../shared/achievements";
import type { RollRecord } from "../shared/dice";
import { visitPlace } from "../shared/map";
import { initWorld } from "../shared/world";
import { buildCharacter } from "../server/characters";
import { loadGameData } from "../server/rules/loader";

const data = await loadGameData(path.resolve(__dirname, "../data"));
const ritter = data.classes.find((c) => c.id === "ritter")!;
const hagen = buildCharacter({ name: "Hagen", stand: "bauer", classId: "ritter", attributes: ritter.recommendedAttributes, chosenSkills: ["reiten", "wahrnehmung"] }, data);
const roll = (critical: RollRecord["critical"]) => ({ critical }) as RollRecord;
const done = (s: AchievementStats) => ACHIEVEMENTS.filter((a) => isDone(a, s)).map((a) => a.id);

describe("Erfolge", () => {
  it("haben eindeutige IDs", () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });

  it("zählen über Figuren, Würfe und Abenteuer", () => {
    const w = initWorld([hagen]);
    for (const n of ["A", "B", "C", "D", "E", "F", "G", "H"]) visitPlace(w, { name: n });
    w.arc = { ...(w.arc as object), finished: true, outcome: "sieg" } as never;
    const run = summarizeRun(w, hagen.id, [roll("hit"), roll("fumble"), roll(null)], 4, true);
    expect(run).toMatchObject({ group: true, turns: 4, finished: true, defeat: false, places: 8, crits: 1, fumbles: 1 });
    const ids = done({ characters: 1, classes: 0, runs: [run] });
    expect(ids).toEqual(expect.arrayContaining(["erste-figur", "erster-zug", "krit", "patzer", "abgeschlossen", "gruppe", "gruppe-sieg", "orte"]));
    expect(ids).not.toContain("gefolge");
    expect(ids).not.toContain("drei-kampagnen");
  });

  it("Niederlage zählt nicht als Abschluss", () => {
    const w = initWorld([hagen]);
    w.arc = { ...(w.arc as object), finished: true, outcome: "niederlage" } as never;
    const ids = done({ characters: 1, classes: 0, runs: [summarizeRun(w, hagen.id, [], 10, false)] });
    expect(ids).toContain("niederlage");
    expect(ids).not.toContain("abgeschlossen");
  });

  it("ohne Spielstand: nichts außer Figuren", () => {
    expect(done({ characters: 0, classes: 0, runs: [summarizeRun(null, "x", [], 0, false)] })).toEqual([]);
  });
});
