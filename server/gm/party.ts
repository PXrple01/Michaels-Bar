// Mehrspieler-Gruppen: Spielstand auf dem Server, Runden mit gesammelten Handlungen, Proben für bestimmte Figuren.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Opening, PendingCheck } from "../../shared/campaign";
import { MAX_ACTION_LENGTH } from "../../shared/campaign";
import { MAX_PARTY_SIZE, type PartyEvent, type PartyJoinResult, type PartyStoryEntry, type PartyView } from "../../shared/party";
import type { RollRecord } from "../../shared/dice";
import type { Character } from "../../shared/schema";
import { initWorld, worldSummary, type WorldState } from "../../shared/world";
import { resolveCharacter, ValidationError } from "../characters";
import type { GameData } from "../rules/loader";
import { errorEvent, GmError, stripThinking, TOOLSET, userTurn, type MessageParam, type Narrator, type ToolResult } from "./narrator";
import { openingSummary, rollOpening } from "./openings";
import { kickoffMessage } from "./prompt";
import type { UsageGuard } from "./usage";

interface PartyPlayer { id: string; tokenHash: string; host: boolean; joinedAt: string; character: Character }

export interface Party {
  code: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  status: "lobby" | "playing";
  players: PartyPlayer[];
  opening: Opening | null;
  messages: MessageParam[];
  story: PartyStoryEntry[];
  actions: Record<string, string>;
  pending: PendingCheck | null;
  busy: { since: string } | null;
  live: string;
  lastTurnCostUsd: number | null;
  /** Lebenspunkte, Kampf, Aufträge, Gedächtnis – ab dem Start. */
  world: WorldState | null;
  /** Werkzeug-Ergebnisse, die mit dem nächsten Probenergebnis an Claude gehen. */
  held: ToolResult[];
  toolset?: number;
}

/** Speicher mit optimistischer Sperre: put schlägt fehl, wenn jemand anderes inzwischen gespeichert hat. */
export interface PartyStore {
  get(code: string): Promise<{ party: Party; etag: string } | null>;
  put(party: Party, etag: string | null): Promise<boolean>;
}

