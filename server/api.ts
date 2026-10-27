// API-Logik ohne Framework: dieselbe Funktion bedient Express (lokal) und Netlify (Web-Request).
import { characterRoll, type CharacterRollType } from "../shared/character";
import { NotationError, type CheckRequest, type FreeRollRequest, type RollMode } from "../shared/dice";
import { mkdir, writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { checkClass } from "../shared/classbuilder";
import { classSchema } from "../shared/schema";
import { buildCharacter, resolveCharacter, ValidationError } from "./characters";
import { signClass, verifySignedClass } from "./classes";
import type { RollLog } from "./dice/log";
import type { GameData } from "./rules/loader";

export interface ApiDeps { data: () => GameData; rolls: RollLog; accessCode?: string; secret?: string; customClassDir?: string }
export interface ApiResult { status: number; body: unknown }

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

async function route(method: string, path: string, body: unknown, deps: ApiDeps): Promise<ApiResult> {
  const key = `${method} ${path.replace(/\/+$/, "")}`;
  switch (key) {
    case "GET /api/health":
      return { status: 200, body: { ok: true } };
    case "GET /api/rules": {
      const { rules, campaign, classes } = deps.data();
      return { status: 200, body: { rules, campaign, classes } };
    }
    case "GET /api/config":
      return { status: 200, body: { accessRequired: !!deps.accessCode } };
    // Neue Figur: Der Server rechnet sie aus, gespeichert wird sie im Browser.
    case "POST /api/characters":
      return { status: 201, body: buildCharacter(body, deps.data(), deps.secret) };
    // Freier Wurf am Würfeltisch. Das Ergebnis entsteht ausschließlich hier.
    case "POST /api/rolls": {
      const b = (body ?? {}) as Partial<FreeRollRequest>;
      if (typeof b.notation !== "string") throw new ValidationError(["notation fehlt"]);
      const record = await deps.rolls.roll({
        requestId: String(b.requestId ?? ""),
        kind: "free",
        label: typeof b.label === "string" ? b.label.slice(0, 80) : "Freier Wurf",
        notation: b.notation,
        mode: parseMode(b.mode),
        dc: parseDc(b.dc),
      });
      return { status: record.repeated ? 200 : 201, body: record };
    }
    // Probe für eine Figur: Der Server prüft die Figur und rechnet den Bonus selbst.
    case "POST /api/rolls/check": {
      const b = (body ?? {}) as Partial<CheckRequest>;
      const { c, data } = resolveCharacter(b.character, deps.data(), deps.secret);
      const type = b.check?.type as CharacterRollType | undefined;
      if (!type || !["attribute", "skill", "attack", "damage"].includes(type)) throw new ValidationError(["Unbekannte Probenart"]);
      let spec;
      try {
        spec = characterRoll(c, data.rules, data.classes, type, String(b.check?.id ?? ""));
      } catch (e) {
        throw new ValidationError([(e as Error).message]);
      }
      const record = await deps.rolls.roll({
        requestId: String(b.requestId ?? ""),
        kind: "check",
        label: `${c.name}: ${spec.label}`,
        notation: spec.notation,
        mode: spec.d20 ? parseMode(b.mode) : "normal",
        modifierParts: spec.parts,
        dc: spec.d20 ? parseDc(b.dc) : null,
      });
      return { status: record.repeated ? 200 : 201, body: record };
    }
    // Klasse speichern: nur, wenn die harte Regelprüfung besteht. Danach signiert der Server sie.
    case "POST /api/classes/confirm": {
      if (!deps.secret) throw new ValidationError(["Eigene Klassen brauchen GAME_SECRET auf dem Server."]);
      const parsed = classSchema.safeParse((body as { cls?: unknown } | null)?.cls);
      if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
      if (!/^eigen_[a-z0-9_]{1,60}$/.test(parsed.data.id)) throw new ValidationError(["Ungültige Klassen-ID"]);
      const data = deps.data();
      if (data.classes.some((c) => c.id === parsed.data.id && !c.custom)) throw new ValidationError(["Grundklassen lassen sich nicht überschreiben."]);
      const check = checkClass({ ...parsed.data, custom: true }, data.rules, data.campaign.magic_level);
      if (!check.ok) return { status: 422, body: { error: "Die Klasse erfüllt die Regeln nicht.", problems: check.errors, check } };
      const signed = signClass(deps.secret, check.cls);
      if (deps.customClassDir) {
        await mkdir(deps.customClassDir, { recursive: true });
        await writeFile(nodePath.join(deps.customClassDir, `${check.cls.id}.json`), JSON.stringify(check.cls, null, 2), "utf8");
      }
      return { status: 201, body: signed };
    }
    // Importierte Klassen-Datei prüfen
    case "POST /api/classes/verify": {
      const res = verifySignedClass(deps.secret, (body as { signed?: unknown } | null)?.signed, deps.data());
      return "error" in res ? { status: 422, body: { error: res.error } } : { status: 200, body: { ok: true, cls: res.cls } };
    }
    default:
      return { status: 404, body: { error: "Unbekannter Endpunkt" } };
  }
}

/** Führt eine API-Anfrage aus und übersetzt Fehler in verständliche Antworten. */
export async function handleApi(method: string, path: string, body: unknown, deps: ApiDeps): Promise<ApiResult> {
  try {
    return await route(method, path, body, deps);
  } catch (err) {
    if (err instanceof ValidationError) return { status: 400, body: { error: "Ungültige Eingabe", problems: err.problems } };
    if (err instanceof NotationError) return { status: 400, body: { error: err.message, problems: [err.message] } };
    if (err instanceof Error && err.message === "Ungültige requestId") return { status: 400, body: { error: err.message, problems: [err.message] } };
    console.error(err);
    const detail = err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 200) : "unbekannt";
    return { status: 500, body: { error: `Interner Fehler (${detail})` } };
  }
}
