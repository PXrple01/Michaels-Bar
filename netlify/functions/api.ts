// Netlify-Funktion: derselbe Server wie lokal, nur ohne dauerhaften Prozess.
import { connectLambda, getStore } from "@netlify/blobs";
import serverless from "serverless-http";
import type { RollRecord } from "../../shared/dice";
import { createApp } from "../../server/app";
import { RollLog, type RollStore } from "../../server/dice/log";
import type { GameData } from "../../server/rules/loader";
import gamedata from "../../server/generated/gamedata.json";

/** Merkt sich jede Wurf-ID dauerhaft, damit ein Wurf nie neu gewürfelt werden kann. */
class BlobRollStore implements RollStore {
  private get store() { return getStore({ name: "rolls", consistency: "strong" }); }
  async get(id: string) { return ((await this.store.get(id, { type: "json" })) as RollRecord | null) ?? null; }
  async putIfNew(r: RollRecord) {
    const res = await this.store.setJSON(r.requestId, r, { onlyIfNew: true });
    return res.modified ? null : await this.get(r.requestId);
  }
}

const data = gamedata as unknown as GameData;
let app: ReturnType<typeof serverless> | null = null;

export const handler: serverless.Handler = (event, context) => {
  // Lambda-kompatible Funktionen müssen Blobs pro Anfrage mit der Umgebung verbinden.
  if ((event as { blobs?: string }).blobs) connectLambda(event as Parameters<typeof connectLambda>[0]);
  app ??= serverless(createApp({ data: () => data, rolls: new RollLog(new BlobRollStore()) }));
  return app(event, context);
};
