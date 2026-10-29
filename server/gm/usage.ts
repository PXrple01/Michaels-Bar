// Kostenkontrolle: Monatsbudget als harte Grenze und Limit pro Stunde.

/** Preise in US-Dollar pro Million Token. Cache schreiben: 5 Minuten = 1,25×, 1 Stunde = 2× Eingabepreis. */
export const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation?: { ephemeral_5m_input_tokens?: number | null; ephemeral_1h_input_tokens?: number | null } | null;
  /** Server-seitige Schritte; die Zusammenfassung (compaction) steht nicht in den Hauptzahlen. */
  iterations?: ({ type: string } & Omit<TokenUsage, "iterations">)[] | null;
}

export function costUsd(u: TokenUsage, model = "claude-opus-5-5"): number {
  const compaction = (u.iterations ?? []).filter((i) => i.type === "compaction").reduce((sum, i) => sum + tokenCost(i, model), 0);
  return tokenCost(u, model) + compaction;
}

function tokenCost(u: Omit<TokenUsage, "iterations">, model: string): number {
  const p = PRICES[model] ?? PRICES["claude-opus-5-5"];
  const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const write5m = u.cache_creation ? (u.cache_creation.ephemeral_5m_input_tokens ?? 0) : (u.cache_creation_input_tokens ?? 0);
  return (
    (u.input_tokens * p.input +
      u.output_tokens * p.output +
      write5m * p.input * 1.25 +
      write1h * p.input * 2 +
      (u.cache_read_input_tokens ?? 0) * p.cacheRead) /
    1_000_000
  );
}

/** Zähler-Speicher. Lokal im Arbeitsspeicher, online in Netlify Blobs. */
export interface CounterStore {
  get(key: string): Promise<number>;
  add(key: string, amount: number): Promise<number>;
}

export class MemoryCounterStore implements CounterStore {
  private map = new Map<string, number>();
  async get(key: string) { return this.map.get(key) ?? 0; }
  async add(key: string, amount: number) {
    const v = (this.map.get(key) ?? 0) + amount;
    this.map.set(key, v);
    return v;
  }
}

export const monthKey = (d = new Date()) => `budget-${d.toISOString().slice(0, 7)}`;
export const hourKey = (who: string, d = new Date()) => `rate-${d.toISOString().slice(0, 13)}-${who.replace(/[^A-Za-z0-9.:-]/g, "_").slice(0, 64)}`;

export class LimitError extends Error {
  constructor(message: string, public code: "budget" | "rate") { super(message); }
}

export class UsageGuard {
  constructor(private store: CounterStore, private limitUsd: number, private turnsPerHour: number) {}

  /** Prüft vor jedem Aufruf. Wirft, wenn Budget oder Stundenlimit erreicht sind. */
  async check(who: string): Promise<void> {
    const spent = await this.store.get(monthKey());
    if (this.limitUsd > 0 && spent >= this.limitUsd) throw new LimitError(`Das Monatsbudget von ${this.limitUsd.toFixed(2)} $ ist aufgebraucht. Ab dem nächsten Monat geht es weiter.`, "budget");
    const turns = await this.store.add(hourKey(who), 1);
    if (turns > this.turnsPerHour) throw new LimitError(`Zu viele Züge in dieser Stunde (höchstens ${this.turnsPerHour}). Gönn dem Spielleiter eine Pause.`, "rate");
  }

  async record(u: TokenUsage, model?: string): Promise<number> {
    return this.store.add(monthKey(), costUsd(u, model));
  }

  /** Sonstige Kosten (z. B. Bilder) aufs Monatsbudget buchen. */
  async addUsd(usd: number): Promise<number> {
    return this.store.add(monthKey(), usd);
  }

  async info() {
    return { spentUsd: Math.round((await this.store.get(monthKey())) * 100) / 100, limitUsd: this.limitUsd };
  }
}
