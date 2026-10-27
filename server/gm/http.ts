// Spielleiter-Endpunkte als Server-Sent Events – für Express (lokal) und Web-Request (Netlify).
import type { Express, Request } from "express";
import type { GmEvent } from "../../shared/campaign";
import type { ReviewEvent } from "../../shared/classreview";
import type { PartyEvent } from "../../shared/party";
import type { Claude } from "./setup";

export const GM_KINDS = ["start", "turn", "roll"] as const;
export type GmKind = (typeof GM_KINDS)[number];

type AnyEvent = GmEvent | ReviewEvent | PartyEvent;
const sse = (ev: AnyEvent) => `data: ${JSON.stringify(ev)}\n\n`;

const PARTY_JSON = ["create", "join", "state", "leave"] as const;
const PARTY_STREAM = ["start", "action", "roll"] as const;

/** Gruppen-Anfragen ohne Claude: direkte JSON-Antwort. */
async function partyJson(claude: Claude, op: (typeof PARTY_JSON)[number], body: unknown): Promise<{ status: number; body: unknown }> {
  try {
    const b = (body ?? {}) as Record<string, unknown>;
    const svc = claude.party;
    const out = op === "create" ? await svc.create(b) : op === "join" ? await svc.join(b) : op === "state" ? await svc.state(b) : await svc.leave(b);
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

export function mountGm(app: Express, claude: () => Claude, accessCode: string | undefined) {
  app.post("/api/party/:op", async (req: Request, res) => {
    const op = String(req.params.op);
    if (!accessAllowed(accessCode, req.header("x-access-code"))) return void res.status(403).json({ error: "Zugangscode fehlt oder ist falsch.", code: "access" });
    if ((PARTY_JSON as readonly string[]).includes(op)) {
      const r = await partyJson(claude(), op as (typeof PARTY_JSON)[number], req.body);
      return void res.status(r.status).json(r.body);
    }
    if (!(PARTY_STREAM as readonly string[]).includes(op)) return void res.status(404).json({ error: "Unbekannter Endpunkt" });
    res.setHeader("content-type", "text/event-stream; charset=utf-8");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.flushHeaders();
    await claude().party.run(op as (typeof PARTY_STREAM)[number], req.body ?? {}, req.ip ?? "local", (ev) => res.write(sse(ev)));
    res.end();
  });

  app.post(["/api/campaign/:kind", "/api/classes/review"], async (req: Request, res) => {
    const kind = (req.path.endsWith("/review") ? "review" : req.params.kind) as GmKind | "review";
    if (kind !== "review" && !GM_KINDS.includes(kind)) return void res.status(404).json({ error: "Unbekannter Endpunkt" });
    res.setHeader("content-type", "text/event-stream; charset=utf-8");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.flushHeaders();
    if (!accessAllowed(accessCode, req.header("x-access-code"))) {
      res.end(sse({ type: "error", message: "Zugangscode fehlt oder ist falsch.", code: "access" }));
      return;
    }
    const emit = (ev: GmEvent | ReviewEvent) => res.write(sse(ev));
    if (kind === "review") await claude().reviewer.run(req.body, req.ip ?? "local", emit);
    else await claude().gm.run(kind, req.body, req.ip ?? "local", emit);
    res.end();
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
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      await r.stream((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
  return new Response(stream, { headers: { ...CORS, "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" } });
}

/** Für Netlify: beantwortet einen Web-Request mit einem gestreamten Response. */
export async function handleGmRequest(req: Request | globalThis.Request, claude: Claude, accessCode: string | undefined, who: string): Promise<Response> {
  const request = req as globalThis.Request;
  const path = new URL(request.url).pathname;
  if (path.startsWith("/v1/")) return handleOpenAiRequest(request, path, claude, who);
  if (path.startsWith("/api/party/")) return handlePartyRequest(request, path.split("/").pop() ?? "", claude, accessCode, who);
  const kind = (path === "/api/classes/review" ? "review" : path.split("/").pop()) as GmKind | "review";
  if (request.method !== "POST" || (kind !== "review" && !GM_KINDS.includes(kind))) return new Response("Not found", { status: 404 });
  let body: unknown = null;
  try { body = await request.json(); } catch { /* bleibt null, wird als ungültig gemeldet */ }
  const encoder = new TextEncoder();
  const allowed = accessAllowed(accessCode, request.headers.get("x-access-code"));
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (ev: GmEvent | ReviewEvent) => controller.enqueue(encoder.encode(sse(ev)));
      if (!allowed) emit({ type: "error", message: "Zugangscode fehlt oder ist falsch.", code: "access" });
      else if (kind === "review") await claude.reviewer.run(body, who, emit);
      else await claude.gm.run(kind, body, who, emit as (ev: GmEvent) => void);
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" } });
}

async function handlePartyRequest(request: globalThis.Request, op: string, claude: Claude, accessCode: string | undefined, who: string): Promise<Response> {
  if (request.method !== "POST") return new Response("Not found", { status: 404 });
  if (!accessAllowed(accessCode, request.headers.get("x-access-code"))) return Response.json({ error: "Zugangscode fehlt oder ist falsch.", code: "access" }, { status: 403 });
  let body: Record<string, unknown> = {};
  try { body = (await request.json()) ?? {}; } catch { /* leer */ }
  if ((PARTY_JSON as readonly string[]).includes(op)) {
    const r = await partyJson(claude, op as (typeof PARTY_JSON)[number], body);
    return Response.json(r.body, { status: r.status });
  }
  if (!(PARTY_STREAM as readonly string[]).includes(op)) return new Response("Not found", { status: 404 });
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      await claude.party.run(op as (typeof PARTY_STREAM)[number], body, who, (ev) => controller.enqueue(encoder.encode(sse(ev))));
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" } });
}
