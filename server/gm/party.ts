// Mehrspieler-Gruppen: Spielstand auf dem Server, Runden mit gesammelten Handlungen, Proben für bestimmte Figuren.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Opening, PendingCheck } from "../../shared/campaign";
import { MAX_ACTION_LENGTH } from "../../shared/campaign";
import { MAX_PARTY_SIZE, type PartyEvent, type PartyJoinResult, type PartyOverview, type PartyStoryEntry, type PartyView } from "../../shared/party";
import type { RollRecord } from "../../shared/dice";
import type { Character } from "../../shared/schema";
import { initArc, initWorld, isArc, type WorldState } from "../../shared/world";
import { turnSummary } from "./summary";
import { countChapterTurn, enforceDefeat } from "./world";
import { resolveCharacter, ValidationError } from "../characters";
import type { GameData } from "../rules/loader";
import { errorEvent, GmError, lastNarration, LEGACY_MODEL, stripThinking, TOOLSET, TURN_BUDGET_MS, userTurn, type MessageParam, type Narrator, type ToolResult } from "./narrator";
import { openingSummary, rollOpening } from "./openings";
import { kickoffMessage } from "./prompt";
import type { UpgradeForge } from "./upgrades";
import { effectiveAbilities, emptyProgression, upgradeDue } from "../../shared/upgrades";
import { applyLevels, chooseLevelReward, effectiveCharacter } from "../../shared/levels";
import type { UsageGuard } from "./usage";

interface Busy {
  since: string;
  op?: "start" | "action" | "roll";
  storyLen?: number;
  /** Zustand vor dem Zug – zum Zurücknehmen bei einem Abbruch */
  pending?: PendingCheck | null;
  pendings?: PendingCheck[];
  rolled?: ToolResult[];
  world?: WorldState | null;
}

/** Offene Proben (auch aus Spielständen mit der älteren Einzelform). */
const openChecks = (p: Party): PendingCheck[] => p.pendings ?? (p.pending ? [p.pending] : []);
const setChecks = (p: Party, list: PendingCheck[]) => { p.pendings = list; p.pending = null; };

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
  /** Sperre während Claude erzählt – mit allem, was nötig ist, um einen abgebrochenen Zug zurückzunehmen. */
  busy: Busy | null;
  /** Fehlermeldung des letzten gescheiterten Zugs. */
  failed?: string | null;
  live: string;
  lastTurnCostUsd: number | null;
  /** Lebenspunkte, Kampf, Aufträge, Gedächtnis – ab dem Start. */
  world: WorldState | null;
  /** Werkzeug-Ergebnisse, die mit dem nächsten Probenergebnis an Claude gehen. */
  held: ToolResult[];
  /** Offene Probe als Liste (höchstens eine; `pending` ist die ältere Einzelform). */
  pendings?: PendingCheck[];
  /** Schon gewürfelte Proben dieser Runde; gehen zusammen an Claude, sobald alle gewürfelt haben. */
  rolled?: ToolResult[];
  toolset?: number;
  /** Modell, das zuletzt erzählt hat (siehe SignedState.model). */
  model?: string;
}

