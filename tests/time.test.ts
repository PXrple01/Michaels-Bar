import path from "node:path";
import { describe, expect, it } from "vitest";
import { advanceTime, initTime } from "../shared/time";
import { initWorld, worldSummary } from "../shared/world";
import { isUsed } from "../shared/abilityUses";
import { buildCharacter } from "../server/characters";
import { RollLog } from "../server/dice/log";
import { runAutoTool } from "../server/gm/world";
import { loadGameData } from "../server/rules/loader";

const data = await loadGameData(path.resolve(__dirname, "../data"));
const moench = data.classes.find((c) => c.id === "moench")!;
const agnes = buildCharacter({ name: "Agnes", stand: "bauer", classId: "moench", attributes: moench.recommendedAttributes, chosenSkills: ["glaube_sagen"] }, data);
const run = (w: ReturnType<typeof initWorld>, name: string, input: object) => runAutoTool({ id: `toolu_${Math.random()}`, name, input }, { data, characters: [agnes], world: w, rolls: new RollLog(), onRoll: () => {} });

describe("Tag, Nacht und Wetter", () => {
  it("die Startzeit kommt aus dem gewürfelten Einstieg", () => {
    expect(initTime("die Nacht vor einem hohen Kirchenfest")).toEqual({ day: 1, phase: "nacht", weather: "wechselhaft" });
    expect(initTime("ein verregneter Herbstmorgen")).toMatchObject({ phase: "morgen", weather: "Regen" });
    expect(initTime("Abenddämmerung im Nebel")).toMatchObject({ phase: "abend", weather: "Nebel" });
    expect(initTime("")).toMatchObject({ phase: "mittag" });
  });

  it("die Zeit läuft in Tageszeiten weiter, über Mitternacht beginnt ein neuer Tag", () => {
    const t = initTime("Morgen");
    expect(advanceTime(t, "stunden")).toBe(false); expect(t).toMatchObject({ day: 1, phase: "mittag" });
    expect(advanceTime(t, "bis_nacht")).toBe(false); expect(t.phase).toBe("nacht");
    expect(advanceTime(t, "stunden")).toBe(true); expect(t).toMatchObject({ day: 2, phase: "morgen" });
    expect(advanceTime(t, "bis_morgen")).toBe(true); expect(t.day).toBe(3); // vom Morgen zum nächsten Morgen
    expect(advanceTime(t, "kurz")).toBe(false); expect(t).toMatchObject({ day: 3, phase: "morgen" });
  });

  it("Werkzeug zeit, Wetter und die lange Rast als neuer Tag – Claude sieht beides im Spielstand", async () => {
    const w = initWorld([agnes]);
    w.time = initTime("Abend");
    const r = await run(w, "zeit", { vergeht: "bis_nacht", wetter: "klirrender Frost" });
    expect(r.content).toContain("Tag 1, Nacht");
    expect(worldSummary(w, [agnes])).toContain("Zeit: Tag 1, Nacht · Wetter: klirrender Frost");
    const tag = moench.abilities.find((a) => a.uses === "einmal_pro_tag")!;
    await run(w, "faehigkeit_einsetzen", { faehigkeit: tag.name });
    expect(isUsed(w, agnes.id, tag.id)).toBe(true);
    const rest = await run(w, "rast", { art: "lang" });
    expect(rest.content).toContain("Ein neuer Tag beginnt: Tag 2, Morgen");
    expect(isUsed(w, agnes.id, tag.id)).toBe(false);
    expect((await run(w, "zeit", { vergeht: "irgendwann" })).is_error).toBe(true);
  });

  it("ältere Spielstände ohne Zeit bekommen sie beim ersten Aufruf", async () => {
    const w = initWorld([agnes]);
    expect(worldSummary(w, [agnes])).not.toContain("Zeit:");
    await run(w, "zeit", { vergeht: "stunden" });
    expect(w.time).toMatchObject({ day: 1, phase: "abend" });
  });
});
