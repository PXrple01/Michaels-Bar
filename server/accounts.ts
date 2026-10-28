// Konten: Benutzername und Passwort, sonst nichts. Passwörter nur als scrypt-Hash, Sitzungen als signiertes Token.
// Gespeichert werden je Konto die Spielstände des Browsers (Figuren, Klassen, Abenteuer, Gruppen, Einstellungen) –
// lokal in Dateien, online in Netlify Blobs.
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { promisify } from "node:util";
import type { CounterStore } from "./gm/usage";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

export interface UserRecord {
  /** Benutzername in Kleinbuchstaben – eindeutig */
  id: string;
  /** Benutzername, wie er eingegeben wurde */
  name: string;
  salt: string;
  hash: string;
  /** Passwort-Version: steigt bei jeder Änderung, alte Sitzungen werden damit ungültig */
  pv: number;
  createdAt: string;
}

export interface AccountStore {
  getUser(id: string): Promise<UserRecord | null>;
  /** false, wenn es den Namen schon gibt */
  createUser(u: UserRecord): Promise<boolean>;
  updateUser(u: UserRecord): Promise<void>;
  listData(id: string): Promise<Record<string, string>>;
  putData(id: string, key: string, value: string): Promise<void>;
  deleteData(id: string, key: string): Promise<void>;
}

export class MemoryAccountStore implements AccountStore {
  private users = new Map<string, UserRecord>();
  private data = new Map<string, Map<string, string>>();
  async getUser(id: string) { const u = this.users.get(id); return u ? { ...u } : null; }
  async createUser(u: UserRecord) { if (this.users.has(u.id)) return false; this.users.set(u.id, { ...u }); return true; }
  async updateUser(u: UserRecord) { this.users.set(u.id, { ...u }); }
  async listData(id: string) { return Object.fromEntries(this.data.get(id) ?? []); }
  async putData(id: string, key: string, value: string) { if (!this.data.has(id)) this.data.set(id, new Map()); this.data.get(id)!.set(key, value); }
  async deleteData(id: string, key: string) { this.data.get(id)?.delete(key); }
}

/** Lokal: eine Datei je Konto und je gespeichertem Schlüssel (Ordner saves/accounts). */
export class FileAccountStore implements AccountStore {
  constructor(private dir: string) {}
  private userFile(id: string) { return nodePath.join(this.dir, "users", `${id}.json`); }
  private dataDir(id: string) { return nodePath.join(this.dir, "data", id); }
  async getUser(id: string) {
    try { return JSON.parse(await readFile(this.userFile(id), "utf8")) as UserRecord; } catch { return null; }
  }
  async createUser(u: UserRecord) {
    await mkdir(nodePath.dirname(this.userFile(u.id)), { recursive: true });
    try { await writeFile(this.userFile(u.id), JSON.stringify(u), { flag: "wx" }); return true; } catch { return false; }
  }
  async updateUser(u: UserRecord) { await writeFile(this.userFile(u.id), JSON.stringify(u)); }
  async listData(id: string) {
    const out: Record<string, string> = {};
    let files: string[] = [];
    try { files = await readdir(this.dataDir(id)); } catch { return out; }
    for (const f of files) if (f.endsWith(".json")) out[decodeURIComponent(f.slice(0, -5))] = await readFile(nodePath.join(this.dataDir(id), f), "utf8");
    return out;
  }
  async putData(id: string, key: string, value: string) {
    await mkdir(this.dataDir(id), { recursive: true });
    await writeFile(nodePath.join(this.dataDir(id), `${encodeURIComponent(key)}.json`), value);
  }
  async deleteData(id: string, key: string) { await rm(nodePath.join(this.dataDir(id), `${encodeURIComponent(key)}.json`), { force: true }); }
}

export class AccountError extends Error { constructor(message: string, public status = 400) { super(message); } }

