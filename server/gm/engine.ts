// Claude als Spielleiter: Startimpuls, Erzählzüge und Proben.
// Claude verlangt Proben nur über ein Werkzeug; gewürfelt wird ausschließlich hier im Server.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { MAX_ACTION_LENGTH, type GmEvent, type PendingCheck, type RollRequest, type SignedState, type StartRequest, type TurnRequest } from "../../shared/campaign";
import { characterRoll } from "../../shared/character";
import { formatModifier, type RollRecord } from "../../shared/dice";
import type { Character } from "../../shared/schema";
import { ValidationError, verifyCharacter } from "../characters";
import type { RollLog } from "../dice/log";
import type { GameData } from "../rules/loader";
import { openingSummary, rollOpening } from "./openings";
import { kickoffMessage, systemPrompt } from "./prompt";
import { characterHash, signState, verifyState } from "./state";
import { LimitError, type UsageGuard } from "./usage";

type Message = Anthropic.Beta.BetaMessage;
type MessageParam = Anthropic.Beta.BetaMessageParam;
type StreamParams = Parameters<Anthropic["beta"]["messages"]["stream"]>[0];

/** Schnittstelle zum Modell – in Tests durch eine Attrappe ersetzbar. */
export interface LlmClient {
  stream(params: StreamParams, onText: (text: string) => void): Promise<Message>;
}

export class AnthropicLlm implements LlmClient {
  private client: Anthropic;
  constructor(apiKey: string) { this.client = new Anthropic({ apiKey, maxRetries: 2 }); }
  async stream(params: StreamParams, onText: (text: string) => void): Promise<Message> {
    const stream = this.client.beta.messages.stream(params);
    stream.on("text", onText);
    return stream.finalMessage();
  }
}

export interface GmOptions {
  data: () => GameData;
  llm: LlmClient | null;
  rolls: RollLog;
  guard: UsageGuard;
  secret: string;
  model?: string;
  effort?: "low" | "medium" | "high";
}

const TOOL_NAME = "probe_anfordern";
const MAX_LOOPS = 3;

class GmError extends Error {
  constructor(message: string, public code: NonNullable<Extract<GmEvent, { type: "error" }>["code"]>) { super(message); }
}

export class GameMaster {
  constructor(private o: GmOptions) {}

  private tools(data: GameData): Anthropic.Beta.BetaTool[] {
    const ids = [...data.rules.attributes.map((a) => a.id), ...data.rules.skills.map((s) => s.id), "waffe"];
    return [{
      name: TOOL_NAME,
      description:
        "Verlangt von der Spielfigur eine Probe. Der Server würfelt fair, sobald die Person auf „Würfeln“ klickt, und liefert dir das Ergebnis. " +
        "art: attribute (reine Attributsprobe), skill (Fertigkeit), attack (Waffenangriff, id = waffe), damage (Waffenschaden, id = waffe, sg = 0). " +
        "Attribute: " + data.rules.attributes.map((a) => `${a.id} (${a.name})`).join(", ") + ". " +
        "Fertigkeiten: " + data.rules.skills.map((s) => `${s.id} (${s.name})`).join(", ") + ".",
      eager_input_streaming: true,
      input_schema: {
        type: "object",
        properties: {
          art: { type: "string", enum: ["attribute", "skill", "attack", "damage"] },
          id: { type: "string", enum: ids },
          sg: { type: "integer", description: "Schwierigkeitsgrad 5–25; bei damage 0" },
          modus: { type: "string", enum: ["normal", "advantage", "disadvantage"] },
          grund: { type: "string", description: "Ein kurzer Satz, warum gewürfelt wird – wird der Person angezeigt" },
        },
        required: ["art", "id", "sg", "modus", "grund"],
      },
    }];
  }

  private toolInput(data: GameData) {
    const ids = new Set([...data.rules.attributes.map((a) => a.id), ...data.rules.skills.map((s) => s.id), "waffe"]);
    return z.object({
      art: z.enum(["attribute", "skill", "attack", "damage"]),
      id: z.string().refine((x) => ids.has(x)),
      sg: z.number().int().min(0).max(30),
      modus: z.enum(["normal", "advantage", "disadvantage"]),
      grund: z.string().min(1).max(300),
    }).refine((v) => (v.art === "attribute" ? data.rules.attributes.some((a) => a.id === v.id) : v.art === "skill" ? data.rules.skills.some((s) => s.id === v.id) : v.id === "waffe"));
  }

