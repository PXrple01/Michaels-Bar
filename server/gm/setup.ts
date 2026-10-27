// Baut den Spielleiter aus Umgebungsvariablen – gleich für lokal und Netlify.
import type { RollLog } from "../dice/log";
import type { GameData } from "../rules/loader";
import { AnthropicLlm, GameMaster } from "./engine";
import { ClassReviewer } from "./review";
import { UsageGuard, type CounterStore } from "./usage";

export interface GmEnv {
  ANTHROPIC_API_KEY?: string;
  GAME_SECRET?: string;
  ACCESS_CODE?: string;
  MONTHLY_BUDGET_USD?: string;
  TURNS_PER_HOUR?: string;
  GM_EFFORT?: string;
}

export interface Claude { gm: GameMaster; reviewer: ClassReviewer }

export function createClaude(env: GmEnv, data: () => GameData, rolls: RollLog, counters: CounterStore, secret: string): Claude {
  const effort = env.GM_EFFORT === "medium" || env.GM_EFFORT === "high" ? env.GM_EFFORT : "low";
  const llm = env.ANTHROPIC_API_KEY ? new AnthropicLlm(env.ANTHROPIC_API_KEY) : null;
  const guard = new UsageGuard(counters, Number(env.MONTHLY_BUDGET_USD ?? 10) || 10, Number(env.TURNS_PER_HOUR ?? 60) || 60);
  return {
    gm: new GameMaster({ data, llm, rolls, guard, secret, effort }),
    reviewer: new ClassReviewer({ data, llm, guard, secret, effort }),
  };
}
