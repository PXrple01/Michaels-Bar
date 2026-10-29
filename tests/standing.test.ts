import path from "node:path";
import { describe, expect, it } from "vitest";
import { addFate, changeStanding, standingName, standingSummary } from "../shared/standing";
import { initWorld } from "../shared/world";
import { buildCharacter } from "../server/characters";
import { RollLog } from "../server/dice/log";
import { runAutoTool } from "../server/gm/world";
import { loadGameData } from "../server/rules/loader";

const data = await loadGameData(path.resolve(__dirname, "../data"));
const ritter = data.classes.find((c) => c.id === "ritter")!;
const hagen = buildCharacter({ name: "Hagen", stand: "bauer", classId: "ritter", attributes: ritter.recommendedAttributes, chosenSkills: ["reiten", "wahrnehmung"] }, data);
const run = (w: ReturnType<typeof initWorld>, name: string, input: Record<string, unknown>) =>
  runAutoTool({ type: "tool_use", id: `t-${name}-${Math.random()}`, name, input } as never, { data, characters: [hagen], world: w, rolls: new RollLog(), onRoll: () => {} });

describe("Ruf, Schicksal, Vermächtnis", () => {
  it("Ruf: begrenzt, gleiche Fraktion trotz anderer Schreibweise, in Worten", async () => {
    const w = initWorld([hagen]);
    await run(w, "ruf", { fraktion: "Kirche", aenderung: 3, grund: "Den Abt gerettet" });
    await run(w, "ruf", { fraktion: "kirche", aenderung: 3, grund: "Reliquie zurückgebracht" });
    expect(w.reputation).toMatchObject({ Kirche: { score: 6 } });
    expect(standingName(6)).toBe("verehrt");
    for (let i = 0; i < 6; i++) changeStanding(w, "Diebesgilde", -3, "");
    expect(w.reputation!.Diebesgilde.score).toBe(-10);
    expect(String((await run(w, "ruf", { fraktion: "Adel", aenderung: 0, grund: "x" })).content)).toMatch(/−3 und \+3/);
    expect(standingSummary(w)).toContain("Kirche +6 (verehrt)");
  });

  it("Schicksal: festgehalten, Folge nur für Claude", async () => {
    const w = initWorld([hagen]);
    await run(w, "schicksal", { entscheidung: "Ihr habt den Wachmann verschont.", folge: "Er warnt euch später vor Gisela." });
    expect(w.fates).toEqual([{ text: "Ihr habt den Wachmann verschont.", folge: "Er warnt euch später vor Gisela.", day: 1 }]);
    expect(standingSummary(w)).toContain("Er warnt euch später");
    addFate(w, "Zweite", "");
    expect(w.fates!.length).toBe(2);
  });
});