/** Speicher mit optimistischer Sperre: put schlägt fehl, wenn jemand anderes inzwischen gespeichert hat. */
export interface PartyStore {
  get(code: string): Promise<{ party: Party; etag: string } | null>;
  put(party: Party, etag: string | null): Promise<boolean>;
  delete(code: string): Promise<void>;
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
  async delete(code: string) { this.map.delete(code); }
}

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from(randomBytes(6), (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
const hash = (t: string) => createHash("sha256").update(t).digest("hex");
/** Eine Sperre gilt als verwaist, wenn der Zug länger als sein Zeitbudget läuft (etwa weil Netlify die Funktion beendet hat). */
const STALE_MS = TURN_BUDGET_MS + 20_000;
const isStale = (b: Busy) => Date.now() - Date.parse(b.since) >= STALE_MS;
const INTERRUPTED = "Der Spielleiter wurde unterbrochen (Zeitlimit oder Verbindungsabbruch). Bitte erneut versuchen.";

/** Nimmt einen abgebrochenen Zug zurück: Geschichte und offene Probe wie vorher, beim Start zurück in die Lobby. */
function recover(p: Party): boolean {
  if (!p.busy || !isStale(p.busy)) return false;
  const b = p.busy;
  if (typeof b.storyLen === "number") p.story = p.story.slice(0, b.storyLen);
  if (b.world !== undefined) p.world = b.world;
  if (b.op === "roll") { setChecks(p, b.pendings ?? (b.pending ? [b.pending] : [])); p.rolled = b.rolled ?? []; }
  if (b.op === "start") { p.status = "lobby"; p.opening = null; p.world = null; }
  p.busy = null;
  p.live = "";
  p.failed = INTERRUPTED;
  return true;
}
const LIVE_SAVE_MS = 1500;

class PartyError extends Error { constructor(message: string, public code = "state") { super(message); } }

export class PartyService {
  constructor(private o: { data: () => GameData; narrator: Narrator; forge?: UpgradeForge; guard: UsageGuard; store: PartyStore; secret: string }) {}

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
        return { id: p.id, host: p.host, characterId: p.character.id, name: p.character.name, classId: p.character.classId, className: cls?.name ?? p.character.classId, sigil: cls?.sigil ?? "shield", acted: p.id in party.actions,
          abilities: effectiveAbilities(cls?.abilities ?? [], party.world?.progress?.[p.character.id]).map((x) => ({ id: x.id, name: x.name, type: x.type, uses: x.uses, text: x.text, beginnerText: x.beginnerText, upgraded: !!x.upgraded })) };
      }),
      opening: party.opening,
      story: party.story,
      pendings: openChecks(party).map((c) => ({ ...c, playerId: party.players.find((p) => p.character.id === c.characterId)?.id ?? "" })),
      yourAction: party.actions[you] ?? null,
      busy: !!party.busy && !isStale(party.busy),
      live: party.live,
      budget,
      lastTurnCostUsd: party.lastTurnCostUsd,
      world: party.status === "playing" ? party.world ?? null : null,
      failed: party.failed ?? null,
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
    let { party } = await this.load(body?.code);
    const me = this.player(party, body?.token);
    // Verwaiste Sperre (abgebrochener Zug): sofort zurücknehmen, damit niemand bei „Der Spielleiter erzählt …“ hängen bleibt
    if (party.busy && isStale(party.busy)) party = await this.update(party.code, (p) => { recover(p); });
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

  /** Überblick für „Deine Gruppen“: Status je Gruppe – nur für Gruppen, zu denen der Zugang passt. */
  async overview(body: { items?: unknown }): Promise<{ items: PartyOverview[] }> {
    const list = (Array.isArray(body?.items) ? body.items : []).slice(0, 20) as { code?: unknown; token?: unknown }[];
    const items = await Promise.all(list.map(async (it): Promise<PartyOverview> => {
      const code = typeof it?.code === "string" ? it.code.trim().toUpperCase() : "";
      try {
        const { party } = await this.load(code);
        const me = this.player(party, it.token);
        const arc = party.world?.arc;
        return {
          code: party.code, status: party.status === "lobby" ? "lobby" : arc?.finished ? "finished" : "playing", outcome: arc?.finished ? arc.outcome ?? "sieg" : undefined,
          title: party.opening?.ort, players: party.players.map((p) => p.character.name), host: me.host,
        };
      } catch { return { code, status: "gone" }; }
    }));
    return { items };
  }

  /**
   * „Gruppe löschen“ aus der eigenen Liste. Auf dem Server gelöscht wird nur, wo niemand sonst etwas verliert:
   * in der Lobby, wenn man allein ist; im Spiel, wenn man allein ist oder als Gastgeber eine beendete Gruppe löscht.
   * Sonst verlässt man nur die Lobby bzw. vergisst die Gruppe – laufende Abenteuer der anderen bleiben unberührt.
   */
  async remove(body: { code?: unknown; token?: unknown }): Promise<{ deleted: boolean }> {
    const c = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
    const got = /^[A-Z0-9]{6}$/.test(c) ? await this.o.store.get(c) : null;
    if (!got) return { deleted: true }; // gibt es schon nicht mehr
    const { party } = got;
    const me = this.player(party, body?.token);
    const alone = party.players.length === 1;
    if (party.status === "lobby") {
      if (alone) { await this.o.store.delete(party.code); return { deleted: true }; }
      await this.leave(body);
      return { deleted: false };
    }
    if (alone || (me.host && party.world?.arc?.finished)) { await this.o.store.delete(party.code); return { deleted: true }; }
    return { deleted: false };
  }

  /* ── Spielleiter-Züge (mit Claude, gestreamt) ── */

  async run(op: "start" | "action" | "roll" | "upgrade", body: Record<string, unknown>, who: string, emit: (ev: PartyEvent) => void): Promise<void> {
    try {
      if (op === "upgrade") return void (await this.upgrade(body, who, emit));
      if (op === "action") {
        const ready = await this.submitAction(body);
        if (!ready) { emit({ type: "view", view: await this.state(body) }); return; }
      }
      this.o.narrator.ensureReady();
      if (op === "roll") await this.rollTurn(body, who, emit);
      else await this.gmTurn(op, body, who, emit);
    } catch (e) {
      if (e instanceof PartyError) emit({ type: "error", message: e.message, code: e.code });
      else emit(errorEvent(e));
    }
  }

  /* ── Verbesserte Fähigkeiten: jede Person für ihre eigene Figur ── */

  private async upgrade(body: Record<string, unknown>, who: string, emit: (ev: PartyEvent) => void) {
    this.o.narrator.ensureReady();
    if (!this.o.forge) throw new PartyError("Verbesserungen sind hier nicht eingerichtet.");
    const { party } = await this.load(body.code);
    const me = this.player(party, body.token);
    const world = party.world;
    const tier = world ? upgradeDue(world, me.character.id) : null;
    if (!world || !tier) throw new PartyError(world?.progress?.[me.character.id]?.offer ? "Deine Verbesserungen liegen schon bereit – wähle eine aus." : "Gerade ist für dich keine Verbesserung freigeschaltet.");
    const prog = world.progress?.[me.character.id] ?? emptyProgression();
    const res = await this.o.forge.generate({ data: this.dataFor(party), character: effectiveCharacter(me.character, world), characters: this.characters(party).map((c) => effectiveCharacter(c, world)), world, tier, recent: lastNarration(party.messages), who });
    const done = await this.update(party.code, (p) => {
      const cur = p.world?.progress?.[me.character.id] ?? emptyProgression();
      if (cur.offer || cur.chosen.length !== prog.chosen.length) return; // inzwischen schon erledigt (zweites Gerät)
      p.world!.progress = { ...p.world!.progress, [me.character.id]: { abilities: res.abilities, chosen: cur.chosen, offer: res.offer } };
      p.lastTurnCostUsd = res.costUsd;
    });
    emit({ type: "view", view: this.view(done, me.id, await this.o.guard.info()) });
  }

  /** Wahl beim Stufenaufstieg (Fertigkeit bei Stufe 4, Attribute bei Stufe 7) – für die eigene Figur. */
  async levelChoice(body: { code?: unknown; token?: unknown; skill?: unknown; attrs?: unknown }): Promise<PartyView> {
    const { party } = await this.load(body?.code);
    const me = this.player(party, body?.token);
    const done = await this.update(party.code, (p) => {
      if (!p.world) throw new PartyError("Das Abenteuer hat noch nicht begonnen.");
      const data = this.dataFor(p);
      const problem = chooseLevelReward(p.world, me.character, data.classes, data.rules, { skill: body.skill, attrs: body.attrs });
      if (problem) throw new PartyError(problem);
    });
    return this.view(done, me.id, await this.o.guard.info());
  }

  async choose(body: { code?: unknown; token?: unknown; option?: unknown }): Promise<PartyView> {
    const { party } = await this.load(body?.code);
    const me = this.player(party, body?.token);
    const done = await this.update(party.code, (p) => {
      const prog = p.world?.progress?.[me.character.id];
      const option = prog?.offer?.options[Number(body.option)];
      if (!prog?.offer || !option) throw new PartyError("Diese Verbesserung gibt es nicht (mehr).");
      p.world!.progress = { ...p.world!.progress, [me.character.id]: { ...prog, chosen: [...prog.chosen, option], offer: null } };
    });
    return this.view(done, me.id, await this.o.guard.info());
  }

  /** Speichert die Handlung. Gibt true zurück, wenn jetzt erzählt werden soll. */
  private async submitAction(body: Record<string, unknown>): Promise<boolean> {
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (text.length > MAX_ACTION_LENGTH) throw new PartyError(`Bitte kürzer fassen (höchstens ${MAX_ACTION_LENGTH} Zeichen).`);
    const { party } = await this.load(body.code);
    const me = this.player(party, body.token);
    const now = body.now === true;
    if (now && !me.host) throw new PartyError("Nur der Gastgeber kann die Runde vorzeitig erzählen lassen.");
    const retry = body.retry === true;
    const updated = await this.update(party.code, (p) => {
      recover(p);
      if (p.status !== "playing") throw new PartyError("Das Abenteuer hat noch nicht begonnen.");
      if (retry && !p.failed) throw new PartyError("Es gibt nichts zu wiederholen.");
      if (openChecks(p).length) throw new PartyError(`Erst muss gewürfelt werden (${openChecks(p).map((c) => c.characterName).join(", ")}).`);
      if (p.world?.arc?.finished) throw new PartyError("Dieses Abenteuer ist abgeschlossen. Gründet eine neue Gruppe für das nächste!");
      // Abgegeben ist abgegeben: Eine Handlung lässt sich danach nicht mehr ändern oder zurückziehen.
      if (text && me.id in p.actions) throw new PartyError("Deine Handlung ist schon abgegeben – sie lässt sich nicht mehr ändern.");
      if (text) p.actions[me.id] = text;
    });
    const all = updated.players.every((p) => p.id in updated.actions);
    return Object.keys(updated.actions).length > 0 && (all || now || retry);
  }

  /** Einmalige Umstellung älterer Gruppen (Werkzeugstand, Modellwechsel). */
  private migrate(p: Party) {
    if (p.status !== "playing") return;
    // Älterer Werkzeugstand: Denkblöcke einmal entfernen; Lebenspunkte usw. bleiben, der Kampagnenbogen kommt dazu
    if (p.toolset !== TOOLSET || !p.world) {
      p.messages = stripThinking(p.messages);
      p.world ??= initWorld(this.characters(p));
      if (!isArc(p.world.arc)) p.world.arc = initArc();
      p.held ??= [];
      p.toolset = TOOLSET;
    }
    if ((p.model ?? LEGACY_MODEL) !== this.o.narrator.model) p.messages = stripThinking(p.messages);
  }

  /** Sperre für einen Spielleiter-Zug – mit allem, was zum Zurücknehmen nötig ist. */
  private lockFor(p: Party, op: Busy["op"]): Busy {
    return { since: new Date().toISOString(), op, storyLen: p.story.length, pendings: openChecks(p), rolled: p.rolled ?? [], world: p.world ? structuredClone(p.world) : null };
  }

  private async gmTurn(op: "start" | "action", body: Record<string, unknown>, who: string, emit: (ev: PartyEvent) => void) {
    const { party: first } = await this.load(body.code);
    const me = this.player(first, body.token);
    let consumed: Record<string, string> = {};
    let messages: MessageParam[] = [];

    // 1) Sperre setzen und Eingabe für Claude vorbereiten
    let lock!: Busy;
    const locked = await this.update(first.code, (p) => {
      recover(p);
      if (p.busy) throw new PartyError("Der Spielleiter erzählt gerade – einen Moment.");
      lock = this.lockFor(p, op);
      const data = this.dataFor(p);
      this.migrate(p);
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
      } else {
        if (openChecks(p).length) throw new PartyError(`Erst muss gewürfelt werden (${openChecks(p).map((c) => c.characterName).join(", ")}).`);
        consumed = { ...p.actions };
        const items = p.players.map((pl) => ({ playerId: pl.id, name: pl.character.name, text: consumed[pl.id] ?? "" }));
        p.story.push({ type: "actions", items: items.filter((i) => i.text) });
        const lines = items.map((i) => `- ${i.name}: ${i.text || "(keine Angabe – handelt passend zur Lage)"}`).join("\n");
        if (p.world!.arc?.finished) throw new PartyError("Dieses Abenteuer ist abgeschlossen. Gründet eine neue Gruppe für das nächste!");
        if (p.world!.combat) p.world!.combat.round++;
        countChapterTurn(p.world!);
        messages = [...p.messages, userTurn(p.held ?? [], `<aktionen>\n${lines}\n</aktionen>\n\n<spielstand>\n${turnSummary(p.world!, this.characters(p), data.rules)}\n</spielstand>`)];
      }
      p.busy = lock;
      p.live = "";
      p.failed = null;
    });
    await this.narrate({ locked, lock, me, messages, consumed, who, emit });
  }

  /** Würfeln: Die genannte Figur würfelt; danach erzählt Claude mit dem Ergebnis und den angesagten Gegnerangriffen. */
  private async rollTurn(body: Record<string, unknown>, who: string, emit: (ev: PartyEvent) => void) {
    const { party } = await this.load(body.code);
    const me = this.player(party, body.token);
    const open = openChecks(party);
    if (!open.length) throw new PartyError("Gerade ist keine Probe offen.");
    const check = open.find((c) => c.characterId === me.character.id);
    if (!check) throw new PartyError(`${open.map((c) => c.characterName).join(", ")} ${open.length > 1 ? "müssen" : "muss"} würfeln, nicht du.`);
    if (party.busy && !isStale(party.busy)) throw new PartyError("Der Spielleiter erzählt gerade – einen Moment.");
    const data = this.dataFor(party);
    const world0 = party.world!;
    const { record, damage } = await this.o.narrator.rollRecords(check, { characters: this.characters(party).map((c) => effectiveCharacter(c, world0)), data, world: world0 });
    emit({ type: "roll", record });

    // Verbuchen in einer gesperrten Änderung: gleichzeitige Würfe überschreiben sich nicht
    let lock: Busy | null = null;
    let extra: RollRecord[] = [];
    const updated = await this.update(party.code, (p) => {
      recover(p);
      lock = null;
      const now = openChecks(p);
      if (!now.some((c) => c.toolUseId === check.toolUseId)) throw new PartyError("Dein Wurf ist schon verbucht.");
      if (p.busy) throw new PartyError("Der Spielleiter erzählt gerade – einen Moment.");
      const before = this.lockFor(p, "roll");
      const res = this.o.narrator.applyRolls(check, { characters: this.characters(p).map((c) => effectiveCharacter(c, p.world!)), data, world: p.world! }, record, damage);
      extra = res.extra;
      p.story.push({ type: "roll", record, playerId: me.id }, ...res.extra.map((r): PartyStoryEntry => ({ type: "roll", record: r, playerId: me.id })));
      p.rolled = [...(p.rolled ?? []), res.result];
      setChecks(p, now.filter((c) => c.toolUseId !== check.toolUseId));
      if (!p.pendings!.length) {
        // Letzter Wurf: Spielleiter-Zug beginnt (bei einem Abbruch zurück auf den Stand vor diesem Wurf)
        this.migrate(p);
        lock = before;
        p.busy = before;
        p.live = "";
        p.failed = null;
      }
    });
    for (const r of extra) emit({ type: "roll", record: r }); // eigener Schaden – eigene Animation im Browser
    if (!lock) { emit({ type: "view", view: this.view(updated, me.id, await this.o.guard.info()) }); return; }
    await this.narrate({ locked: updated, lock, me, messages: null, consumed: {}, who, emit });
  }

  /** Erzählen lassen und das Ergebnis speichern. `messages: null` = nach den Würfen (Ergebnisse und Gegnerzug werden hier angehängt). */
  private async narrate(o: { locked: Party; lock: Busy; me: PartyPlayer; messages: MessageParam[] | null; consumed: Record<string, string>; who: string; emit: (ev: PartyEvent) => void }) {
    const { locked, lock, me, consumed, emit } = o;
    const mine = (p: Party) => p.busy?.since === lock.since;
    const data = this.dataFor(locked);
    const world = locked.world!;
    // Figuren so, wie sie in dieser Kampagne gerade sind (Stufe, zusätzliche Fertigkeit, gesteigerte Attribute)
    const characters = this.characters(locked).map((c) => effectiveCharacter(c, world));

    try {
      // Erzählen; der entstehende Text wird regelmäßig gespeichert, damit Mitspieler mitlesen.
      // Server-Würfe (Gegnerangriffe, Heilung) teilen die Erzählung in Abschnitte.
      let live = "";
      const segments: PartyStoryEntry[] = [];
      const flush = () => { const t = live.trim(); if (t) segments.push({ type: "gm", text: t }); live = ""; };
      const onRoll = (record: RollRecord) => { flush(); segments.push({ type: "roll", record, playerId: "", auto: true }); emit({ type: "autoroll", record }); };
      let messages = o.messages;
      if (!messages) {
        const enemies = await this.o.narrator.enemyTurn(locked.messages, { characters, data, world, onRoll });
        messages = [...locked.messages, { role: "user", content: [...(locked.held ?? []), ...(locked.rolled ?? []), ...enemies] }];
      }
      let lastSave = Date.now();
      let saving: Promise<unknown> = Promise.resolve();
      const res = await this.o.narrator.converse(messages, { characters, data, world, onRoll }, o.who, (text) => {
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
      applyLevels(world, this.characters(locked), data.classes, data.rules);
      // Ganze Gruppe gefallen und niemand hat sie gerettet: Niederlage, vom Server erzwungen
      const defeated = enforceDefeat(world, characters);

      // Ergebnis übernehmen und Sperre lösen
      const done = await this.update(locked.code, (p) => {
        if (!mine(p)) throw new PartyError(INTERRUPTED);
        p.messages = res.history;
        p.model = this.o.narrator.model;
        p.story.push(...segments);
        p.world = world;
        p.held = res.held;
        setChecks(p, defeated ? [] : res.pendings);
        p.rolled = [];
        for (const [id, text] of Object.entries(consumed)) if (p.actions[id] === text) delete p.actions[id];
        p.busy = null;
        p.live = "";
        p.lastTurnCostUsd = res.costUsd;
      });
      emit({ type: "view", view: this.view(done, me.id, await this.o.guard.info()) });
    } catch (e) {
      // Fehler: Zug zurücknehmen und Sperre lösen; beim Start zurück in die Lobby. Die Handlungen bleiben abgegeben –
      // so kann jeder mit „Erneut versuchen“ die Runde neu erzählen lassen. Erneutes Würfeln liefert denselben Wurf (Wurf-ID hängt an der Probe).
      const message = e instanceof PartyError ? e.message : errorEvent(e).message;
      await this.update(locked.code, (p) => {
        if (!mine(p)) return;
        p.busy = { ...lock, since: new Date(0).toISOString() };
        recover(p);
        p.failed = message;
      }).catch(() => {});
      throw e;
    }
  }
}

export { GmError };
