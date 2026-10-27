import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { GmEvent, SignedState } from "../shared/campaign";
import type { PartyEvent, PartyView } from "../shared/party";
import { checkUpgrade, effectiveAbilities, fallbackUpgrade, upgradeDue, type UpgradeDraft } from "../shared/upgrades";
import { initWorld, worldSummary, type WorldState } from "../shared/world";
import { buildCharacter } from "../server/characters";
import { RollLog } from "../server/dice/log";
import { GameMaster, type LlmClient } from "../server/gm/engine";
import { TOOLSET } from "../server/gm/narrator";
import { MemoryPartyStore, PartyService } from "../server/gm/party";
import { characterHash, signState } from "../server/gm/state";
import { MemoryCounterStore, UsageGuard } from "../server/gm/usage";
import { runAutoTool } from "../server/gm/world";
import { loadGameData } from "../server/rules/loader";

const data = await loadGameData(path.resolve(__dirname, "../data"));
const SECRET = "test-secret-0123456789";
const mk = (name: string, classId: string, skills: string[]) =>
  buildCharacter({ name, stand: "bauer", classId, attributes: data.classes.find((c) => c.id === classId)!.recommendedAttributes, chosenSkills: skills }, data);
const hexeClass = data.classes.find((c) => c.id === "kraeuterhexe")!;
const hexe = mk("Grete", "kraeuterhexe", hexeClass.skillChoices.from.slice(0, hexeClass.skillChoices.count));
const moench = mk("Agnes", "moench", ["glaube_sagen"]);
const ability = (classId: string, id: string) => data.classes.find((c) => c.id === classId)!.abilities.find((a) => a.id === id)!;
const none = { extraDamage: "", heal: "", bonusDie: "", flatBonus: 0, advantage: false, imposeDisadvantage: false, armorBonus: 0, attackBonus: 0 };

type Params = Parameters<LlmClient["stream"]>[0];
class FakeLlm implements LlmClient {
  calls: Params[] = [];
  constructor(private replies: Partial<Anthropic.Beta.BetaMessage>[]) {}
  async stream(params: Params, onText: (t: string) => void) {
    this.calls.push(structuredClone(params));
    const r = this.replies.shift() ?? { content: [{ type: "text", text: "…", citations: null }] as Anthropic.Beta.BetaContentBlock[] };
    for (const b of r.content ?? []) if (b.type === "text" && !(params as { output_config?: { format?: unknown } }).output_config?.format) onText(b.text);
    return { id: "m", type: "message", role: "assistant", model: "fake", stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 50 }, ...r } as Anthropic.Beta.BetaMessage;
  }
}
const json = (v: object) => ({ content: [{ type: "text", text: JSON.stringify(v), citations: null }] as Anthropic.Beta.BetaContentBlock[] });
const text = (t: string) => ({ content: [{ type: "text", text: t, citations: null }] as Anthropic.Beta.BetaContentBlock[] });

/** Eine Welt mitten im Akt „Mitte“ mit genug Erfahrung. */
async function midWorld(chars: { id: string; hp: { max: number } }[], xp = 250): Promise<WorldState> {
  const w = initWorld(chars as never);
  const ch = (t: string) => ({ titel: t, ziel: `${t} erreicht` });
  const ctx = { data, characters: chars as never, world: w, rolls: new RollLog(), onRoll: () => {} };
  await runAutoTool({ id: "toolu_p", name: "kampagne_planen", input: { ziel: "Z", bedrohung: "B", anfang: [ch("A1"), ch("A2")], mitte: [ch("M1"), ch("M2"), ch("M3")], finale: [ch("F1"), ch("F2")] } }, ctx);
  await runAutoTool({ id: "toolu_k1", name: "kapitel_abschliessen", input: { rueckblick: "x" } }, ctx);
  await runAutoTool({ id: "toolu_k2", name: "kapitel_abschliessen", input: { rueckblick: "x" } }, ctx);
  for (const c of chars) w.xp[c.id] = xp;
  return w;
}

