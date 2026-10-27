// Speicher in Netlify Blobs: Wurf-IDs (gegen Neuwürfeln) und Zähler (Budget, Stundenlimit).
import { getStore } from "@netlify/blobs";
import type { RollRecord } from "../../shared/dice";
import type { RollStore } from "../../server/dice/log";
import type { CounterStore } from "../../server/gm/usage";

export class BlobRollStore implements RollStore {
  private get store() { return getStore({ name: "rolls", consistency: "strong" }); }
  async get(id: string) { return ((await this.store.get(id, { type: "json" })) as RollRecord | null) ?? null; }
  async putIfNew(r: RollRecord) {
    const res = await this.store.setJSON(r.requestId, r, { onlyIfNew: true });
    return res.modified ? null : await this.get(r.requestId);
  }
}

/** Zähler mit optimistischer Sperre (ETag), damit gleichzeitige Züge nichts verschlucken. */
export class BlobCounterStore implements CounterStore {
  private get store() { return getStore({ name: "counters", consistency: "strong" }); }
  async get(key: string) {
    return Number((await this.store.get(key, { type: "json" })) ?? 0);
  }
  async add(key: string, amount: number) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await this.store.getWithMetadata(key, { type: "json" });
      const next = Number(current?.data ?? 0) + amount;
      const res = current
        ? await this.store.setJSON(key, next, { onlyIfMatch: current.etag })
        : await this.store.setJSON(key, next, { onlyIfNew: true });
      if (res.modified) return next;
    }
    throw new Error("Zähler konnte nicht aktualisiert werden");
  }
}
