// Gemeinsamer Erzähl-Kern für Solo und Gruppe: Modellaufruf, Werkzeug „probe_anfordern“, Proben würfeln.
// Claude verlangt Proben nur über das Werkzeug; gewürfelt wird ausschließlich hier im Server.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { GmEvent, PendingCheck } from "../../shared/campaign";
import { characterRoll } from "../../shared/character";
import { formatModifier, parseNotation, type RollRecord } from "../../shared/dice";
import type { Character } from "../../shared/schema";
import type { WorldState } from "../../shared/world";
import type { RollLog } from "../dice/log";
import type { GameData } from "../rules/loader";
import { systemPrompt } from "./prompt";
import { costUsd, LimitError, type UsageGuard } from "./usage";
import { applyPlayerRoll, AUTO_TOOLS, autoToolDefs, runAutoTool } from "./world";

export type Message = Anthropic.Beta.BetaMessage;
export type MessageParam = Anthropic.Beta.BetaMessageParam;
type StreamParams = Parameters<Anthropic["beta"]["messages"]["stream"]>[0];

/** Schnittstelle zum Modell – in Tests durch eine Attrappe ersetzbar. */
export interface LlmClient {
  stream(params: StreamParams, onText: (text: string) => void): Promise<Message>;
}

export class AnthropicLlm implements LlmClient {
  private client: Anthropic;
  /** Lehnt die API das Ersatzmodell (fallbacks) ab, wird es für diese Instanz nicht mehr mitgeschickt. */
  private noFallback = false;
  constructor(apiKey: string, options: Omit<NonNullable<ConstructorParameters<typeof Anthropic>[0]>, "apiKey"> = {}) { this.client = new Anthropic({ apiKey, maxRetries: 2, ...options }); }
  async stream(params: StreamParams, onText: (text: string) => void): Promise<Message> {
    if (this.noFallback) params = withoutFallback(params);
    try {
      return await this.once(params, onText);
    } catch (e) {
      // Ein 400 kommt vor der ersten Ausgabe. Liegt es an der Ersatzmodell-Option, geht es ohne sie weiter.
      if (!(e instanceof Anthropic.BadRequestError) || !("fallbacks" in params)) throw e;
      console.warn(`[Claude] Anfrage mit Ersatzmodell abgelehnt (${apiErrorText(e)}) – nächster Versuch ohne.`);
      const result = await this.once(withoutFallback(params), onText);
      this.noFallback = true;
      return result;
    }
  }
  private once(params: StreamParams, onText: (text: string) => void): Promise<Message> {
    const stream = this.client.beta.messages.stream(params);
    stream.on("text", onText);
    return stream.finalMessage();
  }
}

function withoutFallback(params: StreamParams): StreamParams {
  const { fallbacks: _, ...rest } = params as StreamParams & { fallbacks?: unknown };
  const betas = rest.betas?.filter((b) => !String(b).startsWith("server-side-fallback"));
  return { ...rest, betas } as StreamParams;
}