describe("Verbesserungen: Regeln", () => {
  it("Giftkunde → Giftblut: lohnend und erlaubt; zu stark, zu schwach oder verboten wird abgelehnt", () => {
    const gift = ability("kraeuterhexe", "giftkunde");
    const giftblut: UpgradeDraft = { name: "Giftblut", text: "Gift kann dir kaum schaden. Wer dich im Nahkampf trifft, erleidet 1W4 Giftschaden.", beginnerText: "Gift prallt an dir ab – und vergiftet, wer dich schlägt.", uses: "passiv", scope: "breit", situational: false, mechanics: { ...none, extraDamage: "1W4" } };
    const ok = checkUpgrade(gift, giftblut, 1, data.rules);
    expect(ok.errors).toEqual([]);
    expect(ok.upgrade!.points).toBeGreaterThanOrEqual(0.5);
    expect(ok.upgrade!.points).toBeLessThanOrEqual(3);
    expect(checkUpgrade(gift, { ...giftblut, mechanics: { ...none, extraDamage: "2W12", attackBonus: 2, advantage: true } }, 1, data.rules).errors.join()).toMatch(/Zu stark/);
    expect(checkUpgrade(gift, { ...giftblut, scope: "eng", mechanics: none }, 1, data.rules).errors.join()).toMatch(/Zu schwach/);
    expect(checkUpgrade(gift, { ...giftblut, text: "Du bist unverwundbar gegen Gift." }, 1, data.rules).errors.join()).toMatch(/Spielbrechend/);
    // Riesige Würfel werden erst auf die Grenzen gekürzt – und sind danach immer noch zu stark
    expect(checkUpgrade(gift, { ...giftblut, mechanics: { ...none, extraDamage: "9W20+9" } }, 1, data.rules).errors.join()).toMatch(/Zu stark/);
  });

  it("freigeschaltet wird im Akt Mitte mit genug Erfahrung – oder spätestens im letzten Kapitel des Akts", async () => {
    const early = initWorld([hexe]);
    early.xp[hexe.id] = 999;
    expect(upgradeDue(early, hexe.id)).toBeNull(); // noch kein Plan / Anfang
    const w = await midWorld([hexe], 50);
    expect(upgradeDue(w, hexe.id)).toBeNull(); // Mitte, aber zu wenig Erfahrung
    w.xp[hexe.id] = 200;
    expect(upgradeDue(w, hexe.id)).toBe(1);
    w.xp[hexe.id] = 50;
    w.arc!.current = 4; // letztes Kapitel der Mitte
    expect(upgradeDue(w, hexe.id)).toBe(1);
    w.progress = { [hexe.id]: { abilities: ["giftkunde", "boeser_blick"], chosen: [{ abilityId: "giftkunde" } as never], offer: null } };
    expect(upgradeDue(w, hexe.id)).toBeNull(); // Stufe 2 erst im Finale
    w.arc!.current = 5;
    w.xp[hexe.id] = 600;
    expect(upgradeDue(w, hexe.id)).toBe(2);
    // Keine zweite Stufe: Gibt es nur eine verbesserbare Fähigkeit, entfällt die zweite Freischaltung
    w.progress[hexe.id].abilities = ["giftkunde", "giftkunde"];
    expect(upgradeDue(w, hexe.id)).toBeNull();
  });
});

describe("Ersatz-Verbesserung", () => {
  it("lohnt sich für jede Grundfähigkeit und bleibt im Rahmen", () => {
    for (const cls of data.classes) for (const a of cls.abilities) {
      const fb = fallbackUpgrade(a, 1, data.rules);
      expect(fb.points, `${cls.id}/${a.id}`).toBeGreaterThanOrEqual(0.5);
      expect(fb.points, `${cls.id}/${a.id}`).toBeLessThanOrEqual(3);
    }
  });
});

