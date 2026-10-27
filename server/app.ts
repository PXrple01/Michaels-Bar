import express, { type NextFunction, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { characterRoll, type CharacterRollType } from "../shared/character";
import { NotationError, type CheckRequest, type FreeRollRequest, type RollMode } from "../shared/dice";
import { buildCharacter, ValidationError, verifyCharacter } from "./characters";
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

export function createApp(opts: { data: () => GameData; rolls: RollLog; staticDir?: string }) {
  const app = express();
  app.disable("x-powered-by");
  // Auf Netlify kommen Anfragen je nach Weiterleitung mit dem Funktionspfad an.
  app.use((req, _res, next) => {
    if (req.url.startsWith("/.netlify/functions/api")) req.url = "/api" + req.url.slice("/.netlify/functions/api".length);
    next();
  });
  app.use(express.json({ limit: "64kb" }));

  app.get("/api/health", (_req, res) => { res.json({ ok: true }); });

  app.get("/api/rules", (_req, res) => {
    const { rules, campaign, classes } = opts.data();
    res.json({ rules, campaign, classes });
  });

  // Neue Figur: Der Server rechnet sie aus, gespeichert wird sie im Browser.
  app.post("/api/characters", (req, res) => { res.status(201).json(buildCharacter(req.body, opts.data())); });

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
    const c = verifyCharacter(body.character, opts.data());
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
