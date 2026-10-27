// Spielleiter-Endpunkte als Server-Sent Events – für Express (lokal) und Web-Request (Netlify).
import type { Express, Request } from "express";
import type { GmEvent } from "../../shared/campaign";
import type { GameMaster } from "./engine";

export const GM_KINDS = ["start", "turn", "roll"] as const;
export type GmKind = (typeof GM_KINDS)[number];

const sse = (ev: GmEvent) => `data: ${JSON.stringify(ev)}\n\n`;

/** Optionaler Zugangscode (ACCESS_CODE). Ohne gesetzten Code ist das Spiel offen – sinnvoll nur lokal. */
export function accessAllowed(accessCode: string | undefined, given: string | null | undefined): boolean {
  return !accessCode || given === accessCode;
}

export function mountGm(app: Express, gm: () => GameMaster, accessCode: string | undefined) {
  app.post("/api/campaign/:kind", async (req: Request, res) => {
    const kind = req.params.kind as GmKind;
    if (!GM_KINDS.includes(kind)) return void res.status(404).json({ error: "Unbekannter Endpunkt" });
    res.setHeader("content-type", "text/event-stream; charset=utf-8");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.flushHeaders();
    if (!accessAllowed(accessCode, req.header("x-access-code"))) {
      res.end(sse({ type: "error", message: "Zugangscode fehlt oder ist falsch.", code: "access" }));
      return;
    }
    await gm().run(kind, req.body, req.ip ?? "local", (ev) => res.write(sse(ev)));
    res.end();
  });
}

/** Für Netlify: beantwortet einen Web-Request mit einem gestreamten Response. */
export async function handleGmRequest(req: Request | globalThis.Request, gm: GameMaster, accessCode: string | undefined, who: string): Promise<Response> {
  const request = req as globalThis.Request;
  const kind = new URL(request.url).pathname.split("/").pop() as GmKind;
  if (request.method !== "POST" || !GM_KINDS.includes(kind)) return new Response("Not found", { status: 404 });
  let body: unknown = null;
  try { body = await request.json(); } catch { /* bleibt null, wird als ungültig gemeldet */ }
  const encoder = new TextEncoder();
  const allowed = accessAllowed(accessCode, request.headers.get("x-access-code"));
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (ev: GmEvent) => controller.enqueue(encoder.encode(sse(ev)));
      if (!allowed) emit({ type: "error", message: "Zugangscode fehlt oder ist falsch.", code: "access" });
      else await gm.run(kind, body, who, emit);
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" } });
}