export const USERNAME = /^[A-Za-z0-9ÄÖÜäöüß_.-]{3,24}$/;
export const PASSWORD_MIN = 8;
/** Welche Browser-Schlüssel ein Konto speichert */
export const DATA_KEY = /^wus\.[a-z0-9._-]{1,60}$/;
const MAX_KEYS = 50;
const MAX_VALUE = 5_000_000;
const SESSION_DAYS = 90;
const FAIL_LIMIT = 10;
const FAIL_WINDOW_MIN = 15;
const REGISTER_PER_DAY = 20;

const b64 = (s: string) => Buffer.from(s).toString("base64url");

async function hashPassword(password: string, salt: Buffer): Promise<string> {
  return (await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })).toString("base64url");
}

/** Sitzungs-Token prüfen (ohne Speicherzugriff) – liefert Benutzer-ID und Passwort-Version. */
export function readSession(secret: string, token: unknown): { id: string; pv: number } | null {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const expected = createHmac("sha256", `account:${secret}`).update(payload).digest("base64url");
  const a = Buffer.from(sig ?? ""), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { u: string; pv: number; exp: number };
    if (typeof p.u !== "string" || typeof p.exp !== "number" || p.exp < Date.now()) return null;
    return { id: p.u, pv: Number(p.pv) || 0 };
  } catch { return null; }
}

export class AccountService {
  constructor(private o: { store: AccountStore; secret: string; counters: CounterStore; inviteCode?: string }) {}

  private token(u: UserRecord): string {
    const payload = b64(JSON.stringify({ u: u.id, pv: u.pv, exp: Date.now() + SESSION_DAYS * 86_400_000 }));
    return `${payload}.${createHmac("sha256", `account:${this.o.secret}`).update(payload).digest("base64url")}`;
  }

  /** Angemeldeter Benutzer – prüft auch, ob das Passwort inzwischen geändert wurde. */
  async user(token: unknown): Promise<UserRecord> {
    const s = readSession(this.o.secret, token);
    const u = s ? await this.o.store.getUser(s.id) : null;
    if (!s || !u || u.pv !== s.pv) throw new AccountError("Bitte melde dich (erneut) an.", 401);
    return u;
  }

  async register(body: { username?: unknown; password?: unknown; inviteCode?: unknown }, who: string) {
    const name = String(body?.username ?? "").trim();
    const password = String(body?.password ?? "");
    if (!USERNAME.test(name)) throw new AccountError("Der Benutzername braucht 3 bis 24 Zeichen: Buchstaben, Ziffern, Punkt, Strich oder Unterstrich.");
    if (password.length < PASSWORD_MIN) throw new AccountError(`Das Passwort braucht mindestens ${PASSWORD_MIN} Zeichen.`);
    if (password.length > 200) throw new AccountError("Das Passwort ist zu lang.");
    if (this.o.inviteCode && String(body?.inviteCode ?? "").trim() !== this.o.inviteCode) throw new AccountError("Der Einladungscode stimmt nicht. Frag die Person, die dir die Seite gezeigt hat.", 403);
    const regKey = `acct-reg:${who}:${new Date().toISOString().slice(0, 10)}`;
    if ((await this.o.counters.get(regKey)) >= REGISTER_PER_DAY) throw new AccountError("Heute wurden von hier schon zu viele Konten angelegt. Bitte morgen wieder.", 429);
    const salt = randomBytes(16);
    const user: UserRecord = { id: name.toLowerCase(), name, salt: salt.toString("base64url"), hash: await hashPassword(password, salt), pv: 1, createdAt: new Date().toISOString() };
    if (!(await this.o.store.createUser(user))) throw new AccountError("Diesen Benutzernamen gibt es schon. Bitte wähle einen anderen.", 409);
    await this.o.counters.add(regKey, 1);
    return { token: this.token(user), username: user.name };
  }

