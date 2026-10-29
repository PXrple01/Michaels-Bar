// Solo-Modus: Der Spielstand liegt im Browser und ist vom Server signiert.
import type { ImageMaker } from "../images";
import { MAX_ACTION_LENGTH, type GmEvent, type RollRequest, type SignedState, type StartRequest, type TurnRequest, type UpgradeRequest, type LevelRequest, type ShopRequest, type SceneImage } from "../../shared/campaign";
import { trade } from "../../shared/shop";
import { emptyProgression, upgradeDue } from "../../shared/upgrades";
import { applyLevels, chooseLevelReward, effectiveCharacter } from "../../shared/levels";
import type { RollRecord } from "../../shared/dice";
import type { Character } from "../../shared/schema";
import { initArc, initWorld, isArc, type WorldState } from "../../shared/world";
import { initTime } from "../../shared/time";
import { upsertPerson } from "../../shared/people";
import { startPlace, visitPlace } from "../../shared/map";
import { turnSummary } from "./summary";
import { resolveCharacter, ValidationError } from "../characters";
import type { RollLog } from "../dice/log";
import type { GameData } from "../rules/loader";
import { chapterMark, errorEvent, GmError, Narrator, lastNarration, LEGACY_MODEL, stripThinking, TOOLSET, userTurn, type LlmClient, type MessageParam, type ModelId, type ToolResult } from "./narrator";
import { openingSummary, rollOpening } from "./openings";
import { kickoffMessage } from "./prompt";
import { characterHash, signState, verifyState } from "./state";
import { UpgradeForge } from "./upgrades";
import { countChapterTurn, enforceDefeat } from "./world";
import type { UsageGuard } from "./usage";

export { AnthropicLlm, describeRoll, type LlmClient } from "./narrator";

export interface GmOptions {
  data: () => GameData;
  llm: LlmClient | null;
  rolls: RollLog;
  guard: UsageGuard;
  secret: string;
  model?: ModelId;
  effort?: "low" | "medium" | "high";
  turnBudgetMs?: number;
  images?: ImageMaker;
}

interface Saved { messages: MessageParam[]; world: WorldState; held: ToolResult[] }

export class GameMaster {
  readonly narrator: Narrator;
  readonly forge: UpgradeForge;
  constructor(private o: GmOptions) {
    this.narrator = new Narrator(o);
    this.forge = new UpgradeForge(o);
  }

  pendingFrom(messages: MessageParam[], c: Character, data: GameData, world: WorldState | null = null) {
    return this.narrator.pendingFrom(messages, [c], data, world);
  }

  private character(raw: unknown): { c: Character; data: GameData } {
    try { return resolveCharacter(raw, this.o.data(), this.o.secret); } catch (e) {
      throw new GmError(e instanceof ValidationError ? `Figur ungültig: ${e.problems.join(", ")}` : "Figur ungültig", "state");
    }
  }

  /** Prüft die Signatur. Ältere Spielstände werden einmalig auf den neuen Werkzeugstand gebracht. */
  private verified(state: SignedState | undefined, c: Character): Saved {
    if (!verifyState(this.o.secret, state, c)) throw new GmError("Der Spielstand passt nicht zur Signatur des Servers (verändert oder zu einer anderen Figur gehörig).", "state");
    const messages = state!.messages as MessageParam[];
    if (state!.toolset === TOOLSET && state!.world) {
      // Anderes Modell als beim letzten Zug (z. B. GM_MODEL umgestellt): dessen Denkblöcke kann das neue Modell nicht lesen.
      const sameModel = (state!.model ?? LEGACY_MODEL) === this.narrator.model;
      return { messages: sameModel ? messages : stripThinking(messages), world: structuredClone(state!.world), held: (state!.held ?? []) as ToolResult[] };
    }
    // Älterer Werkzeugstand: Denkblöcke einmal entfernen; Lebenspunkte, Aufträge usw. bleiben, der Kampagnenbogen kommt dazu.
    const world = state!.world ? structuredClone(state!.world) : initWorld([c]);
    if (!isArc(world.arc)) world.arc = initArc();
    return { messages: stripThinking(messages), world, held: (state!.held ?? []) as ToolResult[] };
  }

