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
    expect(buyPerk(r, "erprobt")).toMatch(/ausgereizt/);
    const c = { ...base, growth: g({ perks: { zaeh: 2, erspart: 1, vorrat: 1, erprobt: 1 }, heirlooms: [{ name: "Morgenrot", qty: 1, kind: "waffe", stats: { angriff: 3, schaden: 2, seltenheit: "sagenhaft" } }] }) };
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

describe("Erbstück-Truhe", () => {
  const sword = { name: "Morgenrot", qty: 1, kind: "waffe" as const, stats: { angriff: 3, seltenheit: "sagenhaft" as const } };
  const shield = { name: "Elfenschild", qty: 1, kind: "schild" as const, stats: { ruestung: 2 } };
  it("1 Platz, ab 3 bestandenen Abenteuern 2 – antippen legt hinein oder nimmt heraus", async () => {
    const { toggleHeirloom, heirloomSlots } = await import("../shared/growth");
    const one = toggleHeirloom(toggleHeirloom(g({}), sword), shield);
    expect(one.heirlooms.map((h) => h.name)).toEqual(["Elfenschild"]); // voll: ersetzt das ältere
    const vet = g({ earned: ["a", "b", "c"] });
    expect(heirloomSlots(vet)).toBe(2);
    const two = toggleHeirloom(toggleHeirloom(vet, sword), shield);
    expect(two.heirlooms.map((h) => h.name)).toEqual(["Morgenrot", "Elfenschild"]);
    expect(toggleHeirloom(two, sword).heirlooms.map((h) => h.name)).toEqual(["Elfenschild"]);
    // Beide reisen mit, der Server lässt aber nicht mehr zu, als Plätze da sind
    const c = { ...base, growth: two };
    const w = initWorld([c]);
    ensureInventory(w, [c], data.rules, data.classes);
    expect(w.inventory![c.id].items.filter((i) => ["Morgenrot", "Elfenschild"].includes(i.name))).toHaveLength(2);
    expect(() => resolveCharacter({ ...base, growth: { ...g({}), heirlooms: [sword, shield] } }, data)).toThrow();
  });
});

describe("Limit Break", () => {
  const veteran = (x: Partial<Growth> = {}) => g({ earned: ["a", "b", "c"], ...x });
  it("nach 3 Abenteuern: Vorteile über die Obergrenze, legendäre Fähigkeit erlaubt", async () => {
    const { perkMax, limitBroken } = await import("../shared/growth");
    expect(limitBroken(g({ earned: ["a", "b"] }))).toBe(false);
    expect(perkMax("erprobt", veteran())).toBe(2);
    const twice = buyPerk(buyPerk(veteran({ fame: 20 }), "erprobt") as Growth, "erprobt") as Growth;
    expect(twice.perks.erprobt).toBe(2);
    expect(buyPerk(twice, "erprobt")).toMatch(/so oft wie möglich/);
    const legend = { name: "Zorn des Ogertöters", type: "angriff" as const, uses: "einmal_pro_tag" as const, text: "Ein Schlag mit 3W8 zusätzlichem Schaden gegen einen Gegner.", beginnerText: "Ein gewaltiger Hieb." };
    expect(() => resolveCharacter({ ...base, growth: { ...g({}), legend } }, data)).toThrow(); // vor dem Limit Break
    const c = resolveCharacter({ ...base, growth: { ...veteran(), legend } }, data).c;
    const w = initWorld([c]);
    expect(useAbility(w, c, data.classes, "Zorn des Ogertöters").error).toBeUndefined();
    expect(w.abilityUses![c.id].legende).toBe(1);
  });

  it("Meisterschaft III: nach dem Limit Break ab 50 Einsätzen verstärkte Wirkung", () => {
    expect(masteryInfo("einmal_pro_tag", 60, false)).toMatchObject({ level: 2, max: 2, locked: true, boost: false });
    expect(masteryInfo("einmal_pro_tag", 30, true)).toMatchObject({ level: 2, max: 3, next: 50, then: expect.stringContaining("Meisterschaft III") });
    expect(masteryInfo("einmal_pro_tag", 50, true)).toMatchObject({ level: 3, boost: true, next: null });
    const cls = data.classes.find((c) => c.id === "ritter")!;
    const a = cls.abilities.find((x) => x.uses === "einmal_pro_kampf")!;
    const c = { ...base, growth: veteran({ uses: { alt: { [a.id]: 55 } } }) };
    const boosted = applyMastery(cls.abilities, c, initWorld([c])).find((x) => x.id === a.id)!;
    expect(boosted.uses).toBe("zweimal_pro_kampf");
    expect(boosted.text).toContain("Meisterschaft III");
  });
});

