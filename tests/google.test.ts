import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GoogleCloud, googleConfig, TRIAL_DAYS } from "../server/google";
import { SwitchingLlm } from "../server/gm/googleLlm";
import type { LlmClient } from "../server/gm/narrator";
import { ImageMaker, MemoryImageStore } from "../server/images";
import { AudioMaker } from "../server/audio";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const sa = JSON.stringify({ client_email: "spiel@projekt.iam.gserviceaccount.com", private_key: privateKey, project_id: "projekt" });
const today = new Date().toISOString().slice(0, 10);

/** Schein-Google: Anmeldung, Imagen, Text-to-Speech. */
function fakeGoogle(calls: string[], fail?: number) {
  return (async (url: string, init?: RequestInit) => {
    calls.push(url);
    if (url.includes("oauth2.googleapis.com")) return Response.json({ access_token: "tok", expires_in: 3600 });
    if (fail) return new Response("nein", { status: fail });
    if (url.includes(":predict")) return Response.json({ predictions: [{ bytesBase64Encoded: Buffer.from([1, 2]).toString("base64"), mimeType: "image/jpeg" }] });
    if (url.includes("texttospeech")) { calls.push(`voice:${JSON.parse(String(init?.body)).voice.name}`); return Response.json({ audioContent: Buffer.from([1]).toString("base64") }); }
    return new Response("?", { status: 404 });
  }) as unknown as typeof fetch;
}

describe("Google-Testphase", () => {
  it("nur mit Dienstkonto und Startdatum; endet nach 88 Tagen von selbst", () => {
    expect(googleConfig({ GOOGLE_SERVICE_ACCOUNT: sa })).toBeNull();
    expect(googleConfig({ GOOGLE_TRIAL_START: today })).toBeNull();
    const cfg = googleConfig({ GOOGLE_SERVICE_ACCOUNT: sa, GOOGLE_TRIAL_START: "2026-01-01" })!;
    expect(cfg.until.toISOString().slice(0, 10)).toBe("2026-03-30");
    const g = new GoogleCloud(cfg);
    expect(g.active(new Date("2026-03-29T12:00:00Z").getTime())).toBe(true);
    expect(g.active(new Date("2026-03-30T00:00:01Z").getTime())).toBe(false);
    expect(TRIAL_DAYS).toBe(88);
  });

  it("Claude: nach der Testphase sofort Anthropic, ohne Google zu fragen", async () => {
    const g = new GoogleCloud(googleConfig({ GOOGLE_SERVICE_ACCOUNT: sa, GOOGLE_TRIAL_START: "2020-01-01" })!, fakeGoogle([]));
    const backup: LlmClient = { stream: async () => ({ content: [{ type: "text", text: "Anthropic" }] }) as never };
    const llm = new SwitchingLlm(g, backup);
    const msg = await llm.stream({ model: "claude-sonnet-5-5", max_tokens: 10, messages: [] } as never, () => {});
    expect((msg.content[0] as { text: string }).text).toBe("Anthropic");
  });

  it("Bilder: im Zeitfenster Imagen; lehnt Google ab (Guthaben weg), malt wieder fal.ai – und Google bleibt eine Weile aus", async () => {
    const calls: string[] = [];
    const g = new GoogleCloud(googleConfig({ GOOGLE_SERVICE_ACCOUNT: sa, GOOGLE_TRIAL_START: today })!, fakeGoogle(calls));
    const maker = new ImageMaker({ key: undefined, store: new MemoryImageStore(), google: g, fetch: fakeGoogle(calls) });
    const r = await maker.make("A misty monastery", "landscape_4_3");
    expect(r.costUsd).toBe(0.04);
    expect(calls.some((c) => c.includes("imagen-4.0-generate-001:predict"))).toBe(true);
    const broke = new GoogleCloud(googleConfig({ GOOGLE_SERVICE_ACCOUNT: sa, GOOGLE_TRIAL_START: today })!, fakeGoogle([], 403));
    const falCalls: string[] = [];
    const fal = (async (url: string) => { falCalls.push(url); if (url.includes("fal.run")) return Response.json({ images: [{ url: "data:image/webp;base64,AQI=", width: 1024, height: 768 }] }); return fakeGoogle([], 403)(url); }) as unknown as typeof fetch;
    const m2 = new ImageMaker({ key: "fal", store: new MemoryImageStore(), google: broke, fetch: fal });
    expect((await m2.make("A misty monastery", "landscape_4_3")).costUsd).toBe(0.012);
    expect(broke.active()).toBe(false);
  });

  it("Vorlesen: im Zeitfenster Chirp-Stimmen (Erzähler Charon), sonst wie bisher", async () => {
    const calls: string[] = [];
    const g = new GoogleCloud(googleConfig({ GOOGLE_SERVICE_ACCOUNT: sa, GOOGLE_TRIAL_START: today })!, fakeGoogle(calls));
    const a = new AudioMaker({ store: new MemoryImageStore(), google: g, fetch: fakeGoogle(calls) });
    const r = await a.speak("Nebel hängt über dem Kloster.");
    expect(r.costUsd).toBeGreaterThan(0);
    expect(calls).toContain("voice:de-DE-Chirp3-HD-Charon");
  });
});
