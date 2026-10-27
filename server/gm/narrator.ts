// Gemeinsamer Erzähl-Kern für Solo und Gruppe: Modellaufruf, Werkzeug „probe_anfordern“, Proben würfeln.
// Claude verlangt Proben nur über das Werkzeug; gewürfelt wird ausschließlich hier im Server.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { GmEvent, PendingCheck } from "../../shared/campaign";
import { characterRoll } from "../../shared/character";
import { formatModifier, type RollRecord } from "../../shared/dice";
import type { Character } from "../../shared/schema";
import type { RollLog } from "../dice/log";
import type { GameData } from "../rules/loader";
import { systemPrompt } from "./prompt";
import { costUsd, LimitError, type UsageGuard } from "./usage";

export type Message = Anthropic.Beta.BetaMessage;
export type MessageParam = Anthropic.Beta.BetaMessageParam;
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

export const MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] as const;
export type ModelId = (typeof MODELS)[number];

/** Gemeinsame Anfrage-Einstellungen: Modell, Denktiefe, Ersatzmodell bei Ablehnung, Cache 1 Stunde. */
export function requestBase(model: ModelId, effort: "low" | "medium" | "high") {
  // Server-seitiges Ersatzmodell gibt es für Opus und Sonnet, nicht für Haiku.
  const fallback = model === "claude-haiku-5-5" ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };
  return { model, output_config: { effort }, ...fallback };
}

/** Ein Cache-Eintrag hält eine Stunde: Wer länger überlegt, zahlt trotzdem nur den günstigen Lesepreis. */
export const CACHE_1H = { type: "ephemeral" as const, ttl: "1h" as const };

export const TOOL_NAME = "probe_anfordern";
const MAX_LOOPS = 3;

export class GmError extends Error {
  constructor(message: string, public code: NonNullable<Extract<GmEvent, { type: "error" }>["code"]>) { super(message); }
}

/** Übersetzt Fehler in verständliche Ereignisse für die Oberfläche. */
export function errorEvent(e: unknown): Extract<GmEvent, { type: "error" }> {
  if (e instanceof GmError) return { type: "error", message: e.message, code: e.code };
  if (e instanceof LimitError) return { type: "error", message: e.message, code: e.code };
  if (e instanceof Anthropic.RateLimitError) return { type: "error", message: "Der Spielleiter ist gerade überlastet. Bitte gleich noch einmal versuchen.", code: "api" };
  if (e instanceof Anthropic.AuthenticationError) return { type: "error", message: "Der API-Schlüssel wurde abgelehnt. Bitte ANTHROPIC_API_KEY prüfen.", code: "no_api_key" };
  if (e instanceof Anthropic.APIError) return { type: "error", message: `Fehler bei der Verbindung zum Spielleiter (${e.status ?? "Netzwerk"}). Bitte erneut versuchen.`, code: "api" };
  console.error(e);
  return { type: "error", message: "Unerwarteter Fehler beim Erzählen.", code: "api" };
}

export interface NarratorOptions {
  llm: LlmClient | null;
  rolls: RollLog;
  guard: UsageGuard;
  model?: ModelId;
  effort?: "low" | "medium" | "high";
}

export interface ConverseResult { history: MessageParam[]; pending: PendingCheck | null; costUsd: number }

export class Narrator {
  constructor(private o: NarratorOptions) {}

  get model(): ModelId { return this.o.model ?? "claude-opus-5-5"; }

  ensureReady() {
    if (!this.o.llm) throw new GmError("Kein API-Schlüssel hinterlegt. Trage ANTHROPIC_API_KEY ein (lokal in .env, online in den Netlify-Umgebungsvariablen).", "no_api_key");
  }

  /** In der Gruppe muss Claude sagen, welche Figur würfelt. */
  private tools(data: GameData, characters: Character[]): Anthropic.Beta.BetaTool[] {
    const ids = [...data.rules.attributes.map((a) => a.id), ...data.rules.skills.map((s) => s.id), "waffe"];
    const party = characters.length > 1;
    return [{
      name: TOOL_NAME,
      description:
        `Verlangt von ${party ? "einer Spielfigur" : "der Spielfigur"} eine Probe. Der Server würfelt fair, sobald die Person auf „Würfeln“ klickt, und liefert dir das Ergebnis. ` +
        "art: attribute (reine Attributsprobe), skill (Fertigkeit), attack (Waffenangriff, id = waffe), damage (Waffenschaden, id = waffe, sg = 0). " +
        "Attribute: " + data.rules.attributes.map((a) => `${a.id} (${a.name})`).join(", ") + ". " +
        "Fertigkeiten: " + data.rules.skills.map((s) => `${s.id} (${s.name})`).join(", ") + ".",
      eager_input_streaming: true,
      input_schema: {
        type: "object",
        properties: {
          ...(party ? { figur: { type: "string", enum: characters.map((c) => c.name), description: "Wer würfelt" } } : {}),
          art: { type: "string", enum: ["attribute", "skill", "attack", "damage"] },
          id: { type: "string", enum: ids },
          sg: { type: "integer", description: "Schwierigkeitsgrad 5–25; bei damage 0" },
          modus: { type: "string", enum: ["normal", "advantage", "disadvantage"] },
          grund: { type: "string", description: "Ein kurzer Satz, warum gewürfelt wird – wird der Person angezeigt" },
        },
        required: [...(party ? ["figur"] : []), "art", "id", "sg", "modus", "grund"],
      },
    }];
  }

