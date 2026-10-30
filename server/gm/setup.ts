// Baut den Spielleiter aus Umgebungsvariablen – gleich für lokal und Netlify.
import { growthOf, limitTier } from "../../shared/growth";
import type { RollLog } from "../dice/log";
import type { GameData } from "../rules/loader";
import { GameMaster } from "./engine";
import { AnthropicLlm, MODELS, type ModelId } from "./narrator";
import { OpenAiGateway } from "./openai";
import { ClassReviewer } from "./review";
import { MemoryPartyStore, PartyService, type PartyStore } from "./party";
import { UsageGuard, type CounterStore } from "./usage";
import { ImageMaker, MemoryImageStore, type ImageStore } from "../images";
import { portraitPrompt } from "./portrait";
import { AudioMaker, isMood, type Segment } from "../audio";
import { resolveCharacter } from "../characters";
import { GoogleCloud, googleConfig, parseBudgetPush, type GoogleEnv } from "../google";
import { SwitchingLlm } from "./googleLlm";

export interface GmEnv extends GoogleEnv {
  ANTHROPIC_API_KEY?: string;
  GAME_SECRET?: string;
  ACCESS_CODE?: string;
  MONTHLY_BUDGET_USD?: string;
  TURNS_PER_HOUR?: string;
  GM_EFFORT?: string;
  GM_MODEL?: string;
  REVIEW_MODEL?: string;
  /** Schlüssel für die OpenAI-kompatible Schnittstelle (/v1/…). Ohne ihn ist sie abgeschaltet. */
  OPENAI_COMPAT_KEY?: string;
  /** fal.ai-Schlüssel für Szenenbilder und Porträts. Ohne ihn gibt es keine Bilder. */
  FAL_KEY?: string;
  /** Google-Cloud-Schlüssel für kostenloses Vorlesen (Text-to-Speech, 1 Mio. Zeichen/Monat). Ohne ihn liest ElevenLabs (fal.ai). */
  GOOGLE_TTS_KEY?: string;
  /** "1": Ist das Google-Kontingent aufgebraucht, liest ElevenLabs kostenpflichtig weiter. Sonst Pause bis zum Monatswechsel. */
  TTS_PAID_FALLBACK?: string;
}

const pickModel = (v: string | undefined, fallback: ModelId, name = "GM_MODEL"): ModelId => {
  const value = v?.trim();
  if ((MODELS as readonly string[]).includes(value ?? "")) return value as ModelId;
  if (value) console.warn(`[Claude] ${name}="${value}" ist unbekannt – nutze ${fallback}. Erlaubt: ${MODELS.join(", ")}`);
  return fallback;
};

export interface Claude {
  gm: GameMaster; reviewer: ClassReviewer; party: PartyService; openai: OpenAiGateway; images: ImageMaker; audio: AudioMaker;
  /** Figurenporträt: Claude schreibt die Bildbeschreibung, fal.ai malt (prüft die Figur, bucht die Kosten). */
  portrait(raw: unknown, who: string, legendary?: unknown): Promise<{ url: string; costUsd: number; claudeUsd: number }>;
  /** Vorlesen und Stimmungsmusik (prüfen Budget und buchen die Kosten). */
  /** prefetch: im Hintergrund vorbereiten (nur in der Google-Testphase – sonst { skipped: true }, ohne Kosten). */
  speak(text: unknown, who: string, segments?: unknown, prefetch?: boolean): Promise<{ url: string; costUsd: number } | { skipped: true }>;
  music(mood: unknown, who: string): Promise<{ url: string; costUsd: number }>;
  /** Googles Budget-Meldung (echter Verbrauch) für den Ausgabe-Regler. */
  googleBudget(token: unknown, body: unknown): Promise<{ status: number; body: unknown }>;
}