  /** Führt eine Aktion aus und meldet alle Ereignisse über `emit`. Fehler werden als Ereignis gemeldet. */
  async run(kind: "start" | "turn" | "roll" | "upgrade" | "choose" | "level" | "shop", body: unknown, who: string, emit: (ev: GmEvent) => void): Promise<void> {
    try {
      if (kind === "choose") return void (await this.choose(body as UpgradeRequest, emit));
      if (kind === "level") return void (await this.levelChoice(body as LevelRequest, emit));
      if (kind === "shop") return void (await this.shop(body as ShopRequest, emit));
      this.narrator.ensureReady();
      if (kind === "start") await this.start(body as StartRequest, who, emit);
      else if (kind === "turn") await this.turn(body as TurnRequest, who, emit);
      else if (kind === "upgrade") await this.upgrade(body as UpgradeRequest, who, emit);
      else await this.roll(body as RollRequest, who, emit);
    } catch (e) {
      emit(errorEvent(e));
    }
  }

  private async start(req: StartRequest, who: string, emit: (ev: GmEvent) => void) {
    const { c, data } = this.character(req?.character);
    const previous = Array.isArray(req.previousOpenings) ? req.previousOpenings.filter((p) => typeof p === "string").map((p) => p.slice(0, 400)).slice(-10) : [];
    const opening = rollOpening(data.openings, previous);
    emit({ type: "opening", opening, summary: openingSummary(opening) });
    const world = initWorld([c]);
    world.time = initTime(opening.zeit);
    upsertPerson(world, { name: opening.npc.name, role: opening.npc.rolle, note: opening.npc.eigenschaft });
    visitPlace(world, startPlace(opening.ort));
    await this.converse([{ role: "user", content: kickoffMessage([c], data, opening, previous) }], world, c, data, who, emit);
  }

  private async turn(req: TurnRequest, who: string, emit: (ev: GmEvent) => void) {
    const { c, data } = this.character(req?.character);
    const { messages, world, held } = this.verified(req.state, c);
    if (this.pendingFrom(messages, effectiveCharacter(c, world), data, world)) throw new GmError("Erst muss die verlangte Probe gewürfelt werden.", "state");
    if (world.arc?.finished) throw new GmError("Dieses Abenteuer ist abgeschlossen. Beginne ein neues!", "state");
    const action = typeof req.action === "string" ? req.action.trim() : "";
    if (!action) throw new GmError("Was tust du? Schreib es in das Feld.", "state");
    if (action.length > MAX_ACTION_LENGTH) throw new GmError(`Bitte kürzer fassen (höchstens ${MAX_ACTION_LENGTH} Zeichen).`, "state");
    if (world.combat) world.combat.round++;
    countChapterTurn(world);
    await this.converse([...messages, userTurn(held, `${action}\n\n<spielstand>\n${turnSummary(world, [c], data.rules)}\n</spielstand>`)], world, c, data, who, emit);
  }

  private async roll(req: RollRequest, who: string, emit: (ev: GmEvent) => void) {
    const { c, data } = this.character(req?.character);
    const { messages, world, held } = this.verified(req.state, c);
    const ce = effectiveCharacter(c, world);
    if (world.arc?.finished) throw new GmError("Dieses Abenteuer ist abgeschlossen. Beginne ein neues!", "state");
    const pending = this.pendingFrom(messages, ce, data, world);
    if (!pending) throw new GmError("Gerade ist keine Probe offen.", "state");
    // Gegnerangriffe erst nach dem eigenen Wurf (und Schaden) zeigen
    const enemyRolls: RollRecord[] = [];
    const { record, extra, content } = await this.narrator.rollPending(pending, { characters: [ce], data, world, onRoll: (r) => enemyRolls.push(r) }, held, messages);
    emit({ type: "roll", record });
    for (const r of extra) emit({ type: "roll", record: r }); // eigener Schaden – gehört zum Wurf der Figur
    for (const r of enemyRolls) emit({ type: "autoroll", record: r });
    await this.converse([...messages, { role: "user", content }], world, c, data, who, emit);
  }

  /** Freischaltung: Claude erstellt zwei Verbesserungen, passend zur Figur und teils zur Lage. */
  private async upgrade(req: UpgradeRequest, who: string, emit: (ev: GmEvent) => void) {
    const { c, data } = this.character(req?.character);
    const { messages, world, held } = this.verified(req.state, c);
    const prog = world.progress?.[c.id] ?? emptyProgression();
    if (prog.offer) throw new GmError("Die Verbesserungen liegen schon bereit – wähle eine aus.", "state");
    const tier = upgradeDue(world, c.id);
    if (!tier) throw new GmError("Gerade ist keine Verbesserung freigeschaltet.", "state");
    const ce = effectiveCharacter(c, world);
    const res = await this.forge.generate({ data, character: ce, characters: [ce], world, tier, recent: lastNarration(messages), who });
    world.progress = { ...world.progress, [c.id]: { abilities: res.abilities, chosen: prog.chosen, offer: res.offer } };
    emit({ type: "upgrade", state: this.sign(messages, world, held, c), offer: res.offer, budget: await this.o.guard.info(), turnCostUsd: res.costUsd });
  }