export class MemoryPartyStore implements PartyStore {
  private map = new Map<string, { json: string; etag: string }>();
  async get(code: string) {
    const e = this.map.get(code);
    return e ? { party: JSON.parse(e.json) as Party, etag: e.etag } : null;
  }
  async put(party: Party, etag: string | null) {
    const cur = this.map.get(party.code);
    if (etag === null ? !!cur : cur?.etag !== etag) return false;
    this.map.set(party.code, { json: JSON.stringify(party), etag: randomBytes(6).toString("hex") });
    return true;
  }
}

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from(randomBytes(6), (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const STALE_MS = 120_000;
const LIVE_SAVE_MS = 1500;

class PartyError extends Error { constructor(message: string, public code = "state") { super(message); } }

export class PartyService {
  constructor(private o: { data: () => GameData; narrator: Narrator; guard: UsageGuard; store: PartyStore; secret: string }) {}

  /* ── Hilfen ── */

  private dataFor(party: Party): GameData {
    // Eigene Klassen aller Mitspieler einbinden (sie wurden beim Beitritt geprüft)
    const base = this.o.data();
    const extra = party.players.map((p) => p.character.customClass?.cls).filter((c): c is NonNullable<typeof c> => !!c);
    return extra.length ? { ...base, classes: [...base.classes, ...extra.filter((c) => !base.classes.some((b) => b.id === c.id))] } : base;
  }

  private characters(party: Party) { return party.players.map((p) => p.character); }

  private player(party: Party, token: unknown): PartyPlayer {
    const t = typeof token === "string" ? token : "";
    const h = Buffer.from(hash(t));
    const p = party.players.find((x) => { const o = Buffer.from(x.tokenHash); return o.length === h.length && timingSafeEqual(o, h); });
    if (!p) throw new PartyError("Du gehörst nicht zu dieser Gruppe (oder der Link ist veraltet).", "access");
    return p;
  }

  private async load(code: unknown) {
    const c = typeof code === "string" ? code.trim().toUpperCase() : "";
    if (!/^[A-Z0-9]{6}$/.test(c)) throw new PartyError("Ungültiger Gruppen-Code.");
    const got = await this.o.store.get(c);
    if (!got) throw new PartyError("Diese Gruppe gibt es nicht (mehr).");
    return got;
  }

  /** Ändert die Gruppe mit erneutem Laden bei Konflikten. */
  private async update(code: string, fn: (p: Party) => void): Promise<Party> {
    for (let i = 0; i < 6; i++) {
      const { party, etag } = await this.load(code);
      fn(party);
      party.version++;
      party.updatedAt = new Date().toISOString();
      if (await this.o.store.put(party, etag)) return party;
    }
    throw new PartyError("Zu viele gleichzeitige Änderungen – bitte nochmal versuchen.");
  }

  private character(raw: unknown): Character {
    try { return resolveCharacter(raw, this.o.data(), this.o.secret).c; } catch (e) {
      throw new PartyError(e instanceof ValidationError ? `Figur ungültig: ${e.problems.join(", ")}` : "Figur ungültig");
    }
  }

  view(party: Party, you: string, budget: PartyView["budget"] = null): PartyView {
    const data = this.dataFor(party);
    return {
      code: party.code, status: party.status, you, version: party.version,
      players: party.players.map((p) => {
        const cls = data.classes.find((c) => c.id === p.character.classId);
        return { id: p.id, host: p.host, characterId: p.character.id, name: p.character.name, classId: p.character.classId, className: cls?.name ?? p.character.classId, sigil: cls?.sigil ?? "shield", acted: p.id in party.actions };
      }),
      opening: party.opening,
      story: party.story,
      pending: party.pending ? { ...party.pending, playerId: party.players.find((p) => p.character.id === party.pending!.characterId)?.id ?? "" } : null,
      yourAction: party.actions[you] ?? null,
      busy: !!party.busy && Date.now() - Date.parse(party.busy.since) < STALE_MS,
      live: party.live,
      budget,
      lastTurnCostUsd: party.lastTurnCostUsd,
      world: party.status === "playing" ? party.world ?? null : null,
    };
  }

  /* ── Beitreten und Lesen (ohne Claude) ── */

  async create(body: { character?: unknown }): Promise<PartyJoinResult> {
    const c = this.character(body?.character);
    const token = randomBytes(24).toString("base64url");
    const player: PartyPlayer = { id: randomBytes(6).toString("hex"), tokenHash: hash(token), host: true, joinedAt: new Date().toISOString(), character: c };
    for (let i = 0; i < 5; i++) {
      const now = new Date().toISOString();
      const party: Party = {
        code: newCode(), createdAt: now, updatedAt: now, version: 1, status: "lobby", players: [player], opening: null,
        messages: [], story: [], actions: {}, pending: null, busy: null, live: "", lastTurnCostUsd: null, world: null, held: [], toolset: TOOLSET,
      };
      if (await this.o.store.put(party, null)) return { code: party.code, playerId: player.id, token, view: this.view(party, player.id) };
    }
    throw new PartyError("Konnte keine Gruppe anlegen – bitte nochmal versuchen.");
  }

  async join(body: { code?: unknown; character?: unknown }): Promise<PartyJoinResult> {
    const c = this.character(body?.character);
    const token = randomBytes(24).toString("base64url");
    const player: PartyPlayer = { id: randomBytes(6).toString("hex"), tokenHash: hash(token), host: false, joinedAt: new Date().toISOString(), character: c };
    const { party: current } = await this.load(body?.code);
    const party = await this.update(current.code, (p) => {
      if (p.status !== "lobby") throw new PartyError("Das Abenteuer hat schon begonnen – Beitreten geht nur vor dem Start.");
      if (p.players.length >= MAX_PARTY_SIZE) throw new PartyError(`Die Gruppe ist voll (höchstens ${MAX_PARTY_SIZE}).`);
      if (p.players.some((x) => x.character.id === c.id)) throw new PartyError("Diese Figur ist schon in der Gruppe.");
      if (p.players.some((x) => x.character.name.toLowerCase() === c.name.toLowerCase())) throw new PartyError("Eine Figur mit diesem Namen ist schon dabei – bitte eine andere wählen.");
      p.players.push(player);
    });
    return { code: party.code, playerId: player.id, token, view: this.view(party, player.id) };
  }

  async state(body: { code?: unknown; token?: unknown }): Promise<PartyView> {
    const { party } = await this.load(body?.code);
    const me = this.player(party, body?.token);
    return this.view(party, me.id, await this.o.guard.info());
  }

  async leave(body: { code?: unknown; token?: unknown }): Promise<{ ok: true }> {
    const { party } = await this.load(body?.code);
    const me = this.player(party, body?.token);
    await this.update(party.code, (p) => {
      if (p.status !== "lobby") throw new PartyError("Während des Abenteuers kann man die Gruppe nicht verlassen.");
      p.players = p.players.filter((x) => x.id !== me.id);
      if (p.players.length && !p.players.some((x) => x.host)) p.players[0].host = true;
    });
    return { ok: true };
  }

  /* ── Spielleiter-Züge (mit Claude, gestreamt) ── */

  async run(op: "start" | "action" | "roll", body: Record<string, unknown>, who: string, emit: (ev: PartyEvent) => void): Promise<void> {
    try {
      if (op === "action") {
        const ready = await this.submitAction(body);
        if (!ready) { emit({ type: "view", view: await this.state(body) }); return; }
      }
      this.o.narrator.ensureReady();
      await this.gmTurn(op, body, who, emit);
    } catch (e) {
      if (e instanceof PartyError) emit({ type: "error", message: e.message, code: e.code });
      else emit(errorEvent(e));
    }
  }

  /** Speichert die Handlung. Gibt true zurück, wenn jetzt erzählt werden soll. */
  private async submitAction(body: Record<string, unknown>): Promise<boolean> {
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (text.length > MAX_ACTION_LENGTH) throw new PartyError(`Bitte kürzer fassen (höchstens ${MAX_ACTION_LENGTH} Zeichen).`);
    const { party } = await this.load(body.code);
    const me = this.player(party, body.token);
    const now = body.now === true;
    if (now && !me.host) throw new PartyError("Nur der Gastgeber kann die Runde vorzeitig erzählen lassen.");
    const updated = await this.update(party.code, (p) => {
      if (p.status !== "playing") throw new PartyError("Das Abenteuer hat noch nicht begonnen.");
      if (p.pending) throw new PartyError(`Erst muss ${p.pending.characterName} würfeln.`);
      if (text) p.actions[me.id] = text;
      else if (!now) delete p.actions[me.id];
    });
    const all = updated.players.every((p) => p.id in updated.actions);
    return Object.keys(updated.actions).length > 0 && (all || now);
  }

  private async gmTurn(op: "start" | "action" | "roll", body: Record<string, unknown>, who: string, emit: (ev: PartyEvent) => void) {
    const { party: first } = await this.load(body.code);
    const me = this.player(first, body.token);
    let consumed: Record<string, string> = {};
    let messages: MessageParam[] = [];
    let rollEntry: PartyStoryEntry | null = null;

    // 1) Sperre setzen und Eingabe für Claude vorbereiten
    const locked = await this.update(first.code, (p) => {
      if (p.busy && Date.now() - Date.parse(p.busy.since) < STALE_MS) throw new PartyError("Der Spielleiter erzählt gerade – einen Moment.");
      const data = this.dataFor(p);
      // Gruppen von vor Etappe 5: einmalig auf den neuen Werkzeugstand bringen
      if (p.status === "playing" && (p.toolset !== TOOLSET || !p.world)) {
        p.messages = stripThinking(p.messages);
        p.world = initWorld(this.characters(p));
        p.held = [];
        p.toolset = TOOLSET;
      }
      if (op === "start") {
        if (!me.host) throw new PartyError("Nur der Gastgeber kann das Abenteuer starten.");
        if (p.status !== "lobby") throw new PartyError("Das Abenteuer läuft schon.");
        const previous = Array.isArray(body.previousOpenings) ? (body.previousOpenings as unknown[]).filter((x): x is string => typeof x === "string").slice(-10) : [];
        p.opening = rollOpening(data.openings, previous);
        p.status = "playing";
        p.world = initWorld(this.characters(p));
        p.held = [];
        p.toolset = TOOLSET;
        messages = [{ role: "user", content: kickoffMessage(this.characters(p), data, p.opening, previous) }];
      } else if (op === "action") {
        if (p.pending) throw new PartyError(`Erst muss ${p.pending.characterName} würfeln.`);
        consumed = { ...p.actions };
        const items = p.players.map((pl) => ({ playerId: pl.id, name: pl.character.name, text: consumed[pl.id] ?? "" }));
        p.story.push({ type: "actions", items: items.filter((i) => i.text) });
        const lines = items.map((i) => `- ${i.name}: ${i.text || "(keine Angabe – handelt passend zur Lage)"}`).join("\n");
        if (p.world!.combat) p.world!.combat.round++;
        messages = [...p.messages, userTurn(p.held ?? [], `<aktionen>\n${lines}\n</aktionen>\n\n<spielstand>\n${worldSummary(p.world!, this.characters(p))}\n</spielstand>`)];
      } else {
        if (!p.pending) throw new PartyError("Gerade ist keine Probe offen.");
        if (p.pending.characterId !== me.character.id) throw new PartyError(`${p.pending.characterName} muss würfeln, nicht du.`);
        messages = p.messages;
      }
      p.busy = { since: new Date().toISOString() };
      p.live = "";
    });

    const data = this.dataFor(locked);
    const characters = this.characters(locked);
    const world = locked.world!;

    try {
      // 2) Probe würfeln (nur bei „roll“)
      if (op === "roll") {
        const { record, content } = await this.o.narrator.rollPending(locked.pending!, { characters, data, world }, locked.held ?? []);
        emit({ type: "roll", record });
        rollEntry = { type: "roll", record, playerId: me.id };
        await this.update(locked.code, (p) => { p.story.push(rollEntry!); p.pending = null; });
        messages = [...messages, { role: "user", content }];
      }

      // 3) Erzählen; der entstehende Text wird regelmäßig gespeichert, damit Mitspieler mitlesen
      // Server-Würfe (Gegnerangriffe, Heilung) teilen die Erzählung in Abschnitte.
      let live = "";
      const segments: PartyStoryEntry[] = [];
      const flush = () => { const t = live.trim(); if (t) segments.push({ type: "gm", text: t }); live = ""; };
      const onRoll = (record: RollRecord) => { flush(); segments.push({ type: "roll", record, playerId: "", auto: true }); emit({ type: "autoroll", record }); };
      let lastSave = Date.now();
      let saving: Promise<unknown> = Promise.resolve();
      const res = await this.o.narrator.converse(messages, { characters, data, world, onRoll }, who, (text) => {
        live += text;
        emit({ type: "text", text });
        if (Date.now() - lastSave > LIVE_SAVE_MS) {
          lastSave = Date.now();
          const snapshot = live.split("»")[0];
          saving = saving.then(() => this.update(locked.code, (p) => { p.live = snapshot; }).catch(() => {}));
        }
      });
      await saving;
      flush();

      // 4) Ergebnis übernehmen und Sperre lösen
      const done = await this.update(locked.code, (p) => {
        p.messages = res.history;
        p.story.push(...segments);
        p.world = world;
        p.held = res.held;
        p.pending = res.pending;
        for (const [id, text] of Object.entries(consumed)) if (p.actions[id] === text) delete p.actions[id];
        p.busy = null;
        p.live = "";
        p.lastTurnCostUsd = res.costUsd;
      });
      emit({ type: "view", view: this.view(done, me.id, await this.o.guard.info()) });
    } catch (e) {
      // Fehler: Sperre lösen; beim Start zurück in die Lobby, damit man es erneut versuchen kann
      await this.update(locked.code, (p) => {
        p.busy = null;
        p.live = "";
        if (op === "start") { p.status = "lobby"; p.opening = null; }
        if (op === "action") { p.story = p.story.filter((s, i) => !(i === p.story.length - 1 && s.type === "actions")); }
        if (op === "roll" && rollEntry?.type === "roll") {
          // Probe wieder öffnen; erneutes Würfeln liefert denselben Wurf (Wurf-ID hängt an der Probe)
          p.pending = locked.pending;
          const id = rollEntry.record.id;
          p.story = p.story.filter((s) => !(s.type === "roll" && s.record.id === id));
        }
      }).catch(() => {});
      throw e;
    }
  }
}

export { GmError };
