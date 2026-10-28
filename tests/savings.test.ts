import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { GmEvent } from "../shared/campaign";
import type { PartyEvent, PartyView } from "../shared/party";
import { initWorld } from "../shared/world";
import { buildCharacter } from "../server/characters";
import { RollLog } from "../server/dice/log";
import { GameMaster } from "../server/gm/engine";
import { Narrator, type LlmClient } from "../server/gm/narrator";
import { MemoryPartyStore, PartyService } from "../server/gm/party";
import { MemoryCounterStore, UsageGuard } from "../server/gm/usage";
import { ARC_EVERY, turnSummary } from "../server/gm/summary";
import { runAutoTool } from "../server/gm/world";
import { loadGameData } from "../server/rules/loader";

const data = await loadGameData(path.resolve(__dirname, "../data"));
const mk = (name: string, classId: string, skills: string[]) =>
  buildCharacter({ name, stand: "bauer", classId, attributes: data.classes.find((c) => c.id === classId)!.recommendedAttributes, chosenSkills: skills }, data);
const hagen = mk("Hagen", "ritter", ["reiten", "wahrnehmung"]);
const agnes = mk("Agnes", "moench", ["glaube_sagen"]);

type Params = Parameters<LlmClient["stream"]>[0];
type Reply = Partial<Anthropic.Beta.BetaMessage> | Error;
class FakeLlm implements LlmClient {
  calls: Params[] = [];
  constructor(private replies: Reply[]) {}
  async stream(params: Params, onText: (t: string) => void) {
    this.calls.push(structuredClone(params));
    const r = this.replies.shift();
    if (!r) throw new Error("keine Antwort mehr");
    if (r instanceof Error) throw r;
    for (const b of r.content ?? []) if (b.type === "text") onText(b.text);
    return { id: "m", type: "message", role: "assistant", model: "fake", stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 50 }, ...r } as Anthropic.Beta.BetaMessage;
  }
}
let uid = 0;
const text = (t: string) => ({ content: [{ type: "text", text: t, citations: null }] as Anthropic.Beta.BetaContentBlock[] });
const tools = (t: string, ...uses: { name: string; input: object; id?: string }[]) => ({
  stop_reason: "tool_use" as const,
  content: [{ type: "text", text: t, citations: null }, ...uses.map((u) => ({ type: "tool_use", id: u.id ?? `toolu_s${uid++}`, name: u.name, input: u.input }))] as Anthropic.Beta.BetaContentBlock[],
});
const fight = (gegner: { name: string; trefferpunkte: number; ruestung: number }[]) => ({ name: "kampf_beginnen", input: { gegner } });
const attack = (ziel: string, figur?: string, id?: string) => ({ name: "probe_anfordern", id, input: { ...(figur ? { figur } : {}), art: "attack", id: "waffe", sg: 10, modus: "normal", grund: "Zuschlagen", ziel } });
const enemyHits = (gegner: string, ziel?: string, id?: string) => ({ name: "gegner_greift_an", id, input: { gegner, ...(ziel ? { ziel } : {}), angriffsbonus: 2, schaden: "1W4", modus: "normal" } });
const results = (p: Params) => p.messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[];

