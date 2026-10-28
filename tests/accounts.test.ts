import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AccountService, FileAccountStore, MemoryAccountStore, readSession, type AccountStore } from "../server/accounts";
import { gate } from "../server/gm/http";
import { MemoryCounterStore } from "../server/gm/usage";

const SECRET = "konto-geheimnis-0123456789";
const svc = (store: AccountStore = new MemoryAccountStore(), inviteCode?: string) => new AccountService({ store, secret: SECRET, counters: new MemoryCounterStore(), inviteCode });
const call = (s: AccountService, method: string, op: string, body?: unknown, session: string | null = null) => s.handle(method, op, body, session, "1.2.3.4");

describe("Konten", () => {
  it("registrieren, anmelden, Sitzung prüfen – Namen ohne Groß/Klein-Unterschied eindeutig", async () => {
    const s = svc();
    expect((await call(s, "POST", "register", { username: "ab", password: "geheim123" })).status).toBe(400);
    expect((await call(s, "POST", "register", { username: "Hagen", password: "kurz" })).status).toBe(400);
    const reg = await call(s, "POST", "register", { username: "Hagen", password: "geheim123" });
    expect(reg.status).toBe(200);
    expect((await call(s, "POST", "register", { username: "hagen", password: "anderes12" })).status).toBe(409);
    expect((await call(s, "POST", "login", { username: "HAGEN", password: "falsch!!!" })).status).toBe(401);
    const login = await call(s, "POST", "login", { username: "HAGEN", password: "geheim123" });
    expect(login.status).toBe(200);
    const token = (login.body as { token: string }).token;
    expect((await call(s, "GET", "me", null, token)).body).toEqual({ username: "Hagen" });
    expect((await call(s, "GET", "me", null, token + "x")).status).toBe(401);
    expect((await call(s, "GET", "me", null, null)).status).toBe(401);
  });

  it("das Passwort wird nie im Klartext gespeichert", async () => {
    const store = new MemoryAccountStore();
    await call(svc(store), "POST", "register", { username: "Agnes", password: "klosterluft" });
    const u = await store.getUser("agnes");
    expect(JSON.stringify(u)).not.toContain("klosterluft");
    expect(u!.hash.length).toBeGreaterThan(40);
  });

  it("nach 10 Fehlversuchen ist der Name 15 Minuten gesperrt", async () => {
    const s = svc();
    await call(s, "POST", "register", { username: "Kaspar", password: "richtig123" });
    for (let i = 0; i < 10; i++) expect((await call(s, "POST", "login", { username: "kaspar", password: `falsch${i}xx` })).status).toBe(401);
    const locked = await call(s, "POST", "login", { username: "kaspar", password: "richtig123" });
    expect(locked.status).toBe(429);
  }, 20_000);

  it("Spielstände je Schlüssel speichern, lesen und löschen – nur fürs eigene Konto", async () => {
    const s = svc();
    const a = ((await call(s, "POST", "register", { username: "Anna", password: "passwort1" })).body as { token: string }).token;
    const b = ((await call(s, "POST", "register", { username: "Bert", password: "passwort2" })).body as { token: string }).token;
    expect((await call(s, "PUT", "data", { key: "wus.characters.v1", value: "[1,2]" }, a)).status).toBe(200);
    expect((await call(s, "PUT", "data", { key: "böse/../pfad", value: "x" }, a)).status).toBe(400);
    expect((await call(s, "PUT", "data", { key: "wus.characters.v1", value: "[]" }, null)).status).toBe(401);
    expect((await call(s, "GET", "data", null, a)).body).toEqual({ data: { "wus.characters.v1": "[1,2]" } });
    expect((await call(s, "GET", "data", null, b)).body).toEqual({ data: {} });
    await call(s, "PUT", "data", { key: "wus.characters.v1", value: null }, a);
    expect((await call(s, "GET", "data", null, a)).body).toEqual({ data: {} });
  });

  it("Passwort ändern macht alte Sitzungen ungültig", async () => {
    const s = svc();
    const old = ((await call(s, "POST", "register", { username: "Wolfram", password: "altesPasswort" })).body as { token: string }).token;
    expect((await call(s, "POST", "password", { oldPassword: "falsch", newPassword: "neuesPasswort" }, old)).status).toBe(403);
    const r = await call(s, "POST", "password", { oldPassword: "altesPasswort", newPassword: "neuesPasswort" }, old);
    expect(r.status).toBe(200);
    expect((await call(s, "GET", "me", null, old)).status).toBe(401);
    expect((await call(s, "GET", "me", null, (r.body as { token: string }).token)).status).toBe(200);
    expect((await call(s, "POST", "login", { username: "wolfram", password: "neuesPasswort" })).status).toBe(200);
  });

  it("mit gesetztem ACCESS_CODE braucht die Registrierung den Einladungscode", async () => {
    const s = svc(new MemoryAccountStore(), "geheimcode");
    expect((await call(s, "POST", "register", { username: "Gast1", password: "passwort1" })).status).toBe(403);
    expect((await call(s, "POST", "register", { username: "Gast1", password: "passwort1", inviteCode: "geheimcode" })).status).toBe(200);
  });

  it("angemeldete Konten dürfen ohne Zugangscode zum Spielleiter", async () => {
    const s = svc();
    const token = ((await call(s, "POST", "register", { username: "Lotte", password: "passwort1" })).body as { token: string }).token;
    expect(readSession(SECRET, token)?.id).toBe("lotte");
    expect(gate("code", SECRET, null, token, "ip")).toEqual({ ok: true, who: "user:lotte" });
    expect(gate("code", SECRET, null, "gefälscht.abc", "ip")).toEqual({ ok: false, who: "ip" });
    expect(gate("code", SECRET, "code", null, "ip").ok).toBe(true);
  });

  it("lokal werden Konten als Dateien gespeichert", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "konten-"));
    const s = svc(new FileAccountStore(dir));
    const token = ((await call(s, "POST", "register", { username: "Datei", password: "passwort1" })).body as { token: string }).token;
    await call(s, "PUT", "data", { key: "wus.campaigns.v1", value: "[\"x\"]" }, token);
    const again = svc(new FileAccountStore(dir));
    expect((await call(again, "POST", "login", { username: "datei", password: "passwort1" })).status).toBe(200);
    expect((await call(again, "GET", "data", null, token)).body).toEqual({ data: { "wus.campaigns.v1": "[\"x\"]" } });
  });
});

