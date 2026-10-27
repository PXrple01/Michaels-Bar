import express, { type NextFunction, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { handleApi } from "./api";
import type { RollLog } from "./dice/log";
import type { Claude } from "./gm/setup";
import { mountGm, mountOpenAi } from "./gm/http";
import type { GameData } from "./rules/loader";

export function createApp(opts: { data: () => GameData; rolls: RollLog; staticDir?: string; claude?: () => Claude; accessCode?: string; secret?: string; customClassDir?: string }) {
  const app = express();
  app.disable("x-powered-by");
  // Lange Abenteuer (signierter Verlauf) und OpenAI-Gespräche schicken den ganzen Verlauf mit
  app.use(express.json({ limit: "2mb" }));

  if (opts.claude) { mountGm(app, opts.claude, opts.accessCode); mountOpenAi(app, opts.claude); }

  app.all(/^\/api\/.*/, async (req, res) => {
    const result = await handleApi(req.method, req.path, req.body, opts);
    res.status(result.status).json(result.body);
  });

  if (opts.staticDir && existsSync(opts.staticDir)) {
    app.use(express.static(opts.staticDir));
    app.get(/^(?!\/(api|v1)\/).*/, (_req, res) => res.sendFile(path.join(opts.staticDir!, "index.html")));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof SyntaxError) return void res.status(400).json({ error: "Ungültiges JSON" });
    console.error(err);
    res.status(500).json({ error: "Interner Fehler" });
  });

  return app;
}
