import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { PartyEvent, PartyView } from "../shared/party";
import { allDown, initWorld, worldSummary } from "../shared/world";
import { buildCharacter } from "../server/characters";
import { RollLog } from "../server/dice/log";
import { Narrator, type LlmClient } from "../server/gm/narrator";
import { MemoryPartyStore, PartyService } from "../server/gm/party";
import { MemoryCounterStore, UsageGuard } from "../server/gm/usage";
import { enforceDefeat, runAutoTool } from "../server/gm/world";
import { loadGameData } from "../server/rules/loader";

const data = await loadGameData(path.resolve(__dirname, "../data"));
const mk = (name: string, classId: string, skills: string[]) =>
  buildCharacter({ name, stand: "bauer", classId, attributes: data.classes.find((c) => c.id === classId)!.recommendedAttributes, chosenSkills: skills }, data);
const hagen = mk("Hagen", "ritter", ["reiten", "wahrnehmung"]);
const agnes = mk("Agnes", "moench", ["glaube_sagen"]);

type Params = Parameters<LlmClient["stream"]>[0];
type Reply = Partial<Anthropic.Beta.BetaMessage> | Error | "hang";
class FakeLlm implements LlmClient {
  calls: Params[] = [];
  constructor(private replies: Reply[]) {}
  async stream(params: Params, onText: (t: string) => void, signal?: AbortSignal) {
    this.calls.push(structuredClone(params));
    const r = this.replies.shift()!;
    if (r instanceof Error) throw r;
    if (r === "hang") return new Promise<never>((_, reject) => signal?.addEventListener("abort", () => reject(new Error("abgebrochen"))));
    for (const b of r.content ?? []) if (b.type === "text") onText(b.text);
    return { id: "m", type: "message", role: "assistant", model: "fake", stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 50 }, ...r } as Anthropic.Beta.BetaMessage;
  }
}
const text = (t: string) => ({ content: [{ type: "text", text: t, citations: null }] as Anthropic.Beta.BetaContentBlock[] });
const tools = (t: string, ...uses: { name: string; input: object }[]) => ({
  stop_reason: "tool_use" as const,
  content: [{ type: "text", text: t, citations: null }, ...uses.map((u, i) => ({ type: "tool_use", id: `toolu_d${i}${Math.random().toString(36).slice(2, 6)}`, ...u }))] as Anthropic.Beta.BetaContentBlock[],
});

function setup(replies: Reply[], turnBudgetMs?: number) {
  const llm = new FakeLlm(replies);
  const guard = new UsageGuard(new MemoryCounterStore(), 10, 100);
  const narrator = new Narrator({ llm, rolls: new RollLog(), guard, turnBudgetMs });
  const store = new MemoryPartyStore();
  const svc = new PartyService({ data: () => data, narrator, guard, store, secret: "s".repeat(20) });
  const run = async (op: "start" | "action" | "roll", body: Record<string, unknown>) => {
    const evs: PartyEvent[] = [];
    await svc.run(op, body, "t", (e) => evs.push(e));
    return evs;
  };
  /** Gespeicherte Gruppe direkt verändern (wie ein abgebrochener Zug oder ein verlorener Kampf). */
  const patch = async (code: string, fn: (p: Awaited<ReturnType<MemoryPartyStore["get"]>> & object) => void) => {
    const got = (await store.get(code))!;
    fn(got);
    await store.put(got.party, got.etag);
  };
  return { svc, llm, run, patch };
}
const viewOf = (evs: PartyEvent[]) => (evs.find((e) => e.type === "view") as { view: PartyView } | undefined)?.view;
const ctx = (w: ReturnType<typeof initWorld>) => ({ data, characters: [hagen, agnes], world: w, rolls: new RollLog(), onRoll: () => {} });

async function playingParty(replies: Reply[], turnBudgetMs?: number) {
  const s = setup([text("Ihr steht am Tor."), ...replies], turnBudgetMs);
  const host = await s.svc.create({ character: hagen });
  const guest = await s.svc.join({ code: host.code, character: agnes });
  await s.run("start", { code: host.code, token: host.token });
  return { ...s, host, guest };
}
const downAll = (p: { party: { world: ReturnType<typeof initWorld> | null } }) => {
  const w = p.party.world!;
  for (const id of Object.keys(w.hp)) w.hp[id] = 0;
  w.combat = { round: 2, enemies: [{ id: "e1", name: "Räuber", hp: 7, maxHp: 7, armor: 11 }] };
};

