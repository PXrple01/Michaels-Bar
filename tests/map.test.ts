import path from "node:path";
import { describe, expect, it } from "vitest";
import { guessKind, MAX_PLACES, startPlace, visitPlace } from "../shared/map";
import { initWorld } from "../shared/world";
import { buildCharacter } from "../server/characters";
import { RollLog } from "../server/dice/log";
import { turnSummary } from "../server/gm/summary";
import { runAutoTool } from "../server/gm/world";
import { loadGameData } from "../server/rules/loader";

const data = await loadGameData(path.resolve(__dirname, "../data"));
const ritter = data.classes.find((c) => c.id === "ritter")!;
const hagen = buildCharacter({ name: "Hagen", stand: "bauer", classId: "ritter", attributes: ritter.recommendedAttributes, chosenSkills: ["reiten", "wahrnehmung"] }, data);

describe("Karte der Reise", () => {
  it("Orte mit Wegen, Wiederbesuch ohne doppelten Weg, keine Überlappung", () => {
    const w = initWorld([hagen]);
    visitPlace(w, { name: "Dorf Eichen", kind: "dorf" });
    visitPlace(w, { name: "Rabenwald", kind: "wald" });
    visitPlace(w, { name: "Burg Falkenstein", kind: "burg" });
    const back = visitPlace(w, { name: "rabenwald" });
    expect(back.created).toBe(false);
    expect(back.place.visits).toBe(2);
    expect(w.map!.current).toBe("Rabenwald");
    expect(w.map!.roads).toEqual([["Dorf Eichen", "Rabenwald"], ["Rabenwald", "Burg Falkenstein"]]);
    for (let i = 0; i < 12; i++) visitPlace(w, { name: `Weiler ${i}`, kind: "dorf" });
    const ps = w.map!.places;
    for (const a of ps) for (const b of ps) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0.3);
  });

  it("die Art wird aus dem Namen erraten; höchstens 40 Orte", () => {
    expect(guessKind("ein Pilgerhospiz an einer Passstraße")).toBe("gasthaus");
    expect(guessKind("Kloster Sankt Gallus")).toBe("kloster");
    expect(guessKind("die alte Mühle")).toBe("dorf");
    const w = initWorld([hagen]);
    for (let i = 0; i < MAX_PLACES + 5; i++) visitPlace(w, { name: `Ort ${i}` });
    expect(w.map!.places.length).toBe(MAX_PLACES);
    expect(w.map!.current).toBe(`Ort ${MAX_PLACES + 4}`);
  });

  it("Werkzeug ort und Spielstand", async () => {
    const w = initWorld([hagen]);
    const run = (input: object) => runAutoTool({ id: `toolu_${Math.random()}`, name: "ort", input }, { data, characters: [hagen], world: w, rolls: new RollLog(), onRoll: () => {} });
    expect((await run({ name: "Kloster Sankt Gallus", art: "kloster", notiz: "Die Mönche schweigen." })).content).toContain("Neu auf der Karte: Kloster Sankt Gallus (Kloster)");
    expect(turnSummary(w, [hagen], data.rules)).toContain("Karte – jetzt in: Kloster Sankt Gallus");
    expect(turnSummary(w, [hagen], data.rules)).toContain("Ort: Kloster Sankt Gallus (Karte sonst unverändert)");
  });
});

describe("startPlace", () => {
  it("macht aus dem Startimpuls einen kurzen Kartennamen", () => {
    expect(startPlace("eine Kapelle auf einer Insel im Moor")).toEqual({ name: "Kapelle auf einer Insel", kind: "kloster" });
    expect(startPlace("eine verrauchte Taverne an der Handelsstraße")).toEqual({ name: "Verrauchte Taverne", kind: "gasthaus" });
    expect(startPlace("eine Köhlerhütte tief im Wald").name).toBe("Köhlerhütte");
  });
});
