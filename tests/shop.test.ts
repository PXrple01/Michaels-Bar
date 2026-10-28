import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureInventory, toPfennig } from "../shared/inventory";
import { gearOf, shopSummary, trade } from "../shared/shop";
import { initWorld } from "../shared/world";
import { buildCharacter } from "../server/characters";
import { RollLog } from "../server/dice/log";
import { Narrator } from "../server/gm/narrator";
import { MemoryCounterStore, UsageGuard } from "../server/gm/usage";
import { runAutoTool } from "../server/gm/world";
import { loadGameData } from "../server/rules/loader";

const data = await loadGameData(path.resolve(__dirname, "../data"));
const ritter = data.classes.find((c) => c.id === "ritter")!;
const hagen = buildCharacter({ name: "Hagen", stand: "bauer", classId: "ritter", attributes: ritter.recommendedAttributes, chosenSkills: ["reiten", "wahrnehmung"] }, data);
const setup = async (waren: object[], art = "haendler") => {
  const w = initWorld([hagen]);
  ensureInventory(w, [hagen], data.rules);
  w.inventory![hagen.id].money = toPfennig({ gulden: 2 });
  const run = (name: string, input: object) => runAutoTool({ id: `toolu_${Math.random()}`, name, input }, { data, characters: [hagen], world: w, rolls: new RollLog(), onRoll: () => {} });
  const r = await run("laden", { aktion: "oeffnen", name: "Krämerin Berta", art, waren });
  return { w, run, r };
};

describe("Händler und Schmied", () => {
  it("Laden öffnen, kaufen (Geld und Gepäck), zu teuer, ausverkauft – Claude erfährt die Einkäufe einmal", async () => {
    const { w, r } = await setup([
      { name: "Heiltrank", art: "trank", groschen: 2, notiz: "heilt 1W8+2", vorrat: 1 },
      { name: "Reitpferd", art: "gegenstand", gulden: 8 },
    ]);
    expect(r.content).toContain("Heiltrank");
    expect(trade(w, hagen, data.rules, "kaufen", "w0")).toBeNull();
    expect(w.inventory![hagen.id].money).toBe(toPfennig({ gulden: 2 }) - toPfennig({ groschen: 2 }));
    expect(w.inventory![hagen.id].items.find((i) => i.name === "Heiltrank")).toMatchObject({ kind: "trank", note: "heilt 1W8+2" });
    expect(trade(w, hagen, data.rules, "kaufen", "w0")).toMatch(/ausverkauft/);
    expect(trade(w, hagen, data.rules, "kaufen", "w1")).toMatch(/reicht dein Geld nicht/);
    expect(shopSummary(w)).toContain("Hagen kauft Heiltrank für 2 Groschen");
    expect(shopSummary(w)).not.toContain("kauft"); // Protokoll wird nach dem Senden geleert
  });

  it("verkaufen: halber Ladenpreis oder fester Satz", async () => {
    const { w } = await setup([{ name: "Langschwert", art: "waffe", gulden: 1 }]);
    const before = w.inventory![hagen.id].money;
    expect(trade(w, hagen, data.rules, "verkaufen", "Langschwert")).toBeNull();
    expect(w.inventory![hagen.id].money - before).toBe(120);
    expect(trade(w, hagen, data.rules, "verkaufen", "Drachenei")).toMatch(/nicht in deinem Gepäck/);
  });

  it("Schmied: Verbesserungen zählen bei Würfen und Rüstung, höchstens +2", async () => {
    const { w } = await setup([{ name: "Klinge schärfen", art: "verbesserung", groschen: 10, bonus: "schaden" }, { name: "Rüstung verstärken", art: "verbesserung", groschen: 10, bonus: "ruestung" }], "schmied");
    expect(trade(w, hagen, data.rules, "kaufen", "w0")).toBeNull();
    expect(trade(w, hagen, data.rules, "kaufen", "w0")).toBeNull();
    expect(trade(w, hagen, data.rules, "kaufen", "w0")).toMatch(/\+2/);
    expect(gearOf(w, hagen.id).schaden).toBe(2);
    // Schaden mit Schmied-Bonus
    const narrator = new Narrator({ llm: null, rolls: new RollLog(), guard: new UsageGuard(new MemoryCounterStore(), 10, 100) });
    const { record } = await narrator.rollRecords({ toolUseId: "toolu_d", characterId: hagen.id, characterName: "Hagen", art: "damage", id: "waffe", sg: null, modus: "normal", grund: "x", label: "Schaden", ziel: null }, { characters: [hagen], data, world: w });
    expect(record.modifierParts.some((p) => p.label === "Schmied" && p.value === 2)).toBe(true);
    // Rüstung +1 erschwert Gegnerangriffe
    trade(w, hagen, data.rules, "kaufen", "w1");
    await runAutoTool({ id: "toolu_k", name: "kampf_beginnen", input: { gegner: [{ name: "Räuber", trefferpunkte: 9, ruestung: 11 }] } }, { data, characters: [hagen], world: w, rolls: new RollLog(), onRoll: () => {} });
    expect(w.shop).toBeNull(); // im Kampf schließt der Laden
    const atk = await runAutoTool({ id: "toolu_g", name: "gegner_greift_an", input: { gegner: "Räuber", angriffsbonus: 2, schaden: "1W4", modus: "normal" } }, { data, characters: [hagen], world: w, rolls: new RollLog(), onRoll: () => {} });
    const ac = Number(/Rüstung (\d+)/.exec(atk.content)![1]);
    expect(ac).toBeGreaterThan(0);
  });
});
