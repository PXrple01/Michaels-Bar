import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { GmEvent, SignedState } from "../shared/campaign";
import { currentChapter, initWorld, worldSummary } from "../shared/world";
import { buildCharacter } from "../server/characters";
import { RollLog } from "../server/dice/log";
import { GameMaster, type LlmClient } from "../server/gm/engine";
import { TOOLSET } from "../server/gm/narrator";
import { signState, characterHash } from "../server/gm/state";
import { MemoryCounterStore, UsageGuard } from "../server/gm/usage";
import { clampDice, countChapterTurn, runAutoTool } from "../server/gm/world";
import { loadGameData } from "../server/rules/loader";

const data = await loadGameData(path.resolve(__dirname, "../data"));
const character = buildCharacter({ name: "Hagen", stand: "bauer", classId: "ritter", attributes: data.classes.find((c) => c.id === "ritter")!.recommendedAttributes, chosenSkills: ["reiten", "wahrnehmung"] }, data);
const SECRET = "test-secret-0123456789";

type Params = Parameters<LlmClient["stream"]>[0];
type Block = Anthropic.Beta.BetaContentBlock;
class FakeLlm implements LlmClient {
  calls: Params[] = [];
  constructor(private replies: Partial<Anthropic.Beta.BetaMessage>[]) {}
  async stream(params: Params, onText: (t: string) => void) {
    this.calls.push(structuredClone(params));
    const r = this.replies.shift()!;
    for (const b of r.content ?? []) if (b.type === "text") onText(b.text);
    return { id: "m", type: "message", role: "assistant", model: "fake", stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 50 }, ...r } as Anthropic.Beta.BetaMessage;
  }
}
const text = (t: string) => ({ content: [{ type: "text", text: t, citations: null }] as Block[] });
const tools = (t: string, ...uses: { id: string; name: string; input: object }[]) => ({
  stop_reason: "tool_use" as const,
  content: [{ type: "text", text: t, citations: null }, ...uses.map((u) => ({ type: "tool_use", ...u }))] as Block[],
});

function setup(replies: Partial<Anthropic.Beta.BetaMessage>[]) {
  const llm = new FakeLlm(replies);
  const gm = new GameMaster({ data: () => data, llm, rolls: new RollLog(), guard: new UsageGuard(new MemoryCounterStore(), 10, 100), secret: SECRET });
  const run = async (kind: "start" | "turn" | "roll", body: unknown) => {
    const evs: GmEvent[] = [];
    await gm.run(kind, body, "t", (e) => evs.push(e));
    return evs;
  };
  return { llm, run };
}
const done = (evs: GmEvent[]) => evs.find((e) => e.type === "done") as Extract<GmEvent, { type: "done" }>;
const userContent = (p: Params) => p.messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[];

