// Konto im Browser: Anmeldung, Sitzung und das automatische Speichern der Spielstände im Konto.
// Der Browser-Speicher (localStorage) bleibt der schnelle Arbeitsspeicher; jede Änderung an einem der
// SYNC_KEYS geht kurz danach an den Server. Beim Start kommt der Stand aus dem Konto.

/** Was zum Konto gehört: Figuren, Abenteuer, eigene Klassen, Gruppen, Einstiege, Einstellungen, Würfelverlauf. */
export const SYNC_KEYS = ["wus.characters.v1", "wus.campaigns.v1", "wus.classes.v1", "wus.parties.v1", "wus.openings.v1", "wus.settings.v1", "wus.rolls.v1"] as const;
const SYNC = new Set<string>(SYNC_KEYS);

const SESSION = "wus.session.v1";
/** Wem der Browser-Speicher gerade gehört (Benutzername in Kleinbuchstaben). */
const OWNER = "wus.owner.v1";
/** Noch nicht gespeicherte Schlüssel – überstehen auch ein Schließen des Tabs. */
const DIRTY = "wus.sync.dirty.v1";
/** Spielstände aus der Zeit vor den Konten – warten darauf, übernommen zu werden. */
const LEGACY = "wus.legacy.v1";

export interface Session { token: string; username: string }
export type SyncState = "saved" | "saving" | "offline";

const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
let applying = false;
const rawSet = Storage.prototype.setItem;
const rawRemove = Storage.prototype.removeItem;
/** Schreiben, ohne dass es als Änderung zum Speichern zählt (z. B. beim Laden aus dem Konto). */
function quietly(fn: () => void) { applying = true; try { fn(); } finally { applying = false; } }
const put = (k: string, v: string | null) => { try { if (v === null) rawRemove.call(localStorage, k); else rawSet.call(localStorage, k, v); } catch { /* voll oder gesperrt */ } };

export function session(): Session | null {
  try { const s = JSON.parse(get(SESSION) ?? "null"); return s?.token ? s : null; } catch { return null; }
}
export const sessionToken = () => session()?.token ?? "";

export class AccountApiError extends Error { constructor(message: string, public status: number) { super(message); } }

