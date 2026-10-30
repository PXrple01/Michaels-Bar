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
    const reply = JSON.stringify({ optionen: [
      { name: "Zorn des Ogertöters", type: "angriff", uses: "einmal_pro_tag", text: "Ein Schlag mit 3W8 zusätzlichem Schaden gegen einen Gegner.", beginnerText: "Ein gewaltiger Hieb.", beiname: "der Ogertöter" },
      { name: "Schild der Gefallenen", type: "verteidigung", uses: "einmal_pro_kampf", text: "Alle Verbündeten erhalten bis zum Ende der Runde +3 Rüstung.", beginnerText: "Du schützt deine Freunde.", beiname: "der Unbeugsame" },
      { name: "kaputt" },
    ] });
    const calls: unknown[] = [];
    const llm = { stream: async (p: unknown) => { calls.push(p); return { id: "m", type: "message", role: "assistant", model: "fake", stop_reason: "end_turn", usage: { input_tokens: 500, output_tokens: 100 }, content: [{ type: "text", text: reply }] }; } };
    const gm = new GameMaster({ data: () => data, llm: llm as never, rolls: new RollLog(), guard: new UsageGuard(new MemoryCounterStore(), 10, 100), secret: "s".repeat(20) });
    const run = async (c: unknown) => { const evs: { type: string; options?: { name: string }[]; message?: string }[] = []; await gm.run("legend", { character: c, titles: ["Retter von Falkenstein"] }, "t", (e) => evs.push(e as never)); return evs; };
    expect((await run(base))[0]).toMatchObject({ type: "error" });
    expect(calls).toHaveLength(0);
    const evs = await run({ ...base, growth: g({ earned: ["a", "b", "c"] }) });
    expect(evs[0].type).toBe("legend");
    expect(evs[0].options!.map((o) => o.name)).toEqual(["Zorn des Ogertöters", "Schild der Gefallenen"]); // ungültige fallen weg
    expect(JSON.stringify(calls[0])).toContain("Retter von Falkenstein");
  });
});

describe("Beiname", () => {
  it("nach dem Limit Break trägt die Figur ihren Beinamen", async () => {
    const { fullName } = await import("../shared/growth");
    expect(fullName({ ...base, growth: g({ earned: ["a", "b", "c"], epithet: "der Unbändige" }) })).toBe("Makkalot der Unbändige");
    expect(fullName(base)).toBe("Makkalot");
    expect(() => resolveCharacter({ ...base, growth: { ...g({}), epithet: "der Unbändige" } }, data)).toThrow();
  });
});

describe("Limit Break II", () => {
  const legend = { name: "Zorn des Ogertöters", type: "angriff" as const, uses: "einmal_pro_tag" as const, text: "Ein Schlag mit 3W8 zusätzlichem Schaden gegen einen Gegner.", beginnerText: "Ein gewaltiger Hieb." };
  const legend2 = { name: "Sturm der Krone", type: "kontrolle" as const, uses: "einmal_pro_rast" as const, text: "Alle Gegner in der Nähe sind eine Runde lang benommen.", beginnerText: "Ein Schrei, der Heere erstarren lässt." };
  it("ab 7 Abenteuern: Stufe 2, drei Truhenplätze, zweite legendäre Fähigkeit", async () => {
    const { limitTier, heirloomSlots, legendAbilities } = await import("../shared/growth");
    const seven = ["a", "b", "c", "d", "e", "f", "g"];
    expect(limitTier(g({ earned: seven.slice(0, 2) }))).toBe(0);
    expect(limitTier(g({ earned: seven.slice(0, 3) }))).toBe(1);
    expect(limitTier(g({ earned: seven }))).toBe(2);
    expect(heirloomSlots(g({ earned: seven }))).toBe(3);
    expect(() => resolveCharacter({ ...base, growth: { ...g({ earned: seven.slice(0, 5) }), legend, legend2 } }, data)).toThrow();
    const c = resolveCharacter({ ...base, growth: { ...g({ earned: seven }), legend, legend2 } }, data).c;
    expect(legendAbilities(c).map((l) => l.id)).toEqual(["legende", "legende2"]);
    expect(useAbility(initWorld([c]), c, data.classes, "Sturm der Krone").error).toBeUndefined();
  });

  it("Legenden zahlen beim Händler 10 % weniger", async () => {
    const { trade } = await import("../shared/shop");
    const vet = { ...base, growth: g({ earned: ["a", "b", "c"] }) };
    const w = initWorld([vet]);
    w.shop = { name: "Krämer", kind: "haendler", wares: [{ id: "w0", name: "Heiltrank", kind: "trank", price: 100 }], log: [] };
    ensureInventory(w, [vet], data.rules, data.classes);
    const before = w.inventory![vet.id].money;
    expect(trade(w, vet, data.rules, "kaufen", "w0")).toBeNull();
    expect(before - w.inventory![vet.id].money).toBe(90);
    expect(w.shop.log[0]).toContain("Legenden-Rabatt");
  });
});

