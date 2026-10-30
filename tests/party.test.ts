import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { PartyEvent, PartyView } from "../shared/party";
import { buildCharacter } from "../server/characters";
import { RollLog } from "../server/dice/log";
import { Narrator, type LlmClient } from "../server/gm/narrator";
import { MemoryPartyStore, PartyService } from "../server/gm/party";
import { costUsd, MemoryCounterStore, UsageGuard } from "../server/gm/usage";
import { loadGameData } from "../server/rules/loader";

const data = await loadGameData(path.resolve(__dirname, "../data"));
const mk = (name: string, classId: string, skills: string[]) =>
  buildCharacter({ name, stand: "bauer", classId, attributes: data.classes.find((c) => c.id === classId)!.recommendedAttributes, chosenSkills: skills }, data);
const hagen = mk("Hagen", "ritter", ["reiten", "wahrnehmung"]);
const agnes = mk("Agnes", "moench", ["glaube_sagen"]);

type Params = Parameters<LlmClient["stream"]>[0];
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
const text = (t: string) => ({ content: [{ type: "text", text: t, citations: null }] as Anthropic.Beta.BetaContentBlock[] });
const probe = (figur: string) => ({
  stop_reason: "tool_use" as const,
  content: [{ type: "text", text: "Die Tür klemmt.", citations: null }, { type: "tool_use", id: "toolu_party1", name: "probe_anfordern", input: { figur, art: "skill", id: "athletik", sg: 12, modus: "normal", grund: "Tür aufstemmen" } }] as Anthropic.Beta.BetaContentBlock[],
});

function setup(replies: Partial<Anthropic.Beta.BetaMessage>[]) {
  const llm = new FakeLlm(replies);
  const guard = new UsageGuard(new MemoryCounterStore(), 10, 100);
  const narrator = new Narrator({ llm, rolls: new RollLog(), guard });
  const svc = new PartyService({ data: () => data, narrator, guard, store: new MemoryPartyStore(), secret: "s".repeat(20) });
  const run = async (op: "start" | "action" | "roll", body: Record<string, unknown>) => {
    const evs: PartyEvent[] = [];
    await svc.run(op, body, "t", (e) => evs.push(e));
    return evs;
  };
  return { svc, llm, run };
}
const viewOf = (evs: PartyEvent[]) => (evs.find((e) => e.type === "view") as { view: PartyView } | undefined)?.view;

