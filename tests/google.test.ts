import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GoogleCloud, googleConfig, parseBudgetPush, TRIAL_DAYS } from "../server/google";
import { SwitchingLlm } from "../server/gm/googleLlm";
import type { LlmClient } from "../server/gm/narrator";
import { ImageMaker, MemoryImageStore } from "../server/images";
import { AudioMaker } from "../server/audio";
import { MemoryCounterStore } from "../server/gm/usage";

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
    expect(cfg.until.toISOString().slice(0, 10)).toBe("2026-03-31");
    const g = new GoogleCloud(cfg);
    expect(g.active(new Date("2026-03-30T12:00:00Z").getTime())).toBe(true);
    expect(g.active(new Date("2026-03-31T00:00:01Z").getTime())).toBe(false);
    expect(TRIAL_DAYS).toBe(89);
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
    // Noch nichts ausgegeben: Luxus-Stufe – Imagen 4 Ultra
    expect(r.costUsd).toBe(0.06);
    expect(calls.some((c) => c.includes("imagen-4.0-ultra-generate-001:predict"))).toBe(true);
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

  it("Ausgabe-Regler: unter dem Tempo Luxus (Opus, Imagen Ultra), darüber normal – einmal pro Tag festgelegt", async () => {
    const cfg = googleConfig({ GOOGLE_SERVICE_ACCOUNT: sa, GOOGLE_TRIAL_START: "2026-01-01", GOOGLE_TRIAL_BUDGET_USD: "89" })!; // 1 $ pro Tag
    const counters = new MemoryCounterStore();
    const g = new GoogleCloud(cfg, fakeGoogle([]), counters);
    const day3 = new Date("2026-01-03T10:00:00Z").getTime(); // Tempo bis Tag 3: 3 $
    await g.addSpend(2.5);
    expect(await g.luxury(day3)).toBe(true);
    await g.addSpend(1);
    expect(await g.luxury(day3)).toBe(true); // am selben Tag bleibt die Stufe
    const g2 = new GoogleCloud(cfg, fakeGoogle([]), counters); // anderer Server, gleicher Tag: gleiche Stufe
    expect(await g2.luxury(day3)).toBe(true);
    expect(await g2.luxury(new Date("2026-01-03T23:00:00Z").getTime() + 3_600_000)).toBe(true); // Tag 4: Tempo 4 $, verbraucht 3,5 $
    await g.addSpend(1);
    expect(await new GoogleCloud(cfg, fakeGoogle([]), counters).luxury(new Date("2026-01-05T08:00:00Z").getTime())).toBe(true); // Tag 5: 5 $ > 4,5 $
    await g.addSpend(2);
    expect(await new GoogleCloud(cfg, fakeGoogle([]), counters).luxury(new Date("2026-01-06T08:00:00Z").getTime())).toBe(false); // Tag 6: 6 $ < 6,5 $
  });

  it("Lücken: Start in der Zukunft = noch aus; Zählfehler bricht nichts ab; gleichzeitig verschieden festgelegt = normal", async () => {
    const future = new GoogleCloud(googleConfig({ GOOGLE_SERVICE_ACCOUNT: sa, GOOGLE_TRIAL_START: "2099-01-01" })!);
    expect(future.active()).toBe(false);
    const broken = { get: async () => { throw new Error("weg"); }, add: async () => { throw new Error("weg"); } };
    const g = new GoogleCloud(googleConfig({ GOOGLE_SERVICE_ACCOUNT: sa, GOOGLE_TRIAL_START: today })!, fakeGoogle([]), broken);
    await expect(g.addSpend(1)).resolves.toBeUndefined();
    expect(await g.luxury()).toBe(false);
    const counters = new MemoryCounterStore();
    const day = new Date().toISOString().slice(0, 10);
    await counters.add(`google-tier-${day}`, 101); // ein Server sagte Luxus, einer normal
    expect(await new GoogleCloud(googleConfig({ GOOGLE_SERVICE_ACCOUNT: sa, GOOGLE_TRIAL_START: today })!, fakeGoogle([]), counters).luxury()).toBe(false);
  });

  it("echte Zahlen: Googles Budget-Meldung ersetzt die Schätzung, danach wird nur der Rest geschätzt", async () => {
    const counters = new MemoryCounterStore();
    const g = new GoogleCloud(googleConfig({ GOOGLE_SERVICE_ACCOUNT: sa, GOOGLE_TRIAL_START: today })!, fakeGoogle([]), counters);
    await g.addSpend(10); // Schätzung 10 $
    const push = { message: { data: Buffer.from(JSON.stringify({ costAmount: 12.5, currencyCode: "USD", budgetAmount: 300 })).toString("base64") } };
    expect(parseBudgetPush(push)).toEqual({ cost: 12.5, currency: "USD" });
    expect(parseBudgetPush({ message: { data: "kaputt" } })).toBeNull();
    await g.recordBilled(12.5);
    expect(await g.spentUsd()).toBeCloseTo(12.5);
    await g.addSpend(2); // nach der Meldung geschätzt
    expect(await g.spentUsd()).toBeCloseTo(14.5);
    await g.recordBilled(11); // ältere, verspätete Meldung wird ignoriert
    expect(await g.spentUsd()).toBeCloseTo(14.5);
    await g.recordBilled(15); // neue Meldung enthält die 2 $ schon
    expect(await g.spentUsd()).toBeCloseTo(15);
  });
});
