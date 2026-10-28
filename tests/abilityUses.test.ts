import path from "node:path";
import { describe, expect, it } from "vitest";
import { initWorld, worldSummary } from "../shared/world";
import { isUsed } from "../shared/abilityUses";
import { buildCharacter } from "../server/characters";
import { RollLog } from "../server/dice/log";
import { autoToolDefs, runAutoTool } from "../server/gm/world";
import { loadGameData } from "../server/rules/loader";

const data = await loadGameData(path.resolve(__dirname, "../data"));
const mk = (name: string, classId: string, skills: string[]) =>
  buildCharacter({ name, stand: "bauer", classId, attributes: data.classes.find((c) => c.id === classId)!.recommendedAttributes, chosenSkills: skills }, data);
const hagen = mk("Hagen", "ritter", ["reiten", "wahrnehmung"]);
const agnes = mk("Agnes", "moench", ["glaube_sagen"]);
const ability = (classId: string, uses: string) => data.classes.find((c) => c.id === classId)!.abilities.find((a) => a.uses === uses)!;

function setup() {
  const w = initWorld([hagen, agnes]);
  const run = (name: string, input: object) => runAutoTool({ id: `toolu_${name}${Math.random().toString(36).slice(2)}`, name, input }, { data, characters: [hagen, agnes], world: w, rolls: new RollLog(), onRoll: () => {} });
  const use = (figur: string, faehigkeit: string) => run("faehigkeit_einsetzen", { figur, faehigkeit });
  return { w, run, use };
}

describe("Begrenzte Fähigkeiten zählt der Server", () => {
  it("1× pro Kampf: einmal geht, zweimal nicht – nach dem Kampf wieder", async () => {
    const { w, run, use } = setup();
    const a = ability("ritter", "einmal_pro_kampf");
    await run("kampf_beginnen", { gegner: [{ name: "Räuber", trefferpunkte: 7, ruestung: 11 }] });
    expect((await use("Hagen", a.name)).is_error).toBeUndefined();
    expect(isUsed(w, hagen.id, a.id)).toBe(true);
    expect(worldSummary(w, [hagen, agnes])).toContain(`Verbrauchte Fähigkeiten: Hagen: ${a.name} (wieder nach dem Kampf)`);
    const again = await use("Hagen", a.name.toLowerCase());
    expect(again.is_error).toBe(true);
    expect(again.content).toMatch(/schon eingesetzt/);
    await run("kampf_beenden", { grund: "Flucht" });
    expect(isUsed(w, hagen.id, a.id)).toBe(false);
    expect(worldSummary(w, [hagen, agnes])).not.toContain("Verbrauchte");
  });

  it("1× pro Rast übersteht das Kampfende, eine kurze Rast macht sie frei", async () => {
    const { w, run, use } = setup();
    const a = ability("ritter", "einmal_pro_rast");
    await use("Hagen", a.name);
    await run("kampf_beginnen", { gegner: [{ name: "Wolf", trefferpunkte: 5, ruestung: 10 }] });
    await run("kampf_beenden", { grund: "Der Wolf flieht" });
    expect(isUsed(w, hagen.id, a.id)).toBe(true);
    await run("rast", { art: "kurz" });
    expect(isUsed(w, hagen.id, a.id)).toBe(false);
  });

  it("1× pro Tag erst nach der langen Rast; passive Fähigkeiten werden nie verbraucht", async () => {
    const { w, run, use } = setup();
    const a = ability("moench", "einmal_pro_tag");
    await use("Agnes", a.name);
    await run("rast", { art: "kurz" });
    expect(isUsed(w, agnes.id, a.id)).toBe(true);
    await run("rast", { art: "lang" });
    expect(isUsed(w, agnes.id, a.id)).toBe(false);
    const p = ability("moench", "passiv");
    const r = await use("Agnes", p.name);
    expect(r.is_error).toBeUndefined();
    expect(r.content).toMatch(/passiv/);
    expect(isUsed(w, agnes.id, p.id)).toBe(false);
  });

  it("unbekannte Fähigkeiten und fremde Fähigkeiten werden abgelehnt", async () => {
    const { use } = setup();
    expect((await use("Hagen", "Feuerball")).is_error).toBe(true);
    expect((await use("Hagen", ability("moench", "einmal_pro_tag").name)).is_error).toBe(true);
  });

  it("das Werkzeug steht Claude zur Verfügung – in der Gruppe mit Figurenauswahl", () => {
    const tool = autoToolDefs([hagen, agnes]).find((t) => t.name === "faehigkeit_einsetzen")!;
    expect((tool.input_schema.properties as Record<string, { enum?: string[] }>).figur.enum).toEqual(["Hagen", "Agnes"]);
    expect(autoToolDefs([hagen]).find((t) => t.name === "faehigkeit_einsetzen")!.input_schema.required).toEqual(["faehigkeit"]);
  });
});
