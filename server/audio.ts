// Ton über fal.ai: Vorlesen der Erzählung (MiniMax Speech 2.8 Turbo, Deutsch) und Stimmungsmusik je Szene
// (ElevenLabs Music). Beides wird gespeichert und wiederverwendet: derselbe Text kostet nur einmal, jede Musik-Stimmung
// wird nur ein einziges Mal erzeugt – danach keine laufenden Kosten.
import { createHash } from "node:crypto";
import type { ImageStore, StoredImage } from "./images";

export const TTS_MODEL = "fal-ai/minimax/speech-2.8-turbo";
export const MUSIC_MODEL = "fal-ai/elevenlabs/music";
/** Preise (Richtwerte): Vorlesen 0,06 $ je 1000 Zeichen (Turbo – HD kostete 0,10 $), Musik ca. 0,80 $ je Minute (nur einmal je Stimmung). */
const TTS_USD_PER_1000 = 0.06, MUSIC_USD_PER_MIN = 0.8;
export const MAX_TTS_CHARS = 3000;
const MUSIC_SECONDS = 40;
/** Erzählerstimme (tiefe Männerstimme, ruhig) – mit deutscher Aussprache. */
const NARRATOR_VOICE = "Deep_Voice_Man";
/** Stimmen für wörtliche Rede (MiniMax-Systemstimmen). */
export const VOICES = ["Deep_Voice_Man", "Young_Knight", "Determined_Man", "Patient_Man", "Elegant_Man", "Imposing_Manner", "Casual_Guy", "Wise_Woman", "Calm_Woman", "Abbess", "Lively_Girl", "Friendly_Person"] as const;
export interface Segment { text: string; voice?: string }
const MAX_SEGMENTS = 16;

/** Stimmungen und wie sie klingen sollen (instrumental, als Schleife spielbar). */
export const MOODS = {
  taverne: "Medieval tavern music, lute and hurdy-gurdy with soft hand drum, warm and lively but gentle, instrumental, seamless loop",
  wald: "Mysterious medieval forest ambience, soft wooden flute and harp, distant birds, calm and magical, instrumental, seamless loop",
  kampf: "Intense medieval battle music, pounding war drums, low strings and horns, urgent and heroic, instrumental, seamless loop",
  nacht: "Quiet medieval night, sparse harp notes over a low drone, crickets, calm and slightly eerie, instrumental, seamless loop",
  kirche: "Monastery ambience, slow organ drone and wordless choir pad, reverent and peaceful, instrumental, seamless loop",
  stadt: "Medieval market town music, bagpipe, recorder and frame drum, bustling and cheerful, instrumental, seamless loop",
  wildnis: "Medieval travel music across open landscape, fiddle and frame drum, adventurous and hopeful, instrumental, seamless loop",
  dunkel: "Dark dungeon ambience, low droning strings, dripping water, tense and ominous, instrumental, seamless loop",
} as const;
export type Mood = keyof typeof MOODS;
export const isMood = (m: unknown): m is Mood => typeof m === "string" && m in MOODS;

export class AudioMaker {
  constructor(private o: { key?: string; store: ImageStore; fetch?: typeof fetch }) {}

  get ready() { return !!this.o.key; }

