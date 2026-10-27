import { appendFile } from "node:fs/promises";
import type { RollRecord } from "../../shared/dice";
import { performRoll, type RollSpec } from "./engine";
import type { RandomInt } from "./rng";

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

/** Speicher für bereits gewürfelte Anfragen. Lokal im Arbeitsspeicher, online in Netlify Blobs. */
export interface RollStore {
  get(requestId: string): Promise<RollRecord | null>;
  /** Speichert nur, wenn die ID neu ist. Gibt sonst den schon vorhandenen Wurf zurück. */
  putIfNew(record: RollRecord): Promise<RollRecord | null>;
}

export class MemoryRollStore implements RollStore {
  private map = new Map<string, RollRecord>();
  constructor(private file: string | null = null, private max = 5000) {}
  async get(id: string) { return this.map.get(id) ?? null; }
  async putIfNew(r: RollRecord) {
    const existing = this.map.get(r.requestId);
    if (existing) return existing;
    this.map.set(r.requestId, r);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
    if (this.file) await appendFile(this.file, JSON.stringify(r) + "\n", "utf8");
    return null;
  }
}

/**
 * Wurf-Protokoll. Jede requestId wird genau einmal gewürfelt: Wer dieselbe Anfrage erneut schickt
 * (Doppelklick, Neuladen, Manipulationsversuch), bekommt den bereits feststehenden Wurf zurück.
 */
export class RollLog {
  constructor(private store: RollStore = new MemoryRollStore(), private rng?: RandomInt) {}

  async roll(spec: RollSpec): Promise<RollRecord> {
    if (!REQUEST_ID.test(spec.requestId)) throw new Error("Ungültige requestId");
    const known = await this.store.get(spec.requestId);
    if (known) return { ...known, repeated: true };
    const record = performRoll(spec, this.rng);
    const raced = await this.store.putIfNew(record);
    return raced ? { ...raced, repeated: true } : record;
  }
}