  /** Eine der angebotenen Verbesserungen übernehmen – ohne Claude, kostet nichts. */
  private async choose(req: UpgradeRequest, emit: (ev: GmEvent) => void) {
    const { c } = this.character(req?.character);
    const { messages, world, held } = this.verified(req.state, c);
    const prog = world.progress?.[c.id];
    const option = prog?.offer?.options[Number(req.option)];
    if (!prog?.offer || !option) throw new GmError("Diese Verbesserung gibt es nicht (mehr).", "state");
    world.progress = { ...world.progress, [c.id]: { ...prog, chosen: [...prog.chosen, option], offer: null } };
    emit({ type: "upgrade", state: this.sign(messages, world, held, c), offer: null, budget: await this.o.guard.info() });
  }

  /** Wahl bei Stufe 4 (Fertigkeit) bzw. 7 (Attribute) – ohne Claude, kostet nichts. */
  private async levelChoice(req: LevelRequest, emit: (ev: GmEvent) => void) {
    const { c, data } = this.character(req?.character);
    const { messages, world, held } = this.verified(req.state, c);
    const problem = chooseLevelReward(world, c, data.classes, data.rules, { skill: req.skill, attrs: req.attrs });
    if (problem) throw new GmError(problem, "state");
    emit({ type: "upgrade", state: this.sign(messages, world, held, c), offer: world.progress?.[c.id]?.offer ?? null, budget: await this.o.guard.info() });
  }

  /** Im offenen Laden kaufen oder verkaufen – ohne Claude, kostet nichts. Claude erfährt es im nächsten Zug. */
  private async shop(req: ShopRequest, emit: (ev: GmEvent) => void) {
    const { c, data } = this.character(req?.character);
    const { messages, world, held } = this.verified(req.state, c);
    const problem = trade(world, c, data.rules, req.action, req.ref);
    if (problem) throw new GmError(problem, "state");
    emit({ type: "upgrade", state: this.sign(messages, world, held, c), offer: world.progress?.[c.id]?.offer ?? null, budget: await this.o.guard.info() });
  }

  private sign(messages: MessageParam[], world: WorldState, held: ToolResult[], c: Character): SignedState {
    return { ...signState(this.o.secret, { messages, world, held, toolset: TOOLSET }, characterHash(c)), model: this.narrator.model };
  }

  private async converse(messages: MessageParam[], world: WorldState, c: Character, data: GameData, who: string, emit: (ev: GmEvent) => void) {
    const scene = { characters: [effectiveCharacter(c, world)], data, world, onRoll: (record: RollRecord) => emit({ type: "autoroll", record }), onImage: (img: SceneImage) => emit({ type: "image", ...img }) };
    const mark = chapterMark(world), first = !messages.some((m) => m.role === "assistant"), wasFighting = !!world.combat, placeBefore = world.map?.current ?? null;
    let narration = "";
    const res = await this.narrator.converse(messages, scene, who, (text) => { narration += text; emit({ type: "text", text }); });
    // Anfang der Kampagne oder eines Kapitels, Ortswechsel, Ende eines Kampfes, spätestens jeder dritte Zug: immer ein Bild (falls Claude keines bestellt hat)
    const auto = await this.narrator.imageIfDue({ mark, first, painted: res.painted, narration, scene, wasFighting, placeBefore });
    applyLevels(world, [c], data.classes, data.rules);
    // Gefallen und niemand hat geholfen: Niederlage, vom Server erzwungen (auch wenn Claude es nicht selbst beendet hat)
    const defeated = enforceDefeat(world, scene.characters);
    emit({ type: "done", state: this.sign(res.history, world, res.held, c), pending: defeated ? null : res.pending, budget: await this.o.guard.info(), turnCostUsd: res.costUsd + auto.claudeUsd, turnImageUsd: res.imageUsd + auto.imageUsd });
  }
}