  async login(body: { username?: unknown; password?: unknown }) {
    const id = String(body?.username ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");
    const failKey = `acct-fail:${id}:${Math.floor(Date.now() / (FAIL_WINDOW_MIN * 60_000))}`;
    if ((await this.o.counters.get(failKey)) >= FAIL_LIMIT) throw new AccountError(`Zu viele Fehlversuche. Bitte warte ${FAIL_WINDOW_MIN} Minuten.`, 429);
    const u = id ? await this.o.store.getUser(id) : null;
    // Auch ohne Konto rechnen, damit man an der Antwortzeit nicht erkennt, ob es den Namen gibt
    const hash = await hashPassword(password, u ? Buffer.from(u.salt, "base64url") : randomBytes(16));
    const ok = !!u && timingSafeEqual(Buffer.from(hash), Buffer.from(u.hash));
    if (!ok) { await this.o.counters.add(failKey, 1); throw new AccountError("Benutzername oder Passwort stimmt nicht.", 401); }
    return { token: this.token(u!), username: u!.name };
  }

  async me(token: unknown) { const u = await this.user(token); return { username: u.name }; }

  async changePassword(token: unknown, body: { oldPassword?: unknown; newPassword?: unknown }) {
    const u = await this.user(token);
    const old = await hashPassword(String(body?.oldPassword ?? ""), Buffer.from(u.salt, "base64url"));
    if (!timingSafeEqual(Buffer.from(old), Buffer.from(u.hash))) throw new AccountError("Das bisherige Passwort stimmt nicht.", 403);
    const pw = String(body?.newPassword ?? "");
    if (pw.length < PASSWORD_MIN || pw.length > 200) throw new AccountError(`Das neue Passwort braucht mindestens ${PASSWORD_MIN} Zeichen.`);
    const salt = randomBytes(16);
    const next = { ...u, salt: salt.toString("base64url"), hash: await hashPassword(pw, salt), pv: u.pv + 1 };
    await this.o.store.updateUser(next);
    return { token: this.token(next), username: next.name };
  }

  async getData(token: unknown) {
    const u = await this.user(token);
    return { data: await this.o.store.listData(u.id) };
  }

  /** Einen Schlüssel speichern (value = Text, wie er im Browser steht) oder mit value = null löschen. */
  async putData(token: unknown, body: { key?: unknown; value?: unknown }) {
    const u = await this.user(token);
    const key = String(body?.key ?? "");
    if (!DATA_KEY.test(key)) throw new AccountError("Ungültiger Schlüssel.");
    if (body?.value === null) { await this.o.store.deleteData(u.id, key); return { ok: true }; }
    if (typeof body?.value !== "string") throw new AccountError("value fehlt.");
    if (body.value.length > MAX_VALUE) throw new AccountError("Zu viele Daten auf einmal (über 5 MB).", 413);
    const existing = await this.o.store.listData(u.id);
    if (!(key in existing) && Object.keys(existing).length >= MAX_KEYS) throw new AccountError("Zu viele gespeicherte Bereiche.", 413);
    await this.o.store.putData(u.id, key, body.value);
    return { ok: true };
  }

  /** HTTP: /api/account/<op> – gleiche Logik für Express und Netlify. */
  async handle(method: string, op: string, body: unknown, session: string | null, who: string): Promise<{ status: number; body: unknown }> {
    const b = (body ?? {}) as Record<string, unknown>;
    try {
      const key = `${method} ${op}`;
      const out = key === "POST register" ? await this.register(b, who)
        : key === "POST login" ? await this.login(b)
        : key === "GET me" ? await this.me(session)
        : key === "POST password" ? await this.changePassword(session, b)
        : key === "GET data" ? await this.getData(session)
        : key === "PUT data" ? await this.putData(session, b)
        : null;
      if (!out) return { status: 404, body: { error: "Unbekannter Endpunkt" } };
      return { status: 200, body: out };
    } catch (e) {
      if (e instanceof AccountError) return { status: e.status, body: { error: e.message } };
      console.error(e);
      return { status: 500, body: { error: "Interner Fehler" } };
    }
  }
}
