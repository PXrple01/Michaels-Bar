import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { buildCharacter } from "../server/characters";
import { RollLog } from "../server/dice/log";
import { Narrator, type LlmClient } from "../server/gm/narrator";
import { OpenAiGateway, type OaiResult } from "../server/gm/openai";
import { MemoryCounterStore, UsageGuard } from "../server/gm/usage";
import { loadGameData } from "../server/rules/loader";

const data = await loadGameData(path.resolve(__dirname, "../data"));
const KEY = "sk-test-schluessel";
const SECRET = "s".repeat(20);

type Params = Parameters<LlmClient["stream"]>[0];
type Block = Anthropic.Beta.BetaContentBlock;
class FakeLlm implements LlmClient {
  calls: Params[] = [];
  constructor(private replies: Partial<Anthropic.Beta.BetaMessage>[]) {}
  async stream(params: Params, onText: (t: string) => void) {
    this.calls.push(structuredClone(params));
    const r = this.replies.shift() ?? text("…");
    for (const b of r.content ?? []) if (b.type === "text") onText(b.text);
    return { id: "m", type: "message", role: "assistant", model: "fake", stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 50 }, ...r } as Anthropic.Beta.BetaMessage;
  }
}
const text = (t: string) => ({ content: [{ type: "text", text: t, citations: null }] as Block[] });
const tools = (t: string, ...uses: { id: string; name: string; input: object }[]) => ({
  stop_reason: "tool_use" as const,
  content: [{ type: "text", text: t, citations: null }, ...uses.map((u) => ({ type: "tool_use", ...u }))] as Block[],
});

function setup(replies: Partial<Anthropic.Beta.BetaMessage>[], apiKey: string | undefined = KEY) {
  const llm = new FakeLlm(replies);
  const guard = new UsageGuard(new MemoryCounterStore(), 10);
  const narrator = new Narrator({ llm, rolls: new RollLog(), guard });
  const gw = new OpenAiGateway({ data: () => data, narrator, guard, secret: SECRET, apiKey });
  const chat = (body: object) => gw.handle("POST", "/v1/chat/completions", `Bearer ${KEY}`, { model: "michaels-bar", ...body }, "t") as Promise<{ status: number; json: any }>;
  return { llm, gw, chat };
}
const answer = (r: { json: any }) => r.json.choices[0].message.content as string;

