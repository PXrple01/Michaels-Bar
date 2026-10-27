// Kostenkontrolle: Monatsbudget als harte Grenze und Limit pro Stunde.

/** Preise für Claude Opus 5.5 in US-Dollar pro Million Token. */
export const PRICES = { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 };

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export function costUsd(u: TokenUsage): number {
  return (
    (u.input_tokens * PRICES.input +
      u.output_tokens * PRICES.output +
      (u.cache_creation_input_tokens ?? 0) * PRICES.cacheWrite +
      (u.cache_read_input_tokens ?? 0) * PRICES.cacheRead) /
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
    if (spent >= this.limitUsd) throw new LimitError(`Das Monatsbudget von ${this.limitUsd.toFixed(2)} $ ist aufgebraucht. Ab dem nächsten Monat geht es weiter.`, "budget");
    const turns = await this.store.add(hourKey(who), 1);
    if (turns > this.turnsPerHour) throw new LimitError(`Zu viele Züge in dieser Stunde (höchstens ${this.turnsPerHour}). Gönn dem Spielleiter eine Pause.`, "rate");
  }

  async record(u: TokenUsage): Promise<number> {
    return this.store.add(monthKey(), costUsd(u));
  }

  async info() {
    return { spentUsd: Math.round((await this.store.get(monthKey())) * 100) / 100, limitUsd: this.limitUsd };
  }
}
