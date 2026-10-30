import path from "node:path";
import { describe, expect, it } from "vitest";
import { cleanStats, ensureInventory, fromPfennig, moneyText, rarityOf, toPfennig, useItem } from "../shared/inventory";
import { bonusParts, bonusTotal } from "../shared/shop";
import { initWorld } from "../shared/world";
import { buildCharacter } from "../server/characters";
import { RollLog } from "../server/dice/log";
import { turnSummary } from "../server/gm/summary";
import { runAutoTool } from "../server/gm/world";
import { loadGameData } from "../server/rules/loader";

const data = await loadGameData(path.resolve(__dirname, "../data"));
const mk = (name: string, classId: string, skills: string[]) =>
  buildCharacter({ name, stand: "bauer", classId, attributes: data.classes.find((c) => c.id === classId)!.recommendedAttributes, chosenSkills: skills }, data);
const hagen = mk("Hagen", "ritter", ["reiten", "wahrnehmung"]);
const agnes = mk("Agnes", "moench", ["glaube_sagen"]);
const roll = () => ({ total: 5 });
const setup = () => {
  const w = initWorld([hagen, agnes]);
  ensureInventory(w, [hagen, agnes], data.rules);
  const run = (name: string, input: object) => runAutoTool({ id: `toolu_${Math.random()}`, name, input }, { data, characters: [hagen, agnes], world: w, rolls: new RollLog(), onRoll: () => {} });
  return { w, run };
};

