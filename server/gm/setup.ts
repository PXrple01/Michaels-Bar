// Baut den Spielleiter aus Umgebungsvariablen – gleich für lokal und Netlify.
import type { RollLog } from "../dice/log";
import type { GameData } from "../rules/loader";
import { GameMaster } from "./engine";
import { AnthropicLlm, MODELS, type ModelId } from "./narrator";
import { ClassReviewer } from "./review";
import { MemoryPartyStore, PartyService, type PartyStore } from "./party";
import { UsageGuard, type CounterStore } from "./usage";

export interface GmEnv {
  ANTHROPIC_API_KEY?: string;
  GAME_SECRET?: string;
  ACCESS_CODE?: string;
  MONTHLY_BUDGET_USD?: string;
  TURNS_PER_HOUR?: string;
  GM_EFFORT?: string;
  GM_MODEL?: string;
  REVIEW_MODEL?: string;
}

const pickModel = (v: string | undefined, fallback: ModelId): ModelId => ((MODELS as readonly string[]).includes(v ?? "") ? (v as ModelId) : fallback);

export interface Claude { gm: GameMaster; reviewer: ClassReviewer; party: PartyService }

export function createClaude(env: GmEnv, data: () => GameData, rolls: RollLog, counters: CounterStore, secret: string, parties: PartyStore = new MemoryPartyStore()): Claude {
  const effort = env.GM_EFFORT === "medium" || env.GM_EFFORT === "high" ? env.GM_EFFORT : "low";
  const llm = env.ANTHROPIC_API_KEY ? new AnthropicLlm(env.ANTHROPIC_API_KEY) : null;
  const guard = new UsageGuard(counters, Number(env.MONTHLY_BUDGET_USD ?? 10) || 10, Number(env.TURNS_PER_HOUR ?? 60) || 60);
  const model = pickModel(env.GM_MODEL, "claude-opus-5-5");
  const gm = new GameMaster({ data, llm, rolls, guard, secret, effort, model });
  return {
    gm,
    party: new PartyService({ data, narrator: gm.narrator, guard, store: parties, secret }),
    reviewer: new ClassReviewer({ data, llm, guard, secret, effort, model: pickModel(env.REVIEW_MODEL, model) }),
  };
}