  private toolInput(data: GameData) {
    const ids = new Set([...data.rules.attributes.map((a) => a.id), ...data.rules.skills.map((s) => s.id), "waffe"]);
    return z.object({
      figur: z.string().optional(),
      art: z.enum(["attribute", "skill", "attack", "damage"]),
      id: z.string().refine((x) => ids.has(x)),
      sg: z.number().int().min(0).max(30),
      modus: z.enum(["normal", "advantage", "disadvantage"]),
      grund: z.string().min(1).max(300),
    }).refine((v) => (v.art === "attribute" ? data.rules.attributes.some((a) => a.id === v.id) : v.art === "skill" ? data.rules.skills.some((s) => s.id === v.id) : v.id === "waffe"));
  }

  /** Liest die offene Probe aus der letzten Spielleiter-Nachricht. */
  pendingFrom(messages: MessageParam[], characters: Character[], data: GameData): PendingCheck | null {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant" || typeof last.content === "string") return null;
    const block = last.content.find((b): b is Anthropic.Beta.BetaToolUseBlockParam => b.type === "tool_use" && b.name === TOOL_NAME);
    if (!block) return null;
    const parsed = this.toolInput(data).safeParse(block.input);
    if (!parsed.success) return null;
    const v = parsed.data;
    const c = characters.length === 1 ? characters[0] : characters.find((x) => x.name === v.figur);
    if (!c) return null;
    const spec = characterRoll(c, data.rules, data.classes, v.art, v.id);
    return {
      toolUseId: block.id, characterId: c.id, characterName: c.name,
      art: v.art, id: v.id, sg: spec.d20 ? v.sg : null, modus: spec.d20 ? v.modus : "normal", grund: v.grund, label: spec.label,
    };
  }

  /** Würfelt die offene Probe. Die Wurf-ID hängt an der Probe – erneutes Senden liefert denselben Wurf. */
  async rollPending(pending: PendingCheck, characters: Character[], data: GameData): Promise<{ record: RollRecord; result: Anthropic.Beta.BetaToolResultBlockParam }> {
    const c = characters.find((x) => x.id === pending.characterId)!;
    const spec = characterRoll(c, data.rules, data.classes, pending.art, pending.id);
    const record = await this.o.rolls.roll({
      requestId: `gm-${pending.toolUseId.replace(/[^A-Za-z0-9-]/g, "-")}`.slice(0, 64),
      kind: "check",
      label: `${c.name}: ${spec.label}`,
      notation: spec.notation,
      mode: pending.modus,
      modifierParts: spec.parts,
      dc: pending.sg,
    });
    return { record, result: { type: "tool_result", tool_use_id: pending.toolUseId, content: describeRoll(record) } };
  }

  /** Erzählt weiter, bis Claude fertig ist oder eine Probe verlangt. */
  async converse(messages: MessageParam[], characters: Character[], data: GameData, who: string, onText: (text: string) => void): Promise<ConverseResult> {
    const history = [...messages];
    let cost = 0;
    for (let loop = 0; loop < MAX_LOOPS; loop++) {
      await this.o.guard.check(who);
      const msg = await this.o.llm!.stream({
        ...requestBase(this.model, this.o.effort ?? "low"),
        max_tokens: 8000,
        cache_control: CACHE_1H,
        system: [{ type: "text", text: systemPrompt(data), cache_control: CACHE_1H }],
        tools: this.tools(data, characters),
        tool_choice: { type: "auto", disable_parallel_tool_use: true },
        messages: history,
      }, onText);
      const c = costUsd(msg.usage, this.model);
      cost += c;
      await this.o.guard.record(msg.usage, this.model);
      const u = msg.usage;
      console.log(`[Kosten] ${this.model}: Eingabe ${u.input_tokens}, Cache gelesen ${u.cache_read_input_tokens ?? 0}, Cache geschrieben ${u.cache_creation_input_tokens ?? 0}, Ausgabe ${u.output_tokens} → ${(c * 100).toFixed(2)} ct`);

      if (msg.stop_reason === "refusal") throw new GmError("Der Spielleiter möchte diese Szene so nicht erzählen. Versuch es mit einer anderen Handlung.", "refusal");
      history.push({ role: "assistant", content: msg.content as Anthropic.Beta.BetaContentBlockParam[] });
      const toolUse = msg.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (toolUse && msg.stop_reason === "tool_use") {
        const pending = this.pendingFrom(history, characters, data);
        if (pending) return { history, pending, costUsd: cost };
        // Ungültige Anfrage: Claude bekommt einen Fehler zurück und versucht es neu.
        history.push({ role: "user", content: [{ type: "tool_result", tool_use_id: toolUse.id, is_error: true, content: "INVALID_INPUT: Prüfe figur, art, id (aus der Liste), sg (0–30) und modus." }] });
        continue;
      }
      if (toolUse) history.pop(); // abgeschnittener Werkzeugaufruf (max_tokens): nicht übernehmen
      return { history, pending: null, costUsd: cost };
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