describe("Weniger Modellaufrufe im Kampf (Solo)", () => {
  it("Schaden würfelt der Server gleich mit, Gegnerangriffe kommen nach dem Wurf – die Runde braucht nur einen Aufruf nach dem Würfeln", async () => {
    const llm = new FakeLlm([
      text("Am Wegrand raschelt es."),
      tools("Ein Räuber springt hervor – du hebst das Schwert.", fight([{ name: "Räuber", trefferpunkte: 30, ruestung: 8 }]), attack("Räuber"), enemyHits("Räuber", undefined, "toolu_enemy")),
      text("Die Runde ist erzählt. » Vorschläge: Nachsetzen | Ausweichen"),
    ]);
    const gm = new GameMaster({ data: () => data, llm, rolls: new RollLog(), guard: new UsageGuard(new MemoryCounterStore(), 10, 100), secret: "s".repeat(20) });
    const run = async (kind: "start" | "turn" | "roll", body: unknown) => { const evs: GmEvent[] = []; await gm.run(kind, body, "t", (e) => evs.push(e)); return evs; };
    const done = (evs: GmEvent[]) => evs.find((e) => e.type === "done") as Extract<GmEvent, { type: "done" }>;
    const start = done(await run("start", { character: hagen, previousOpenings: [] }));
    const turn = done(await run("turn", { character: hagen, state: start.state, action: "Ich ziehe mein Schwert." }));
    // Der Gegnerangriff wartet noch: Hagen hat noch nicht gewürfelt
    expect(turn.state.world?.hp[hagen.id]).toBe(hagen.hp.max);
    expect((turn.state.held ?? []).map((h) => (h as { tool_use_id: string }).tool_use_id)).not.toContain("toolu_enemy");

    const evs = await run("roll", { character: hagen, state: turn.state });
    expect(llm.calls).toHaveLength(3); // Start, Handlung, ein einziger Aufruf nach dem Wurf
    const sent = results(llm.calls[2]);
    const probe = sent.find((r) => String(r.content).startsWith("Hagen:"))!;
    const roll = (evs.find((e) => e.type === "roll") as Extract<GmEvent, { type: "roll" }>).record;
    const enemy = done(evs).state.world!.combat!.enemies[0];
    if (roll.success) {
      expect(String(probe.content)).toMatch(/Schaden: .*verliert \d+ TP/);
      expect(enemy.hp).toBeLessThan(30);
      expect(evs.filter((e) => e.type === "roll").length).toBe(2); // Angriff + Schaden
      expect(evs.filter((e) => e.type === "autoroll").length).toBeGreaterThanOrEqual(1); // Gegnerangriff
    } else {
      expect(String(probe.content)).not.toMatch(/Schaden:/);
      expect(enemy.hp).toBe(30);
    }
    expect(sent.some((r) => r.tool_use_id === "toolu_enemy")).toBe(true);
  });

  it("ein besiegter Gegner greift nicht mehr an", async () => {
    const narrator = new Narrator({ llm: null, rolls: new RollLog(), guard: new UsageGuard(new MemoryCounterStore(), 10, 100) });
    const world = initWorld([hagen]);
    await runAutoTool({ id: "toolu_kk", name: "kampf_beginnen", input: { gegner: [{ name: "Wolf", trefferpunkte: 5, ruestung: 10 }, { name: "Bär", trefferpunkte: 30, ruestung: 10 }] } }, { data, characters: [hagen], world, rolls: new RollLog(), onRoll: () => {} });
    world.combat!.enemies[0].hp = 0;
    const msgs = [{ role: "assistant" as const, content: [enemyHits("Wolf", undefined, "toolu_w"), enemyHits("Bär", undefined, "toolu_b")].map((u) => ({ type: "tool_use" as const, ...u })) as Anthropic.Beta.BetaToolUseBlockParam[] }];
    const out = await narrator.enemyTurn(msgs, { characters: [hagen], data, world, onRoll: () => {} });
    expect(out.map((r) => r.tool_use_id)).toEqual(["toolu_w", "toolu_b"]);
    expect(String(out[0].content)).toMatch(/besiegt und greift nicht mehr an/);
    expect(String(out[1].content)).toMatch(/Bär (greift|trifft) Hagen/);
  });
});

function party(replies: Reply[]) {
  const llm = new FakeLlm(replies);
  const guard = new UsageGuard(new MemoryCounterStore(), 10, 100);
  const svc = new PartyService({ data: () => data, narrator: new Narrator({ llm, rolls: new RollLog(), guard }), guard, store: new MemoryPartyStore(), secret: "s".repeat(20) });
  const run = async (op: "start" | "action" | "roll", body: Record<string, unknown>) => { const evs: PartyEvent[] = []; await svc.run(op, body, "t", (e) => evs.push(e)); return evs; };
  return { llm, svc, run };
}
const viewOf = (evs: PartyEvent[]) => (evs.find((e) => e.type === "view") as { view: PartyView } | undefined)?.view;

