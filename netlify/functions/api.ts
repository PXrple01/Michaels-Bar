// Netlify-Funktion für Regeln, Figuren und Würfe (modernes Format: Blobs ist automatisch verbunden).
import type { Config } from "@netlify/functions";
import { handleApi } from "../../server/api";
import { RollLog } from "../../server/dice/log";
import type { GameData } from "../../server/rules/loader";
import gamedata from "../../server/generated/gamedata.json";
import { BlobRollStore } from "../lib/blobs";

const deps = { data: () => gamedata as unknown as GameData, rolls: new RollLog(new BlobRollStore()), accessCode: process.env.ACCESS_CODE, secret: process.env.GAME_SECRET, images: !!process.env.FAL_KEY?.trim() };

export default async (req: Request) => {
  let body: unknown = null;
  if (req.method !== "GET" && req.method !== "HEAD") {
    try { body = await req.json(); } catch { return Response.json({ error: "Ungültiges JSON" }, { status: 400 }); }
  }
  const path = new URL(req.url).pathname;
  const result = await handleApi(req.method, path, body, deps);
  // Regeln und Einstellungen ändern sich nur mit einer neuen Veröffentlichung (die leert den Zwischenspeicher):
  // im Netlify-Zwischenspeicher halten statt bei jedem Seitenaufruf die Funktion zu starten.
  const cacheable = req.method === "GET" && result.status === 200 && (path === "/api/rules" || path === "/api/config");
  return Response.json(result.body, { status: result.status, headers: cacheable ? { "cache-control": "public, max-age=300", "netlify-cdn-cache-control": "public, max-age=86400, durable" } : {} });
};

export const config: Config = {
  path: ["/api/health", "/api/rules", "/api/config", "/api/characters", "/api/rolls", "/api/rolls/check", "/api/classes/confirm", "/api/classes/verify"],
};