describe("Kampf", () => {
  it("Kampf beginnen, Angriff gegen Rüstung, Schaden zieht Gegner-TP ab", async () => {
    const { llm, run } = setup([
      text("Am Wegrand lauert jemand."),
      tools("Ein Räuber springt hervor!",
        { id: "toolu_k1", name: "kampf_beginnen", input: { gegner: [{ name: "Räuber", trefferpunkte: 500, ruestung: 30 }] } },
        { id: "toolu_k2", name: "probe_anfordern", input: { art: "attack", id: "waffe", sg: 10, modus: "normal", grund: "Zuschlagen", ziel: "räuber" } }),
      text("Weiter."),
    ]);
    const start = done(await run("start", { character, previousOpenings: [] }));
    expect(start.state.world?.hp[character.id]).toBe(character.hp.max);

    const turn = done(await run("turn", { character, state: start.state, action: "Ich ziehe mein Schwert." }));
    // Der Spielstand hängt an der Handlung
    expect(llm.calls[1].messages.at(-1)!.content).toContain("<spielstand>");
    // Grenzen: höchstens 80 TP, Rüstung höchstens 20; der SG ist die Rüstung des Gegners
    expect(turn.state.world?.combat?.enemies[0]).toMatchObject({ name: "Räuber", hp: 80, armor: 20 });
    expect(turn.pending).toMatchObject({ art: "attack", sg: 20, ziel: "Räuber" });
    // Die Probe ist offen, das Kampf-Ergebnis wird zurückgehalten
    expect(turn.state.held).toHaveLength(1);

    const rolled = await run("roll", { character, state: turn.state });
    const results = userContent(llm.calls[2]);
    expect(results.map((r) => r.tool_use_id)).toEqual(["toolu_k1", "toolu_k2"]);
    expect(String(results[1].content)).toMatch(/SG 20/);
    expect(done(rolled).state.held).toEqual([]);
  });

  it("Gegnerangriff würfelt der Server und zieht Trefferpunkte ab – nie unter 0", async () => {
    const world = initWorld([character]);
    world.combat = { round: 1, enemies: [{ id: "e", name: "Oger", hp: 40, maxHp: 40, armor: 12 }] };
    const rolls: unknown[] = [];
    const ctx = { data, characters: [character], world, rolls: new RollLog(), onRoll: (r: unknown) => rolls.push(r) };
    for (let i = 0; i < 40; i++) await runAutoTool({ id: `toolu_o${i}`, name: "gegner_greift_an", input: { gegner: "Oger", angriffsbonus: 99, schaden: "9W20+40", modus: "advantage" } }, ctx);
    expect(world.hp[character.id]).toBe(0);
    expect(rolls.length).toBeGreaterThan(1);
    const r = await runAutoTool({ id: "toolu_x", name: "gegner_greift_an", input: { gegner: "Oger", angriffsbonus: 2, schaden: "1W6", modus: "normal" } }, ctx);
    expect(r.is_error).toBe(true);
  });

  it("gleichnamige Gegner werden durchnummeriert", async () => {
    const world = initWorld([character]);
    await runAutoTool({ id: "toolu_n", name: "kampf_beginnen", input: { gegner: [{ name: "Räuber", trefferpunkte: 7, ruestung: 11 }, { name: "Räuber", trefferpunkte: 7, ruestung: 11 }, { name: "Hund", trefferpunkte: 4, ruestung: 12 }] } }, { data, characters: [character], world, rolls: new RollLog(), onRoll: () => {} });
    expect(world.combat?.enemies.map((e) => e.name)).toEqual(["Räuber 1", "Räuber 2", "Hund"]);
  });

  it("Heilung und Rast begrenzen auf das Maximum", async () => {
    const world = initWorld([character]);
    world.hp[character.id] = 1;
    const ctx = { data, characters: [character], world, rolls: new RollLog(), onRoll: () => {} };
    await runAutoTool({ id: "toolu_h", name: "heilen", input: { wuerfel: "10W20+50", grund: "Trank" } }, ctx);
    expect(world.hp[character.id]).toBeLessThanOrEqual(character.hp.max);
    expect(world.hp[character.id]).toBeGreaterThan(1);
    world.hp[character.id] = 1;
    await runAutoTool({ id: "toolu_r", name: "rast", input: { art: "lang" } }, ctx);
    expect(world.hp[character.id]).toBe(character.hp.max);
  });

  it("Würfelausdrücke werden auf die Grenzen gekürzt", () => {
    expect(clampDice("5W20+30", 12)).toBe("2W12+5");
    expect(clampDice("1W6-1", 12)).toBe("1W6-1");
    expect(clampDice("Unsinn", 12)).toBe("1W4");
  });
});

