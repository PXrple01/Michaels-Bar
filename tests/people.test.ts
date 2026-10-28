import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_PEOPLE, upsertPerson } from "../shared/people";
import { initWorld } from "../shared/world";
import { buildCharacter } from "../server/characters";
import { RollLog } from "../server/dice/log";
import { turnSummary } from "../server/gm/summary";
import { runAutoTool } from "../server/gm/world";
import { loadGameData } from "../server/rules/loader";

const data = await loadGameData(path.resolve(__dirname, "../data"));
const ritter = data.classes.find((c) => c.id === "ritter")!;
const hagen = buildCharacter({ name: "Hagen", stand: "bauer", classId: "ritter", attributes: ritter.recommendedAttributes, chosenSkills: ["reiten", "wahrnehmung"] }, data);

describe("Personenverzeichnis", () => {
  it("anlegen, Haltung ändern, Notizen sammeln – Claude sieht die Liste (danach nur bei Änderungen)", async () => {
    const w = initWorld([hagen]);
    const run = (input: object) => runAutoTool({ id: `toolu_${Math.random()}`, name: "person", input }, { data, characters: [hagen], world: w, rolls: new RollLog(), onRoll: () => {} });
    expect((await run({ name: "Gerlind", rolle: "Marktfrau", haltung: "freund", notiz: "Verkauft Äpfel." })).content).toContain("Neu im Verzeichnis: Gerlind (Marktfrau), Freund");
    await run({ name: "gerlind", haltung: "misstrauisch", notiz: "Hat uns beim Stehlen gesehen." });
    expect(w.people).toHaveLength(1);
    expect(w.people![0]).toMatchObject({ attitude: "misstrauisch", notes: ["Verkauft Äpfel.", "Hat uns beim Stehlen gesehen."] });
    expect((await run({ rolle: "x" })).is_error).toBe(true);
    expect(turnSummary(w, [hagen], data.rules)).toContain("Personen – Gerlind (Marktfrau): misstrauisch");
    expect(turnSummary(w, [hagen], data.rules)).toContain("Personen: unverändert");
  });

  it("bei vollem Verzeichnis fällt eine lange nicht gesehene neutrale Person heraus", () => {
    const w = initWorld([hagen]);
    upsertPerson(w, { name: "Feind Konrad", attitude: "feind" });
    for (let i = 0; i < MAX_PEOPLE + 3; i++) upsertPerson(w, { name: `Bauer ${i}` });
    expect(w.people!.length).toBe(MAX_PEOPLE);
    expect(w.people!.some((p) => p.name === "Feind Konrad")).toBe(true);
  });
});
