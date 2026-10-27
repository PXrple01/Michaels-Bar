// Netlify-Funktion für den Spielleiter: gestreamte Antworten (bis 60 s pro Zug).
import type { Config, Context } from "@netlify/functions";
import { RollLog } from "../../server/dice/log";
import { handleGmRequest } from "../../server/gm/http";
import { createGameMaster } from "../../server/gm/setup";
import type { GameData } from "../../server/rules/loader";
import gamedata from "../../server/generated/gamedata.json";
import { BlobCounterStore, BlobRollStore } from "../lib/blobs";

const data = gamedata as unknown as GameData;

export default async (req: Request, context: Context) => {
  const secret = process.env.GAME_SECRET;
  if (!secret || secret.length < 16) {
    return new Response(`data: ${JSON.stringify({ type: "error", code: "no_api_key", message: "GAME_SECRET fehlt in den Netlify-Umgebungsvariablen (mindestens 16 Zeichen)." })}\n\n`, { headers: { "content-type": "text/event-stream" } });
  }
  const gm = createGameMaster(process.env, () => data, new RollLog(new BlobRollStore()), new BlobCounterStore(), secret);
  return handleGmRequest(req, gm, process.env.ACCESS_CODE, context.ip ?? "unbekannt");
};

export const config: Config = { path: "/api/campaign/*" };
