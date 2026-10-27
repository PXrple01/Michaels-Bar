// Netlify-Funktion für Regeln, Figuren und Würfe (modernes Format: Blobs ist automatisch verbunden).
import type { Config } from "@netlify/functions";
import { handleApi } from "../../server/api";
import { RollLog } from "../../server/dice/log";
import type { GameData } from "../../server/rules/loader";
import gamedata from "../../server/generated/gamedata.json";
import { BlobRollStore } from "../lib/blobs";

const deps = { data: () => gamedata as unknown as GameData, rolls: new RollLog(new BlobRollStore()), accessCode: process.env.ACCESS_CODE, secret: process.env.GAME_SECRET };

export default async (req: Request) => {
  let body: unknown = null;
  if (req.method !== "GET" && req.method !== "HEAD") {
    try { body = await req.json(); } catch { return Response.json({ error: "Ungültiges JSON" }, { status: 400 }); }
  }
  const result = await handleApi(req.method, new URL(req.url).pathname, body, deps);
  return Response.json(result.body, { status: result.status });
};

export const config: Config = {
  path: ["/api/health", "/api/rules", "/api/config", "/api/characters", "/api/rolls", "/api/rolls/check", "/api/classes/confirm", "/api/classes/verify"],
};
