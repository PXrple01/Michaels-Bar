import { describe, expect, it } from "vitest";
import { AnthropicLlm, errorEvent } from "../server/gm/narrator";

/** Nachgebaute Anthropic-API: lehnt Anfragen mit `fallbacks` ab, sonst kommt eine kurze gestreamte Antwort. */
function fakeApi(rejectFallback: boolean, alwaysReject = false) {
  const bodies: Record<string, unknown>[] = [];
  const fetch = async (_url: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    if (alwaysReject || (rejectFallback && "fallbacks" in body)) {
      return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: alwaysReject ? "output_config.format: schema too complex" : "fallbacks: not supported here" } }), { status: 400, headers: { "content-type": "application/json" } });
    }
    const events = [
      ["message_start", { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, usage: { input_tokens: 5, output_tokens: 0 } } }],
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hallo" } }],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
      ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } }],
      ["message_stop", { type: "message_stop" }],
    ];
    return new Response(events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  return { bodies, fetch: fetch as unknown as typeof globalThis.fetch };
}

const params = { model: "claude-opus-5-5", max_tokens: 100, betas: ["server-side-fallback-2026-07-01", "compact-2026-01-12"], fallbacks: "default", messages: [{ role: "user", content: "Hi" }] } as never;

describe("Verbindung zu Claude", () => {
  it("lehnt die API das Ersatzmodell ab, geht es ohne weiter – und bleibt dabei", async () => {
    const api = fakeApi(true);
    const llm = new AnthropicLlm("test", { fetch: api.fetch, maxRetries: 0 });
    let text = "";
    const msg = await llm.stream(params, (t) => { text += t; });
    expect(text).toBe("Hallo");
    expect(msg.stop_reason).toBe("end_turn");
    expect(api.bodies).toHaveLength(2);
    expect(api.bodies[1]).not.toHaveProperty("fallbacks");
    await llm.stream(params, () => {});
    expect(api.bodies).toHaveLength(3); // kein erneuter Fehlversuch
  });

  it("andere 400-Fehler zeigen die genaue Meldung der API", async () => {
    const api = fakeApi(false, true);
    const llm = new AnthropicLlm("test", { fetch: api.fetch, maxRetries: 0 });
    const err = await llm.stream(params, () => {}).then(() => null, (e: unknown) => e);
    expect(api.bodies).toHaveLength(2); // ein Versuch ohne Ersatzmodell, dann aufgeben
    expect(errorEvent(err).message).toContain("schema too complex");
  });
});