describe("Aufträge, Gedächtnis, Erfahrung", () => {
  it("werden im signierten Spielstand geführt und können nicht verändert werden", async () => {
    const { run } = setup([
      tools("Der Abt bittet um Hilfe.",
        { id: "toolu_a1", name: "auftrag", input: { aktion: "neu", titel: "Der verschwundene Kelch", text: "Finde den Kelch des Klosters." } },
        { id: "toolu_a2", name: "merken", input: { text: "Bruder Anselm schuldet Hagen einen Gefallen." } },
        { id: "toolu_a3", name: "erfahrung", input: { menge: 9999, grund: "Test" } }),
      text("Die Glocke schlägt."),
    ]);
    const evs = await run("start", { character, previousOpenings: [] });
    const w = done(evs).state.world!;
    expect(w.quests[0]).toMatchObject({ title: "Der verschwundene Kelch", status: "offen" });
    expect(w.memory).toEqual(["Bruder Anselm schuldet Hagen einen Gefallen."]);
    expect(w.xp[character.id]).toBe(100); // höchstens 100 pro Vergabe (Kapitel und Akte belohnt der Server)

    const forged: SignedState = { ...done(evs).state, world: { ...w, hp: { [character.id]: 999 } } };
    expect((await run("turn", { character, state: forged, action: "Ich gehe." })).at(-1)).toMatchObject({ type: "error", code: "state" });
  });

  it("Buchführung nach fertiger Erzählung kostet keinen zweiten Modellaufruf", async () => {
    const { llm, run } = setup([
      tools("Der Abt nickt dir zu.\n» Vorschläge: Ins Kloster gehen | Weiterreiten",
        { id: "toolu_s1", name: "merken", input: { text: "Der Abt heißt Gregor." } },
        { id: "toolu_s2", name: "auftrag", input: { aktion: "neu", titel: "Der Brief", text: "Bring den Brief nach Ulm." } }),
      text("Du reitest weiter."),
    ]);
    const start = done(await run("start", { character, previousOpenings: [] }));
    expect(llm.calls).toHaveLength(1);
    expect(start.pending).toBeNull();
    expect(start.state.world?.memory).toEqual(["Der Abt heißt Gregor."]);
    await run("turn", { character, state: start.state, action: "Ich reite weiter." });
    const sent = llm.calls[1].messages.at(-1)!.content as { type: string; tool_use_id?: string; text?: string }[];
    expect(sent.map((b) => b.tool_use_id ?? b.type)).toEqual(["toolu_s1", "toolu_s2", "text"]);
    expect(sent[2].text).toContain("Ich reite weiter.");
  });

  it("ohne Vorschlagszeile erzählt Claude nach der Buchführung weiter", async () => {
    const { llm, run } = setup([
      tools("Der Abt nickt.", { id: "toolu_t1", name: "merken", input: { text: "Abt Gregor." } }),
      text("Er reicht dir einen Brief.\n» Vorschläge: Lesen | Einstecken"),
    ]);
    await run("start", { character, previousOpenings: [] });
    expect(llm.calls).toHaveLength(2);
  });

  it("alte Spielstände werden einmalig umgestellt (Denkblöcke entfernt, Welt angelegt)", async () => {
    const { llm, run } = setup([text("Weiter geht's.")]);
    const old = { messages: [{ role: "user", content: "Start" }, { role: "assistant", content: [{ type: "thinking", thinking: "x", signature: "s" }, { type: "text", text: "Hallo" }] }] };
    // Signatur wie vor Etappe 5: ohne Werkzeugstand
    const legacy = signState(SECRET, { ...old, world: undefined as never, held: undefined as never, toolset: 0 }, characterHash(character));
    const evs = await run("turn", { character, state: legacy, action: "Ich schaue mich um." });
    const sent = llm.calls[0].messages[1].content as { type: string }[];
    expect(sent.map((b) => b.type)).toEqual(["text"]);
    expect(done(evs).state.toolset).toBe(TOOLSET);
    expect(done(evs).state.world?.hp[character.id]).toBe(character.hp.max);
    expect(llm.calls[0].context_management?.edits?.[0]).toMatchObject({ type: "compact_20260112" });
  });
});

describe("Modellwechsel", () => {
  it("wechselt GM_MODEL, werden die Denkblöcke des alten Modells entfernt – sonst bleiben sie", async () => {
    const thinking = { role: "assistant", content: [{ type: "thinking", thinking: "x", signature: "s" }, { type: "text", text: "Hallo" }] };
    const state = signState(SECRET, { messages: [{ role: "user", content: "Start" }, thinking], world: initWorld([character]), held: [], toolset: TOOLSET }, characterHash(character));
    const sentTypes = async (model: "claude-opus-5-5" | "claude-sonnet-5-5", s: SignedState) => {
      const llm = new FakeLlm([text("Weiter.")]);
      const gm = new GameMaster({ data: () => data, llm, rolls: new RollLog(), guard: new UsageGuard(new MemoryCounterStore(), 10, 100), secret: SECRET, model });
      const evs: GmEvent[] = [];
      await gm.run("turn", { character, state: s, action: "Ich gehe." }, "t", (e) => evs.push(e));
      return { types: (llm.calls[0].messages[1].content as { type: string }[]).map((b) => b.type), done: done(evs) };
    };
    // Alter Spielstand ohne Modellangabe stammt von Opus
    expect((await sentTypes("claude-opus-5-5", state)).types).toEqual(["thinking", "text"]);
    const switched = await sentTypes("claude-sonnet-5-5", state);
    expect(switched.types).toEqual(["text"]);
    expect(switched.done.state.model).toBe("claude-sonnet-5-5");
  });
});

