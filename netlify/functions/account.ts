// Netlify-Funktion für Konten: Registrieren, Anmelden, Spielstände speichern (in Netlify Blobs).
import type { Config, Context } from "@netlify/functions";
import { AccountService } from "../../server/accounts";
import { BlobAccountStore, BlobCounterStore, BlobPartyStore } from "../lib/blobs";

export default async (req: Request, context: Context) => {
  const secret = process.env.GAME_SECRET;
  if (!secret || secret.length < 16) return Response.json({ error: "GAME_SECRET fehlt in den Netlify-Umgebungsvariablen (mindestens 16 Zeichen)." }, { status: 503 });
  const svc = new AccountService({ store: new BlobAccountStore(), secret, counters: new BlobCounterStore(), inviteCode: process.env.ACCESS_CODE?.trim() || undefined, admin: process.env.ADMIN_USER?.trim() || undefined, parties: new BlobPartyStore() });
  let body: unknown = null;
  if (req.method !== "GET" && req.method !== "HEAD") { try { body = await req.json(); } catch { return Response.json({ error: "Ungültiges JSON" }, { status: 400 }); } }
  const op = new URL(req.url).pathname.split("/").pop() ?? "";
  const r = await svc.handle(req.method, op, body, req.headers.get("x-session"), context.ip ?? "unbekannt");
  return Response.json(r.body, { status: r.status });
};

export const config: Config = { path: ["/api/account/*"] };