describe("Figuren aus Gruppen zurückholen (nur Betreiber)", () => {
  it("nur ADMIN_USER sieht die Gruppen; Zurückholen liefert Figur und neuen Zugang, der alte gilt nicht mehr", async () => {
    const { MemoryPartyStore, PartyService } = await import("../server/gm/party");
    const { Narrator } = await import("../server/gm/narrator");
    const { RollLog } = await import("../server/dice/log");
    const { UsageGuard } = await import("../server/gm/usage");
    const { buildCharacter } = await import("../server/characters");
    const { loadGameData } = await import("../server/rules/loader");
    const data = await loadGameData(path.resolve(__dirname, "../data"));
    const ritter = data.classes.find((c) => c.id === "ritter")!;
    const hagen = buildCharacter({ name: "Hagen", stand: "bauer", classId: "ritter", attributes: ritter.recommendedAttributes, chosenSkills: ["reiten", "wahrnehmung"] }, data);
    const parties = new MemoryPartyStore();
    const guard = new UsageGuard(new MemoryCounterStore(), 10, 100);
    const party = new PartyService({ data: () => data, narrator: new Narrator({ llm: null, rolls: new RollLog(), guard }), guard, store: parties, secret: SECRET });
    const host = await party.create({ character: hagen });

    const s = new AccountService({ store: new MemoryAccountStore(), secret: SECRET, counters: new MemoryCounterStore(), admin: "Chefin", parties });
    const chef = ((await call(s, "POST", "register", { username: "chefin", password: "passwort1" })).body as { token: string }).token;
    const other = ((await call(s, "POST", "register", { username: "Gast", password: "passwort1" })).body as { token: string }).token;
    expect((await call(s, "GET", "recover", null, other)).status).toBe(403);
    const list = await call(s, "GET", "recover", null, chef);
    expect(list.status).toBe(200);
    expect((list.body as { parties: { code: string; players: { name: string }[] }[] }).parties[0]).toMatchObject({ code: host.code, players: [{ name: "Hagen" }] });

    const r = await call(s, "POST", "recover", { code: host.code, characterId: hagen.id }, chef);
    expect(r.status).toBe(200);
    const body = r.body as { character: { name: string }; token: string; playerId: string };
    expect(body.character.name).toBe("Hagen");
    expect(body.playerId).toBe(host.playerId);
    await expect(party.state({ code: host.code, token: host.token })).rejects.toThrow(/gehörst nicht/);
    expect((await party.state({ code: host.code, token: body.token })).you).toBe(host.playerId);
  });
});