async function call<T>(method: string, op: string, body?: unknown, token = sessionToken(), keepalive = false): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/account/${op}`, { method, keepalive, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(token ? { "x-session": token } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch { throw new AccountApiError("Keine Verbindung zum Server.", 0); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AccountApiError(data.error ?? `Fehler ${res.status}`, res.status);
  return data as T;
}

/* ── Komprimieren: große Spielstände (lange Abenteuer) gehen gepackt an den Server ── */

const PACKED = "gz1:";
const toB64 = (buf: ArrayBuffer) => { let s = ""; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function pack(v: string): Promise<string> {
  if (v.length < 50_000 || typeof CompressionStream === "undefined") return v;
  const buf = await new Response(new Blob([v]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
  return PACKED + toB64(buf);
}
export async function unpack(v: string): Promise<string> {
  if (!v.startsWith(PACKED)) return v;
  return new Response(new Blob([fromB64(v.slice(PACKED.length))]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
}
async function unpackAll(data: Record<string, string>): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) { try { out[k] = await unpack(v); } catch { /* beschädigt: überspringen */ } }
  return out;
}

/* ── Speichern im Konto ── */

let state: SyncState = "saved";
const listeners = new Set<(s: SyncState) => void>();
const setState = (s: SyncState) => { if (s !== state) { state = s; listeners.forEach((l) => l(s)); } };
export const syncState = () => state;
export function onSyncState(fn: (s: SyncState) => void) { listeners.add(fn); return () => listeners.delete(fn); }

const dirty = (): Set<string> => { try { return new Set(JSON.parse(get(DIRTY) ?? "[]")); } catch { return new Set(); } };
const setDirty = (s: Set<string>) => put(DIRTY, s.size ? JSON.stringify([...s]) : null);
let timer = 0, retry = 0, flushing: Promise<void> | null = null;

function markDirty(key: string) {
  const d = dirty(); d.add(key); setDirty(d);
  setState("saving");
  clearTimeout(timer);
  timer = window.setTimeout(() => void flush(), 1200);
}

/** Alle offenen Änderungen an den Server schicken. */
export function flush(keepalive = false): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    const token = sessionToken();
    const keys = [...dirty()];
    if (!token || !keys.length) { if (!keys.length) setState("saved"); return; }
    let failed = false;
    for (const key of keys) {
      const value = get(key);
      try {
        const sent = value === null ? null : await pack(value);
        await call("PUT", "data", { key, value: sent }, token, keepalive && (sent?.length ?? 0) < 60_000);
        const d = dirty(); if (get(key) === value) d.delete(key); setDirty(d);
      } catch (e) {
        // Ein Bereich klappt nicht (z. B. zu groß) – die anderen trotzdem speichern
        failed = true;
        if (e instanceof AccountApiError && (e.status === 401 || e.status === 0)) break;
      }
    }
    if (failed) {
      setState("offline");
      retry = Math.min(retry + 1, 6);
      timer = window.setTimeout(() => void flush(), 2000 * 2 ** retry);
    } else {
      retry = 0;
      setState(dirty().size ? "saving" : "saved");
      if (dirty().size) timer = window.setTimeout(() => void flush(), 300);
    }
  })().finally(() => { flushing = null; });
  return flushing;
}

let hooked = false;
function installHooks() {
  if (hooked) return;
  hooked = true;
  Storage.prototype.setItem = function (k: string, v: string) {
    rawSet.call(this, k, v);
    if (this === localStorage && !applying && SYNC.has(k)) markDirty(k);
  };
  Storage.prototype.removeItem = function (k: string) {
    rawRemove.call(this, k);
    if (this === localStorage && !applying && SYNC.has(k)) markDirty(k);
  };
  addEventListener("pagehide", () => void flush(true));
  document.addEventListener("visibilitychange", () => { if (document.hidden) void flush(true); });
  addEventListener("online", () => void flush());
}

/** Stand aus dem Konto in den Browser holen. Was hier noch ungespeichert liegt, geht vorher an den Server. */
async function pull(token: string) {
  const data = await unpackAll((await call<{ data: Record<string, string> }>("GET", "data", undefined, token)).data);
  const pending = dirty();
  quietly(() => {
    for (const key of SYNC_KEYS) {
      if (pending.has(key)) continue;
      if (key in data) put(key, data[key]);
      else put(key, null);
    }
  });
}

/**
 * Beim Seitenstart: Ist jemand angemeldet? Dann offene Änderungen speichern, Stand aus dem Konto laden und das
 * automatische Speichern einschalten. Ohne Verbindung geht es mit dem Stand im Browser weiter.
 */
export async function boot(): Promise<Session | null> {
  const s = session();
  if (!s) return null;
  try {
    await call("GET", "me", undefined, s.token);
  } catch (e) {
    if (e instanceof AccountApiError && e.status === 401) { put(SESSION, null); return null; }
    // Offline: mit dem Browser-Stand weiterspielen, wenn er diesem Konto gehört
    if (get(OWNER) !== s.username.toLowerCase()) return null;
    installHooks();
    setState("offline");
    return s;
  }
  installHooks();
  await flush();
  try { await pull(s.token); } catch { setState("offline"); }
  return s;
}

/** Nach dem ersten Anmelden mit alten Spielständen gesetzt – die App zeigt dann einmal, was übernommen wurde. */
const IMPORTED = "wus.imported.v1";

/**
 * Nach Anmeldung oder Registrierung: Browser-Speicher diesem Konto zuordnen und seinen Stand laden.
 * Spielstände aus der Zeit vor den Konten bleiben dabei, wo sie sind, und werden direkt ins Konto übernommen –
 * nie wird etwas gelöscht, bevor es sicher im Konto liegt (früher ging das bei vollem Browser-Speicher schief).
 */
export async function adopt(token: string, username: string) {
  const owner = get(OWNER);
  const deviceSettings = get("wus.settings.v1");
  const legacy = !owner && SYNC_KEYS.some((k) => k !== "wus.settings.v1" && get(k) !== null);
  setDirty(new Set());
  put(SESSION, JSON.stringify({ token, username }));
  put(OWNER, username.toLowerCase());
  installHooks();
  if (legacy) {
    // Kontostand dazuholen und mit den Spielständen im Browser zusammenführen; danach alles hochladen
    const data = await unpackAll((await call<{ data: Record<string, string> }>("GET", "data", undefined, token)).data);
    const before = legacyCounts();
    const server: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) { try { server[k] = JSON.parse(v); } catch { /* kaputter Eintrag */ } }
    mergeData(server);
    const d = dirty(); for (const k of SYNC_KEYS) if (get(k) !== null) d.add(k); setDirty(d);
    put(IMPORTED, JSON.stringify(before));
    await flush();
    return;
  }
  quietly(() => { for (const k of SYNC_KEYS) put(k, null); });
  await pull(token);
  // Hat das Konto noch keine Einstellungen (z. B. Farbthema), gelten die dieses Geräts
  if (get("wus.settings.v1") === null && deviceSettings !== null) localStorage.setItem("wus.settings.v1", deviceSettings);
  await flush();
}

function legacyCounts(): MergeSummary {
  const n = (k: string) => { try { const v = JSON.parse(get(k) ?? "[]"); return Array.isArray(v) ? v.length : 0; } catch { return 0; } };
  return { characters: n("wus.characters.v1"), campaigns: n("wus.campaigns.v1"), classes: n("wus.classes.v1"), parties: n("wus.parties.v1") };
}

/** Einmalig nach der Übernahme: was aus dem Browser ins Konto kam (oder null). */
export function takeImported(): MergeSummary | null {
  try { const v = JSON.parse(get(IMPORTED) ?? "null"); put(IMPORTED, null); return v; } catch { return null; }
}

export async function login(username: string, password: string) {
  const r = await call<{ token: string; username: string }>("POST", "login", { username, password }, "");
  await adopt(r.token, r.username);
}
export async function register(username: string, password: string, inviteCode?: string) {
  const r = await call<{ token: string; username: string }>("POST", "register", { username, password, inviteCode }, "");
  await adopt(r.token, r.username);
}
export async function changePassword(oldPassword: string, newPassword: string) {
  const r = await call<{ token: string; username: string }>("POST", "password", { oldPassword, newPassword });
  put(SESSION, JSON.stringify({ token: r.token, username: r.username }));
}

/** Abmelden: erst alles speichern, dann den Browser-Speicher leeren (die Daten liegen im Konto). */
export async function logout(force = false) {
  await flush().catch(() => {});
  if (dirty().size && !force) throw new Error("Noch nicht alles gespeichert – bitte Verbindung prüfen und erneut versuchen.");
  setDirty(new Set());
  quietly(() => { for (const k of SYNC_KEYS) put(k, null); });
  put(SESSION, null);
  put(OWNER, null);
}

/* ── Export, Import, alte Spielstände ── */

export interface ExportFile { app: "the-last-ember"; version: 1; exportedAt: string; user?: string; data: Record<string, unknown> }

/** Alle Spielstände als Datei (zum Sichern oder für ein anderes Konto). */
export function exportData(source: Record<string, unknown> | null = null): ExportFile {
  const data = source ?? Object.fromEntries(SYNC_KEYS.filter((k) => get(k) !== null).map((k) => [k, JSON.parse(get(k)!)]));
  return { app: "the-last-ember", version: 1, exportedAt: new Date().toISOString(), user: session()?.username, data };
}

export function downloadExport(file: ExportFile, name = "spielstand") {
  const blob = new Blob([JSON.stringify(file, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `the-last-ember-${name}-${file.exportedAt.slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function legacyData(): Record<string, unknown> | null {
  try { return JSON.parse(get(LEGACY) ?? "null"); } catch { return null; }
}
export const dropLegacy = () => put(LEGACY, null);

export interface MergeSummary { characters: number; campaigns: number; classes: number; parties: number }

/** Liest eine Exportdatei (oder den Inhalt alter Spielstände) und gibt die Daten zurück – oder einen Fehler. */
export function parseExport(text: string): Record<string, unknown> {
  let f: Partial<ExportFile>;
  try { f = JSON.parse(text); } catch { throw new Error("Die Datei ist keine gültige Spielstand-Datei."); }
  if (f?.app !== "the-last-ember" || typeof f.data !== "object" || !f.data) throw new Error("Das ist keine Spielstand-Datei von The Last Ember.");
  return f.data as Record<string, unknown>;
}

type Item = Record<string, unknown>;
const idOf = (key: string, x: Item): string => String(key === "wus.classes.v1" ? (x.cls as Item | undefined)?.id : key === "wus.parties.v1" ? x.code : x.id ?? JSON.stringify(x));
const newer = (a: Item, b: Item) => String(b.updatedAt ?? "") > String(a.updatedAt ?? "") ? b : a;

/**
 * Daten ins Konto übernehmen: Figuren, Abenteuer, Klassen und Gruppen werden ergänzt (bei gleicher ID gilt der neuere Stand),
 * eigene Einstellungen bleiben. Gibt zurück, wie viele neu dazukamen.
 */
export function mergeData(incoming: Record<string, unknown>): MergeSummary {
  const sum: MergeSummary = { characters: 0, campaigns: 0, classes: 0, parties: 0 };
  const count: Partial<Record<string, keyof MergeSummary>> = { "wus.characters.v1": "characters", "wus.campaigns.v1": "campaigns", "wus.classes.v1": "classes", "wus.parties.v1": "parties" };
  for (const key of SYNC_KEYS) {
    const add = incoming[key];
    if (add === undefined || add === null) continue;
    const cur = (() => { try { return JSON.parse(get(key) ?? "null"); } catch { return null; } })();
    let next: unknown = cur;
    if (key === "wus.settings.v1") next = cur ?? add;
    else if (key === "wus.openings.v1" && Array.isArray(add)) next = [...new Set([...(Array.isArray(cur) ? cur : []), ...add])].slice(-20);
    else if (Array.isArray(add)) {
      const list: Item[] = Array.isArray(cur) ? [...cur] : [];
      for (const x of add as Item[]) {
        if (!x || typeof x !== "object") continue;
        const i = list.findIndex((y) => idOf(key, y) === idOf(key, x));
        if (i < 0) { list.push(x); const c = count[key]; if (c) sum[c]++; }
        else list[i] = newer(list[i], x);
      }
      next = key === "wus.rolls.v1" ? list.slice(0, 25) : list;
    }
    if (JSON.stringify(next) !== JSON.stringify(cur)) localStorage.setItem(key, JSON.stringify(next));
  }
  return sum;
}

export function summaryText(s: MergeSummary): string {
  const parts = [s.characters && `${s.characters} ${s.characters === 1 ? "Figur" : "Figuren"}`, s.campaigns && `${s.campaigns} ${s.campaigns === 1 ? "Abenteuer" : "Abenteuer"}`, s.classes && `${s.classes} ${s.classes === 1 ? "Klasse" : "Klassen"}`, s.parties && `${s.parties} ${s.parties === 1 ? "Gruppe" : "Gruppen"}`].filter(Boolean);
  return parts.length ? parts.join(", ") : "nichts Neues";
}

/** Kurzer Überblick über alte Spielstände (für die Übernahme-Karte). */
export function legacySummary(): MergeSummary | null {
  const l = legacyData();
  if (!l) return null;
  const n = (k: string) => (Array.isArray(l[k]) ? (l[k] as unknown[]).length : 0);
  return { characters: n("wus.characters.v1"), campaigns: n("wus.campaigns.v1"), classes: n("wus.classes.v1"), parties: n("wus.parties.v1") };
}

/* ── Wiederherstellung (nur Betreiber, ADMIN_USER): Figuren aus Gruppen zurückholen ── */

export interface RecoverParty {
  code: string; status: "lobby" | "playing" | "finished"; createdAt: string; updatedAt: string; title: string | null;
  players: { characterId: string; name: string; classId: string; className: string; host: boolean; level: number }[];
}

/** Alle Gruppen mit Figuren – oder null, wenn man nicht der Betreiber ist. */
export async function recoverList(): Promise<RecoverParty[] | null> {
  try { return (await call<{ parties: RecoverParty[] }>("GET", "recover")).parties; } catch { return null; }
}

/** Figur ins Konto holen (mit eigener Klasse) und wieder Zugang zu ihrer Gruppe bekommen. */
export async function recoverCharacter(code: string, characterId: string) {
  const r = await call<{ character: Record<string, unknown> & { id: string; customClass?: { cls: { id: string } } }; code: string; playerId: string; token: string }>("POST", "recover", { code, characterId });
  const read = (k: string) => { try { const v = JSON.parse(get(k) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
  const now = new Date().toISOString();
  const chars = read("wus.characters.v1").filter((c: { id: string }) => c.id !== r.character.id);
  localStorage.setItem("wus.characters.v1", JSON.stringify([...chars, { ...r.character, updatedAt: (r.character.updatedAt as string) ?? now }]));
  if (r.character.customClass) {
    const cls = read("wus.classes.v1").filter((c: { cls: { id: string } }) => c.cls.id !== r.character.customClass!.cls.id);
    localStorage.setItem("wus.classes.v1", JSON.stringify([...cls, r.character.customClass]));
  }
  const parties = read("wus.parties.v1").filter((m: { code: string }) => m.code !== r.code);
  localStorage.setItem("wus.parties.v1", JSON.stringify([{ code: r.code, playerId: r.playerId, token: r.token, characterId: r.character.id, joinedAt: now }, ...parties].slice(0, 20)));
  return r;
}

/* ── Sicherungen im Konto ── */

export interface BackupInfo { name: string; createdAt: string; reason: "tag" | "manuell" | "vor-wiederherstellung"; counts: MergeSummary }

export async function listBackups(): Promise<BackupInfo[]> { return (await call<{ backups: BackupInfo[] }>("GET", "backups")).backups; }

export async function backupNow(): Promise<BackupInfo[]> {
  await flush();
  return (await call<{ backups: BackupInfo[] }>("POST", "backup", {})).backups;
}

/** Sicherung zurückspielen. Danach lädt die Seite neu und holt den gesicherten Stand. */
export async function restoreBackup(name: string) {
  await flush().catch(() => {});
  await call("POST", "restore", { name });
  setDirty(new Set()); // nichts Altes über den zurückgespielten Stand schreiben
}

/** Sicherung als Exportdatei (zum Aufheben auf dem eigenen Gerät). */
export async function backupFile(name: string): Promise<ExportFile> {
  const { data } = await call<{ data: Record<string, string> }>("POST", "backup-data", { name });
  const plain = await unpackAll(data);
  const parsed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(plain)) { try { parsed[k] = JSON.parse(v); } catch { /* übergehen */ } }
  return exportData(parsed);
}
