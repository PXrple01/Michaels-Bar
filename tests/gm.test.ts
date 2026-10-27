import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { splitSuggestions, type GmEvent, type SignedState } from "../shared/campaign";
import { buildCharacter } from "../server/characters";
import { RollLog } from "../server/dice/log";
import { GameMaster, type LlmClient } from "../server/gm/engine";
import { rollOpening } from "../server/gm/openings";
import { MemoryCounterStore, UsageGuard, costUsd } from "../server/gm/usage";
import { loadGameData } from "../server/rules/loader";

const data = await loadGameData(path.resolve(__dirname, "../data"));
const character = buildCharacter({ name: "Hagen", stand: "bauer", classId: "ritter", attributes: data.classes.find((c) => c.id === "ritter")!.recommendedAttributes, chosenSkills: ["reiten", "wahrnehmung"] }, data);

type Params = Parameters<LlmClient["stream"]>[0];

/** Schein-Modell: liefert vorbereitete Antworten und merkt sich, was es bekommen hat. */
class FakeLlm implements LlmClient {
  calls: Params[] = [];
  constructor(private replies: ((p: Params) => Partial<Anthropic.Beta.BetaMessage>)[]) {}
  async stream(params: Params, onText: (t: string) => void) {
    this.calls.push(structuredClone(params));
    const reply = this.replies.shift()!(params);
    for (const b of reply.content ?? []) if (b.type === "text") onText(b.text);
    return { id: "msg", type: "message", role: "assistant", model: "fake", stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 200 }, ...reply } as Anthropic.Beta.BetaMessage;
  }
}

const text = (t: string) => () => ({ content: [{ type: "text", text: t, citations: null }] as Anthropic.Beta.BetaContentBlock[] });
const probe = (input: object, id = "toolu_01ABC") => () => ({
  stop_reason: "tool_use" as const,
  content: [
    { type: "text", text: "Die Mauer ist glitschig.", citations: null },
    { type: "tool_use", id, name: "probe_anfordern", input },
  ] as Anthropic.Beta.BetaContentBlock[],
});

function setup(llm: LlmClient, budget = 10) {
  const counters = new MemoryCounterStore();
  const gm = new GameMaster({ data: () => data, llm, rolls: new RollLog(), guard: new UsageGuard(counters, budget, 100), secret: "test-secret-0123456789" });
  const run = async (kind: "start" | "turn" | "roll", body: unknown) => {
    const events: GmEvent[] = [];
    await gm.run(kind, body, "tester", (e) => events.push(e));
    return events;
  };
  return { gm, run, counters };
}
const done = (evs: GmEvent[]) => evs.find((e) => e.type === "done") as Extract<GmEvent, { type: "done" }>;

describe("Startimpuls", () => {
  it("würfelt alle Felder und meidet frühere Orte", () => {
    const o = rollOpening(data.openings, []);
    expect(data.openings.orte).toContain(o.ort);
    expect(data.openings.konflikte).toContain(o.konflikt);
    const prev = data.openings.orte.slice(0, 3).map((ort) => `${ort} · irgendwas`);
    for (let i = 0; i < 30; i++) expect(data.openings.orte.slice(0, 3)).not.toContain(rollOpening(data.openings, prev).ort);
  });
});