describe("Gruppe: eine Probe nach der anderen, Gegnerzug nach dem Wurf", () => {
  it("eine zweite Probe in derselben Antwort wird abgelehnt; der angesagte Gegnerangriff kommt nach dem Wurf", async () => {
    const { llm, svc, run } = party([
      text("Ihr steht am Tor."),
      tools("Zwei Söldner stürmen heran!", fight([{ name: "Söldner", trefferpunkte: 40, ruestung: 8 }]), attack("Söldner", "Hagen", "toolu_ph"), attack("Söldner", "Agnes", "toolu_pa"), enemyHits("Söldner", "Agnes", "toolu_eg")),
      text("Hagens Hieb. » Vorschläge: Weiter | Rückzug"),
    ]);
    const host = await svc.create({ character: hagen });
    const guest = await svc.join({ code: host.code, character: agnes });
    await run("start", { code: host.code, token: host.token });
    await run("action", { code: host.code, token: host.token, text: "Angriff!" });
    const v = viewOf(await run("action", { code: host.code, token: guest.token, text: "Ich auch!" }))!;
    expect(v.pendings.map((c) => c.characterName)).toEqual(["Hagen"]);
    expect(v.world!.hp[agnes.id]).toBe(agnes.hp.max); // Gegnerangriff wartet noch
    expect((await run("roll", { code: host.code, token: guest.token })).at(-1)).toMatchObject({ type: "error" }); // Agnes ist nicht dran

    const after = viewOf(await run("roll", { code: host.code, token: host.token }))!;
    expect(llm.calls).toHaveLength(3); // ein Aufruf nach dem Wurf
    const sent = results(llm.calls[2]);
    expect(sent.map((r) => r.tool_use_id)).toEqual(expect.arrayContaining(["toolu_ph", "toolu_pa", "toolu_eg"]));
    expect(sent.find((r) => r.tool_use_id === "toolu_pa")!.is_error).toBe(true);
    expect(after.pendings).toEqual([]);
  });

  it("bricht der Zug nach dem Wurf ab, wird der Spielstand zurückgenommen – erneutes Würfeln ergibt denselben Wurf", async () => {
    const { llm, svc, run } = party([
      text("Ihr steht am Tor."),
      tools("Kampf!", fight([{ name: "Söldner", trefferpunkte: 40, ruestung: 8 }]), attack("Söldner", "Agnes")),
      new Error("Netz weg"),
      text("Weiter. » Vorschläge: A | B"),
    ]);
    const host = await svc.create({ character: hagen });
    const guest = await svc.join({ code: host.code, character: agnes });
    await run("start", { code: host.code, token: host.token });
    await run("action", { code: host.code, token: host.token, text: "a" });
    await run("action", { code: host.code, token: guest.token, text: "b" });
    const failed = await run("roll", { code: host.code, token: guest.token });
    const firstRoll = (failed.find((e) => e.type === "roll") as { record: { id: string } }).record.id;
    expect(failed.at(-1)).toMatchObject({ type: "error" });
    const v = await svc.state({ code: host.code, token: guest.token });
    expect(v.pendings.map((c) => c.characterName)).toEqual(["Agnes"]);
    expect(v.failed).toBeTruthy();
    expect(v.world!.combat!.enemies[0].hp).toBe(40); // Schaden zurückgenommen
    const again = await run("roll", { code: host.code, token: guest.token });
    expect((again.find((e) => e.type === "roll") as { record: { id: string } }).record.id).toBe(firstRoll);
    expect(viewOf(again)!.pendings).toEqual([]);
    expect(llm.calls).toHaveLength(4);
  });
});

describe("Kürzerer Spielstand", () => {
  it("der ausführliche Kampagnenstand kommt nur bei Änderungen und sonst alle paar Züge", async () => {
    const w = initWorld([hagen]);
    const ch = (t: string) => ({ titel: t, ziel: `${t} erreicht` });
    await runAutoTool({ id: "toolu_plan", name: "kampagne_planen", input: { ziel: "Z", bedrohung: "B", kernauftrag: "K", aufgabe: "A", anfang: [ch("A1"), ch("A2")], mitte: [ch("M1"), ch("M2"), ch("M3")], finale: [ch("F1"), ch("F2")] } }, { data, characters: [hagen], world: w, rolls: new RollLog(), onRoll: () => {} });
    const full = (s: string) => s.includes("Kapitelplan:");
    const seq = Array.from({ length: ARC_EVERY + 1 }, () => full(turnSummary(w, [hagen], data.rules)));
    expect(seq).toEqual([true, false, false, false, false, true]);
    expect(turnSummary(w, [hagen], data.rules)).toContain("Kapitel „A1“");
    await runAutoTool({ id: "toolu_kap", name: "kapitel_abschliessen", input: { rueckblick: "x", aufgabe: "y" } }, { data, characters: [hagen], world: w, rolls: new RollLog(), onRoll: () => {} });
    expect(full(turnSummary(w, [hagen], data.rules))).toBe(true); // Kapitelwechsel → sofort ausführlich
    expect(turnSummary(w, [hagen], data.rules).length).toBeLessThan(400);
  });
});