describe("Niederlage", () => {
  it("eine einzelne bewusstlose Figur ist rettbar – erst wenn alle liegen, droht das Ende", async () => {
    const w = initWorld([hagen, agnes]);
    w.combat = { round: 1, enemies: [{ id: "e", name: "Räuber", hp: 7, maxHp: 7, armor: 11 }] };
    w.hp[hagen.id] = 0;
    expect(allDown(w, [hagen, agnes])).toBe(false);
    expect(worldSummary(w, [hagen, agnes])).toContain("bewusstlos, aber rettbar");
    expect(enforceDefeat(w, [hagen, agnes])).toBe(false);
    const early = await runAutoTool({ id: "toolu_x", name: "abenteuer_beenden", input: { epilog: "x", ausgang: "niederlage" } }, ctx(w));
    expect(early.is_error).toBe(true);

    w.hp[agnes.id] = 0;
    expect(worldSummary(w, [hagen, agnes])).toContain("ALLE Figuren sind kampfunfähig");
    const end = await runAutoTool({ id: "toolu_y", name: "abenteuer_beenden", input: { epilog: "Sie fielen im Schnee.", ausgang: "niederlage" } }, ctx(w));
    expect(end.is_error).toBeUndefined();
    expect(w.arc).toMatchObject({ finished: true, outcome: "niederlage", epilog: "Sie fielen im Schnee." });
    expect(w.combat).toBeNull();
  });

  it("ohne Rettung erzwingt der Server die Niederlage – danach keine Züge mehr", async () => {
    const { run, patch, host, guest } = await playingParty([text("Die Räuber stehen über euch. » Vorschläge: Aufstehen | Betteln")]);
    await patch(host.code, downAll);
    await run("action", { code: host.code, token: host.token, text: "Ich versuche aufzustehen." });
    const v = viewOf(await run("action", { code: host.code, token: guest.token, text: "Ich bete." }))!;
    expect(v.world?.arc).toMatchObject({ finished: true, outcome: "niederlage" });
    expect(v.world?.arc?.epilog).toBeTruthy();
    expect(v.pendings).toEqual([]);
    expect((await run("action", { code: host.code, token: host.token, text: "Weiter!" })).at(-1)).toMatchObject({ type: "error", message: expect.stringMatching(/abgeschlossen/) });
  });

  it("ein Verbündeter kann retten: Heilung verhindert die Niederlage", async () => {
    const { run, patch, host, guest } = await playingParty([
      tools("Bruder Anselm stürzt herbei.", { name: "heilen", input: { ziel: "Agnes", wuerfel: "1W8+2", grund: "Kräutertrank" } }),
      text("Agnes kommt zu sich. » Vorschläge: Fliehen | Kämpfen"),
    ]);
    await patch(host.code, downAll);
    await run("action", { code: host.code, token: host.token, text: "…" });
    const v = viewOf(await run("action", { code: host.code, token: guest.token, text: "…" }))!;
    expect(v.world?.arc?.finished).toBe(false);
    expect(v.world?.hp[agnes.id]).toBeGreaterThan(0);
  });
});

describe("Kein Hängenbleiben bei „Der Spielleiter erzählt …“", () => {
  it("Fehler im Zug: Sperre weg, Meldung für alle, Handlungen bleiben – jeder kann es erneut versuchen", async () => {
    const { svc, run, llm, host, guest } = await playingParty([new Error("Netzwerk weg"), text("Es geht weiter. » Vorschläge: A | B")]);
    await run("action", { code: host.code, token: host.token, text: "Ich klopfe." });
    const failed = await run("action", { code: host.code, token: guest.token, text: "Ich warte." });
    expect(failed.at(-1)).toMatchObject({ type: "error" });
    const v = await svc.state({ code: host.code, token: host.token });
    expect(v.busy).toBe(false);
    expect(v.failed).toBeTruthy();
    expect(v.players.every((p) => p.acted)).toBe(true);
    expect(v.story.map((s) => s.type)).toEqual(["gm"]); // die Handlungs-Zeile wurde zurückgenommen

    const again = viewOf(await run("action", { code: host.code, token: guest.token, text: "", retry: true }))!; // auch Nicht-Gastgeber
    expect(llm.calls).toHaveLength(3);
    expect(again.failed).toBeNull();
    expect(again.story.map((s) => s.type)).toEqual(["gm", "actions", "gm"]);
    expect(again.players.some((p) => p.acted)).toBe(false);
  });

  it("verwaiste Sperre (Funktion abgebrochen) löst sich von selbst und nimmt den halben Zug zurück", async () => {
    const { svc, patch, host } = await playingParty([]);
    await patch(host.code, ({ party }) => {
      party.story.push({ type: "actions", items: [] });
      party.busy = { since: new Date(Date.now() - 5 * 60_000).toISOString(), op: "action", storyLen: 1, pending: null } as typeof party.busy;
      party.live = "Halber Satz";
    });
    const v = await svc.state({ code: host.code, token: host.token });
    expect(v.busy).toBe(false);
    expect(v.live).toBe("");
    expect(v.failed).toMatch(/unterbrochen/);
    expect(v.story).toHaveLength(1);
  });

  it("Zeitbudget: hängt das Modell, bricht der Zug sauber ab", async () => {
    const { run, host, guest } = await playingParty(["hang"], 50);
    await run("action", { code: host.code, token: host.token, text: "a" });
    const evs = await run("action", { code: host.code, token: guest.token, text: "b" });
    expect(evs.at(-1)).toMatchObject({ type: "error", message: expect.stringMatching(/zu lange/) });
  });

  it("Zeitbudget knapp: kein weiterer Modellaufruf – Werkzeug-Ergebnisse gehen mit der nächsten Handlung mit", async () => {
    const { run, llm, host, guest } = await playingParty([tools("Ihr merkt euch den Namen.", { name: "merken", input: { text: "Der Wirt heißt Utz." } })], 10_000);
    await run("action", { code: host.code, token: host.token, text: "a" });
    const v = viewOf(await run("action", { code: host.code, token: guest.token, text: "b" }))!;
    expect(llm.calls).toHaveLength(2); // Start + ein Aufruf, kein zweiter
    expect(v.busy).toBe(false);
    expect(v.story.at(-1)).toMatchObject({ type: "gm", text: "Ihr merkt euch den Namen." });
  });
});

