// Ton über fal.ai: Vorlesen der Erzählung (ElevenLabs TTS Turbo v2.5, Deutsch) und Stimmungsmusik je Szene
// (ElevenLabs Music). Beides wird gespeichert und wiederverwendet: derselbe Text kostet nur einmal, jede Musik-Stimmung
// wird nur ein einziges Mal erzeugt – danach keine laufenden Kosten.
import { createHash } from "node:crypto";
import type { ImageStore, StoredImage } from "./images";
import { FEMALE, MALE, NARRATOR, UNKNOWN } from "../shared/voices";
import type { CounterStore } from "./gm/usage";
import { GoogleError, isProviderFailure, type GoogleCloud } from "./google";

/**
 * Google Cloud Text-to-Speech (WaveNet, Deutsch): 1 Mio. Zeichen pro Monat kostenlos. Ein Zähler hält uns knapp darunter;
 * ist das Kontingent aufgebraucht, liest ElevenLabs nur weiter, wenn TTS_PAID_FALLBACK=1 gesetzt ist.
 */
const GOOGLE_TTS_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";
export const GOOGLE_FREE_CHARS = 950_000;
/** Stimmen-Zuordnung: dieselben Rollen wie bei ElevenLabs, nur mit deutschen WaveNet-Stimmen. */
const G_MALE = ["de-DE-Wavenet-D", "de-DE-Wavenet-E", "de-DE-Wavenet-H"], G_FEMALE = ["de-DE-Wavenet-A", "de-DE-Wavenet-C", "de-DE-Wavenet-F"];
export function googleVoice(voice: string): string {
  if (voice === NARRATOR) return "de-DE-Wavenet-B";
  const m = MALE.indexOf(voice), f = FEMALE.indexOf(voice);
  if (m >= 0) return G_MALE[m % G_MALE.length];
  if (f >= 0) return G_FEMALE[f % G_FEMALE.length];
  return voice === UNKNOWN ? "de-DE-Wavenet-E" : "de-DE-Wavenet-B";
}
/** Chirp-3-HD-Stimmen (Testphase, sehr natürlich) – gleiche Rollen wie oben. */
const C_MALE = ["Fenrir", "Puck", "Orus"], C_FEMALE = ["Aoede", "Kore", "Leda"];
export function chirpVoice(voice: string): string {
  const m = MALE.indexOf(voice), f = FEMALE.indexOf(voice);
  const name = voice === NARRATOR ? "Charon" : m >= 0 ? C_MALE[m % C_MALE.length] : f >= 0 ? C_FEMALE[f % C_FEMALE.length] : "Zephyr";
  return `de-DE-Chirp3-HD-${name}`;
}
/** Chirp 3 HD (Richtwert, aus dem Testguthaben bezahlt): 30 $ je Million Zeichen. */
const CHIRP_USD_PER_1000 = 0.03;
const ttsMonthKey = (d = new Date()) => `tts-chars-${d.toISOString().slice(0, 7)}`;