describe("Kampagne in Akten und Kapiteln", () => {
  const ctx = (world: ReturnType<typeof initWorld>) => ({ data, characters: [character], world, rolls: new RollLog(), onRoll: () => {} });
  const ch = (titel: string) => ({ titel, ziel: `${titel} erreicht` });
  const plan = { ziel: "Den Kelch zurückholen", bedrohung: "Der Raubritter Kuno", anfang: [ch("Die Spur"), ch("Der Wald")], mitte: [ch("Die Burg"), ch("Der Verrat"), ch("Die Flucht")], finale: [ch("Der Turm"), ch("Kuno")] };
  const tool = (w: ReturnType<typeof initWorld>, name: string, input: object) => runAutoTool({ id: `toolu_${name}`, name, input }, ctx(w));

  it("Plan anlegen: lineare Kapitel in drei Akten, Mindestzahl je Akt", async () => {
    const w = initWorld([character]);
    expect((await tool(w, "kampagne_planen", { ...plan, anfang: [ch("Nur eins")] })).is_error).toBe(true);
    await tool(w, "kampagne_planen", plan);
    expect(w.arc!.chapters.map((c) => `${c.act}:${c.titel}`)).toEqual(["0:Die Spur", "0:Der Wald", "1:Die Burg", "1:Der Verrat", "1:Die Flucht", "2:Der Turm", "2:Kuno"]);
    const summary = worldSummary(w, [character]);
    expect(summary).toContain("Akt 1 von 3 „Anfang“, Kapitel 1 von 2 dieses Akts: „Die Spur“");
    expect(summary).not.toMatch(/Zug \d/); // keine Zugzahlen
  });

  it("Kapitel abschließen führt durch die Akte; das Ende kommt erst im letzten Kapitel des Finales", async () => {
    const w = initWorld([character]);
    await tool(w, "kampagne_planen", plan);
    expect((await tool(w, "abenteuer_beenden", { epilog: "x" })).is_error).toBe(true);
    await tool(w, "kapitel_abschliessen", { rueckblick: "Eine Spur führt in den Wald." });
    const r = await tool(w, "kapitel_abschliessen", { rueckblick: "Im Wald wartet ein Bote." });
    expect(r.content).toContain("Akt 2 „Mitte“");
    for (let i = 0; i < 4; i++) await tool(w, "kapitel_abschliessen", { rueckblick: "weiter" });
    expect(worldSummary(w, [character])).toContain("letzte Kapitel des Finales");
    expect((await tool(w, "kapitel_abschliessen", { rueckblick: "x" })).is_error).toBe(true); // letztes Kapitel → abenteuer_beenden
    await tool(w, "abenteuer_beenden", { epilog: "Kuno ist besiegt.", vermaechtnis: [{ figur: "Hagen", titel: "Bezwinger Kunos", erbstueck: "Kunos zerbrochene Krone" }] });
    expect(w.arc).toMatchObject({ finished: true, epilog: "Kuno ist besiegt." });
    expect(w.legacy).toEqual([{ characterId: character.id, title: "Bezwinger Kunos", heirloom: "Kunos zerbrochene Krone" }]);
  });

  it("Abzweigungen: eingeschoben vor dem unterbrochenen Kapitel, begrenzt je Akt – kein endloser Anfang", async () => {
    const w = initWorld([character]);
    await tool(w, "kampagne_planen", plan);
    await tool(w, "abzweigung", { titel: "Der Jahrmarkt", ziel: "Gaukler befragt", rueckweg: "Der Gaukler kennt die Spur" });
    expect(currentChapter(w.arc!)).toMatchObject({ titel: "Der Jahrmarkt", detour: true });
    expect(worldSummary(w, [character])).toContain("ABZWEIGUNG; danach zurück zur Hauptlinie: Der Gaukler kennt die Spur");
    expect((await tool(w, "abzweigung", { titel: "Noch eine", ziel: "x", rueckweg: "y" })).is_error).toBe(true); // nicht in einer Abzweigung
    await tool(w, "kapitel_abschliessen", { rueckblick: "Der Gaukler redet." });
    expect(currentChapter(w.arc!)!.titel).toBe("Die Spur"); // das unterbrochene Kapitel folgt
    await tool(w, "abzweigung", { titel: "Die Mühle", ziel: "x", rueckweg: "y" });
    await tool(w, "kapitel_abschliessen", { rueckblick: "x" });
    const third = await tool(w, "abzweigung", { titel: "Der See", ziel: "x", rueckweg: "y" });
    expect(third.is_error).toBe(true); // Anfang: höchstens 2
    expect(worldSummary(w, [character])).toContain("Keine Abzweigungen mehr in diesem Akt");
  });

  it("Umplanen kann einen Akt nicht über seine Höchstzahl verlängern", async () => {
    const w = initWorld([character]);
    await tool(w, "kampagne_planen", plan);
    await tool(w, "kampagne_planen", { ...plan, anfang: Array.from({ length: 9 }, (_, i) => ch(`Neu ${i}`)) });
    const anfang = w.arc!.chapters.filter((c) => c.act === 0);
    expect(anfang.length).toBeLessThanOrEqual(4);
    expect(anfang[0].titel).toBe("Die Spur"); // laufendes Kapitel bleibt
  });

  it("lange Kapitel: nur ein Hinweis an Claude, kein harter Schnitt", async () => {
    const w = initWorld([character]);
    await tool(w, "kampagne_planen", plan);
    for (let i = 0; i < 60; i++) countChapterTurn(w);
    expect(currentChapter(w.arc!)!.titel).toBe("Die Spur");
    expect(worldSummary(w, [character])).toContain("läuft schon lange");
  });

  it("im Solo-Spiel: erst der Plan, am Ende kein Zug mehr", async () => {
    const { run } = setup([
      tools("Es beginnt.\n» Vorschläge: A | B", { id: "toolu_plan", name: "kampagne_planen", input: { ...plan, anfang: [ch("A1"), ch("A2")], mitte: [ch("M1"), ch("M2"), ch("M3")], finale: [ch("F1"), ch("F2")] } }),
      ...Array.from({ length: 6 }, (_, i) => tools("Weiter.\n» Vorschläge: A | B", { id: `toolu_k${i}`, name: "kapitel_abschliessen", input: { rueckblick: `Kapitel ${i + 1}` } })),
      tools("Kuno fällt. Epilog: Frieden.", { id: "toolu_end", name: "abenteuer_beenden", input: { epilog: "Frieden kehrt ein." } }),
    ]);
    let state = done(await run("start", { character, previousOpenings: [] })).state;
    expect(state.world!.arc!.chapters).toHaveLength(7);
    for (let i = 0; i < 7; i++) state = done(await run("turn", { character, state, action: "Weiter." })).state;
    expect(state.world!.arc).toMatchObject({ finished: true, epilog: "Frieden kehrt ein." });
    const after = await run("turn", { character, state, action: "Und weiter?" });
    expect(after.at(-1)).toMatchObject({ type: "error", message: expect.stringMatching(/abgeschlossen/) });
  });
});

