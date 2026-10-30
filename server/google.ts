// Google Cloud für die Testphase (300 $ Guthaben, 90 Tage): Claude über Vertex AI, Bilder mit Imagen, Chirp-Stimmen.
// Google wird nur in einem festen Zeitfenster benutzt – ab GOOGLE_TRIAL_START für TRIAL_DAYS Tage. Danach (oder ohne
// Startdatum) laufen automatisch wieder die bisherigen Anbieter (Anthropic, fal.ai, ElevenLabs bzw. WaveNet).
// Lehnt Google vorher ab (Guthaben weg, Zugang falsch), wird für eine Weile ebenfalls auf die bisherigen umgeschaltet.
import { createSign } from "node:crypto";
import type { CounterStore } from "./gm/usage";

/** 90 Tage Testphase, ein Tag Puffer – damit nie eine echte Abrechnung beginnt. */
export const TRIAL_DAYS = 89;
/** So lange bleibt Google nach einer Ablehnung (Guthaben, Rechte, Kontingent) abgeschaltet, bevor es neu versucht wird. */
const BROKEN_MS = 15 * 60_000;
/** Zähler der Google-Ausgaben (in Hundertstel-Cent, damit er ganzzahlig bleibt). */
const SPEND_KEY = "google-spend-cents100";
/** Letzter von Google gemeldeter echter Betrag (Budget-Meldung) und unser Schätzstand in dem Moment. */
const BILLED_KEY = "google-billed-cents100", EST_AT_BILL_KEY = "google-est-at-billed-cents100";

export interface GoogleEnv {
  /** Inhalt der JSON-Schlüsseldatei des Dienstkontos (client_email, private_key, project_id). */
  GOOGLE_SERVICE_ACCOUNT?: string;
  /** Erster Tag der Testphase, JJJJ-MM-TT. Ohne Datum wird Google nie benutzt. */
  GOOGLE_TRIAL_START?: string;
  /**
   * „1“ = Claude über Google (Vertex/Agent Platform). Standard aus: Claude ist dort ein Marketplace-Produkt, das das
   * Startguthaben meist NICHT abdeckt – es würde echt abgerechnet. Bilder und Stimme laufen auch ohne über Google.
   */
  GOOGLE_CLAUDE?: string;
  /** Region für Claude (Standard: global). */
  GOOGLE_REGION?: string;
  /** Region für Imagen (Standard: us-central1). */
  GOOGLE_IMAGE_REGION?: string;
  /** Imagen-Modell (Standard: imagen-4.0-generate-001). */
  GOOGLE_IMAGE_MODEL?: string;
  /** Imagen-Modell der Luxus-Stufe (Standard: imagen-4.0-ultra-generate-001). */
  GOOGLE_IMAGE_MODEL_LUXURY?: string;
  /** Guthaben, das in der Testphase ausgegeben werden soll, in Dollar (Standard: 300). */
  GOOGLE_TRIAL_BUDGET_USD?: string;
  /** Geheimes Wort im Link für Googles Budget-Meldungen (…/api/google-budget?token=…). Ohne es werden Meldungen abgelehnt. */
  GOOGLE_BUDGET_TOKEN?: string;
}

export interface GoogleConfig { email: string; privateKey: string; projectId: string; region: string; imageRegion: string; imageModel: string; luxuryImageModel: string; budgetUsd: number; start: Date; until: Date }

/**
 * Schlüsseldatei lesen – auch wenn sie beim Einfügen gelitten hat: in Anführungszeichen gesetzt, als Base64,
 * oder mit echten Zeilenumbrüchen statt „\n“ im privaten Schlüssel (das macht manches Eingabefeld).
 */
export function parseServiceAccount(raw: string): unknown {
  let s = raw.trim().replace(/^\uFEFF/, "");
  if (!s.startsWith("{") && /^[A-Za-z0-9+/=\s]+$/.test(s)) { try { s = Buffer.from(s, "base64").toString("utf8").trim(); } catch { /* kein Base64 */ } }
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"{') && s.endsWith('}"'))) { try { const inner = s.startsWith('"') ? JSON.parse(s) : s.slice(1, -1); if (typeof inner === "string") s = inner.trim(); } catch { s = s.slice(1, -1); } }
  try { return JSON.parse(s); } catch { /* weiter unten reparieren */ }
  // Zeilenumbrüche innerhalb von Zeichenketten wieder zu \n machen
  let out = "", inStr = false, esc = false;
  for (const ch of s) {
    if (inStr) {
      if (esc) { esc = false; out += ch; continue; }
      if (ch === "\\") { esc = true; out += ch; continue; }
      if (ch === '"') inStr = false;
      if (ch === "\n") { out += "\\n"; continue; }
      if (ch === "\r") continue;
    } else if (ch === '"') inStr = true;
    out += ch;
  }
  return JSON.parse(out);
}