  private async run(model: string, input: unknown, timeoutMs: number): Promise<Record<string, unknown>> {
    if (!this.o.key) throw new Error("Ton ist nicht eingerichtet (FAL_KEY fehlt).");
    const res = await (this.o.fetch ?? fetch)(`https://fal.run/${model}`, {
      method: "POST",
      headers: { authorization: `Key ${this.o.key}`, "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      console.error(`[Ton] fal.ai ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
      throw new Error(res.status === 401 || res.status === 403 ? "Der fal.ai-Schlüssel wurde abgelehnt (Modell freigegeben?)." : `fal.ai hat abgelehnt (${res.status}).`);
    }
    return (await res.json()) as Record<string, unknown>;
  }

  private async download(url: string, fallbackType: string): Promise<StoredImage> {
    const r = await (this.o.fetch ?? fetch)(url, { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error("Ton konnte nicht geladen werden.");
    // Manche Speicher liefern „application/octet-stream“ – dann die bekannte Art nehmen, damit Browser abspielen
    const type = r.headers.get("content-type") ?? "";
    return { type: type.startsWith("audio/") ? type : fallbackType, bytes: new Uint8Array(await r.arrayBuffer()) };
  }

  /**
   * Vorlesen mit Figurenstimmen: Abschnitte (Erzählung, wörtliche Rede) mit je eigener Stimme, hintereinandergehängt.
   * Gleiche Abschnitte werden wiederverwendet – nochmal anhören kostet nichts.
   */
  async speakSegments(segments: Segment[]): Promise<{ url: string; costUsd: number }> {
    const segs = segments.map((s) => ({ text: s.text.replace(/\s+/g, " ").trim(), voice: (VOICES as readonly string[]).includes(String(s.voice)) ? String(s.voice) : NARRATOR_VOICE }))
      .filter((s) => s.text.length >= 1).slice(0, MAX_SEGMENTS);
    let budget = MAX_TTS_CHARS;
    for (const s of segs) { s.text = s.text.slice(0, Math.max(0, budget)); budget -= s.text.length; }
    const parts = segs.filter((s) => s.text.length);
    if (!parts.length) throw new Error("Kein Text zum Vorlesen.");
    if (parts.length === 1) return this.speak(parts[0].text, parts[0].voice);
    const id = `tts-${createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32)}`;
    if (await this.o.store.get(id)) return { url: `/api/images/${id}`, costUsd: 0 };
    let cost = 0;
    const files: Uint8Array[] = [];
    for (const p of parts) { // nacheinander: fal.ai-Grenzen schonen, Reihenfolge bleibt
      const r = await this.speak(p.text, p.voice);
      cost += r.costUsd;
      const f = await this.o.store.get(r.url.split("/").pop()!);
      if (f) files.push(f.bytes);
    }
    const all = new Uint8Array(files.reduce((n, f) => n + f.length, 0));
    let off = 0;
    for (const f of files) { all.set(f, off); off += f.length; }
    await this.o.store.put(id, { type: "audio/mpeg", bytes: all });
    return { url: `/api/images/${id}`, costUsd: cost };
  }

  /** Text vorlesen. Gleicher Text = gleiche Datei (keine erneuten Kosten). */
  async speak(text: string, voice: string = NARRATOR_VOICE): Promise<{ url: string; costUsd: number }> {
    const clean = text.replace(/\s+/g, " ").trim().slice(0, MAX_TTS_CHARS);
    if (clean.length < 1) throw new Error("Kein Text zum Vorlesen.");
    const id = `tts-${createHash("sha256").update(`${voice}|${clean}`).digest("hex").slice(0, 32)}`;
    if (await this.o.store.get(id)) return { url: `/api/images/${id}`, costUsd: 0 };
    const out = await this.run(TTS_MODEL, {
      prompt: clean,
      voice_setting: { voice_id: voice, speed: 0.95, vol: 1 },
      language_boost: "German",
      audio_setting: { format: "mp3", sample_rate: 24000, bitrate: 64000, channel: 1 },
      output_format: "url",
    }, 45_000);
    const url = (out.audio as { url?: string } | undefined)?.url;
    if (!url) throw new Error("fal.ai hat keinen Ton geliefert.");
    await this.o.store.put(id, await this.download(url, "audio/mpeg"));
    return { url: `/api/images/${id}`, costUsd: (clean.length / 1000) * TTS_USD_PER_1000 };
  }

  /** Musik einer Stimmung – beim ersten Mal erzeugt, danach immer dieselbe Datei. */
  async music(mood: Mood): Promise<{ url: string; costUsd: number }> {
    const id = `music-${mood}-v2`;
    if (await this.o.store.get(id)) return { url: `/api/images/${id}`, costUsd: 0 };
    const out = await this.run(MUSIC_MODEL, { prompt: MOODS[mood], music_length_ms: MUSIC_SECONDS * 1000, force_instrumental: true, output_format: "mp3_44100_64" }, 55_000);
    const url = (out.audio as { url?: string } | undefined)?.url;
    if (!url) throw new Error("fal.ai hat keine Musik geliefert.");
    const raw = await this.download(url, "audio/mpeg");
    // WAV kleiner machen (Mono, 22 kHz): spart Speicher und Datenübertragung, für Hintergrundmusik reicht das
    const small = raw.type.includes("wav") || isWav(raw.bytes) ? { type: "audio/wav", bytes: shrinkWav(raw.bytes) } : raw;
    await this.o.store.put(id, small);
    return { url: `/api/images/${id}`, costUsd: (MUSIC_SECONDS / 60) * MUSIC_USD_PER_MIN };
  }
}

const isWav = (b: Uint8Array) => b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WAVE";

/** PCM-WAV (16 Bit oder 32 Bit Float, beliebige Kanäle/Rate) → Mono, 22,05 kHz, 16 Bit. Unbekanntes bleibt unverändert. */
export function shrinkWav(bytes: Uint8Array): Uint8Array {
  if (!isWav(bytes)) return bytes;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 12, fmt: { format: number; channels: number; rate: number; bits: number } | null = null, data: { start: number; len: number } | null = null;
  while (pos + 8 <= bytes.length) {
    const tag = String.fromCharCode(...bytes.slice(pos, pos + 4)), len = dv.getUint32(pos + 4, true);
    if (tag === "fmt ") fmt = { format: dv.getUint16(pos + 8, true), channels: dv.getUint16(pos + 10, true), rate: dv.getUint32(pos + 12, true), bits: dv.getUint16(pos + 22, true) };
    if (tag === "data") { data = { start: pos + 8, len: Math.min(len, bytes.length - pos - 8) }; break; }
    pos += 8 + len + (len % 2);
  }
  if (!fmt || !data || !((fmt.format === 1 && fmt.bits === 16) || (fmt.format === 3 && fmt.bits === 32))) return bytes;
  const frameBytes = (fmt.bits / 8) * fmt.channels, frames = Math.floor(data.len / frameBytes);
  const sample = (f: number, ch: number) => {
    const off = data!.start + f * frameBytes + ch * (fmt!.bits / 8);
    return fmt!.format === 1 ? dv.getInt16(off, true) / 32768 : dv.getFloat32(off, true);
  };
  const outRate = 22050, step = fmt.rate / outRate, outFrames = Math.floor(frames / step);
  const out = new Uint8Array(44 + outFrames * 2), o = new DataView(out.buffer);
  const w = (p: number, s: string) => { for (let i = 0; i < 4; i++) out[p + i] = s.charCodeAt(i); };
  w(0, "RIFF"); o.setUint32(4, 36 + outFrames * 2, true); w(8, "WAVE"); w(12, "fmt ");
  o.setUint32(16, 16, true); o.setUint16(20, 1, true); o.setUint16(22, 1, true); o.setUint32(24, outRate, true);
  o.setUint32(28, outRate * 2, true); o.setUint16(32, 2, true); o.setUint16(34, 16, true); w(36, "data"); o.setUint32(40, outFrames * 2, true);
  for (let i = 0; i < outFrames; i++) {
    const f = Math.min(frames - 1, Math.floor(i * step));
    let v = 0;
    for (let ch = 0; ch < fmt.channels; ch++) v += sample(f, ch);
    v = Math.max(-1, Math.min(1, v / fmt.channels));
    o.setInt16(44 + i * 2, Math.round(v * 32767), true);
  }
  return out;
}
