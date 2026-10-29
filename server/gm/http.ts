// Spielleiter-Endpunkte als Server-Sent Events – für Express (lokal) und Web-Request (Netlify).
import type { Express, Request } from "express";
import type { GmEvent } from "../../shared/campaign";
import type { ReviewEvent } from "../../shared/classreview";
import type { PartyEvent } from "../../shared/party";
import type { Claude } from "./setup";
import { readSession } from "../accounts";
import { ValidationError } from "../characters";
import { serveImage } from "../images";
import { LimitError } from "./usage";

export const GM_KINDS = ["start", "turn", "roll", "upgrade", "choose", "level", "shop"] as const;
export type GmKind = (typeof GM_KINDS)[number];

type AnyEvent = GmEvent | ReviewEvent | PartyEvent;
const sse = (ev: AnyEvent) => `data: ${JSON.stringify(ev)}\n\n`;

/** Lebenszeichen im Stream: Proxys schließen stille Verbindungen nicht, und der Browser erkennt eine tote Verbindung. */
const PING_MS = 15_000;

/** Gestreamte SSE-Antwort (Netlify). Schreiben nach einem Verbindungsabbruch ist harmlos – der Zug läuft zu Ende und wird gespeichert. */
function sseResponse(run: (write: (chunk: string) => void) => Promise<void>, headers: Record<string, string> = {}): Response {
  const encoder = new TextEncoder();
  let closed = false;
  let ping: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (chunk: string) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(chunk)); } catch { closed = true; }
      };
      ping = setInterval(() => write(": ping\n\n"), PING_MS);
      try { await run(write); } catch (e) { console.error(e); } finally {
        clearInterval(ping);
        if (!closed) { closed = true; try { controller.close(); } catch { /* schon zu */ } }
      }
    },
    cancel() { closed = true; clearInterval(ping); },
  });
  return new Response(stream, { headers: { ...headers, "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" } });
}

/** Dasselbe für Express (lokal). */
async function sseExpress(res: import("express").Response, run: (write: (chunk: string) => void) => Promise<void>) {
  res.setHeader("content-type", "text/event-stream; charset=utf-8");
  res.setHeader("cache-control", "no-cache, no-transform");
  res.flushHeaders();
  const write = (chunk: string) => { if (!res.writableEnded && !res.destroyed) res.write(chunk); };
  const ping = setInterval(() => write(": ping\n\n"), PING_MS);
  try { await run(write); } catch (e) { console.error(e); } finally { clearInterval(ping); res.end(); }
}

const PARTY_JSON = ["create", "join", "state", "leave", "choose", "level", "overview", "remove", "shop", "sheet"] as const;
const PARTY_STREAM = ["start", "action", "roll", "upgrade"] as const;

/** Gruppen-Anfragen ohne Claude: direkte JSON-Antwort. */
async function partyJson(claude: Claude, op: (typeof PARTY_JSON)[number], body: unknown): Promise<{ status: number; body: unknown }> {
  try {
    const b = (body ?? {}) as Record<string, unknown>;
    const svc = claude.party;
    const out = op === "create" ? await svc.create(b) : op === "join" ? await svc.join(b) : op === "state" ? await svc.state(b) : op === "choose" ? await svc.choose(b) : op === "level" ? await svc.levelChoice(b)
      : op === "overview" ? await svc.overview(b) : op === "remove" ? await svc.remove(b) : op === "shop" ? await svc.shop(b) : op === "sheet" ? await svc.sheet(b) : await svc.leave(b);
    return { status: 200, body: out };
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.name === "Error" || err.code) return { status: err.code === "access" ? 403 : 400, body: { error: err.message } };
    console.error(e);
    return { status: 500, body: { error: "Interner Fehler" } };
  }
}

/** Optionaler Zugangscode (ACCESS_CODE). Ohne gesetzten Code ist das Spiel offen – sinnvoll nur lokal. */
export function accessAllowed(accessCode: string | undefined, given: string | null | undefined): boolean {
  return !accessCode || given === accessCode;
}

/**
 * Zugang zum Spielleiter: Zugangscode oder angemeldetes Konto (x-session). Angemeldete zählen beim Stundenlimit
 * als Konto statt als Adresse.
 */
export function gate(accessCode: string | undefined, secret: string | undefined, code: string | null | undefined, session: string | null | undefined, ip: string) {
  const s = secret ? readSession(secret, session) : null;
  return { ok: accessAllowed(accessCode, code) || !!s, who: s ? `user:${s.id}` : ip };
}