describe("Limit-Angriff", () => {
  it("einmal pro Abenteuer im Kampf: garantierter kritischer Treffer", async () => {
    const { armLimitAttack, canLimitAttack } = await import("../shared/growth");
    const { Narrator } = await import("../server/gm/narrator");
    const { MemoryCounterStore, UsageGuard } = await import("../server/gm/usage");
    const vet = { ...base, growth: g({ earned: ["a", "b", "c"] }) };
    const w = initWorld([vet]);
    expect(armLimitAttack(w, vet)).toMatch(/nur im Kampf/);
    expect(armLimitAttack(initWorld([base]), base)).toMatch(/erst nach dem Limit Break/);
    w.combat = { round: 1, enemies: [{ id: "o", name: "Oger", hp: 200, maxHp: 200, armor: 30 }] };
    expect(canLimitAttack(w, vet)).toBe(true);
    expect(armLimitAttack(w, vet)).toBeNull();
    expect(canLimitAttack(w, vet)).toBe(false);
    expect(armLimitAttack(w, vet)).toMatch(/schon verbraucht/);
    const narrator = new Narrator({ llm: null, rolls: new RollLog(), guard: new UsageGuard(new MemoryCounterStore(), 10, 60) });
    const pending = { toolUseId: "toolu_la", characterId: vet.id, characterName: vet.name, art: "attack" as const, id: "waffe", sg: 30, modus: "normal" as const, grund: "Limit", label: "Angriff", ziel: "Oger" };
    const scene = { characters: [vet], data, world: w };
    const { record, damage } = await narrator.rollRecords(pending, scene);
    expect(record.success).toBe(true); // Rüstung 30 – ohne Limit kaum zu treffen
    expect(record.modifierParts).toContainEqual({ label: "Limit-Angriff", value: 20 });
    expect(damage?.label).toContain("kritisch");
    expect(damage?.modifierParts).toContainEqual({ label: "Limit-Angriff", value: 5 });
    const { result } = narrator.applyRolls(pending, scene, record, damage);
    expect(String(result.content)).toContain("LIMIT-ANGRIFF");
    expect(w.limitArmed?.[vet.id]).toBeUndefined();
  });
});

describe("Legendäre Fähigkeiten im Abenteuer verbessern", () => {
  it("stehen bei den Verbesserungen zur Auswahl und die Verbesserung wirkt", async () => {
    const { withLegends } = await import("../shared/growth");
    const { abilitiesOf } = await import("../shared/abilityUses");
    const legend = { name: "Zorn des Ogertöters", type: "angriff" as const, uses: "einmal_pro_tag" as const, text: "Ein Schlag mit 3W8 zusätzlichem Schaden gegen einen Gegner.", beginnerText: "Ein gewaltiger Hieb." };
    const c = { ...base, growth: g({ earned: ["a", "b", "c"], legend }) };
    const cls = data.classes.find((x) => x.id === "ritter")!;
    expect(withLegends(cls.abilities, c).map((a) => a.id)).toContain("legende");
    const w = initWorld([c]);
    w.progress = { [c.id]: { abilities: ["legende", cls.abilities[0].id], chosen: [{ abilityId: "legende", tier: 1, basedOn: legend.name, name: "Zorn des Ogertöters II", text: "Ein Schlag mit 4W8 zusätzlichem Schaden; der Gegner ist benommen.", beginnerText: "Ein noch gewaltigerer Hieb.", uses: "einmal_pro_tag", scope: "breit" }] as never, offer: null } as never };
    const up = abilitiesOf(c, data.classes, w).find((a) => a.id === "legende")!;
    expect(up.name).toBe("Zorn des Ogertöters II");
    expect((up as { legendary?: boolean }).legendary).toBe(true);
  });
});