describe("Automatische Sicherungen", () => {
  const chars = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: `c${i}` })));

  it("das erste Speichern eines Tages sichert den bisherigen Stand – danach nicht mehr am selben Tag", async () => {
    const store = new MemoryAccountStore();
    const s = svc(store);
    const t = ((await call(s, "POST", "register", { username: "Sicher", password: "passwort1" })).body as { token: string }).token;
    await call(s, "PUT", "data", { key: "wus.characters.v1", value: chars(2) }, t); // Konto war leer: nichts zu sichern
    await call(s, "PUT", "data", { key: "wus.characters.v1", value: chars(3) }, t); // sichert den Stand mit 2 Figuren
    await call(s, "PUT", "data", { key: "wus.characters.v1", value: chars(4) }, t); // derselbe Tag: keine neue Sicherung
    const list = ((await call(s, "GET", "backups", null, t)).body as { backups: { reason: string; counts: { characters: number } }[] }).backups;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ reason: "tag", counts: { characters: 2 } });
    // nächster Tag
    const u = (await store.getUser("sicher"))!;
    await store.updateUser({ ...u, backupDay: "2000-01-01" });
    await call(s, "PUT", "data", { key: "wus.characters.v1", value: chars(5) }, t);
    const after = ((await call(s, "GET", "backups", null, t)).body as { backups: { counts: { characters: number } }[] }).backups;
    expect(after.map((b) => b.counts.characters)).toContain(4);
  });

  it("wiederherstellen, herunterladen und manuell sichern", async () => {
    const s = svc();
    const t = ((await call(s, "POST", "register", { username: "Zurueck", password: "passwort1" })).body as { token: string }).token;
    await call(s, "PUT", "data", { key: "wus.characters.v1", value: chars(2) }, t);
    const manual = await call(s, "POST", "backup", {}, t);
    expect(manual.status).toBe(200);
    const name = (manual.body as { backups: { name: string; reason: string }[] }).backups.find((b) => b.reason === "manuell")!.name;
    await call(s, "PUT", "data", { key: "wus.characters.v1", value: chars(0) }, t); // „Unfall“: alles weg
    await call(s, "PUT", "data", { key: "wus.classes.v1", value: "[]" }, t);
    expect((await call(s, "POST", "backup-data", { name }, t)).body).toEqual({ data: { "wus.characters.v1": chars(2) } });
    const r = await call(s, "POST", "restore", { name }, t);
    expect(r.status).toBe(200);
    expect((await call(s, "GET", "data", null, t)).body).toEqual({ data: { "wus.characters.v1": chars(2) } });
    const list = (r.body as { backups: { reason: string }[] }).backups;
    expect(list.some((b) => b.reason === "vor-wiederherstellung")).toBe(true);
    expect((await call(s, "POST", "restore", { name: "gibt-es-nicht" }, t)).status).toBe(404);
  });

  it("es bleiben höchstens 14 tägliche Sicherungen", async () => {
    const store = new MemoryAccountStore();
    const s = svc(store);
    const t = ((await call(s, "POST", "register", { username: "Viele", password: "passwort1" })).body as { token: string }).token;
    await call(s, "PUT", "data", { key: "wus.characters.v1", value: chars(1) }, t);
    for (let d = 0; d < 18; d++) {
      const u = (await store.getUser("viele"))!;
      await store.updateUser({ ...u, backupDay: `1999-01-${String(d + 1).padStart(2, "0")}` });
      await call(s, "PUT", "data", { key: "wus.characters.v1", value: chars(d + 2) }, t);
    }
    const list = ((await call(s, "GET", "backups", null, t)).body as { backups: unknown[] }).backups;
    expect(list.length).toBeLessThanOrEqual(14);
  });
});