describe("Verbesserungen im Solo-Spiel", () => {
  const options = [
    { name: "Giftblut", text: "Gift kann dir kaum schaden. Wer dich im Nahkampf trifft, erleidet 1W4 Giftschaden.", beginnerText: "Gift prallt ab – und vergiftet Angreifer.", uses: "passiv", scope: "breit", passtZurLage: false, ...none, extraDamage: "1W4" },
    { name: "Giftmischerin", text: "Einmal pro Kampf bestreichst du eine Waffe: +1W6 Giftschaden beim nächsten Treffer.", beginnerText: "Du vergiftest eine Klinge.", uses: "einmal_pro_kampf", scope: "breit", passtZurLage: true, ...none, extraDamage: "1W6" },
  ];

  function setup(replies: Partial<Anthropic.Beta.BetaMessage>[]) {
    const llm = new FakeLlm(replies);
    const gm = new GameMaster({ data: () => data, llm, rolls: new RollLog(), guard: new UsageGuard(new MemoryCounterStore(), 10, 100), secret: SECRET });
    const run = async (kind: "turn" | "upgrade" | "choose", body: unknown) => { const evs: GmEvent[] = []; await gm.run(kind, body, "t", (e) => evs.push(e)); return evs.at(-1)!; };
    return { llm, run };
  }
  const stateFor = (w: WorldState): SignedState => ({ ...signState(SECRET, { messages: [{ role: "user", content: "Start" }, { role: "assistant", content: [{ type: "text", text: "Der Räuber schlägt zu, Grete stürzt." }] }], world: w, held: [], toolset: TOOLSET }, characterHash(hexe)), model: "claude-opus-5-5" });

  it("freischalten → zwei Verbesserungen → eine wählen → gilt ab sofort und Claude kennt sie", async () => {
    const w = await midWorld([hexe]);
    w.combat = { round: 2, enemies: [{ id: "e", name: "Räuber", hp: 5, maxHp: 9, armor: 11 }] };
    w.hp[hexe.id] = 0;
    const { llm, run } = setup([json({ auswahl: { erste: "giftkunde", zweite: "boeser_blick" }, optionen: options }), text("Weiter.")]);

    const up = (await run("upgrade", { character: hexe, state: stateFor(w) })) as Extract<GmEvent, { type: "upgrade" }>;
    expect(up.type).toBe("upgrade");
    expect(up.offer!.abilityId).toBe("giftkunde");
    expect(up.offer!.options.map((o) => o.name)).toEqual(["Giftblut", "Giftmischerin"]);
    expect(up.offer!.options[1].situational).toBe(true);
    const prompt = llm.calls[0].messages[0].content as string;
    expect(prompt).toContain("Gerade läuft ein Kampf");
    expect(prompt).toContain("am Boden");
    expect(prompt).toContain("Der Räuber schlägt zu");
    expect(up.state.world!.progress![hexe.id].abilities).toEqual(["giftkunde", "boeser_blick"]);

    expect((await run("upgrade", { character: hexe, state: up.state })).type).toBe("error"); // liegt schon bereit
    expect((await run("choose", { character: hexe, state: up.state, option: 5 })).type).toBe("error");
    const chosen = (await run("choose", { character: hexe, state: up.state, option: 0 })) as Extract<GmEvent, { type: "upgrade" }>;
    expect(chosen.offer).toBeNull();
    const prog = chosen.state.world!.progress![hexe.id];
    expect(prog.chosen.map((u) => u.name)).toEqual(["Giftblut"]);
    expect(effectiveAbilities(data.classes.find((c) => c.id === "kraeuterhexe")!.abilities, prog).find((a) => a.id === "giftkunde")!.name).toBe("Giftblut");
    expect(worldSummary(chosen.state.world!, [hexe])).toContain("„Giftblut“ (verbesserte Fassung von „Giftkunde“");
    expect((await run("upgrade", { character: hexe, state: chosen.state })).type).toBe("error"); // Stufe 2 erst im Finale
    // Im Finale ist die zweite Fähigkeit geplant – ohne Empfehlung gibt es nur sie
    const fin = structuredClone(chosen.state.world!);
    fin.arc!.current = 5;
    fin.xp[hexe.id] = 600;
    const fluch = { ...options[1], name: "Fluchblick", text: "Wie Böser Blick; das Opfer verliert zusätzlich 1W4 TP.", extraDamage: "1W4", imposeDisadvantage: true };
    const fluch2 = { ...fluch, name: "Lähmender Blick", text: "Wie Böser Blick; zusätzlich +1 auf deinen nächsten Wurf gegen das Opfer.", extraDamage: "", flatBonus: 1 };
    const llm2 = setup([json({ auswahl: { erste: "giftkunde", zweite: "giftkunde" }, optionen: [fluch, fluch2], empfehlung: "geplant", optionenZweiteStufe: [] })]);
    const up2 = (await llm2.run("upgrade", { character: hexe, state: stateFor(fin) })) as Extract<GmEvent, { type: "upgrade" }>;
    expect(up2.offer!.tier).toBe(2);
    expect(up2.offer!.abilityId).toBe("boeser_blick");
    expect(up2.offer!.recommended).toBeUndefined();
    expect(up2.offer!.options.every((o) => o.abilityId === "boeser_blick")).toBe(true);

    // Empfiehlt Claude die schon verbesserte Fähigkeit, entscheidet der Spieler zwischen beiden Wegen
    const venom = { ...options[0], name: "Giftdorn", text: "Giftblut; zusätzlich einmal pro Kampf: Wer dich trifft, hat Nachteil auf seinen nächsten Angriff.", imposeDisadvantage: true };
    const venom2 = { ...options[0], name: "Schlangenblut", text: "Giftblut; der Giftschaden steigt auf 1W6.", extraDamage: "1W6" };
    const llm3 = setup([json({ auswahl: { erste: "boeser_blick", zweite: "x" }, optionen: [fluch, fluch2], empfehlung: "bereits_verbessert", optionenZweiteStufe: [venom, venom2] })]);
    const up3 = (await llm3.run("upgrade", { character: hexe, state: stateFor(fin) })) as Extract<GmEvent, { type: "upgrade" }>;
    expect(up3.offer!.recommended).toBe("giftkunde");
    expect(up3.offer!.options.map((o) => `${o.abilityId}:${o.secondStage ? 2 : 1}`)).toEqual(["boeser_blick:1", "boeser_blick:1", "giftkunde:2", "giftkunde:2"]);
    // Die zweite Stufe wird am schon verbesserten Stand gemessen (Giftblut, nicht Giftkunde)
    expect(up3.offer!.options[2].basedOn).toBe("Giftblut");
    for (const o of up3.offer!.options) { expect(o.points).toBeGreaterThanOrEqual(0.5); expect(o.points).toBeLessThanOrEqual(3); }
    const picked = (await llm3.run("choose", { character: hexe, state: up3.state, option: 3 })) as Extract<GmEvent, { type: "upgrade" }>;
    const p2 = picked.state.world!.progress![hexe.id];
    const eff = effectiveAbilities(hexeClass.abilities, p2);
    expect(eff.find((a) => a.id === "giftkunde")!.name).toBe("Schlangenblut"); // zweite Stufe gilt
    expect(eff.find((a) => a.id === "boeser_blick")!.upgraded).toBeUndefined(); // die andere bleibt, wie sie ist
    expect(worldSummary(picked.state.world!, [hexe])).toContain("zweite Stufe");
    expect(worldSummary(picked.state.world!, [hexe])).not.toContain("„Giftblut“ (verbesserte Fassung"); // nur noch die zweite Stufe gilt
    expect(upgradeDue(picked.state.world!, hexe.id)).toBeNull(); // danach ist Schluss

    // Ungültige Empfehlung (zu stark): es bleibt beim geplanten Weg
    const huge = { ...venom, name: "Gottgift", extraDamage: "2W12", advantage: true, attackBonus: 2 };
    const llm4 = setup([json({ auswahl: { erste: "x", zweite: "x" }, optionen: [fluch, fluch2], empfehlung: "bereits_verbessert", optionenZweiteStufe: [huge, huge] }), json({ auswahl: { erste: "x", zweite: "x" }, optionen: [], empfehlung: "bereits_verbessert", optionenZweiteStufe: [huge] })]);
    const up4 = (await llm4.run("upgrade", { character: hexe, state: stateFor(fin) })) as Extract<GmEvent, { type: "upgrade" }>;
    expect(up4.offer!.recommended).toBeUndefined();
    expect(up4.offer!.options.map((o) => o.name)).toEqual(["Fluchblick", "Lähmender Blick"]);

    const forged = { ...chosen.state, world: { ...chosen.state.world!, progress: { [hexe.id]: { ...prog, chosen: [] } } } };
    expect((await run("turn", { character: hexe, state: forged, action: "x" })).type).toBe("error"); // Signatur
  });

  it("ungültige Vorschläge: zweiter Versuch mit Begründung, sonst eine maßvolle Ersatz-Verbesserung", async () => {
    const w = await midWorld([hexe]);
    const tooStrong = { ...options[0], name: "Gottgift", ...none, extraDamage: "2W12", advantage: true, attackBonus: 2 };
    const { llm, run } = setup([json({ auswahl: { erste: "giftkunde", zweite: "boeser_blick" }, optionen: [tooStrong, tooStrong] }), json({ auswahl: { erste: "giftkunde", zweite: "x" }, optionen: [options[0], tooStrong] })]);
    const up = (await run("upgrade", { character: hexe, state: stateFor(w) })) as Extract<GmEvent, { type: "upgrade" }>;
    expect(llm.calls).toHaveLength(2);
    expect(String((llm.calls[1].messages[2] as { content: string }).content)).toMatch(/Zu stark/);
    expect(up.offer!.options).toHaveLength(2);
    expect(up.offer!.options[0].name).toBe("Giftblut");
    expect(up.offer!.options[1].name).toContain("gemeistert"); // Ersatz
    for (const o of up.offer!.options) { expect(o.points).toBeGreaterThanOrEqual(0.5); expect(o.points).toBeLessThanOrEqual(3); }
  });
});