describe("Bilder im Hintergrund", () => {
  it("ein langsames Bild bricht den Zug nicht ab und erscheint nach dem Text", async () => {
    const llm = new FakeLlm([
      tools("Die Burg erhebt sich vor dir.", { id: "toolu_b1", name: "bild", input: { motiv: "A dark castle at dusk", titel: "Die Burg" } }),
      text("Das Tor steht offen.\n» Vorschläge: Eintreten | Umkehren"),
    ]);
    const images = { ready: true, make: async () => { await new Promise((r) => setTimeout(r, 300)); return { url: "/api/images/x", costUsd: 0.134 }; } };
    const gm = new GameMaster({ data: () => data, llm, rolls: new RollLog(), guard: new UsageGuard(new MemoryCounterStore(), 10, 100), secret: SECRET, images: images as never, turnBudgetMs: 200 });
    const evs: GmEvent[] = [];
    await gm.run("start", { character, previousOpenings: [] }, "t", (e) => evs.push(e));
    expect(evs.find((e) => e.type === "error")).toBeUndefined();
    const types = evs.map((e) => e.type);
    expect(types.indexOf("image")).toBeGreaterThan(types.lastIndexOf("text"));
    expect(done(evs).turnImageUsd).toBeGreaterThanOrEqual(0.134);
  });
});

describe("Gesamtzeit eines Zugs", () => {
  it("zu langsame Bilder werden übersprungen – der Zug endet trotzdem rechtzeitig", async () => {
    const llm = new FakeLlm([tools("Die Burg.\n» Vorschläge: Eintreten | Umkehren", { id: "toolu_b2", name: "bild", input: { motiv: "A castle", titel: "Burg" } })]);
    const images = { ready: true, make: async () => { await new Promise((r) => setTimeout(r, 3000)); return { url: "/api/images/y", costUsd: 0.134 }; } };
    const gm = new GameMaster({ data: () => data, llm, rolls: new RollLog(), guard: new UsageGuard(new MemoryCounterStore(), 10, 100), secret: SECRET, images: images as never, wallMs: 300 });
    const evs: GmEvent[] = [];
    const t0 = Date.now();
    await gm.run("start", { character, previousOpenings: [] }, "t", (e) => evs.push(e));
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(done(evs)).toBeTruthy();
    expect(evs.some((e) => e.type === "image")).toBe(false);
  });
});