describe("Mehrspieler", () => {
  it("Gruppe gründen, beitreten, starten – Claude kennt alle Figuren", async () => {
    const { svc, llm, run } = setup([text("Ihr steht am Tor.")]);
    const host = await svc.create({ character: hagen });
    expect(host.code).toMatch(/^[A-Z0-9]{6}$/);
    const guest = await svc.join({ code: host.code, character: agnes });
    expect(guest.view.players.map((p) => p.name)).toEqual(["Hagen", "Agnes"]);
    await expect(svc.join({ code: host.code, character: agnes })).rejects.toThrow(/schon/);

    expect((await run("start", { code: host.code, token: guest.token })).at(-1)).toMatchObject({ type: "error" }); // nur Gastgeber
    const evs = await run("start", { code: host.code, token: host.token });
    expect(viewOf(evs)?.status).toBe("playing");
    const kickoff = llm.calls[0].messages[0].content as string;
    expect(kickoff).toContain("Hagen");
    expect(kickoff).toContain("Agnes");
    const tool = (llm.calls[0].tools as Anthropic.Beta.BetaTool[])[0];
    expect((tool.input_schema.properties as Record<string, { enum?: string[] }>).figur.enum).toEqual(["Hagen", "Agnes"]);
    await expect(svc.join({ code: host.code, character: mk("Kaspar", "jaeger", ["heimlichkeit", "athletik"]) })).rejects.toThrow(/begonnen/);
  });

  it("Runde: erst wenn alle gehandelt haben, erzählt der Spielleiter; würfeln darf nur die genannte Figur", async () => {
    const { svc, llm, run } = setup([text("Ihr steht am Tor."), probe("Agnes"), text("Die Tür springt auf.")]);
    const host = await svc.create({ character: hagen });
    const guest = await svc.join({ code: host.code, character: agnes });
    await run("start", { code: host.code, token: host.token });

    const first = await run("action", { code: host.code, token: host.token, text: "Ich klopfe." });
    expect(viewOf(first)?.players.find((p) => p.name === "Hagen")?.acted).toBe(true);
    expect(llm.calls).toHaveLength(1); // noch nicht erzählt

    // Abgegeben ist abgegeben
    expect((await run("action", { code: host.code, token: host.token, text: "Doch lieber rennen." })).at(-1)).toMatchObject({ type: "error", message: expect.stringMatching(/schon abgegeben/) });
    expect(viewOf(first)?.players.find((p) => p.name === "Hagen")?.abilities.map((a) => a.name)).toContain("Schildwall");
    const second = await run("action", { code: host.code, token: guest.token, text: "Ich drücke gegen die Tür." });
    const v = viewOf(second)!;
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1].messages.at(-1)!.content).toContain("Hagen: Ich klopfe.");
    expect(v.pendings).toMatchObject([{ characterName: "Agnes", playerId: guest.playerId }]);

    expect((await run("roll", { code: host.code, token: host.token })).at(-1)).toMatchObject({ type: "error" });
    const rolled = await run("roll", { code: host.code, token: guest.token });
    expect(rolled.find((e) => e.type === "roll")).toBeTruthy();
    const after = viewOf(rolled)!;
    expect(after.pendings).toEqual([]);
    expect(after.story.map((s) => s.type)).toEqual(["gm", "actions", "gm", "roll", "gm"]);
  });

  it("der Gastgeber kann die Runde vorzeitig erzählen lassen", async () => {
    const { svc, llm, run } = setup([text("Start."), text("Weiter.")]);
    const host = await svc.create({ character: hagen });
    await svc.join({ code: host.code, character: agnes });
    await run("start", { code: host.code, token: host.token });
    await run("action", { code: host.code, token: host.token, text: "Ich gehe vor.", now: true });
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1].messages.at(-1)!.content).toContain("Agnes: (keine Angabe");
  });

  it("Abfragen mit bekanntem Stand: unverändert, nur Live-Text oder alles", async () => {
    const { svc, run } = setup([text("Start.")]);
    const host = await svc.create({ character: hagen });
    const auth = { code: host.code, token: host.token };
    const v = await svc.state(auth);
    expect(await svc.poll({ ...auth, known: v.version, core: v.core })).toEqual({ unchanged: true, version: v.version });
    // Ohne bekannten Stand: die volle Ansicht
    expect(await svc.poll(auth)).toMatchObject({ code: host.code, version: v.version });
    // Etwas Echtes ändert sich (Start): volle Ansicht mit neuem core
    await run("start", auth);
    const full = await svc.poll({ ...auth, known: v.version, core: v.core });
    expect("story" in full && full.core > v.core).toBe(true);
    // Nur der Live-Text ändert sich: kleine Antwort
    const s = svc as unknown as { update(code: string, fn: (p: { live: string }) => void, o: { liveOnly: boolean }): Promise<unknown> };
    await s.update(host.code, (p) => { p.live = "Es donnert …"; }, { liveOnly: true });
    const cur = full as Awaited<ReturnType<typeof svc.state>>;
    expect(await svc.poll({ ...auth, known: cur.version, core: cur.core })).toEqual({ partial: true, version: cur.version + 1, live: "Es donnert …", busy: false });
  });

  it("die Ansicht enthält keine Geheimnisse", async () => {
    const { svc } = setup([]);
    const host = await svc.create({ character: hagen });
    const json = JSON.stringify(await svc.state({ code: host.code, token: host.token }));
    expect(json).not.toContain(host.token);
    expect(json).not.toContain("tokenHash");
    await expect(svc.state({ code: host.code, token: "falsch" })).rejects.toThrow(/gehörst nicht/);
  });
});

describe("Kosten", () => {
  it("1-Stunden-Cache kostet beim Schreiben das Doppelte, beim Lesen ein Zehntel", () => {
    expect(costUsd({ input_tokens: 0, output_tokens: 0, cache_creation: { ephemeral_1h_input_tokens: 1_000_000 } }, "claude-opus-5-5")).toBeCloseTo(8);
    expect(costUsd({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 }, "claude-opus-5-5")).toBeCloseTo(0.2);
    expect(costUsd({ input_tokens: 1_000_000, output_tokens: 1_000_000 }, "claude-sonnet-5-5")).toBeCloseTo(12);
    // Die Zusammenfassung steht nicht in den Hauptzahlen und muss mitgezählt werden
    expect(costUsd({ input_tokens: 0, output_tokens: 0, iterations: [{ type: "compaction", input_tokens: 0, output_tokens: 100_000 }] }, "claude-opus-5-5")).toBeCloseTo(2);
  });
});