describe("Herausforderungen", () => {
  it("ohne Heiltränke, harte Gegner, ohne Limit-Angriff – und doppelter Ruhm", async () => {
    const { armLimitAttack, cleanChallenges } = await import("../shared/growth");
    const { trade } = await import("../shared/shop");
    expect(cleanChallenges(["keine_traenke", "quatsch", "keine_traenke"])).toEqual(["keine_traenke"]);
    const w = initWorld([base]);
    w.challenges = ["keine_traenke", "harte_gegner", "ohne_limit"];
    ensureInventory(w, [base], data.rules, data.classes);
    expect(w.inventory![base.id].items.some((i) => i.kind === "trank")).toBe(false);
    w.shop = { name: "Krämer", kind: "haendler", wares: [{ id: "w0", name: "Heiltrank", kind: "trank", price: 12 }], log: [] };
    expect(trade(w, base, data.rules, "kaufen", "w0")).toMatch(/Ohne Heiltränke/);
    await runAutoTool({ id: "toolu_k", name: "kampf_beginnen", input: { gegner: [{ name: "Wolf", trefferpunkte: 8, ruestung: 11 }] } }, { data, characters: [base], world: w, rolls: new RollLog(), onRoll: () => {} });
    expect(w.combat!.enemies[0]).toMatchObject({ hp: 10, armor: 13 });
    const vet = { ...base, growth: g({ earned: ["a", "b", "c"] }) };
    expect(armLimitAttack(w, vet)).toMatch(/gesperrt|Herausforderung/);
    w.arc = { ...w.arc!, finished: true, outcome: "sieg" };
    expect(growthOf(syncGrowth(base, w)).fame).toBe(6);
  });
});

describe("Besiegte Gegner", () => {
  it("wer den letzten Treffer setzt, bekommt den Sieg gezählt – auch über Abenteuer hinweg", async () => {
    const { applyPlayerRoll } = await import("../server/gm/world");
    const { totalKills } = await import("../shared/growth");
    const w = initWorld([base]);
    w.combat = { round: 1, enemies: [{ id: "a", name: "Wolf", hp: 3, maxHp: 3, armor: 10 }, { id: "b", name: "Bär", hp: 30, maxHp: 30, armor: 10 }] };
    const hit = (total: number, ziel: string) => applyPlayerRoll({ data, characters: [base], world: w }, base.id, "damage", ziel, { total } as never);
    hit(5, "Wolf"); hit(5, "Wolf"); hit(5, "Bär");
    expect(w.kills?.[base.id]).toBe(1);
    const synced = syncGrowth({ ...base, growth: g({ kills: { alt: 4 } }) }, w)!;
    expect(totalKills(synced)).toBe(5);
  });
});

describe("Gefährte fürs Leben", () => {
  it("kommt ins nächste Abenteuer mit und zählt die gemeinsamen Reisen", async () => {
    const { companionLevel } = await import("../shared/growth");
    expect([0, 1, 2, 3, 4, 9, 50].map(companionLevel)).toEqual([1, 1, 2, 2, 3, 5, 5]);
    const c = { ...base, growth: g({ companion: { name: "Grete", role: "Kräuterfrau", skill: "heilt Wunden", journeys: 3 } }) };
    expect(growthSchema.safeParse(c.growth).success).toBe(true);
    const w = initWorld([c]);
    expect(w.companions).toEqual([expect.objectContaining({ name: "Grete", loyalty: 5, skill: expect.stringContaining("Gefährten-Stufe 2") })]);
    w.arc = { ...w.arc!, finished: true, outcome: "sieg" };
    expect(growthOf(syncGrowth(c, w)).companion?.journeys).toBe(4);
    // nicht mehr dabei (z. B. unterwegs verloren) – keine Reise gezählt
    w.companions = [];
    expect(growthOf(syncGrowth(c, w)).companion?.journeys).toBe(3);
  });
});
