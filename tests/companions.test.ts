import path from "node:path";
import { describe, expect, it } from "vitest";
import { standingSummary } from "../shared/standing";
import { looksFemale, segmentVoices, NARRATOR, voiceFor } from "../shared/voices";
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

describe("Begleiter, Gerüchte, Porträt-Angaben", () => {
  it("Begleiter: aufnehmen, Treue ändern (begrenzt), verlassen; höchstens 3", async () => {
    const w = initWorld([hagen]);
    expect((await run(w, "begleiter", { aktion: "aktualisieren", name: "Konrad" })).is_error).toBe(true);
    await run(w, "begleiter", { aktion: "beitreten", name: "Konrad", rolle: "junger Erbe", faehigkeit: "kennt das Moor", aussehen: "A pale young man" });
    await run(w, "begleiter", { aktion: "aktualisieren", name: "konrad", treue: 9 });
    expect(w.companions).toMatchObject([{ name: "Konrad", loyalty: 3, look: "A pale young man" }]);
    for (const n of ["A", "B"]) await run(w, "begleiter", { aktion: "beitreten", name: n });
    expect((await run(w, "begleiter", { aktion: "beitreten", name: "C" })).is_error).toBe(true);
    await run(w, "begleiter", { aktion: "verlassen", name: "A" });
    expect(w.companions!.map((c) => c.name)).toEqual(["Konrad", "B"]);
    expect(standingSummary(w)).toContain("Konrad (junger Erbe), kann: kennt das Moor, Treue 3");
  });

  it("Gerüchte: ohne Doppelte, im Spielstand für Claude", async () => {
    const w = initWorld([hagen]);
    await run(w, "geruecht", { text: "Im Moor spukt ein Mönch." });
    await run(w, "geruecht", { text: "Im Moor spukt ein Mönch." });
    expect(w.rumors!.length).toBe(1);
    expect(standingSummary(w)).toContain("Im Moor spukt ein Mönch.");
  });

  it("Aussehen bei Personen und besonderen Gegnern wird für das Porträt gemerkt", async () => {
    const w = initWorld([hagen]);
    await run(w, "person", { name: "Gisela", rolle: "Burgvögtin", aussehen: "A stern woman in black" });
    await run(w, "kampf_beginnen", { gegner: [{ name: "Wachmann", trefferpunkte: 8, ruestung: 12 }, { name: "Ritter Bernhard", trefferpunkte: 30, ruestung: 16, aussehen: "A scarred knight" }] });
    expect(w.people![0].look).toBe("A stern woman in black");
    expect(w.combat!.enemies.map((e) => e.look ?? null)).toEqual([null, "A scarred knight"]);
  });
});

describe("Figurenstimmen", () => {
  const cast = [{ name: "Irmgard", female: true }, { name: "Konrad", female: false }];
  it("Rede bekommt die Stimme der genannten Person, Erzählung die Erzählerstimme", () => {
    const segs = segmentVoices("Irmgard wischt sich die Hände ab. „Komm rein, Junge!“ Konrad zögert. „Ich danke Euch.“ Dann schweigen beide.", cast);
    expect(segs.map((s) => s.voice)).toEqual([NARRATOR, voiceFor(cast[0]), NARRATOR, voiceFor(cast[1]), NARRATOR]);
    expect(segs[1].text).toBe("Komm rein, Junge!");
  });
  it("Sprecher nach der Rede, unbekannte Sprecher, ohne Rede nur Erzähler", () => {
    expect(segmentVoices("„Halt!“, ruft Konrad.", cast)[0].voice).toBe(voiceFor(cast[1]));
    expect(segmentVoices("„Wer da?“", cast)[0].voice).toBe("Friendly_Person");
    expect(segmentVoices("Nur Erzählung.", cast)).toEqual([{ text: "Nur Erzählung.", voice: NARRATOR }]);
  });
  it("weibliche Rollen erkennen", () => {
    expect(looksFemale("Hebamme")).toBe(true);
    expect(looksFemale("Burgvögtin")).toBe(true);
    expect(looksFemale("Müller")).toBe(false);
  });
});
