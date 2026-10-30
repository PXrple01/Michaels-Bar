import { describe, expect, it } from "vitest";
import { AudioMaker, shrinkWav } from "../server/audio";
import { MemoryImageStore } from "../server/images";
import { MemoryCounterStore } from "../server/gm/usage";
import { moodOf, weatherKind } from "../shared/scene";
import type { WorldState } from "../shared/world";

/** WAV mit 2 Kanälen, 44,1 kHz, 16 Bit, n Frames. */
function wav(frames: number): Uint8Array {
  const b = new Uint8Array(44 + frames * 4), v = new DataView(b.buffer);
  const w = (p: number, s: string) => { for (let i = 0; i < 4; i++) b[p + i] = s.charCodeAt(i); };
  w(0, "RIFF"); v.setUint32(4, 36 + frames * 4, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 2, true); v.setUint32(24, 44100, true); v.setUint32(28, 44100 * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, frames * 4, true);
  for (let i = 0; i < frames * 2; i++) v.setInt16(44 + i * 2, 1000, true);
  return b;
}

const bodies: Record<string, unknown>[] = [];
function fakeFal(calls: string[]) {
  return (async (url: string, init?: RequestInit) => {
    calls.push(url);
    if (url.startsWith("https://fal.run/fal-ai/elevenlabs/tts")) { bodies.push(JSON.parse(String(init?.body))); return Response.json({ audio: { url: "https://cdn/x.mp3" } }); }
    if (url.startsWith("https://fal.run/fal-ai/elevenlabs/music")) return Response.json({ audio: { url: "https://cdn/x.wav" } });
    if (url.endsWith(".mp3")) return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } });
    if (url.endsWith(".wav")) return new Response(new Uint8Array(wav(44100)).buffer, { headers: { "content-type": "audio/wav" } });
    return new Response("?", { status: 404 });
  }) as unknown as typeof fetch;
}

describe("Ton (fal.ai)", () => {
  it("Vorlesen: Kosten nach Zeichen, gleicher Text kostet beim zweiten Mal nichts", async () => {
    const calls: string[] = [];
    const a = new AudioMaker({ key: "k", store: new MemoryImageStore(), fetch: fakeFal(calls) });
    const text = "Der Sturm heult dir ins Gesicht. ".repeat(30);
    const first = await a.speak(text);
    expect(first.url).toMatch(/^\/api\/images\/tts-/);
    expect(first.costUsd).toBeCloseTo((text.trim().length / 1000) * 0.05, 4);
    expect(bodies.at(-1)).toMatchObject({ voice: "Daniel", language_code: "de" });
    const again = await a.speak(text);
    expect(again).toEqual({ url: first.url, costUsd: 0 });
    expect(calls.filter((c) => c.includes("fal.run")).length).toBe(1);
  });

  it("Musik: einmal erzeugt, WAV verkleinert (Mono, 22 kHz), danach kostenlos", async () => {
    const calls: string[] = [];
    const store = new MemoryImageStore();
    const a = new AudioMaker({ key: "k", store, fetch: fakeFal(calls) });
    const r = await a.music("taverne");
    expect(r.costUsd).toBeCloseTo((40 / 60) * 0.8, 4);
    const saved = await store.get("music-taverne-v2");
    expect(saved!.bytes.length).toBe(44 + 22050 * 2); // 1 s Stereo 44,1 kHz → 1 s Mono 22 kHz
    expect((await a.music("taverne")).costUsd).toBe(0);
  });

  it("WAV verkleinern lässt Unbekanntes unverändert", () => {
    const junk = new Uint8Array([1, 2, 3, 4]);
    expect(shrinkWav(junk)).toBe(junk);
  });

  it("ohne Schlüssel: Fehler", async () => {
    await expect(new AudioMaker({ store: new MemoryImageStore() }).speak("Hallo Welt")).rejects.toThrow(/FAL_KEY/);
  });
});

describe("Stimmung und Wetter", () => {
  const w = (o: Partial<WorldState>) => ({ combat: null, ...o }) as WorldState;
  it("Musik passt zu Kampf, Ort und Nacht", () => {
    const map = (kind: string) => ({ places: [{ name: "X", kind, x: 0, y: 0, visits: 1, day: 1 }], roads: [], current: "X" }) as never;
    expect(moodOf(w({ combat: { round: 1, enemies: [] } }))).toBe("kampf");
    expect(moodOf(w({ map: map("gasthaus") }))).toBe("taverne");
    expect(moodOf(w({ map: map("wald"), time: { day: 1, phase: "nacht", weather: "" } }))).toBe("nacht");
    expect(moodOf(w({ map: map("gasthaus"), time: { day: 1, phase: "nacht", weather: "" } }))).toBe("taverne");
    expect(moodOf(w({ map: map("hoehle") }))).toBe("dunkel");
    expect(moodOf(w({}))).toBe("wildnis");
  });
  it("Wetter wird erkannt", () => {
    expect(weatherKind("Schneesturm")).toBe("snow");
    expect(weatherKind("Regen")).toBe("rain");
    expect(weatherKind("stürmisch, Gewitter")).toBe("storm");
    expect(weatherKind("dichter Nebel")).toBe("fog");
    expect(weatherKind("stürmisch")).toBe("storm");
    expect(weatherKind("kalt und klar")).toBeNull();
  });
});

describe("Vorlesen über Google (kostenloses Kontingent)", () => {
  const google = (calls: string[]) => (async (url: string, init?: RequestInit) => {
    calls.push(url);
    if (url.startsWith("https://texttospeech.googleapis.com")) { bodies.push(JSON.parse(String(init?.body))); return Response.json({ audioContent: Buffer.from([1, 2, 3]).toString("base64") }); }
    return fakeFal(calls)(url, init);
  }) as unknown as typeof fetch;

  it("liest kostenlos mit deutscher WaveNet-Stimme, zählt Zeichen, gleicher Text zählt nicht doppelt", async () => {
    const calls: string[] = [];
    const counters = new MemoryCounterStore();
    const a = new AudioMaker({ key: "fal", googleKey: "g", counters, store: new MemoryImageStore(), fetch: google(calls) });
    const r = await a.speak("Nebel hängt über dem Kloster.");
    expect(r.costUsd).toBe(0);
    expect(bodies.at(-1)).toMatchObject({ voice: { languageCode: "de-DE", name: "de-DE-Wavenet-B" } });
    await a.speak("Nebel hängt über dem Kloster.");
    expect(calls.filter((c) => c.includes("googleapis")).length).toBe(1);
    expect(calls.some((c) => c.includes("fal.run"))).toBe(false);
  });

  it("ist das Kontingent aufgebraucht: Pause – oder ElevenLabs, wenn ausdrücklich erlaubt", async () => {
    const calls: string[] = [];
    const counters = new MemoryCounterStore();
    const full = new AudioMaker({ key: "fal", googleKey: "g", counters, freeChars: 10, store: new MemoryImageStore(), fetch: google(calls) });
    await expect(full.speak("Ein viel zu langer Satz.")).rejects.toThrow(/Kontingent/);
    const paid = new AudioMaker({ key: "fal", googleKey: "g", counters, freeChars: 10, paidFallback: true, store: new MemoryImageStore(), fetch: google(calls) });
    expect((await paid.speak("Ein viel zu langer Satz.")).costUsd).toBeGreaterThan(0);
    expect(calls.some((c) => c.includes("elevenlabs/tts"))).toBe(true);
  });
});