/** Vorlesen oder Musik: JSON-Antwort mit dem Ton-Link. */
async function audioJson(claude: Claude, kind: "tts" | "music", arg: unknown, who: string, segments?: unknown): Promise<{ status: number; body: unknown }> {
  try {
    return { status: 200, body: kind === "tts" ? await claude.speak(arg, who, segments) : await claude.music(arg, who) };
  } catch (e) {
    if (e instanceof LimitError) return { status: 429, body: { error: e.message } };
    return { status: 502, body: { error: (e as Error).message } };
  }
}

/** Figurenporträt malen: JSON-Antwort mit dem Bild-Link. */
async function portraitJson(claude: Claude, body: unknown, who: string): Promise<{ status: number; body: unknown }> {
  try {
    return { status: 200, body: await claude.portrait((body as { character?: unknown } | null)?.character, who) };
  } catch (e) {
    if (e instanceof ValidationError) return { status: 400, body: { error: `Figur ungültig: ${e.problems.join(", ")}` } };
    if (e instanceof LimitError) return { status: 429, body: { error: e.message } };
    return { status: 502, body: { error: (e as Error).message } };
  }
}

export function mountGm(app: Express, claude: () => Claude, accessCode: string | undefined, secret?: string) {
  const gateOf = (req: Request) => gate(accessCode, secret, req.header("x-access-code"), req.header("x-session"), req.ip ?? "local");
  app.get("/api/images/:id", async (req: Request, res) => {
    const r = await serveImage(claude().images.store, String(req.params.id));
    res.status(r.status);
    r.headers.forEach((v, k) => res.setHeader(k, v));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  app.post(["/api/tts", "/api/music/:mood"], async (req: Request, res) => {
    const g = gateOf(req);
    if (!g.ok) return void res.status(403).json({ error: "Zugangscode fehlt oder ist falsch.", code: "access" });
    const r = req.path === "/api/tts" ? await audioJson(claude(), "tts", req.body?.text, g.who, req.body?.segments) : await audioJson(claude(), "music", req.params.mood, g.who);
    res.status(r.status).json(r.body);
  });
  app.post("/api/portrait", async (req: Request, res) => {
    const g = gateOf(req);
    if (!g.ok) return void res.status(403).json({ error: "Zugangscode fehlt oder ist falsch.", code: "access" });
    const r = await portraitJson(claude(), req.body, g.who);
    res.status(r.status).json(r.body);
  });
  app.post("/api/party/:op", async (req: Request, res) => {
    const op = String(req.params.op);
    const g = gateOf(req);
    if (!g.ok) return void res.status(403).json({ error: "Zugangscode fehlt oder ist falsch.", code: "access" });
    if ((PARTY_JSON as readonly string[]).includes(op)) {
      const r = await partyJson(claude(), op as (typeof PARTY_JSON)[number], req.body);
      return void res.status(r.status).json(r.body);
    }
    if (!(PARTY_STREAM as readonly string[]).includes(op)) return void res.status(404).json({ error: "Unbekannter Endpunkt" });
    await sseExpress(res, (write) => claude().party.run(op as (typeof PARTY_STREAM)[number], req.body ?? {}, g.who, (ev) => write(sse(ev))));
  });

  app.post(["/api/campaign/:kind", "/api/classes/review"], async (req: Request, res) => {
    const kind = (req.path.endsWith("/review") ? "review" : req.params.kind) as GmKind | "review";
    if (kind !== "review" && !GM_KINDS.includes(kind)) return void res.status(404).json({ error: "Unbekannter Endpunkt" });
    await sseExpress(res, async (write) => {
      const emit = (ev: GmEvent | ReviewEvent) => write(sse(ev));
      const g = gateOf(req);
      if (!g.ok) emit({ type: "error", message: "Zugangscode fehlt oder ist falsch.", code: "access" });
      else if (kind === "review") await claude().reviewer.run(req.body, g.who, emit);
      else await claude().gm.run(kind, req.body, g.who, emit);
    });
  });
}

/** CORS für die OpenAI-Schnittstelle: Chat-Apps im Browser laufen auf anderen Adressen. */
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, POST, OPTIONS" };

/** OpenAI-kompatible Endpunkte (/v1/models, /v1/chat/completions) – geschützt durch OPENAI_COMPAT_KEY statt ACCESS_CODE. */
export function mountOpenAi(app: Express, claude: () => Claude) {
  app.all(/^\/v1\/.*/, async (req: Request, res) => {
    res.set(CORS);
    if (req.method === "OPTIONS") return void res.status(204).end();
    const r = await claude().openai.handle(req.method, req.path, req.header("authorization") ?? null, req.body, req.ip ?? "local");
    if (!("stream" in r)) return void res.status(r.status).json(r.json);
    res.setHeader("content-type", "text/event-stream; charset=utf-8");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.flushHeaders();
    await r.stream((chunk) => res.write(chunk));
    res.end();
  });
}

async function handleOpenAiRequest(request: globalThis.Request, path: string, claude: Claude, who: string): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  let body: unknown = null;
  if (request.method === "POST") { try { body = await request.json(); } catch { return Response.json({ error: { message: "Ungültiges JSON.", type: "invalid_request_error", code: null } }, { status: 400, headers: CORS }); } }
  const r = await claude.openai.handle(request.method, path, request.headers.get("authorization"), body, who);
  if (!("stream" in r)) return Response.json(r.json, { status: r.status, headers: CORS });
  return sseResponse((write) => r.stream(write), CORS);
}

/** Für Netlify: beantwortet einen Web-Request mit einem gestreamten Response. */
export async function handleGmRequest(req: Request | globalThis.Request, claude: Claude, accessCode: string | undefined, ip: string, secret?: string): Promise<Response> {
  const request = req as globalThis.Request;
  const path = new URL(request.url).pathname;
  if (path.startsWith("/v1/")) return handleOpenAiRequest(request, path, claude, ip);
  if (path.startsWith("/api/images/") && request.method === "GET") return serveImage(claude.images.store, path.split("/").pop() ?? "");
  const g = gate(accessCode, secret, request.headers.get("x-access-code"), request.headers.get("x-session"), ip);
  const who = g.who;
  if ((path === "/api/tts" || path.startsWith("/api/music/")) && request.method === "POST") {
    if (!g.ok) return Response.json({ error: "Zugangscode fehlt oder ist falsch.", code: "access" }, { status: 403 });
    let body: { text?: unknown; segments?: unknown } | null = null;
    try { body = await request.json(); } catch { /* leer */ }
    const r = path === "/api/tts" ? await audioJson(claude, "tts", body?.text, who, body?.segments) : await audioJson(claude, "music", path.split("/").pop(), who);
    return Response.json(r.body, { status: r.status });
  }
  if (path === "/api/portrait" && request.method === "POST") {
    if (!g.ok) return Response.json({ error: "Zugangscode fehlt oder ist falsch.", code: "access" }, { status: 403 });
    let body: unknown = null;
    try { body = await request.json(); } catch { /* ungültig */ }
    const r = await portraitJson(claude, body, who);
    return Response.json(r.body, { status: r.status });
  }
  if (path.startsWith("/api/party/")) return handlePartyRequest(request, path.split("/").pop() ?? "", claude, g.ok, who);
  const kind = (path === "/api/classes/review" ? "review" : path.split("/").pop()) as GmKind | "review";
  if (request.method !== "POST" || (kind !== "review" && !GM_KINDS.includes(kind))) return new Response("Not found", { status: 404 });
  let body: unknown = null;
  try { body = await request.json(); } catch { /* bleibt null, wird als ungültig gemeldet */ }
  const allowed = g.ok;
  return sseResponse(async (write) => {
    const emit = (ev: GmEvent | ReviewEvent) => write(sse(ev));
    if (!allowed) emit({ type: "error", message: "Zugangscode fehlt oder ist falsch.", code: "access" });
    else if (kind === "review") await claude.reviewer.run(body, who, emit);
    else await claude.gm.run(kind, body, who, emit as (ev: GmEvent) => void);
  });
}

async function handlePartyRequest(request: globalThis.Request, op: string, claude: Claude, allowed: boolean, who: string): Promise<Response> {
  if (request.method !== "POST") return new Response("Not found", { status: 404 });
  if (!allowed) return Response.json({ error: "Zugangscode fehlt oder ist falsch.", code: "access" }, { status: 403 });
  let body: Record<string, unknown> = {};
  try { body = (await request.json()) ?? {}; } catch { /* leer */ }
  if ((PARTY_JSON as readonly string[]).includes(op)) {
    const r = await partyJson(claude, op as (typeof PARTY_JSON)[number], body);
    return Response.json(r.body, { status: r.status });
  }
  if (!(PARTY_STREAM as readonly string[]).includes(op)) return new Response("Not found", { status: 404 });
  return sseResponse((write) => claude.party.run(op as (typeof PARTY_STREAM)[number], body, who, (ev) => write(sse(ev))));
}
