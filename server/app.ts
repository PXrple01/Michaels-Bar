import express, { type NextFunction, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { handleApi } from "./api";
import type { RollLog } from "./dice/log";
import type { GameMaster } from "./gm/engine";
import { mountGm } from "./gm/http";
import type { GameData } from "./rules/loader";

export function createApp(opts: { data: () => GameData; rolls: RollLog; staticDir?: string; gm?: () => GameMaster; accessCode?: string }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));

  if (opts.gm) mountGm(app, opts.gm, opts.accessCode);

  app.all(/^\/api\/.*/, async (req, res) => {
    const result = await handleApi(req.method, req.path, req.body, opts);
    res.status(result.status).json(result.body);
  });

  if (opts.staticDir && existsSync(opts.staticDir)) {
    app.use(express.static(opts.staticDir));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(opts.staticDir!, "index.html")));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof SyntaxError) return void res.status(400).json({ error: "Ungültiges JSON" });
    console.error(err);
    res.status(500).json({ error: "Interner Fehler" });
  });

  return app;
}
