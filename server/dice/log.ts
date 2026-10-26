import { appendFile } from "node:fs/promises";
import type { RollRecord } from "../../shared/dice";
import { performRoll, type RollSpec } from "./engine";
import type { RandomInt } from "./rng";

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Wurf-Protokoll. Jede requestId wird genau einmal gewürfelt: Wer dieselbe Anfrage erneut schickt
 * (Doppelklick, Neuladen, Manipulationsversuch), bekommt den bereits feststehenden Wurf zurück.
 */
export class RollLog {
  private byRequest = new Map<string, RollRecord>();
  private order: RollRecord[] = [];

  constructor(private file: string | null, private rng?: RandomInt, private maxInMemory = 500) {}

  async roll(spec: RollSpec): Promise<RollRecord> {
    if (!REQUEST_ID.test(spec.requestId)) throw new Error("Ungültige requestId");
    const existing = this.byRequest.get(spec.requestId);
    if (existing) return { ...existing, repeated: true };

    const record = performRoll(spec, this.rng);
    this.byRequest.set(record.requestId, record);
    this.order.push(record);
    if (this.order.length > this.maxInMemory) {
      const old = this.order.shift()!;
      this.byRequest.delete(old.requestId);
    }
    if (this.file) await appendFile(this.file, JSON.stringify(record) + "\n", "utf8");
    return record;
  }

  recent(limit = 50): RollRecord[] {
    return this.order.slice(-limit).reverse();
  }

  get(id: string): RollRecord | undefined {
    return this.order.find((r) => r.id === id);
  }
}
