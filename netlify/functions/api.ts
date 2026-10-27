// Netlify-Funktion: derselbe Server wie lokal, nur ohne dauerhaften Prozess.
import { connectLambda } from "@netlify/blobs";
import serverless from "serverless-http";
import { createApp } from "../../server/app";
import { RollLog } from "../../server/dice/log";
import { BlobRollStore } from "../lib/blobs";
import type { GameData } from "../../server/rules/loader";
import gamedata from "../../server/generated/gamedata.json";

const data = gamedata as unknown as GameData;
let app: ReturnType<typeof serverless> | null = null;

export const handler: serverless.Handler = (event, context) => {
  // Lambda-kompatible Funktionen müssen Blobs pro Anfrage mit der Umgebung verbinden.
  if ((event as { blobs?: string }).blobs) connectLambda(event as Parameters<typeof connectLambda>[0]);
  app ??= serverless(createApp({ data: () => data, rolls: new RollLog(new BlobRollStore()), accessCode: process.env.ACCESS_CODE }));
  return app(event, context);
};