describe("OpenAI-kompatible Schnittstelle", () => {
  it("ist ohne Schlüssel abgeschaltet und prüft den Schlüssel", async () => {
    expect((await setup([], "").gw.handle("GET", "/v1/models", `Bearer ${KEY}`, null, "t")).status).toBe(404);
    const { gw } = setup([]);
    expect((await gw.handle("GET", "/v1/models", "Bearer falsch", null, "t")).status).toBe(401);
    const models = (await gw.handle("GET", "/v1/models", `Bearer ${KEY}`, null, "t")) as { json: any };
    expect(models.json.data.map((m: { id: string }) => m.id)).toEqual(["the-last-ember", "the-last-ember-einfach"]);
  });

  it("neues Abenteuer: Figur und Startimpuls gehen an Claude – derselbe Anfang ergibt denselben Startimpuls", async () => {
    const { llm, chat } = setup([text("Der Regen prasselt.\n» Vorschläge: A | B"), text("Wieder Regen.")]);
    const r = await chat({ messages: [{ role: "system", content: "Antworte kurz." }, { role: "user", content: "Lass uns spielen!" }] });
    expect(r.status).toBe(200);
    expect(answer(r)).toContain("Der Regen prasselt.");
    expect(answer(r)).toMatch(/<!-- the-last-ember:[\w-]+\.[\w-]+ -->$/);
    const kickoff = llm.calls[0].messages[0].content as string;
    expect(kickoff).toContain("Wanderer");
    expect(kickoff).toContain("Antworte kurz.");
    expect(kickoff).toContain("Lass uns spielen!");
    await chat({ messages: [{ role: "system", content: "Antworte kurz." }, { role: "user", content: "Lass uns spielen!" }] });
    expect(llm.calls[1].messages[0].content).toBe(kickoff);
    expect(llm.calls[0].context_management).toBeUndefined(); // keine Zusammenfassung ohne gespeicherten Verlauf
  });

  it("Proben würfelt der Server sofort und schreibt den Wurf in die Antwort", async () => {
    const { llm, chat } = setup([
      tools("Die Mauer ist glitschig.", { id: "toolu_p1", name: "probe_anfordern", input: { art: "skill", id: "athletik", sg: 12, modus: "normal", grund: "Klettern" } }),
      text("Du ziehst dich hoch."),
    ]);
    const r = await chat({ messages: [{ role: "user", content: "Ich klettere über die Mauer." }] });
    expect(answer(r)).toMatch(/Die Mauer ist glitschig\.[\s\S]*🎲 \*Wanderer: Athletik-Probe: .* gegen SG 12 – (nicht )?geschafft[\s\S]*Du ziehst dich hoch\./);
    expect((llm.calls[1].messages.at(-1)!.content as { type: string }[])[0].type).toBe("tool_result");
  });

  it("der Spielstand reist signiert mit – Fälschungen werden ignoriert", async () => {
    const { llm, chat } = setup([
      tools("Zwei Räuber springen hervor!\n» Vorschläge: Kämpfen | Fliehen", { id: "toolu_k1", name: "kampf_beginnen", input: { gegner: [{ name: "Räuber", trefferpunkte: 7, ruestung: 11 }] } }),
      text("Weiter."), text("Weiter."),
    ]);
    const first = await chat({ messages: [{ role: "user", content: "Ich gehe in den Wald." }] });
    expect(llm.calls).toHaveLength(1); // Buchführung kostet keinen zweiten Aufruf
    const history = [{ role: "user", content: "Ich gehe in den Wald." }, { role: "assistant", content: answer(first) }, { role: "user", content: "Ich ziehe mein Schwert." }];
    await chat({ messages: history });
    const sent = llm.calls[1].messages.at(-1)!.content as string;
    expect(sent).toContain("Kampf (Runde 1): Räuber 7/7 TP");
    expect(JSON.stringify(llm.calls[1].messages)).not.toContain("the-last-ember:"); // Kommentar geht nicht an Claude
    const forged = answer(first).replace(/\.([\w-]+) -->$/, ".AAAA -->");
    await chat({ messages: [history[0], { role: "assistant", content: forged }, history[2]] });
    expect(llm.calls[2].messages.at(-1)!.content).not.toContain("Kampf");
  });

  it("Modell „einfach“ hängt keinen Spielstand an", async () => {
    const { chat } = setup([text("Hallo.")]);
    const r = await chat({ model: "michaels-bar-einfach", messages: [{ role: "user", content: "Hi" }] });
    expect(answer(r)).toBe("Hallo.");
  });

  it("eigene Figur per Erweiterung „character“", async () => {
    const { llm, chat } = setup([text("Ja.")]);
    const c = buildCharacter({ name: "Agnes", stand: "bauer", classId: "moench", attributes: data.classes.find((x) => x.id === "moench")!.recommendedAttributes, chosenSkills: ["glaube_sagen"] }, data);
    await chat({ character: c, messages: [{ role: "user", content: "Hi" }] });
    expect(llm.calls[0].messages[0].content).toContain("Agnes");
  });

  it("streamt im OpenAI-Format", async () => {
    const { gw } = setup([text("Es dämmert.")]);
    const r = (await gw.handle("POST", "/v1/chat/completions", `Bearer ${KEY}`, { model: "michaels-bar-einfach", stream: true, stream_options: { include_usage: true }, messages: [{ role: "user", content: "Hi" }] }, "t")) as Extract<OaiResult, { stream: unknown }>;
    let out = "";
    await r.stream((c) => { out += c; });
    const events = out.trim().split("\n\n").map((l) => l.replace(/^data: /, ""));
    expect(events.at(-1)).toBe("[DONE]");
    const chunks = events.slice(0, -1).map((e) => JSON.parse(e));
    expect(chunks[0].choices[0].delta.role).toBe("assistant");
    expect(chunks.map((c) => c.choices[0]?.delta?.content ?? "").join("")).toBe("Es dämmert.");
    expect(chunks.find((c) => c.choices[0]?.finish_reason === "stop")).toBeTruthy();
    expect(chunks.at(-1).usage.completion_tokens).toBe(50);
  });

  it("lehnt ungültige Anfragen verständlich ab", async () => {
    const { chat } = setup([]);
    expect((await chat({ model: "gpt-4", messages: [{ role: "user", content: "x" }] })).status).toBe(404);
    expect((await chat({ messages: [{ role: "assistant", content: "x" }] })).status).toBe(400);
  });
});
