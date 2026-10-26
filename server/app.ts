import express, { type NextFunction, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { characterRoll, type CharacterRollType } from "../shared/character";
import { NotationError, type CheckRequest, type FreeRollRequest, type RollMode } from "../shared/dice";
import { CharacterStore, ValidationError } from "./characters";
import type { RollLog } from "./dice/log";
import type { GameData } from "./rules/loader";

const MODES: RollMode[] = ["normal", "advantage", "disadvantage"];

function parseMode(m: unknown): RollMode {
  if (m === undefined) return "normal";
  if (typeof m === "string" && (MODES as string[]).includes(m)) return m as RollMode;
  throw new ValidationError(["Ungültiger Modus"]);
}

function parseDc(dc: unknown): number | null {
  if (dc === undefined || dc === null) return null;
  if (typeof dc !== "number" || !Number.isInteger(dc) || dc < 1 || dc > 40) throw new ValidationError(["Ungültiger Schwierigkeitsgrad"]);
  return dc;
}

export function createApp(opts: { data: () => GameData; characters: CharacterStore; rolls: RollLog; staticDir?: string }) {
  const app = express();
  app.use(express.json({ limit: "64kb" }));

  app.get("/api/health", (_req, res) => { res.json({ ok: true }); });

  app.get("/api/rules", (_req, res) => {
    const { rules, campaign, classes } = opts.data();
    res.json({ rules, campaign, classes });
  });

  app.get("/api/characters", async (_req, res) => { res.json(await opts.characters.list()); });

  app.get("/api/characters/:id", async (req, res) => {
    const c = await opts.characters.get(req.params.id);
    if (!c) return void res.status(404).json({ error: "Figur nicht gefunden" });
    res.json(c);
  });

  app.post("/api/characters", async (req, res) => { res.status(201).json(await opts.characters.create(req.body)); });

  app.patch("/api/characters/:id", async (req, res) => {
    const c = await opts.characters.patch(req.params.id, req.body ?? {});
    if (!c) return void res.status(404).json({ error: "Figur nicht gefunden" });
    res.json(c);
  });

  app.delete("/api/characters/:id", async (req, res) => {
    res.status((await opts.characters.remove(req.params.id)) ? 204 : 404).end();
  });

  // Freier Wurf am Würfeltisch. Das Ergebnis entsteht ausschließlich hier.
  app.post("/api/rolls", async (req, res) => {
    const body = (req.body ?? {}) as Partial<FreeRollRequest>;
    if (typeof body.notation !== "string") throw new ValidationError(["notation fehlt"]);
    const record = await opts.rolls.roll({
      requestId: String(body.requestId ?? ""),
      kind: "free",
      label: typeof body.label === "string" ? body.label.slice(0, 80) : "Freier Wurf",
      notation: body.notation,
      mode: parseMode(body.mode),
      dc: parseDc(body.dc),
    });
    res.status(record.repeated ? 200 : 201).json(record);
  });

  // Probe für eine Figur: Der Modifikator wird aus der gespeicherten Figur berechnet, nicht vom Browser übernommen.
  app.post("/api/rolls/check", async (req, res) => {
    const body = (req.body ?? {}) as Partial<CheckRequest>;
    const c = await opts.characters.get(String(body.characterId ?? ""));
    if (!c) return void res.status(404).json({ error: "Figur nicht gefunden" });
    const type = body.check?.type as CharacterRollType | undefined;
    if (!type || !["attribute", "skill", "attack", "damage"].includes(type)) throw new ValidationError(["Unbekannte Probenart"]);
    const { rules, classes } = opts.data();
    let spec;
    try {
      spec = characterRoll(c, rules, classes, type, String(body.check?.id ?? ""));
    } catch (e) {
      throw new ValidationError([(e as Error).message]);
    }
    const record = await opts.rolls.roll({
      requestId: String(body.requestId ?? ""),
      kind: "check",
      label: `${c.name}: ${spec.label}`,
      notation: spec.notation,
      mode: spec.d20 ? parseMode(body.mode) : "normal",
      modifierParts: spec.parts,
      dc: spec.d20 ? parseDc(body.dc) : null,
    });
    res.status(record.repeated ? 200 : 201).json(record);
  });

  app.get("/api/rolls", (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    res.json(opts.rolls.recent(limit));
  });

  if (opts.staticDir && existsSync(opts.staticDir)) {
    app.use(express.static(opts.staticDir));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(opts.staticDir!, "index.html")));
  }

  app.use("/api", (_req, res) => { res.status(404).json({ error: "Unbekannter Endpunkt" }); });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ValidationError) return void res.status(400).json({ error: "Ungültige Eingabe", problems: err.problems });
    if (err instanceof NotationError) return void res.status(400).json({ error: err.message, problems: [err.message] });
    if (err instanceof Error && err.message === "Ungültige requestId") return void res.status(400).json({ error: err.message, problems: [err.message] });
    if (err instanceof SyntaxError) return void res.status(400).json({ error: "Ungültiges JSON" });
    console.error(err);
    res.status(500).json({ error: "Interner Fehler" });
  });

  return app;
}