describe("Erwachende Erbstücke", () => {
  it("nach jedem mitgemachten Abenteuer +1, Seltenheit steigt mit", async () => {
    const { awakenHeirloom } = await import("../shared/growth");
    let sword: Growth["heirlooms"][number] = { name: "Altes Schwert", qty: 1, kind: "waffe" };
    const steps: string[] = [];
    for (let i = 0; i < 7; i++) { sword = awakenHeirloom(sword); steps.push(`${sword.stats?.angriff ?? 0}/${sword.stats?.schaden ?? 0}:${sword.stats?.seltenheit}`); }
    expect(steps).toEqual(["1/0:gewoehnlich", "1/1:ungewoehnlich", "2/1:selten", "2/2:sagenhaft", "3/2:sagenhaft", "3/3:sagenhaft", "3/3:sagenhaft"]);
    expect(awakenHeirloom({ name: "Krug", qty: 1, kind: "schatz" })).toEqual({ name: "Krug", qty: 1, kind: "schatz" });
    // Am Ende eines Abenteuers wacht das Erbstück in der Truhe auf
    const w = initWorld([base]);
    w.arc = { ...w.arc!, finished: true, outcome: "sieg" };
    const c = { ...base, growth: g({ heirlooms: [{ name: "Turmschild", qty: 1, kind: "schild", stats: { ruestung: 1 } }] }) };
    expect(growthOf(syncGrowth(c, w)!).heirlooms[0].stats).toMatchObject({ ruestung: 2, seltenheit: "ungewoehnlich" });
  });
});

describe("Machtstufe", () => {
  it("Claude erfährt die Stärke erfahrener Figuren – nur wenn eingeschaltet", async () => {
    const { powerHint, powerScore } = await import("../shared/growth");
    const vet = { ...base, growth: g({ earned: ["a", "b", "c", "d"], perks: { zaeh: 3, erprobt: 2 } }) };
    expect(powerScore(vet)).toBe(4 + 5 + 3);
    expect(powerHint([vet], "aus")).toBe("");
    expect(powerHint([vet], "angepasst")).toContain("Machtstufe: Makkalot 12");
    expect(powerHint([vet], "hart")).toContain("deutlich stärker");
    expect(powerHint([base], "angepasst")).toBe("");
    const { turnSummary } = await import("../server/gm/summary");
    const w = initWorld([vet]);
    w.powerScaling = "hart";
    expect(turnSummary(w, [vet], data.rules)).toContain("Machtstufe");
  });
});

describe("Legendäre Fähigkeit erwecken", () => {
  it("erst nach dem Limit Break, Ergebnis wird geprüft", async () => {
    const { GameMaster } = await import("../server/gm/engine");
    const { MemoryCounterStore, UsageGuard } = await import("../server/gm/usage");
    const reply = JSON.stringify({ name: "Zorn des Ogertöters", type: "angriff", uses: "einmal_pro_tag", text: "Ein Schlag mit 3W8 zusätzlichem Schaden gegen einen Gegner.", beginnerText: "Ein gewaltiger Hieb." });
    const calls: unknown[] = [];
    const llm = { stream: async (p: unknown) => { calls.push(p); return { id: "m", type: "message", role: "assistant", model: "fake", stop_reason: "end_turn", usage: { input_tokens: 500, output_tokens: 100 }, content: [{ type: "text", text: reply }] }; } };
    const gm = new GameMaster({ data: () => data, llm: llm as never, rolls: new RollLog(), guard: new UsageGuard(new MemoryCounterStore(), 10, 100), secret: "s".repeat(20) });
    const run = async (c: unknown) => { const evs: { type: string; legend?: { name: string }; message?: string }[] = []; await gm.run("legend", { character: c, titles: ["Retter von Falkenstein"] }, "t", (e) => evs.push(e as never)); return evs; };
    expect((await run(base))[0]).toMatchObject({ type: "error" });
    expect(calls).toHaveLength(0);
    const evs = await run({ ...base, growth: g({ earned: ["a", "b", "c"] }) });
    expect(evs[0]).toMatchObject({ type: "legend", legend: { name: "Zorn des Ogertöters" } });
    expect(JSON.stringify(calls[0])).toContain("Retter von Falkenstein");
  });
});
