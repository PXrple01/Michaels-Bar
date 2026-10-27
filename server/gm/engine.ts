// Solo-Modus: Der Spielstand liegt im Browser und ist vom Server signiert.
import { MAX_ACTION_LENGTH, type GmEvent, type RollRequest, type SignedState, type StartRequest, type TurnRequest } from "../../shared/campaign";
import type { RollRecord } from "../../shared/dice";
import type { Character } from "../../shared/schema";
import { initWorld, worldSummary, type WorldState } from "../../shared/world";
import { resolveCharacter, ValidationError } from "../characters";
import type { RollLog } from "../dice/log";
import type { GameData } from "../rules/loader";
import { errorEvent, GmError, Narrator, stripThinking, TOOLSET, userTurn, type LlmClient, type MessageParam, type ModelId, type ToolResult } from "./narrator";
import { openingSummary, rollOpening } from "./openings";
import { kickoffMessage } from "./prompt";
import { characterHash, signState, verifyState } from "./state";
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
}

interface Saved { messages: MessageParam[]; world: WorldState; held: ToolResult[] }

export class GameMaster {
  readonly narrator: Narrator;
  constructor(private o: GmOptions) {
    this.narrator = new Narrator(o);
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
    if (state!.toolset === TOOLSET && state!.world) return { messages, world: state!.world, held: (state!.held ?? []) as ToolResult[] };
    return { messages: stripThinking(messages), world: initWorld([c]), held: [] };
  }

  /** Führt eine Aktion aus und meldet alle Ereignisse über `emit`. Fehler werden als Ereignis gemeldet. */
  async run(kind: "start" | "turn" | "roll", body: unknown, who: string, emit: (ev: GmEvent) => void): Promise<void> {
    try {
      this.narrator.ensureReady();
      if (kind === "start") await this.start(body as StartRequest, who, emit);
      else if (kind === "turn") await this.turn(body as TurnRequest, who, emit);
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
    await this.converse([{ role: "user", content: kickoffMessage([c], data, opening, previous) }], initWorld([c]), c, data, who, emit);
  }

  private async turn(req: TurnRequest, who: string, emit: (ev: GmEvent) => void) {
    const { c, data } = this.character(req?.character);
    const { messages, world, held } = this.verified(req.state, c);
    if (this.pendingFrom(messages, c, data, world)) throw new GmError("Erst muss die verlangte Probe gewürfelt werden.", "state");
    const action = typeof req.action === "string" ? req.action.trim() : "";
    if (!action) throw new GmError("Was tust du? Schreib es in das Feld.", "state");
    if (action.length > MAX_ACTION_LENGTH) throw new GmError(`Bitte kürzer fassen (höchstens ${MAX_ACTION_LENGTH} Zeichen).`, "state");
    if (world.combat) world.combat.round++;
    await this.converse([...messages, userTurn(held, `${action}\n\n<spielstand>\n${worldSummary(world, [c])}\n</spielstand>`)], world, c, data, who, emit);
  }

  private async roll(req: RollRequest, who: string, emit: (ev: GmEvent) => void) {
    const { c, data } = this.character(req?.character);
    const { messages, world, held } = this.verified(req.state, c);
    const pending = this.pendingFrom(messages, c, data, world);
    if (!pending) throw new GmError("Gerade ist keine Probe offen.", "state");
    const { record, content } = await this.narrator.rollPending(pending, { characters: [c], data, world }, held);
    emit({ type: "roll", record });
    await this.converse([...messages, { role: "user", content }], world, c, data, who, emit);
  }

  private async converse(messages: MessageParam[], world: WorldState, c: Character, data: GameData, who: string, emit: (ev: GmEvent) => void) {
    const scene = { characters: [c], data, world, onRoll: (record: RollRecord) => emit({ type: "autoroll", record }) };
    const res = await this.narrator.converse(messages, scene, who, (text) => emit({ type: "text", text }));
    const state = signState(this.o.secret, { messages: res.history, world, held: res.held, toolset: TOOLSET }, characterHash(c));
    emit({ type: "done", state, pending: res.pending, budget: await this.o.guard.info(), turnCostUsd: res.costUsd });
  }
}
