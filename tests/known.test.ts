import path from "node:path";
import { describe, expect, it } from "vitest";
import { initWorld } from "../shared/world";
import { buildCharacter } from "../server/characters";
import { RollLog } from "../server/dice/log";
import { runAutoTool } from "../server/gm/world";
import { loadGameData } from "../server/rules/loader";

const data = await loadGameData(path.resolve(__dirname, "../data"));
const ritter = data.classes.find((c) => c.id === "ritter")!;
const hagen = buildCharacter({ name: "Hagen", stand: "bauer", classId: "ritter", attributes: ritter.recommendedAttributes, chosenSkills: ["reiten", "wahrnehmung"] }, data);
const ch = (t: string) => ({ titel: t, ziel: `${t} erreicht` });

describe("Kernauftrag für die Seitenleiste (ohne Geheimnisse aus dem Plan)", () => {
  it("Plan, Kapitelwechsel und Abzweigung setzen, was die Spieler sehen", async () => {
    const w = initWorld([hagen]);
    const run = (name: string, input: object) => runAutoTool({ id: `toolu_${name}${Math.random()}`, name, input }, { data, characters: [hagen], world: w, rolls: new RollLog(), onRoll: () => {} });
    await run("kampagne_planen", { ziel: "Den Abt als Verräter entlarven", bedrohung: "Der Abt", kernauftrag: "Findet heraus, wer die Reliquie gestohlen hat.", aufgabe: "Sprecht mit der Wache.", anfang: [ch("A1"), ch("A2")], mitte: [ch("M1"), ch("M2"), ch("M3")], finale: [ch("F1"), ch("F2")] });
    expect(w.arc!.known).toEqual({ kern: "Findet heraus, wer die Reliquie gestohlen hat.", aufgabe: "Sprecht mit der Wache." });
    await run("kapitel_abschliessen", { rueckblick: "x", aufgabe: "Folgt der Spur ins Moor." });
    expect(w.arc!.known).toEqual({ kern: "Findet heraus, wer die Reliquie gestohlen hat.", aufgabe: "Folgt der Spur ins Moor." });
    await run("abzweigung", { titel: "Die Hexe", ziel: "Die Hexe ist befreit", rueckweg: "Sie kennt den Weg", aufgabe: "Befreit die Hexe aus dem Turm." });
    expect(w.arc!.known!.aufgabe).toBe("Befreit die Hexe aus dem Turm.");
    await run("kapitel_abschliessen", { rueckblick: "y", aufgabe: "Zurück zur Spur.", kernauftrag: "Bringt die Reliquie zurück." });
    expect(w.arc!.known).toEqual({ kern: "Bringt die Reliquie zurück.", aufgabe: "Zurück zur Spur." });
  });
});