  /** Liest die offene Probe aus der letzten Spielleiter-Nachricht (Teil des signierten Verlaufs). */
  pendingFrom(messages: MessageParam[], c: Character): PendingCheck | null {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant" || typeof last.content === "string") return null;
    const block = last.content.find((b): b is Anthropic.Beta.BetaToolUseBlockParam => b.type === "tool_use" && b.name === TOOL_NAME);
    if (!block) return null;
    const data = this.o.data();
    const parsed = this.toolInput(data).safeParse(block.input);
    if (!parsed.success) return null;
    const v = parsed.data;
    const spec = characterRoll(c, data.rules, data.classes, v.art, v.id);
    return { toolUseId: block.id, art: v.art, id: v.id, sg: spec.d20 ? v.sg : null, modus: spec.d20 ? v.modus : "normal", grund: v.grund, label: spec.label };
  }

  private ensureReady() {
    if (!this.o.llm) throw new GmError("Kein API-Schlüssel hinterlegt. Trage ANTHROPIC_API_KEY ein (lokal in .env, online in den Netlify-Umgebungsvariablen).", "no_api_key");
  }

  private character(raw: unknown): Character {
    try { return verifyCharacter(raw, this.o.data()); } catch (e) {
      throw new GmError(e instanceof ValidationError ? `Figur ungültig: ${e.problems.join(", ")}` : "Figur ungültig", "state");
    }
  }

  private verified(state: SignedState | undefined, c: Character): MessageParam[] {
    if (!verifyState(this.o.secret, state, c)) throw new GmError("Der Spielstand passt nicht zur Signatur des Servers (verändert oder zu einer anderen Figur gehörig).", "state");
    return state!.messages as MessageParam[];
  }

  /** Führt eine Aktion aus und meldet alle Ereignisse über `emit`. Fehler werden als Ereignis gemeldet. */
  async run(kind: "start" | "turn" | "roll", body: unknown, who: string, emit: (ev: GmEvent) => void): Promise<void> {
    try {
      this.ensureReady();
      if (kind === "start") await this.start(body as StartRequest, who, emit);
      else if (kind === "turn") await this.turn(body as TurnRequest, who, emit);
      else await this.roll(body as RollRequest, who, emit);
    } catch (e) {
      if (e instanceof GmError) emit({ type: "error", message: e.message, code: e.code });
      else if (e instanceof LimitError) emit({ type: "error", message: e.message, code: e.code });
      else if (e instanceof Anthropic.RateLimitError) emit({ type: "error", message: "Der Spielleiter ist gerade überlastet. Bitte gleich noch einmal versuchen.", code: "api" });
      else if (e instanceof Anthropic.AuthenticationError) emit({ type: "error", message: "Der API-Schlüssel wurde abgelehnt. Bitte ANTHROPIC_API_KEY prüfen.", code: "no_api_key" });
      else if (e instanceof Anthropic.APIError) emit({ type: "error", message: `Fehler bei der Verbindung zum Spielleiter (${e.status ?? "Netzwerk"}). Bitte erneut versuchen.`, code: "api" });
      else { console.error(e); emit({ type: "error", message: "Unerwarteter Fehler beim Erzählen.", code: "api" }); }
    }
  }

  private async start(req: StartRequest, who: string, emit: (ev: GmEvent) => void) {
    const c = this.character(req?.character);
    const data = this.o.data();
    const previous = Array.isArray(req.previousOpenings) ? req.previousOpenings.filter((p) => typeof p === "string").map((p) => p.slice(0, 400)).slice(-10) : [];
    const opening = rollOpening(data.openings, previous);
    emit({ type: "opening", opening, summary: openingSummary(opening) });
    await this.converse([{ role: "user", content: kickoffMessage(c, data, opening, previous) }], c, who, emit);
  }

  private async turn(req: TurnRequest, who: string, emit: (ev: GmEvent) => void) {
    const c = this.character(req?.character);
    const messages = this.verified(req.state, c);
    if (this.pendingFrom(messages, c)) throw new GmError("Erst muss die verlangte Probe gewürfelt werden.", "state");
    const action = typeof req.action === "string" ? req.action.trim() : "";
    if (!action) throw new GmError("Was tust du? Schreib es in das Feld.", "state");
    if (action.length > MAX_ACTION_LENGTH) throw new GmError(`Bitte kürzer fassen (höchstens ${MAX_ACTION_LENGTH} Zeichen).`, "state");
    await this.converse([...messages, { role: "user", content: action }], c, who, emit);
  }

