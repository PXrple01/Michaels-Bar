// Spielleiter-Endpunkte als Server-Sent Events – für Express (lokal) und Web-Request (Netlify).
import type { Express, Request } from "express";
import type { GmEvent } from "../../shared/campaign";
import type { ReviewEvent } from "../../shared/classreview";
import type { Claude } from "./setup";

export const GM_KINDS = ["start", "turn", "roll"] as const;
export type GmKind = (typeof GM_KINDS)[number];

const sse = (ev: GmEvent | ReviewEvent) => `data: ${JSON.stringify(ev)}\n\n`;

/** Optionaler Zugangscode (ACCESS_CODE). Ohne gesetzten Code ist das Spiel offen – sinnvoll nur lokal. */
export function accessAllowed(accessCode: string | undefined, given: string | null | undefined): boolean {
  return !accessCode || given === accessCode;
}

export function mountGm(app: Express, claude: () => Claude, accessCode: string | undefined) {
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

/** Für Netlify: beantwortet einen Web-Request mit einem gestreamten Response. */
export async function handleGmRequest(req: Request | globalThis.Request, claude: Claude, accessCode: string | undefined, who: string): Promise<Response> {
  const request = req as globalThis.Request;
  const path = new URL(request.url).pathname;
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