/** Die eigentliche Fehlermeldung der API (z. B. welcher Parameter ungültig ist) – ohne Geheimnisse, gut zum Melden. */
export function apiErrorText(e: unknown): string {
  if (!(e instanceof Anthropic.APIError)) return e instanceof Error ? e.message : String(e);
  const body = e.error as { error?: { message?: string } } | undefined;
  return (body?.error?.message ?? e.message).slice(0, 300);
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
/** Werkzeugstand: Ab 2 gibt es Kampf, Aufträge und Gedächtnis. Ältere Verläufe werden einmalig umgestellt. */
export const TOOLSET = 2;
const MAX_LOOPS = 5;
/** Buchführungs-Werkzeuge: Claude braucht ihr Ergebnis nicht sofort. Ist die Erzählung fertig, gehen die Ergebnisse erst mit der nächsten Handlung zurück – das spart einen ganzen Modellaufruf. */
const QUIET_TOOLS = new Set(["merken", "auftrag", "erfahrung", "kampf_beginnen", "kampf_beenden"]);
const COMPACT_AT = 80_000;
const COMPACT_INSTRUCTIONS =
  "Fasse die bisherige Geschichte auf Deutsch als Text zusammen (kein Werkzeugaufruf). Behalte: alle Figuren und Nichtspielerfiguren mit Namen, Rolle und Haltung zu den Figuren; " +
  "Orte; offene und erledigte Aufträge; Versprechen, Schulden, Geheimnisse und Hinweise; besiegte und noch lebende Gegner; erhaltene und verlorene Gegenstände und Geld; " +
  "den Stand der aktuellen Szene; Ton und Stil der Erzählung. Lebenspunkte stehen ohnehin in jedem <spielstand>.";

/** Nächste Nachricht an Claude: zurückgehaltene Werkzeug-Ergebnisse zuerst, dann der Text. */
export function userTurn(held: ToolResult[], text: string): MessageParam {
  return { role: "user", content: held.length ? [...held, { type: "text", text }] : text };
}

/** Spielstände von vor dem Modell-Merken stammen alle von Opus. */
export const LEGACY_MODEL = "claude-opus-5-5";

/** Entfernt Denkblöcke – nötig, wenn sich Werkzeuge geändert haben (alte Denkblöcke gelten dann nicht mehr). */
export function stripThinking(messages: MessageParam[]): MessageParam[] {
  return messages.map((m) => {
    if (m.role !== "assistant" || typeof m.content === "string") return m;
    const content = m.content.filter((b) => b.type !== "thinking" && b.type !== "redacted_thinking");
    return { ...m, content: content.length ? content : [{ type: "text", text: "…" }] };
  });
}

export class GmError extends Error {
  constructor(message: string, public code: NonNullable<Extract<GmEvent, { type: "error" }>["code"]>) { super(message); }
}

/** Übersetzt Fehler in verständliche Ereignisse für die Oberfläche. */
export function errorEvent(e: unknown): Extract<GmEvent, { type: "error" }> {
  if (e instanceof GmError) return { type: "error", message: e.message, code: e.code };
  if (e instanceof LimitError) return { type: "error", message: e.message, code: e.code };
  if (e instanceof Anthropic.RateLimitError) return { type: "error", message: "Der Spielleiter ist gerade überlastet. Bitte gleich noch einmal versuchen.", code: "api" };
  if (e instanceof Anthropic.AuthenticationError) return { type: "error", message: "Der API-Schlüssel wurde abgelehnt. Bitte ANTHROPIC_API_KEY prüfen.", code: "no_api_key" };
  if (e instanceof Anthropic.BadRequestError) { console.error("[Claude] 400:", apiErrorText(e)); return { type: "error", message: `Claude hat die Anfrage abgelehnt (400): ${apiErrorText(e)}`, code: "api" }; }
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

/** Alles, was ein Zug über die Szene wissen muss. `world` wird von den Werkzeugen verändert. */
export interface Scene {
  characters: Character[];
  data: GameData;
  world: WorldState;
  onRoll: (record: RollRecord) => void;
}

export type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;

export interface ConverseResult {
  history: MessageParam[];
  pending: PendingCheck | null;
  /** Ergebnisse der übrigen Werkzeuge aus derselben Antwort wie die Probe – gehen mit dem Wurf zurück. */
  held: ToolResult[];
  costUsd: number;
  /** Verbrauchte Tokens aller Aufrufe dieses Zugs (Eingabe inkl. Cache). */
  usage: { input: number; output: number };
}

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
        "Im Kampf gib bei attack und damage den Gegner in ziel an – dann gilt seine Rüstung als SG und der Schaden wird ihm abgezogen. " +
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
          ziel: { type: "string", description: "Nur im Kampf bei attack/damage: Name des Gegners" },
        },
        required: [...(party ? ["figur"] : []), "art", "id", "sg", "modus", "grund"],
      },
    }, ...autoToolDefs(characters)];
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
      ziel: z.string().max(60).optional(),
    }).refine((v) => (v.art === "attribute" ? data.rules.attributes.some((a) => a.id === v.id) : v.art === "skill" ? data.rules.skills.some((s) => s.id === v.id) : v.id === "waffe"));
  }

  /** Macht aus einem Werkzeugaufruf eine offene Probe – oder null, wenn er ungültig ist. */
  private pendingFor(block: { id: string; input: unknown }, characters: Character[], data: GameData, world: WorldState | null): PendingCheck | null {
    const parsed = this.toolInput(data).safeParse(block.input);
    if (!parsed.success) return null;
    const v = parsed.data;
    const c = characters.length === 1 ? characters[0] : characters.find((x) => x.name === v.figur);
    if (!c) return null;
    const spec = characterRoll(c, data.rules, data.classes, v.art, v.id);
    const enemy = (v.art === "attack" || v.art === "damage") && v.ziel
      ? world?.combat?.enemies.find((e) => e.hp > 0 && e.name.toLowerCase() === v.ziel!.trim().toLowerCase()) : undefined;
    return {
      toolUseId: block.id, characterId: c.id, characterName: c.name,
      art: v.art, id: v.id, sg: spec.d20 ? (enemy && v.art === "attack" ? enemy.armor : v.sg) : null,
      modus: spec.d20 ? v.modus : "normal", grund: v.grund, label: spec.label, ziel: enemy?.name ?? null,
    };
  }

  /** Liest die offene Probe aus der letzten Spielleiter-Nachricht. */
  pendingFrom(messages: MessageParam[], characters: Character[], data: GameData, world: WorldState | null = null): PendingCheck | null {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant" || typeof last.content === "string") return null;
    const block = last.content.find((b): b is Anthropic.Beta.BetaToolUseBlockParam => b.type === "tool_use" && b.name === TOOL_NAME);
    return block ? this.pendingFor(block, characters, data, world) : null;
  }

  /**
   * Würfelt die offene Probe und verrechnet sie im Kampf. Die Wurf-ID hängt an der Probe – erneutes Senden liefert denselben Wurf.
   * `content` ist die nächste Nachricht an Claude: zurückgehaltene Werkzeug-Ergebnisse plus das Probenergebnis.
   */
  async rollPending(pending: PendingCheck, scene: Omit<Scene, "onRoll">, held: ToolResult[] = []): Promise<{ record: RollRecord; content: ToolResult[] }> {
    const { characters, data, world } = scene;
    const c = characters.find((x) => x.id === pending.characterId)!;
    const spec = characterRoll(c, data.rules, data.classes, pending.art, pending.id);
    let notation = spec.notation;
    if (pending.art === "damage" && world.critPending[c.id]) {
      const p = parseNotation(notation);
      notation = `${p.terms[0].count * 2}W${p.terms[0].sides}${p.modifier ? (p.modifier > 0 ? `+${p.modifier}` : String(p.modifier)) : ""}`;
    }
    const record = await this.o.rolls.roll({
      requestId: `gm-${pending.toolUseId.replace(/[^A-Za-z0-9-]/g, "-")}`.slice(0, 64),
      kind: "check",
      label: `${c.name}: ${spec.label}${notation !== spec.notation ? " (kritisch)" : ""}`,
      notation,
      mode: pending.modus,
      modifierParts: spec.parts,
      dc: pending.sg,
    });
    const text = describeRoll(record) + applyPlayerRoll({ data, characters, world }, c.id, pending.art, pending.ziel ?? null, record);
    return { record, content: [...held, { type: "tool_result", tool_use_id: pending.toolUseId, content: text }] };
  }

  /** Erzählt weiter, bis Claude fertig ist oder eine Probe verlangt. Sofort-Werkzeuge werden dabei ausgeführt. */
  /**
   * `compact: false` schaltet die automatische Zusammenfassung ab – nötig, wenn der Aufrufer nur Text speichert
   * (OpenAI-Schnittstelle): Ohne gespeicherten Zusammenfassungs-Block würde sie bei jeder Anfrage neu laufen.
   */
  async converse(messages: MessageParam[], scene: Scene, who: string, onText: (text: string) => void, opts: { compact?: boolean } = {}): Promise<ConverseResult> {
    const compact = opts.compact !== false;
    const { characters, data, world } = scene;
    const history = [...messages];
    const base = requestBase(this.model, this.o.effort ?? "low");
    let cost = 0;
    const usage = { input: 0, output: 0 };
    for (let loop = 0; loop < MAX_LOOPS; loop++) {
      await this.o.guard.check(who);
      const msg = await this.o.llm!.stream({
        ...base,
        betas: [...(base.betas ?? []), ...(compact ? ["compact-2026-01-12"] : [])],
        max_tokens: 8000,
        cache_control: CACHE_1H,
        system: [{ type: "text", text: systemPrompt(data), cache_control: CACHE_1H }],
        tools: this.tools(data, characters),
        tool_choice: { type: "auto" },
        ...(compact ? { context_management: { edits: [{ type: "compact_20260112" as const, trigger: { type: "input_tokens" as const, value: COMPACT_AT }, instructions: COMPACT_INSTRUCTIONS }] } } : {}),
        messages: history,
      }, onText);
      const c = costUsd(msg.usage, this.model);
      cost += c;
      await this.o.guard.record(msg.usage, this.model);
      const u = msg.usage;
      usage.input += u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      usage.output += u.output_tokens;
      const compacted = (u.iterations ?? []).some((i) => i.type === "compaction");
      console.log(`[Kosten] ${this.model}: Eingabe ${u.input_tokens}, Cache gelesen ${u.cache_read_input_tokens ?? 0}, Cache geschrieben ${u.cache_creation_input_tokens ?? 0}, Ausgabe ${u.output_tokens} (davon Denken ${u.output_tokens_details?.thinking_tokens ?? "?"})${compacted ? ", mit Zusammenfassung" : ""} → ${(c * 100).toFixed(2)} ct`);

      if (msg.stop_reason === "refusal") throw new GmError("Der Spielleiter möchte diese Szene so nicht erzählen. Versuch es mit einer anderen Handlung.", "refusal");
      history.push({ role: "assistant", content: msg.content as Anthropic.Beta.BetaContentBlockParam[] });
      const uses = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (uses.length && msg.stop_reason === "tool_use") {
        const results: ToolResult[] = [];
        let pending: PendingCheck | null = null;
        for (const b of uses) {
          if (b.name === TOOL_NAME) {
            const p: PendingCheck | null = pending ? null : this.pendingFor(b, characters, data, world);
            if (p) pending = p;
            else results.push({ type: "tool_result", tool_use_id: b.id, is_error: true, content: pending ? "Nur eine Probe gleichzeitig – verlange die nächste nach dem Ergebnis." : "INVALID_INPUT: Prüfe figur, art, id (aus der Liste), sg (0–30) und modus." });
          } else if ((AUTO_TOOLS as readonly string[]).includes(b.name)) {
            results.push({ type: "tool_result", tool_use_id: b.id, ...(await runAutoTool(b, { data, characters, world, rolls: this.o.rolls, onRoll: scene.onRoll })) });
          } else {
            results.push({ type: "tool_result", tool_use_id: b.id, is_error: true, content: "Unbekanntes Werkzeug." });
          }
        }
        if (pending) return { history, pending, held: results, costUsd: cost, usage };
        const told = msg.content.some((b) => b.type === "text" && /»\s*Vorschläge:/.test(b.text));
        if (told && uses.every((b) => QUIET_TOOLS.has(b.name)) && results.every((r) => !r.is_error)) return { history, pending: null, held: results, costUsd: cost, usage };
        history.push({ role: "user", content: results });
        continue;
      }
      if (uses.length) history.pop(); // abgeschnittener Werkzeugaufruf (max_tokens): nicht übernehmen
      return { history, pending: null, held: [], costUsd: cost, usage };
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