export const TTS_MODEL = "fal-ai/elevenlabs/tts/turbo-v2.5";
export const MUSIC_MODEL = "fal-ai/elevenlabs/music";
/** Preise (Richtwerte): Vorlesen 0,05 $ je 1000 Zeichen (MiniMax HD kostete 0,10 $), Musik ca. 0,80 $ je Minute (nur einmal je Stimmung). */
const TTS_USD_PER_1000 = 0.05, MUSIC_USD_PER_MIN = 0.8;
export const MAX_TTS_CHARS = 3000;
const MUSIC_SECONDS = 40;
const NARRATOR_VOICE = NARRATOR;
/** Erlaubte Stimmen: Erzähler und die Stimmen für wörtliche Rede. */
export const VOICES: readonly string[] = [NARRATOR, ...MALE, ...FEMALE, UNKNOWN];
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
  constructor(private o: { key?: string; store: ImageStore; fetch?: typeof fetch; googleKey?: string; counters?: CounterStore; freeChars?: number; paidFallback?: boolean; google?: GoogleCloud | null }) {}

  get ready() { return !!this.o.key || !!this.o.googleKey || !!this.o.google?.active(); }

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
    const segs = segments.map((s) => ({ text: s.text.replace(/\s+/g, " ").trim(), voice: VOICES.includes(String(s.voice)) ? String(s.voice) : NARRATOR_VOICE }))
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
    // Testphase: Chirp-Stimmen über das Dienstkonto
    const g = this.o.google;
    if (g?.active()) {
      try { return await this.speakChirp(g, clean, voice); }
      catch (e) {
        const status = e instanceof GoogleError ? e.status : undefined;
        if (isProviderFailure(status)) g.markBroken("Chirp-Stimmen", (e as Error).message);
        else console.error("[Ton] Chirp fehlgeschlagen, lese wie bisher:", (e as Error).message);
      }
    }
    if (this.o.googleKey) {
      try {
        const r = await this.speakGoogle(clean, voice);
        if (r) return r;
        if (!this.o.paidFallback || !this.o.key) throw new Error("Das kostenlose Vorlese-Kontingent für diesen Monat ist aufgebraucht. Ab dem nächsten Monat geht es weiter.");
      } catch (e) {
        // Google-Schlüssel abgelehnt (z. B. Konto nach der Testphase pausiert): wie bisher mit ElevenLabs lesen
        if (!(e instanceof GoogleError) || !isProviderFailure(e.status) || !this.o.key) throw e;
        console.warn(`[Ton] Google-Vorlesen abgelehnt (${e.message}) – lese mit ElevenLabs.`);
      }
    }
    const id = `tts-${createHash("sha256").update(`${voice}|${clean}`).digest("hex").slice(0, 32)}`;
    if (await this.o.store.get(id)) return { url: `/api/images/${id}`, costUsd: 0 };
    const out = await this.run(TTS_MODEL, { text: clean, voice, language_code: "de", stability: 0.5, similarity_boost: 0.75, speed: 0.95 }, 45_000);
    const url = (out.audio as { url?: string } | undefined)?.url;
    if (!url) throw new Error("fal.ai hat keinen Ton geliefert.");
    await this.o.store.put(id, await this.download(url, "audio/mpeg"));
    return { url: `/api/images/${id}`, costUsd: (clean.length / 1000) * TTS_USD_PER_1000 };
  }

  /** Chirp-3-HD-Stimme (Testphase, aus dem Guthaben bezahlt – zählt nicht zum Gratis-Kontingent). */
  private async speakChirp(g: GoogleCloud, clean: string, voice: string): Promise<{ url: string; costUsd: number }> {
    const cv = chirpVoice(voice);
    const id = `tts-${createHash("sha256").update(`c|${cv}|${clean}`).digest("hex").slice(0, 32)}`;
    if (await this.o.store.get(id)) return { url: `/api/images/${id}`, costUsd: 0 };
    const res = await (this.o.fetch ?? fetch)(GOOGLE_TTS_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${await g.token()}`, "x-goog-user-project": g.cfg.projectId, "content-type": "application/json" },
      body: JSON.stringify({ input: { text: clean }, voice: { languageCode: "de-DE", name: cv }, audioConfig: { audioEncoding: "MP3" } }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new GoogleError(`Chirp ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`, res.status);
    const out = (await res.json()) as { audioContent?: string };
    if (!out.audioContent) throw new GoogleError("Google hat keinen Ton geliefert", 200);
    await this.o.store.put(id, { type: "audio/mpeg", bytes: new Uint8Array(Buffer.from(out.audioContent, "base64")) });
    const usd = (clean.length / 1000) * CHIRP_USD_PER_1000;
    await g.addSpend(usd);
    return { url: `/api/images/${id}`, costUsd: usd };
  }

  /** Google-Stimme (kostenlos im Kontingent). null = Kontingent aufgebraucht. Gespeicherte Texte zählen nicht erneut. */
  private async speakGoogle(clean: string, voice: string): Promise<{ url: string; costUsd: number } | null> {
    const gv = googleVoice(voice);
    const id = `tts-${createHash("sha256").update(`g|${gv}|${clean}`).digest("hex").slice(0, 32)}`;
    if (await this.o.store.get(id)) return { url: `/api/images/${id}`, costUsd: 0 };
    const limit = this.o.freeChars ?? GOOGLE_FREE_CHARS;
    if (this.o.counters && (await this.o.counters.get(ttsMonthKey())) + clean.length > limit) return null;
    const res = await (this.o.fetch ?? fetch)(`${GOOGLE_TTS_URL}?key=${encodeURIComponent(this.o.googleKey!)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: { text: clean }, voice: { languageCode: "de-DE", name: gv }, audioConfig: { audioEncoding: "MP3", speakingRate: 0.95 } }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.error(`[Ton] Google TTS ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
      throw new GoogleError(res.status === 400 || res.status === 403 ? "Der Google-Schlüssel fürs Vorlesen wurde abgelehnt (Text-to-Speech-API aktiviert?)." : `Google hat abgelehnt (${res.status}).`, res.status);
    }
    const out = (await res.json()) as { audioContent?: string };
    if (!out.audioContent) throw new Error("Google hat keinen Ton geliefert.");
    await this.o.counters?.add(ttsMonthKey(), clean.length);
    await this.o.store.put(id, { type: "audio/mpeg", bytes: new Uint8Array(Buffer.from(out.audioContent, "base64")) });
    return { url: `/api/images/${id}`, costUsd: 0 };
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