describe("Verbesserungen in der Gruppe", () => {
  it("jede Person schaltet für ihre eigene Figur frei; alle sehen die verbesserte Fähigkeit", async () => {
    const llm = new FakeLlm([
      text("Start."),
      json({ auswahl: { erste: "wundversorgung", zweite: "gebet_zuversicht" }, optionen: [
        { name: "Feldscher", text: "Wie Wundversorgung, heilt aber 2W8+2 und bringt Bewusstlose sofort auf die Beine.", beginnerText: "Du holst Gefallene zurück in den Kampf.", uses: "einmal_pro_rast", scope: "breit", passtZurLage: true, ...none, heal: "2W8+2" },
        { name: "Ruhige Hände", text: "Wundversorgung heilt 1W8+4 und ist einmal pro Kampf einsetzbar.", beginnerText: "Du verbindest Wunden schneller.", uses: "einmal_pro_kampf", scope: "breit", passtZurLage: false, ...none, heal: "1W8+3" },
      ] }),
    ]);
    const guard = new UsageGuard(new MemoryCounterStore(), 10, 100);
    const gm = new GameMaster({ data: () => data, llm, rolls: new RollLog(), guard, secret: SECRET });
    const store = new MemoryPartyStore();
    const svc = new PartyService({ data: () => data, narrator: gm.narrator, forge: gm.forge, guard, store, secret: SECRET });
    const host = await svc.create({ character: hexe });
    const guest = await svc.join({ code: host.code, character: moench });
    await svc.run("start", { code: host.code, token: host.token }, "t", () => {});
    // Welt in die Mitte setzen
    const got = await store.get(host.code);
    got!.party.world = await midWorld([hexe, moench]);
    await store.put(got!.party, got!.etag);

    const evs: PartyEvent[] = [];
    await svc.run("upgrade", { code: host.code, token: guest.token }, "t", (e) => evs.push(e));
    const v = (evs.at(-1) as { view: PartyView }).view;
    expect(v.world!.progress![moench.id].offer!.options.map((o) => o.name)).toEqual(["Feldscher", "Ruhige Hände"]);
    expect(v.world!.progress![hexe.id]).toBeUndefined();
    await expect(svc.choose({ code: host.code, token: host.token, option: 0 })).rejects.toThrow(/gibt es nicht/); // nicht die eigene
    const after = await svc.choose({ code: host.code, token: guest.token, option: 0 });
    const agnes = after.players.find((p) => p.name === "Agnes")!;
    expect(agnes.abilities.find((a) => a.upgraded)?.name).toBe("Feldscher");
  });
});