export function createClaude(env: GmEnv, data: () => GameData, rolls: RollLog, counters: CounterStore, secret: string, parties: PartyStore = new MemoryPartyStore(), imageStore: ImageStore = new MemoryImageStore()): Claude {
  const effort = env.GM_EFFORT === "medium" || env.GM_EFFORT === "high" ? env.GM_EFFORT : "low";
  const anthropic = env.ANTHROPIC_API_KEY ? new AnthropicLlm(env.ANTHROPIC_API_KEY) : null;
  // Google-Testphase: im Zeitfenster Claude über Vertex, Imagen und Chirp – danach automatisch wieder wie bisher
  const gcfg = googleConfig(env);
  const google = gcfg ? new GoogleCloud(gcfg, fetch, counters) : null;
  if (google) console.log(`[Google] Testphase eingerichtet bis ${gcfg!.until.toISOString().slice(0, 10)}${google.active() ? "" : " (vorbei – bisherige Anbieter)"}.`);
  // Claude über Google nur auf ausdrücklichen Wunsch (GOOGLE_CLAUDE=1) – das Startguthaben deckt Marketplace-Modelle meist nicht
  const llm = google && env.GOOGLE_CLAUDE === "1" ? new SwitchingLlm(google, anthropic) : anthropic;
  // Monatsbudget nur, wenn MONTHLY_BUDGET_USD gesetzt ist (0 oder leer = ohne Grenze)
  const guard = new UsageGuard(counters, Number(env.MONTHLY_BUDGET_USD) || 0, Number(env.TURNS_PER_HOUR ?? 60) || 60);
  const model = pickModel(env.GM_MODEL, "claude-opus-5-5");
  const images = new ImageMaker({ key: env.FAL_KEY?.trim() || undefined, store: imageStore, google });
  const moreImages = async () => !!google?.active() && (await google.luxury());
  const gm = new GameMaster({ data, llm, rolls, guard, secret, effort, model, images, moreImages, allEnemyPortraits: () => !!google?.active() });
  const audio = new AudioMaker({ key: env.FAL_KEY?.trim() || undefined, store: imageStore, googleKey: env.GOOGLE_TTS_KEY?.trim() || undefined, counters, paidFallback: env.TTS_PAID_FALLBACK === "1", google, geminiTtsModel: env.GOOGLE_TTS_MODEL?.trim() || undefined });
  return {
    gm,
    images,
    audio,
    async speak(text, who, segments, prefetch) {
      // Vorab-Vorlesen nur, solange das Guthaben zahlt – danach nicht das Gratis-Kontingent für Ungehörtes verbrauchen
      if (prefetch && !google?.active()) return { skipped: true as const };
      const segs = Array.isArray(segments) ? segments.filter((s): s is Segment => !!s && typeof (s as Segment).text === "string") : null;
      if (!segs?.length && (typeof text !== "string" || !text.trim())) throw new Error("Kein Text zum Vorlesen.");
      await guard.check(who);
      const r = segs?.length ? await audio.speakSegments(segs) : await audio.speak(String(text));
      if (r.costUsd) await guard.addUsd(r.costUsd);
      return r;
    },
    async googleBudget(token, body) {
      const expected = env.GOOGLE_BUDGET_TOKEN?.trim();
      if (!expected || token !== expected) return { status: 403, body: { error: "Falscher oder fehlender token." } };
      const push = parseBudgetPush(body);
      // Pub/Sub wiederholt bei Fehlern endlos – unlesbare Meldungen deshalb trotzdem mit 200 quittieren
      if (push && google) await google.recordBilled(push.cost);
      return { status: 200, body: { ok: true } };
    },
    async music(mood, who) {
      if (!isMood(mood)) throw new Error("Unbekannte Stimmung.");
      await guard.check(who);
      const r = await audio.music(mood);
      if (r.costUsd) await guard.addUsd(r.costUsd);
      return r;
    },
    async portrait(raw, who, legendary) {
      if (!images.ready) throw new Error("Bilder sind nicht eingerichtet (FAL_KEY fehlt).");
      const { c, data: d } = resolveCharacter(raw, data(), secret);
      await guard.check(who);
      const { prompt, claudeUsd } = await portraitPrompt({ llm, guard }, c, d);
      // Limit Break: dieselbe Figur, älter und gezeichnet, mit Erbstücken – das bisherige Porträt dient als Vorlage
      const tier = legendary === 2 && limitTier(growthOf(c)) >= 2 ? 2 : legendary && limitTier(growthOf(c)) >= 1 ? 1 : 0;
      const g = growthOf(c);
      const legend = tier ? `\n\nThis person is now a living legend after ${g.earned.length} adventures: a few years older, weathered and battle-hardened${g.scars.length ? `, with visible scars (${g.scars.map((s) => s.name).join(", ")})` : ""}${g.heirlooms.length ? `, carrying ${g.heirlooms.map((h) => h.name).join(" and ")}` : ""}, proud and confident gaze, ${tier === 2 ? "a faint golden radiance around them, regal and awe-inspiring" : "faint glowing embers drifting around them"}. Keep the same face, hair and identity as in the reference image.` : "";
      const res = await images.make(prompt + legend, "portrait_4_3", `portrait-${c.id}`, tier ? { refs: [{ characterId: c.id, label: c.name }] } : {});
      await guard.addUsd(res.costUsd);
      return { ...res, claudeUsd };
    },
    party: new PartyService({ data, narrator: gm.narrator, forge: gm.forge, guard, store: parties, secret }),
    openai: new OpenAiGateway({ data, narrator: gm.narrator, guard, secret, apiKey: env.OPENAI_COMPAT_KEY?.trim() || undefined }),
    reviewer: new ClassReviewer({ data, llm, guard, secret, effort, model: pickModel(env.REVIEW_MODEL, model, "REVIEW_MODEL") }),
  };
}