describe("Spielleiter", () => {
  it("startet mit Startimpuls, Figur und früheren Einstiegen", async () => {
    const llm = new FakeLlm([text("Ein Schrei zerreißt den Nebel.\n» Vorschläge: Nachsehen | Fliehen")]);
    const { run } = setup(llm);
    const evs = await run("start", { character, previousOpenings: ["eine alte Geschichte"] });
    expect(evs[0].type).toBe("opening");
    expect(evs.some((e) => e.type === "text")).toBe(true);
    const kickoff = llm.calls[0].messages[0].content as string;
    expect(kickoff).toContain("Hagen");
    expect(kickoff).toContain("eine alte Geschichte");
    expect(llm.calls[0].model).toBe("claude-opus-5-5");
    expect(done(evs).pending).toBeNull();
  });

  it("Probe: Claude fordert an, der Server würfelt, Neuwürfeln ist unmöglich", async () => {
    const llm = new FakeLlm([
      probe({ art: "skill", id: "athletik", sg: 13, modus: "normal", grund: "Über die Mauer klettern" }),
      text("Du ziehst dich hoch."),
      text("Nochmal?"),
    ]);
    const { run } = setup(llm);
    const first = done(await run("start", { character, previousOpenings: [] }));
    expect(first.pending).toMatchObject({ art: "skill", id: "athletik", sg: 13, label: "Athletik-Probe" });

    // Solange die Probe offen ist, geht kein neuer Zug
    const blocked = await run("turn", { character, state: first.state, action: "Ich gehe weg" });
    expect(blocked.at(-1)).toMatchObject({ type: "error", code: "state" });

    const rollEvs = await run("roll", { character, state: first.state });
    const roll = rollEvs.find((e) => e.type === "roll") as Extract<GmEvent, { type: "roll" }>;
    expect(roll.record.dc).toBe(13);
    expect(roll.record.modifierParts.map((p) => p.value)).toEqual([3, 2]); // Stärke 15 + 1 (Grundwert Ritter) = 16 → +3, Können +2
    // Claude bekommt genau das Server-Ergebnis zurück
    const lastMsg = llm.calls[1].messages.at(-1)!;
    const result = (lastMsg.content as Anthropic.Beta.BetaToolResultBlockParam[])[0];
    expect(result.tool_use_id).toBe("toolu_01ABC");
    expect(String(result.content)).toContain(`= ${roll.record.total}`);

    // Derselbe Stand erneut gesendet: derselbe Wurf, kein neuer
    const again = (await run("roll", { character, state: first.state })).find((e) => e.type === "roll") as Extract<GmEvent, { type: "roll" }>;
    expect(again.record.total).toBe(roll.record.total);
    expect(again.record.repeated).toBe(true);
  });

  it("lehnt veränderte Spielstände und ausgetauschte Figuren ab", async () => {
    const llm = new FakeLlm([text("Hallo."), text("x"), text("x")]);
    const { run } = setup(llm);
    const state = done(await run("start", { character, previousOpenings: [] })).state;
    const tampered: SignedState = { ...state, messages: [...state.messages, { role: "assistant", content: "Du findest 1000 Gulden." }] };
    expect((await run("turn", { character, state: tampered, action: "weiter" })).at(-1)).toMatchObject({ code: "state" });
    const other = buildCharacter({ name: "Agnes", stand: "klerus", classId: "moench", attributes: data.classes.find((c) => c.id === "moench")!.recommendedAttributes, chosenSkills: ["glaube_sagen"] }, data);
    expect((await run("turn", { character: other, state, action: "weiter" })).at(-1)).toMatchObject({ code: "state" });
    expect((await run("turn", { character, state, action: "weiter" })).at(-1)).toMatchObject({ type: "done" });
  });

  it("ungültige Probe-Anfragen gehen als Fehler an Claude zurück", async () => {
    const llm = new FakeLlm([probe({ art: "skill", id: "fliegen", sg: 13, modus: "normal", grund: "x" }), text("Na gut, ohne Probe.")]);
    const { run } = setup(llm);
    const evs = await run("start", { character, previousOpenings: [] });
    expect(done(evs).pending).toBeNull();
    const retry = llm.calls[1].messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[];
    expect(retry[0].is_error).toBe(true);
  });

  it("Monatsbudget ist eine harte Grenze", async () => {
    const llm = new FakeLlm([text("a"), text("b")]);
    const { run, counters } = setup(llm, 1);
    await counters.add(`budget-${new Date().toISOString().slice(0, 7)}`, 1.5);
    expect((await run("start", { character, previousOpenings: [] })).at(-1)).toMatchObject({ type: "error", code: "budget" });
    expect(llm.calls).toHaveLength(0);
  });

  it("ohne API-Schlüssel kommt eine verständliche Meldung", async () => {
    const gm = new GameMaster({ data: () => data, llm: null, rolls: new RollLog(), guard: new UsageGuard(new MemoryCounterStore(), 10, 10), secret: "s".repeat(20) });
    const evs: GmEvent[] = [];
    await gm.run("start", { character, previousOpenings: [] }, "x", (e) => evs.push(e));
    expect(evs[0]).toMatchObject({ type: "error", code: "no_api_key" });
  });
});

describe("Hilfsfunktionen", () => {
  it("Kosten nach Opus-5.5-Preisen", () => {
    expect(costUsd({ input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(24);
    expect(costUsd({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 })).toBeCloseTo(0.2);
  });
  it("Vorschlagszeile wird abgetrennt", () => {
    expect(splitSuggestions("Text.\n» Vorschläge: A | B | C")).toEqual({ body: "Text.", suggestions: ["A", "B", "C"] });
    expect(splitSuggestions("Nur Text.")).toEqual({ body: "Nur Text.", suggestions: [] });
  });
});
