import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyMastery, buyPerk, growthOf, growthSchema, masteryInfo, masteryUses, syncGrowth, type Growth } from "../shared/growth";
import { useAbility } from "../shared/abilityUses";
import { ensureInventory } from "../shared/inventory";
import { bonusParts } from "../shared/shop";
import { initWorld } from "../shared/world";
import { buildCharacter, resolveCharacter } from "../server/characters";
import { RollLog } from "../server/dice/log";
import { runAutoTool } from "../server/gm/world";
import { loadGameData } from "../server/rules/loader";

const data = await loadGameData(path.resolve(__dirname, "../data"));
const base = buildCharacter({ name: "Makkalot", stand: "bauer", classId: "ritter", attributes: data.classes.find((c) => c.id === "ritter")!.recommendedAttributes, chosenSkills: ["reiten", "wahrnehmung"] }, data);
const g = (x: Partial<Growth>): Growth => ({ ...growthOf(null), ...x });

describe("Ruhm", () => {
  it("Vorteile kosten Ruhm, haben eine Obergrenze und wirken zu Beginn des nächsten Abenteuers", () => {
    expect(buyPerk(g({ fame: 1 }), "zaeh")).toMatch(/fehlt Ruhm/);
    const r = buyPerk(g({ fame: 9 }), "erprobt") as Growth;
    expect(r).toMatchObject({ fame: 5, perks: { erprobt: 1 } });
    expect(buyPerk(r, "erprobt")).toMatch(/so oft wie möglich/);
    const c = { ...base, growth: g({ perks: { zaeh: 2, erspart: 1, vorrat: 1, erprobt: 1 }, heirloom: { name: "Morgenrot", qty: 1, kind: "waffe", stats: { angriff: 3, schaden: 2, seltenheit: "sagenhaft" } } }) };
    const w = initWorld([c]);
    expect(w.maxHp[c.id]).toBe(base.hp.max + 4);
    expect(bonusParts(w, c.id, "angriff")).toContainEqual({ label: "Kampferprobt", value: 1 });
    ensureInventory(w, [c], data.rules, data.classes);
    const inv = w.inventory![c.id];
    expect(inv.money).toBe(240 + Math.round((base.money.gulden * 240) + base.money.groschen * 12 + base.money.pfennig));
    expect(inv.items.find((i) => i.name === "Heiltrank")).toBeTruthy();
    expect(inv.items.find((i) => i.name === "Morgenrot")).toMatchObject({ equipped: true, stats: { angriff: 3, schaden: 2, seltenheit: "sagenhaft" } });
  });

  it("der Server prüft die Entwicklung an der Figur", () => {
    expect(resolveCharacter({ ...base, growth: g({ fame: 3, perks: { erprobt: 1 } }) }, data).c.growth?.perks.erprobt).toBe(1);
    expect(() => resolveCharacter({ ...base, growth: { ...g({}), perks: { erprobt: 5 } } }, data)).toThrow();
    expect(() => resolveCharacter({ ...base, growth: { ...g({}), perks: { fliegen: 1 } } }, data)).toThrow();
    expect(growthSchema.safeParse({ ...g({}), fame: 1000 }).success).toBe(false);
  });

  it("am Ende eines Abenteuers gibt es einmal Ruhm (Sieg 3, Niederlage 1)", () => {
    const w = initWorld([base]);
    w.arc = { ...w.arc!, finished: true, outcome: "sieg" };
    const once = syncGrowth(base, w)!;
    expect(growthOf(once).fame).toBe(3);
    expect(syncGrowth(once, w)).toBeNull();
  });
});

describe("Meisterschaft", () => {
  it("Einsätze zählen über Abenteuer; ab 8 bzw. 20 wird die Fähigkeit häufiger einsetzbar", () => {
    expect(masteryInfo("passiv", 50)).toBeNull();
    expect(masteryInfo("einmal_pro_tag", 3)).toMatchObject({ level: 0, next: 8, now: "1× pro Tag", then: "1× pro Rast" });
    expect(masteryInfo("einmal_pro_tag", 20)).toMatchObject({ level: 2, next: null, now: "1× pro Kampf" });
    expect(masteryInfo("einmal_pro_rast", 9)).toMatchObject({ level: 1, max: 2, next: 20, now: "1× pro Kampf", then: "2× pro Kampf" });
    expect(masteryInfo("einmal_pro_kampf", 0)).toMatchObject({ level: 0, max: 1, next: 8, then: "2× pro Kampf" });
    expect(masteryInfo("einmal_pro_kampf", 30)).toMatchObject({ level: 1, max: 1, next: null, now: "2× pro Kampf" });
    const cls = data.classes.find((c) => c.id === "ritter")!;
    const limited = cls.abilities.find((a) => a.uses === "einmal_pro_rast" || a.uses === "einmal_pro_tag")!;
    const c = { ...base, growth: g({ uses: { "frueheres-abenteuer": { [limited.id]: 7 } } }) };
    const w = initWorld([c]);
    expect(masteryUses(c, w, limited.id)).toBe(7);
    expect(useAbility(w, c, data.classes, limited.name).error).toBeUndefined();
    expect(w.abilityUses![c.id][limited.id]).toBe(1);
    expect(masteryUses(c, w, limited.id)).toBe(8);
    expect(applyMastery(cls.abilities, c, w).find((a) => a.id === limited.id)?.mastery).toBe(1);
    // Nach dem Zug landet der Stand an der Figur – ohne doppelt zu zählen
    const synced = syncGrowth(c, w)!;
    expect(masteryUses(synced, w, limited.id)).toBe(8);
  });
});

describe("Narben", () => {
  it("wer im Kampf zu Boden geht, trägt eine Narbe davon – höchstens eine je Abenteuer", async () => {
    const w = initWorld([base]);
    const ctx = { data, characters: [base], world: w, rolls: new RollLog(), onRoll: () => {} };
    await runAutoTool({ id: "toolu_k", name: "kampf_beginnen", input: { gegner: [{ name: "Oger", trefferpunkte: 40, ruestung: 14 }] } }, ctx);
    for (let i = 0; i < 12 && w.hp[base.id] > 0; i++) await runAutoTool({ id: `toolu_a${i}`, name: "gegner_greift_an", input: { gegner: "Oger", angriffsbonus: 8, schaden: "2W12+5", modus: "advantage" } }, ctx);
    expect(w.hp[base.id]).toBe(0);
    expect(w.scars?.[base.id]).toEqual([{ name: "Narbe von Oger", text: expect.stringContaining("Einschüchtern") }]);
    const synced = syncGrowth(base, w)!;
    expect(growthOf(synced).scars).toHaveLength(1);
  });
});

describe("Gemeistert: 2× pro Kampf", () => {
  it("eine 1×-pro-Kampf-Fähigkeit geht nach 8 Einsätzen zweimal je Kampf", () => {
    const cls = data.classes.find((c) => c.id === "ritter")!;
    const a = cls.abilities.find((x) => x.uses === "einmal_pro_kampf")!;
    const c = { ...base, growth: g({ uses: { alt: { [a.id]: 8 } } }) };
    const w = initWorld([c]);
    expect(useAbility(w, c, data.classes, a.name).error).toBeUndefined();
    expect(useAbility(w, c, data.classes, a.name).text).toContain("zweites Mal");
    expect(useAbility(w, c, data.classes, a.name).error).toBe(true);
  });
});