/** Liest die Einstellungen. null = Google ist nicht (vollständig) eingerichtet. */
export function googleConfig(env: GoogleEnv): GoogleConfig | null {
  const start = env.GOOGLE_TRIAL_START?.trim();
  if (!env.GOOGLE_SERVICE_ACCOUNT?.trim() || !start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  try {
    const sa = parseServiceAccount(env.GOOGLE_SERVICE_ACCOUNT) as { client_email?: string; private_key?: string; project_id?: string };
    if (!sa.client_email || !sa.private_key || !sa.project_id) return null;
    const from = new Date(`${start}T00:00:00Z`);
    const until = new Date(from);
    until.setUTCDate(until.getUTCDate() + TRIAL_DAYS);
    return {
      email: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, "\n"), projectId: sa.project_id,
      region: env.GOOGLE_REGION?.trim() || "global", imageRegion: env.GOOGLE_IMAGE_REGION?.trim() || "us-central1",
      imageModel: env.GOOGLE_IMAGE_MODEL?.trim() || "imagen-4.0-generate-001",
      luxuryImageModel: env.GOOGLE_IMAGE_MODEL_LUXURY?.trim() || "imagen-4.0-ultra-generate-001",
      budgetUsd: Number(env.GOOGLE_TRIAL_BUDGET_USD) > 0 ? Number(env.GOOGLE_TRIAL_BUDGET_USD) : 300, start: from, until,
    };
  } catch {
    const raw = env.GOOGLE_SERVICE_ACCOUNT.trim();
    // Nur Form-Hinweise, nie Inhalt (der Schlüssel ist geheim)
    console.error(`[Google] GOOGLE_SERVICE_ACCOUNT ist kein gültiges JSON (Länge ${raw.length}, beginnt mit „${raw[0]}“, endet mit „${raw.at(-1)}“). Bitte den ganzen Inhalt der JSON-Datei von { bis } einfügen.`);
    return null;
  }
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

export class GoogleCloud {
  private cached: { token: string; exp: number } | null = null;
  private brokenUntil = 0;

  private tier: { day: string; luxury: boolean } | null = null;

  constructor(readonly cfg: GoogleConfig, private f: typeof fetch = fetch, private counters?: CounterStore) {}

  /** Ausgaben über Google mitzählen (für den Ausgabe-Regler). */
  async addSpend(usd: number) {
    // Mitzählen darf nie einen Zug oder ein Bild scheitern lassen
    try { if (usd > 0) await this.counters?.add(SPEND_KEY, Math.round(usd * 10_000)); }
    catch (e) { console.error("[Google] Ausgaben konnten nicht gezählt werden:", (e as Error).message); }
  }
  /**
   * Verbrauch: der letzte echte Betrag von Google (Budget-Meldung) plus unsere Schätzung für alles danach.
   * Ohne Meldung nur die Schätzung (Listenpreise).
   */
  async spentUsd(): Promise<number> {
    const est = (await this.counters?.get(SPEND_KEY)) ?? 0;
    const billed = (await this.counters?.get(BILLED_KEY)) ?? 0;
    if (!billed) return est / 10_000;
    const atBill = (await this.counters?.get(EST_AT_BILL_KEY)) ?? 0;
    return (billed + Math.max(0, est - atBill)) / 10_000;
  }

  /** Echten Betrag aus Googles Budget-Meldung übernehmen (nur steigend – Meldungen können doppelt oder verspätet kommen). */
  async recordBilled(costUsd: number): Promise<void> {
    if (!this.counters || !Number.isFinite(costUsd) || costUsd < 0) return;
    const next = Math.round(costUsd * 10_000), billed = await this.counters.get(BILLED_KEY);
    if (next <= billed) return;
    await this.counters.add(BILLED_KEY, next - billed);
    const est = await this.counters.get(SPEND_KEY), atBill = await this.counters.get(EST_AT_BILL_KEY);
    await this.counters.add(EST_AT_BILL_KEY, est - atBill);
    console.log(`[Google] Budget-Meldung: ${costUsd.toFixed(2)} $ tatsächlich verbraucht (Schätzung war ${(est / 10_000).toFixed(2)} $).`);
  }

  /**
   * Ausgabe-Regler: Liegt der Verbrauch unter dem gleichmäßigen Tempo (Guthaben ÷ Testtage), gilt heute die Luxus-Stufe
   * (Opus, beste Bilder, mehr Bilder). Einmal pro Tag festgelegt – so bleibt der Cache stabil.
   */
  async luxury(now = Date.now()): Promise<boolean> {
    const day = new Date(now).toISOString().slice(0, 10);
    if (this.tier?.day === day) return this.tier.luxury;
    // Gespeichert wird 1 (Luxus) oder 100 (normal). Legen zwei Server gleichzeitig verschieden fest (101), gilt normal.
    const key = `google-tier-${day}`;
    let luxury = false;
    try {
      let stored = (await this.counters?.get(key)) ?? 0;
      if (!stored) {
        const elapsed = Math.max(0, Math.floor((now - this.cfg.start.getTime()) / 86_400_000));
        const pace = (this.cfg.budgetUsd * (elapsed + 1)) / TRIAL_DAYS;
        const mine = (await this.spentUsd()) < pace ? 1 : 100;
        stored = (await this.counters?.add(key, mine)) ?? mine;
        console.log(`[Google] Stufe für ${day}: ${mine === 1 ? "Luxus" : "normal"} (verbraucht ${(await this.spentUsd()).toFixed(2)} $ von ${pace.toFixed(2)} $ Tempo).`);
      }
      luxury = stored > 0 && stored < 100;
    } catch (e) {
      console.error("[Google] Stufe konnte nicht bestimmt werden – heute normal:", (e as Error).message);
      return false; // nicht merken: beim nächsten Aufruf neu versuchen
    }
    this.tier = { day, luxury };
    return luxury;
  }

  /** Wird Google gerade benutzt? Nur im Zeitfenster und wenn es nicht kürzlich abgelehnt hat. */
  active(now = Date.now()): boolean { return now >= this.cfg.start.getTime() && now < this.cfg.until.getTime() && now >= this.brokenUntil; }

  /** Nach einer Ablehnung eine Weile auf die bisherigen Anbieter umschalten. */
  markBroken(what: string, reason: string) {
    this.brokenUntil = Date.now() + BROKEN_MS;
    console.warn(`[Google] ${what} abgelehnt (${reason}) – für 15 Minuten wieder die bisherigen Anbieter.`);
  }

  /** Zugangsschlüssel (OAuth) aus dem Dienstkonto – eine Stunde gültig, wird zwischengespeichert. */
  async token(): Promise<string> {
    if (this.cached && this.cached.exp > Date.now() + 60_000) return this.cached.token;
    const iat = Math.floor(Date.now() / 1000);
    const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = b64url(JSON.stringify({ iss: this.cfg.email, scope: "https://www.googleapis.com/auth/cloud-platform", aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600 }));
    const sig = createSign("RSA-SHA256").update(`${head}.${claims}`).sign(this.cfg.privateKey).toString("base64url");
    const res = await this.f("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claims}.${sig}` }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new GoogleError(`Anmeldung bei Google fehlgeschlagen (${res.status})`, res.status);
    const out = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!out.access_token) throw new GoogleError("Google hat keinen Zugangsschlüssel geliefert", 401);
    this.cached = { token: out.access_token, exp: Date.now() + (out.expires_in ?? 3600) * 1000 };
    return out.access_token;
  }
}

export class GoogleError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** Fehler, nach denen Google eine Weile gemieden wird: Zugang, Guthaben/Abrechnung, Kontingent. (404 – einzelnes Modell fehlt – nur für den einen Aufruf.) */
export const isProviderFailure = (status: number | undefined) => status === 401 || status === 402 || status === 403 || status === 429;

/** Googles Budget-Meldung (Pub/Sub-Push) lesen: Betrag in der Währung des Kontos. null = unlesbar. */
export function parseBudgetPush(body: unknown): { cost: number; currency: string } | null {
  try {
    const data = (body as { message?: { data?: string } })?.message?.data;
    if (!data) return null;
    const msg = JSON.parse(Buffer.from(data, "base64").toString("utf8")) as { costAmount?: number; currencyCode?: string };
    return typeof msg.costAmount === "number" ? { cost: msg.costAmount, currency: msg.currencyCode ?? "USD" } : null;
  } catch { return null; }
}