  private async roll(req: RollRequest, who: string, emit: (ev: GmEvent) => void) {
    const c = this.character(req?.character);
    const messages = this.verified(req.state, c);
    const pending = this.pendingFrom(messages, c);
    if (!pending) throw new GmError("Gerade ist keine Probe offen.", "state");
    const data = this.o.data();
    const spec = characterRoll(c, data.rules, data.classes, pending.art, pending.id);
    // Die Wurf-ID hängt an der Probe: Wer erneut sendet, bekommt denselben Wurf – kein Neuwürfeln.
    const record = await this.o.rolls.roll({
      requestId: `gm-${pending.toolUseId.replace(/[^A-Za-z0-9-]/g, "-")}`.slice(0, 64),
      kind: "check",
      label: `${c.name}: ${spec.label}`,
      notation: spec.notation,
      mode: pending.modus,
      modifierParts: spec.parts,
      dc: pending.sg,
    });
    emit({ type: "roll", record });
    const result: Anthropic.Beta.BetaToolResultBlockParam = { type: "tool_result", tool_use_id: pending.toolUseId, content: describeRoll(record) };
    await this.converse([...messages, { role: "user", content: [result] }], c, who, emit);
  }

  private async converse(messages: MessageParam[], c: Character, who: string, emit: (ev: GmEvent) => void) {
    const data = this.o.data();
    const history = [...messages];
    for (let loop = 0; loop < MAX_LOOPS; loop++) {
      await this.o.guard.check(who);
      const msg = await this.o.llm!.stream({
        model: this.o.model ?? "claude-opus-5-5",
        max_tokens: 8000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: this.o.effort ?? "low" },
        cache_control: { type: "ephemeral" },
        system: [{ type: "text", text: systemPrompt(data), cache_control: { type: "ephemeral" } }],
        tools: this.tools(data),
        tool_choice: { type: "auto", disable_parallel_tool_use: true },
        messages: history,
      }, (text) => emit({ type: "text", text }));
      await this.o.guard.record(msg.usage);

      if (msg.stop_reason === "refusal") {
        throw new GmError("Der Spielleiter möchte diese Szene so nicht erzählen. Versuch es mit einer anderen Handlung.", "refusal");
      }
      history.push({ role: "assistant", content: msg.content as Anthropic.Beta.BetaContentBlockParam[] });
      const toolUse = msg.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (toolUse && msg.stop_reason === "tool_use") {
        if (this.pendingFrom(history, c)) {
          emit({ type: "done", state: signState(this.o.secret, history, characterHash(c)), pending: this.pendingFrom(history, c), budget: await this.o.guard.info() });
          return;
        }
        // Ungültige Anfrage: Claude bekommt einen Fehler zurück und versucht es neu.
        history.push({ role: "user", content: [{ type: "tool_result", tool_use_id: toolUse.id, is_error: true, content: "INVALID_INPUT: Prüfe art, id (aus der Liste), sg (0–30) und modus." }] });
        continue;
      }
      if (toolUse) history.pop(); // abgeschnittener Werkzeugaufruf (max_tokens): nicht übernehmen
      emit({ type: "done", state: signState(this.o.secret, history, characterHash(c)), pending: null, budget: await this.o.guard.info() });
      return;
    }
    throw new GmError("Der Spielleiter hat sich verhaspelt. Bitte versuch es noch einmal.", "api");
  }
}

/** Ergebnis für Claude in Worten – die Zahlen stammen vom Server. */
export function describeRoll(r: RollRecord): string {
  const dice = r.mode === "normal" ? `gewürfelt ${r.values.join(" + ")}` : `zwei W20 (${r.values.join(" und ")}, ${r.mode === "advantage" ? "Vorteil" : "Nachteil"}) – es zählt ${r.natural}`;
  const parts = r.modifierParts.map((p) => `${p.label} ${formatModifier(p.value)}`).join(", ");
  let text = `${r.label}: ${dice}${parts ? `, ${parts}` : ""} = ${r.total}.`;
  if (r.dc !== null) text += ` SG ${r.dc}: ${r.success ? "ERFOLG" : "FEHLSCHLAG"}.`;
  if (r.critical === "hit") text += " Natürliche 20 – kritischer Erfolg!";
  if (r.critical === "fumble") text += " Natürliche 1 – Patzer!";
  if (r.natural === null) text += " (Schadenswurf)";
  return text;
}
