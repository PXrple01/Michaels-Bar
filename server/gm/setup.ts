// Baut den Spielleiter aus Umgebungsvariablen – gleich für lokal und Netlify.
import type { RollLog } from "../dice/log";
import type { GameData } from "../rules/loader";
import { AnthropicLlm, GameMaster } from "./engine";
import { UsageGuard, type CounterStore } from "./usage";

export interface GmEnv {
  ANTHROPIC_API_KEY?: string;
  GAME_SECRET?: string;
  ACCESS_CODE?: string;
  MONTHLY_BUDGET_USD?: string;
  TURNS_PER_HOUR?: string;
  GM_EFFORT?: string;
}

export function createGameMaster(env: GmEnv, data: () => GameData, rolls: RollLog, counters: CounterStore, secret: string): GameMaster {
  const effort = env.GM_EFFORT === "medium" || env.GM_EFFORT === "high" ? env.GM_EFFORT : "low";
  return new GameMaster({
    data,
    llm: env.ANTHROPIC_API_KEY ? new AnthropicLlm(env.ANTHROPIC_API_KEY) : null,
    rolls,
    guard: new UsageGuard(counters, Number(env.MONTHLY_BUDGET_USD ?? 10) || 10, Number(env.TURNS_PER_HOUR ?? 60) || 60),
    secret,
    effort,
  });
}
