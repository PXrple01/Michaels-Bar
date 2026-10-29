// Speicher in Netlify Blobs: Wurf-IDs (gegen Neuwürfeln) und Zähler (Budget, Stundenlimit).
import { getStore } from "@netlify/blobs";
import type { RollRecord } from "../../shared/dice";
import type { RollStore } from "../../server/dice/log";
import type { CounterStore } from "../../server/gm/usage";
import type { Party, PartyStore } from "../../server/gm/party";
import type { AccountStore, UserRecord } from "../../server/accounts";
import type { ImageStore, StoredImage } from "../../server/images";

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

/** Gruppen-Spielstände; jede Änderung nur, wenn niemand dazwischen gespeichert hat (ETag). */
export class BlobPartyStore implements PartyStore {
  private get store() { return getStore({ name: "parties", consistency: "strong" }); }
  async get(code: string) {
    const r = await this.store.getWithMetadata(code, { type: "json" });
    return r ? { party: r.data as Party, etag: r.etag ?? "" } : null;
  }
  async put(party: Party, etag: string | null) {
    const res = etag === null
      ? await this.store.setJSON(party.code, party, { onlyIfNew: true })
      : await this.store.setJSON(party.code, party, { onlyIfMatch: etag });
    return res.modified;
  }
  async delete(code: string) { await this.store.delete(code); }
  async list() {
    const { blobs } = await this.store.list();
    const all = await Promise.all(blobs.map((b) => this.store.get(b.key, { type: "json" }) as Promise<Party | null>));
    return all.filter((p): p is Party => !!p);
  }
}

/** Konten und ihre Spielstände: user/<name> und data/<name>/<schlüssel>. */
export class BlobAccountStore implements AccountStore {
  private get store() { return getStore({ name: "accounts", consistency: "strong" }); }
  private dataKey(id: string, key: string) { return `data/${encodeURIComponent(id)}/${encodeURIComponent(key)}`; }
  async getUser(id: string) { return ((await this.store.get(`user/${encodeURIComponent(id)}`, { type: "json" })) as UserRecord | null) ?? null; }
  async createUser(u: UserRecord) { return (await this.store.setJSON(`user/${encodeURIComponent(u.id)}`, u, { onlyIfNew: true })).modified; }
  async updateUser(u: UserRecord) { await this.store.setJSON(`user/${encodeURIComponent(u.id)}`, u); }
  async listData(id: string) {
    const prefix = `data/${encodeURIComponent(id)}/`;
    const { blobs } = await this.store.list({ prefix });
    const entries = await Promise.all(blobs.map(async (b) => [decodeURIComponent(b.key.slice(prefix.length)), (await this.store.get(b.key, { type: "text" })) ?? ""] as const));
    return Object.fromEntries(entries);
  }
  async putData(id: string, key: string, value: string) { await this.store.set(this.dataKey(id, key), value); }
  async deleteData(id: string, key: string) { await this.store.delete(this.dataKey(id, key)); }
  private backupKey(id: string, name: string) { return `backup/${encodeURIComponent(id)}/${encodeURIComponent(name)}`; }
  async getBackup(id: string, name: string) { return ((await this.store.get(this.backupKey(id, name), { type: "json" })) as Record<string, string> | null) ?? null; }
  async putBackup(id: string, name: string, data: Record<string, string>) { await this.store.setJSON(this.backupKey(id, name), data); }
  async deleteBackup(id: string, name: string) { await this.store.delete(this.backupKey(id, name)); }
}

/** Gemalte Bilder (Szenen und Porträts) – die Art steht in den Metadaten. */
export class BlobImageStore implements ImageStore {
  // Stark konsistent: eine gerade gespeicherte Datei (Vorlesen, Musik) ist sofort abrufbar
  private get store() { return getStore({ name: "images", consistency: "strong" }); }
  async put(id: string, img: StoredImage) {
    await this.store.set(id, new Uint8Array(img.bytes).buffer, { metadata: { type: img.type } });
  }
  async get(id: string) {
    const r = await this.store.getWithMetadata(id, { type: "arrayBuffer" });
    return r ? { bytes: new Uint8Array(r.data), type: String(r.metadata?.type ?? "image/webp") } : null;
  }
}