describe("Inventar und Geld", () => {
  it("Währung: 1 Gulden = 20 Groschen = 240 Pfennig", () => {
    expect(toPfennig({ gulden: 1, groschen: 3, pfennig: 2 })).toBe(278);
    expect(fromPfennig(278)).toEqual({ gulden: 1, groschen: 3, pfennig: 2 });
    expect(moneyText(278)).toBe("1 Gulden, 3 Groschen, 2 Pfennig");
    expect(moneyText(0, true)).toBe("0 Pf");
  });

  it("Startausrüstung und -geld kommen aus der Figur", () => {
    const { w } = setup();
    const names = w.inventory![hagen.id].items.map((i) => i.name);
    expect(names).toContain("Langschwert");
    expect(w.inventory![hagen.id].money).toBe(toPfennig(hagen.money));
  });

  it("finden, verbrauchen (nur was da ist), weitergeben", async () => {
    const { w, run } = setup();
    expect((await run("gegenstand", { figur: "Hagen", aktion: "erhalten", name: "Heiltrank", anzahl: 2, art: "trank", notiz: "heilt 1W8+2" })).is_error).toBeUndefined();
    expect(w.inventory![hagen.id].items.find((i) => i.name === "Heiltrank")).toMatchObject({ qty: 2, kind: "trank", note: "heilt 1W8+2" });
    expect((await run("gegenstand", { figur: "Hagen", aktion: "verbrauchen", name: "heiltrank" })).content).toContain("verbraucht");
    expect((await run("gegenstand", { figur: "Agnes", aktion: "verbrauchen", name: "Heiltrank" })).is_error).toBe(true);
    await run("gegenstand", { figur: "Hagen", aktion: "weitergeben", name: "Heiltrank", an: "Agnes" });
    expect(w.inventory![hagen.id].items.some((i) => i.name === "Heiltrank")).toBe(false);
    expect(w.inventory![agnes.id].items.find((i) => i.name === "Heiltrank")?.qty).toBe(1);
  });

  it("Geld: Beute wird geteilt, ausgeben nur, wenn es reicht", async () => {
    const { w, run } = setup();
    const before = [w.inventory![hagen.id].money, w.inventory![agnes.id].money];
    await run("geld", { figur: "alle", aktion: "erhalten", gulden: 1, grund: "Beute" });
    expect(w.inventory![hagen.id].money + w.inventory![agnes.id].money - before[0] - before[1]).toBe(240);
    const poor = await run("geld", { figur: "Agnes", aktion: "ausgeben", gulden: 400, grund: "Pferd" });
    expect(poor.is_error).toBe(true);
    expect(poor.content).toMatch(/reichen nicht/);
    expect((await run("geld", { figur: "Agnes", aktion: "ausgeben", pfennig: 4, grund: "Herberge" })).is_error).toBeUndefined();
  });

  it("Werte: begrenzt, Seltenheit kappt Boni, Heiltrank heilt beim Verbrauchen", async () => {
    const { w, run } = setup();
    expect(cleanStats({ angriff: 9, schaden: "1", ruestung: -2, heilung: "5W12+20" })).toEqual({ angriff: 3, schaden: 1 });
    expect(cleanStats({ heilung: "2w4 + 2" })).toEqual({ heilung: "2W4+2" });
    expect(cleanStats({ heilung: "3" })).toEqual({ heilung: "3" });
    expect(cleanStats({ notiz: "x" })).toBeUndefined();
    expect(cleanStats({ angriff: 2, schaden: 2, seltenheit: "ungewoehnlich" })).toEqual({ angriff: 2, seltenheit: "ungewoehnlich" });
    expect(cleanStats({ angriff: 3, schaden: 2, seltenheit: "sagenhaft" })).toEqual({ angriff: 3, schaden: 2, seltenheit: "sagenhaft" });
    expect(rarityOf({ stats: { angriff: 2, schaden: 1 } })).toBe("selten");
    await run("gegenstand", { figur: "Agnes", aktion: "erhalten", name: "Heiltrank", art: "trank", heilung: "3" });
    w.hp[agnes.id] = 1;
    const r = await run("gegenstand", { figur: "Agnes", aktion: "verbrauchen", name: "Heiltrank" });
    expect(r.content).toContain("heilt 3 TP");
    expect(w.hp[agnes.id]).toBe(4);
  });

  it("Ausrüsten: nur angelegte Stücke zählen, neue Waffe mit Werten ersetzt die Startwaffe", async () => {
    const { w, run } = setup();
    const inv = w.inventory![hagen.id];
    expect(inv.items.find((i) => i.name === "Langschwert")?.equipped).toBe(true);
    await run("gegenstand", { figur: "Hagen", aktion: "erhalten", name: "Streitkolben", art: "waffe", angriff: 1 });
    expect(inv.items.find((i) => i.name === "Langschwert")?.equipped).toBe(false);
    await run("gegenstand", { figur: "Hagen", aktion: "erhalten", name: "Runenschwert", art: "waffe", angriff: 2, schaden: 1 });
    expect(bonusParts(w, hagen.id, "angriff")).toEqual([{ label: "Streitkolben", value: 1 }]);
    expect(useItem(w, hagen, data.rules, "anlegen", "Runenschwert", roll)).toBeNull();
    expect(bonusParts(w, hagen.id, "angriff")).toEqual([{ label: "Runenschwert", value: 2 }]);
    await run("gegenstand", { figur: "Hagen", aktion: "erhalten", name: "Turmschild", art: "schild", ruestung: 1 });
    w.gear = { [hagen.id]: { angriff: 1, schaden: 0, ruestung: 0 } };
    expect(bonusTotal(w, hagen.id, "angriff")).toBe(3);
    expect(bonusTotal(w, hagen.id, "ruestung")).toBe(1);
    expect(turnSummary(w, [hagen, agnes], data.rules)).toContain("Runenschwert [selten, +2 Angriff, +1 Schaden, angelegt]");
    expect(useItem(w, hagen, data.rules, "anlegen", "Langschwert", roll)).toBeNull();
    expect(bonusTotal(w, hagen.id, "angriff")).toBe(1);
    expect(useItem(w, hagen, data.rules, "anlegen", "Brot", roll)).toMatch(/nicht in deinem Gepäck/);
    // Verliert man das angelegte Stück, rückt das beste übrige nach
    await run("gegenstand", { figur: "Hagen", aktion: "verlieren", name: "Langschwert" });
    expect(inv.items.find((i) => i.name === "Runenschwert")?.equipped).toBe(true);
  });

  it("Trinken per Knopf: heilt, im Kampf einmal je Runde, Claude erfährt es", async () => {
    const { w, run } = setup();
    await run("gegenstand", { figur: "Agnes", aktion: "erhalten", name: "Heiltrank", anzahl: 3, art: "trank", heilung: "2W4+2" });
    expect(useItem(w, agnes, data.rules, "trinken", "Heiltrank", roll)).toMatch(/unverletzt/);
    w.hp[agnes.id] = 1;
    w.combat = { round: 2, enemies: [] };
    expect(useItem(w, agnes, data.rules, "trinken", "Heiltrank", roll)).toBeNull();
    expect(w.hp[agnes.id]).toBe(6);
    expect(useItem(w, agnes, data.rules, "trinken", "Heiltrank", roll)).toMatch(/schon getrunken/);
    w.combat.round = 3;
    expect(useItem(w, agnes, data.rules, "trinken", "Heiltrank", roll)).toBeNull();
    expect(w.inventory![agnes.id].items.find((i) => i.name === "Heiltrank")?.qty).toBe(1);
    expect(useItem(w, agnes, data.rules, "trinken", "Langschwert", roll)).toBeTruthy();
    expect(turnSummary(w, [hagen, agnes], data.rules)).toContain("Agnes trinkt Heiltrank und heilt 5 TP");
    expect(w.itemLog).toEqual([]);
  });

  it("Claude sieht das Inventar im Spielstand – danach nur bei Änderungen", async () => {
    const { w, run } = setup();
    expect(turnSummary(w, [hagen, agnes], data.rules)).toContain("Inventar – Hagen: ");
    expect(turnSummary(w, [hagen, agnes], data.rules)).toContain("Inventar: unverändert");
    await run("gegenstand", { figur: "Agnes", aktion: "erhalten", name: "Silberkreuz", art: "schatz" });
    expect(turnSummary(w, [hagen, agnes], data.rules)).toContain("Silberkreuz");
  });
});
