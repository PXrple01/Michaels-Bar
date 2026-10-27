import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { GmEvent, SignedState } from "../shared/campaign";
import { initWorld } from "../shared/world";
import { buildCharacter } from "../server/characters";
import { RollLog } from "../server/dice/log";
import { GameMaster, type LlmClient } from "../server/gm/engine";
import { signState, characterHash } from "../server/gm/state";
import { MemoryCounterStore, UsageGuard } from "../server/gm/usage";
import { clampDice, runAutoTool } from "../server/gm/world";
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
    expect(w.xp[character.id]).toBe(300);

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
    expect(done(evs).state.toolset).toBe(2);
    expect(done(evs).state.world?.hp[character.id]).toBe(character.hp.max);
    expect(llm.calls[0].context_management?.edits?.[0]).toMatchObject({ type: "compact_20260112" });
  });
});

describe("Modellwechsel", () => {
  it("wechselt GM_MODEL, werden die Denkblöcke des alten Modells entfernt – sonst bleiben sie", async () => {
    const thinking = { role: "assistant", content: [{ type: "thinking", thinking: "x", signature: "s" }, { type: "text", text: "Hallo" }] };
    const state = signState(SECRET, { messages: [{ role: "user", content: "Start" }, thinking], world: initWorld([character]), held: [], toolset: 2 }, characterHash(character));
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
