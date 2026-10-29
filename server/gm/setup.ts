// Baut den Spielleiter aus Umgebungsvariablen – gleich für lokal und Netlify.
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
import { AudioMaker, isMood } from "../audio";
import { resolveCharacter } from "../characters";

export interface GmEnv {
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
  portrait(raw: unknown, who: string): Promise<{ url: string; costUsd: number; claudeUsd: number }>;
  /** Vorlesen und Stimmungsmusik (prüfen Budget und buchen die Kosten). */
  speak(text: unknown, who: string): Promise<{ url: string; costUsd: number }>;
  music(mood: unknown, who: string): Promise<{ url: string; costUsd: number }>;
}

export function createClaude(env: GmEnv, data: () => GameData, rolls: RollLog, counters: CounterStore, secret: string, parties: PartyStore = new MemoryPartyStore(), imageStore: ImageStore = new MemoryImageStore()): Claude {
  const effort = env.GM_EFFORT === "medium" || env.GM_EFFORT === "high" ? env.GM_EFFORT : "low";
  const llm = env.ANTHROPIC_API_KEY ? new AnthropicLlm(env.ANTHROPIC_API_KEY) : null;
  const guard = new UsageGuard(counters, Number(env.MONTHLY_BUDGET_USD ?? 10) || 10, Number(env.TURNS_PER_HOUR ?? 60) || 60);
  const model = pickModel(env.GM_MODEL, "claude-opus-5-5");
  const images = new ImageMaker({ key: env.FAL_KEY?.trim() || undefined, store: imageStore });
  const gm = new GameMaster({ data, llm, rolls, guard, secret, effort, model, images });
  const audio = new AudioMaker({ key: env.FAL_KEY?.trim() || undefined, store: imageStore });
  return {
    gm,
    images,
    audio,
    async speak(text, who) {
      if (typeof text !== "string" || !text.trim()) throw new Error("Kein Text zum Vorlesen.");
      await guard.check(who);
      const r = await audio.speak(text);
      if (r.costUsd) await guard.addUsd(r.costUsd);
      return r;
    },
    async music(mood, who) {
      if (!isMood(mood)) throw new Error("Unbekannte Stimmung.");
      await guard.check(who);
      const r = await audio.music(mood);
      if (r.costUsd) await guard.addUsd(r.costUsd);
      return r;
    },
    async portrait(raw, who) {
      if (!images.ready) throw new Error("Bilder sind nicht eingerichtet (FAL_KEY fehlt).");
      const { c, data: d } = resolveCharacter(raw, data(), secret);
      await guard.check(who);
      const { prompt, claudeUsd } = await portraitPrompt({ llm, guard }, c, d);
      const res = await images.make(prompt, "portrait_4_3", `portrait-${c.id}`);
      await guard.addUsd(res.costUsd);
      return { ...res, claudeUsd };
    },
    party: new PartyService({ data, narrator: gm.narrator, forge: gm.forge, guard, store: parties, secret }),
    openai: new OpenAiGateway({ data, narrator: gm.narrator, guard, secret, apiKey: env.OPENAI_COMPAT_KEY?.trim() || undefined }),
    reviewer: new ClassReviewer({ data, llm, guard, secret, effort, model: pickModel(env.REVIEW_MODEL, model, "REVIEW_MODEL") }),
  };
}
