// Gemeinsamer Erzähl-Kern für Solo und Gruppe: Modellaufruf, Werkzeug „probe_anfordern“, Proben würfeln.
// Claude verlangt Proben nur über das Werkzeug; gewürfelt wird ausschließlich hier im Server.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { splitSuggestions, type GmEvent, type PendingCheck, type SceneImage } from "../../shared/campaign";
import type { ImageMaker } from "../images";
import { characterRoll } from "../../shared/character";
import { formatModifier, parseNotation, type RollRecord } from "../../shared/dice";
import type { Character } from "../../shared/schema";
import { currentChapter, type WorldState } from "../../shared/world";
import type { RollLog } from "../dice/log";
import type { GameData } from "../rules/loader";
import { systemPrompt } from "./prompt";
import { costUsd, LimitError, type UsageGuard } from "./usage";
import { applyPlayerRoll, AUTO_TOOLS, autoToolDefs, runAutoTool } from "./world";
import { ensureInventory } from "../../shared/inventory";
import { gearOf } from "../../shared/shop";

export type Message = Anthropic.Beta.BetaMessage;
export type MessageParam = Anthropic.Beta.BetaMessageParam;
type StreamParams = Parameters<Anthropic["beta"]["messages"]["stream"]>[0];

/** Schnittstelle zum Modell – in Tests durch eine Attrappe ersetzbar. */
export interface LlmClient {
  /** `signal` bricht den Aufruf ab (Zeitlimit des Zugs). */
  stream(params: StreamParams, onText: (text: string) => void, signal?: AbortSignal): Promise<Message>;
}

export class AnthropicLlm implements LlmClient {
  private client: Anthropic;
  /** Lehnt die API das Ersatzmodell (fallbacks) ab, wird es für diese Instanz nicht mehr mitgeschickt. */
  private noFallback = false;
  constructor(apiKey: string, options: Omit<NonNullable<ConstructorParameters<typeof Anthropic>[0]>, "apiKey"> = {}) { this.client = new Anthropic({ apiKey, maxRetries: 2, ...options }); }
  async stream(params: StreamParams, onText: (text: string) => void, signal?: AbortSignal): Promise<Message> {
    if (this.noFallback) params = withoutFallback(params);
    try {
      return await this.once(params, onText, signal);
    } catch (e) {
      // Ein 400 kommt vor der ersten Ausgabe. Liegt es an der Ersatzmodell-Option, geht es ohne sie weiter.
      if (!(e instanceof Anthropic.BadRequestError) || !("fallbacks" in params)) throw e;
      console.warn(`[Claude] Anfrage mit Ersatzmodell abgelehnt (${apiErrorText(e)}) – nächster Versuch ohne.`);
      const result = await this.once(withoutFallback(params), onText, signal);
      this.noFallback = true;
      return result;
    }
  }
  private once(params: StreamParams, onText: (text: string) => void, signal?: AbortSignal): Promise<Message> {
    const stream = this.client.beta.messages.stream(params, { signal });
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
/** Werkzeugstand: 2 = Kampf, Aufträge, Gedächtnis; 3 = Kampagne in Akten und Kapiteln; 4 = Stufen; 5 = Niederlage; 6 = sichtbarer Kernauftrag; 7 = Fähigkeiten zählen; 8 = Schaden automatisch, Gegnerzug nach den Würfen; 9 = wieder eine Probe gleichzeitig; 10 = Gegnerzug vorab nur noch im Solo; 11 = Tageszeit und Wetter; 12 = Inventar und Geld; 13 = Händler und Schmied; 14 = Personenverzeichnis; 15 = Karte. Ältere Verläufe werden einmalig umgestellt. */
export const TOOLSET = 16;
const MAX_LOOPS = 5;
/**
 * Zeitbudget eines Zugs. Netlify bricht Funktionen nach 60 Sekunden hart ab – dann bliebe die Gruppe „gesperrt“.
 * Darum: nach TURN_BUDGET_MS wird abgebrochen (sauberer Fehler), und ein weiterer Modellaufruf beginnt nur, wenn noch MIN_CALL_MS übrig sind.
 */
export const TURN_BUDGET_MS = 50_000;
/** Gelände je Ortsart für den gemalten Kartenhintergrund. */
const MAP_TERRAIN: Record<string, string> = { dorf: "small villages", stadt: "a walled town", burg: "a castle on a hill", kloster: "a monastery", wald: "dense forests", hoehle: "rocky caves", ruine: "ancient ruins", gasthaus: "a roadside inn", fluss: "a winding river with a bridge", berg: "mountains" };
/** Beta für die Steuerung, was mit nicht mehr passenden Denkblöcken passiert. */
const THINKING_BINDING_BETA = "thinking-binding-controls-2026-08-01";
/** Kleines Modell für Bildbeschreibungen. */
const IMAGE_PROMPT_MODEL: ModelId = "claude-haiku-5-5";
/** Kapitelmarke: ändert sie sich in einem Zug, hat ein neues Kapitel (oder die Kampagne) begonnen. */
export const chapterMark = (w: WorldState) => (w.arc?.plan ? `${w.arc.current}:${w.arc.chapters[w.arc.current]?.titel ?? ""}` : "");
const MIN_CALL_MS = 15_000;
/** Buchführungs-Werkzeuge: Claude braucht ihr Ergebnis nicht sofort. Ist die Erzählung fertig, gehen die Ergebnisse erst mit der nächsten Handlung zurück – das spart einen ganzen Modellaufruf. */
const QUIET_TOOLS = new Set(["bild", "ort", "person", "laden", "gegenstand", "geld", "zeit", "faehigkeit_einsetzen", "merken", "auftrag", "erfahrung", "kampf_beginnen", "kampf_beenden", "kampagne_planen", "kapitel_abschliessen", "abzweigung", "abenteuer_beenden"]);
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
  /** Zeitbudget je Zug (Tests setzen es kürzer). */
  turnBudgetMs?: number;
  /** Bilder über fal.ai (ohne FAL_KEY: keine Bilder). */
  images?: ImageMaker;
}

/** Alles, was ein Zug über die Szene wissen muss. `world` wird von den Werkzeugen verändert. */
export interface Scene {
  characters: Character[];
  data: GameData;
  world: WorldState;
  onRoll: (record: RollRecord) => void;
  /** Ein Szenenbild ist fertig (Werkzeug bild). */
  onImage?: (img: SceneImage) => void;
}

export type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;

export interface ConverseResult {
  history: MessageParam[];
  /** Erste offene Probe (Solo: die einzige). */
  pending: PendingCheck | null;
  /** Alle offenen Proben – in der Gruppe höchstens eine pro Figur, gewürfelt wird gleichzeitig. */
  pendings: PendingCheck[];
  /** Ergebnisse der übrigen Werkzeuge aus derselben Antwort wie die Probe – gehen mit dem Wurf zurück. */
  held: ToolResult[];
  /** Kosten der Claude-Aufrufe dieses Zugs. */
  costUsd: number;
  /** Kosten der gemalten Bilder dieses Zugs (fal.ai). */
  imageUsd: number;
  /** Hat Claude in diesem Zug ein Bild bestellt? */
  painted: boolean;
  /** Verbrauchte Tokens aller Aufrufe dieses Zugs (Eingabe inkl. Cache). */
  usage: { input: number; output: number };
}

export class Narrator {
  constructor(private o: NarratorOptions) {}

  get model(): ModelId { return this.o.model ?? "claude-opus-5-5"; }

  /**
   * Am Anfang der Kampagne und jedes Kapitels, bei jedem Ortswechsel sowie am Ende jedes Kampfes ein Szenenbild, falls Claude keines bestellt hat (Beschreibung von Claude Haiku
   * aus der Erzählung) – sonst entscheidet Claude. Dazu einmal je Kampagne ein gemalter Kartenhintergrund. Beides läuft gleichzeitig.
   */
  async imageIfDue(o: { mark: string; first: boolean; painted: boolean; narration: string; scene: Scene; wasFighting?: boolean; placeBefore?: string | null }): Promise<{ imageUsd: number; claudeUsd: number }> {
    const { world } = o.scene;
    if (!this.o.images?.ready) return { imageUsd: 0, claudeUsd: 0 };
    const newChapter = o.first || (chapterMark(world) !== "" && chapterMark(world) !== o.mark);
    // Ende eines Kampfes: immer ein Bild vom Ausgang
    const fightOver = !!o.wasFighting && !world.combat;
    // Ortswechsel (Claude hat mit ort einen anderen Ort gemeldet): Bild vom neuen Ort
    const moved = o.placeBefore !== undefined && !!world.map?.current && world.map.current !== o.placeBefore;
    const due = !o.painted && !world.arc?.finished && o.narration.trim().length >= 40 && (newChapter || fightOver || moved);
    const [scene, map] = await Promise.all([
      due ? this.autoScene(o) : Promise.resolve({ imageUsd: 0, claudeUsd: 0 }),
      this.mapBackground(world),
    ]);
    return { imageUsd: scene.imageUsd + map, claudeUsd: scene.claudeUsd };
  }

  private async autoScene(o: { mark: string; first: boolean; narration: string; scene: Scene }): Promise<{ imageUsd: number; claudeUsd: number }> {
    const { world } = o.scene;
    const story = o.narration.split("»")[0];
    // Neues Kapitel (oder Kampagnenstart): Kapiteltitel als Bildunterschrift
    const now = chapterMark(world);
    const ch = world.arc ? currentChapter(world.arc) : null;
    let caption = o.first ? ch?.titel ?? "Der Anfang" : now !== "" && now !== o.mark ? ch?.titel ?? "" : "";
    let claudeUsd = 0, motif = story.trim().slice(0, 900);
    if (this.o.llm) {
      try {
        const msg = await this.o.llm.stream({
          ...requestBase(IMAGE_PROMPT_MODEL, "low"),
          max_tokens: 400,
          system: [{ type: "text", text: "You write prompts for an image model that paints scenes of a medieval role-playing game (Holy Roman Empire, around 1400). From the German narration, pick the most striking moment and answer in exactly two lines (keep the picture simple: one clear focal point, at most two or three figures, no crowds):\nCAPTION: a German caption of 2–5 words\nPROMPT: 2–4 English sentences describing it as one picture – place, light, weather, time of day, important figures with appearance and clothing, mood. No names, no text, no style instructions." }],
          messages: [{ role: "user", content: `${world.time ? `Time: ${world.time.phase}, weather: ${world.time.weather}.\n` : ""}Narration:\n${story.slice(-3000)}` }],
        }, () => {}, AbortSignal.timeout(15_000));
        await this.o.guard.record(msg.usage, IMAGE_PROMPT_MODEL);
        claudeUsd = costUsd(msg.usage, IMAGE_PROMPT_MODEL);
        const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
        const p = text.match(/PROMPT:\s*([\s\S]+)/i)?.[1]?.trim() ?? (/CAPTION:/i.test(text) ? "" : text);
        if (p.length >= 40) motif = p;
        if (!caption) caption = text.match(/CAPTION:\s*(.+)/i)?.[1]?.trim().replace(/^["„“]|["“”]$/g, "").slice(0, 60) ?? "";
      } catch (e) { console.error("[Bilder] Bildbeschreibung fehlgeschlagen:", (e as Error).message); }
    }
    try {
      const { url, costUsd: imageUsd } = await this.o.images!.make(motif, "landscape_4_3");
      await this.o.guard.addUsd(imageUsd);
      o.scene.onImage?.({ url, caption });
      return { imageUsd, claudeUsd };
    } catch (e) {
      console.error("[Bilder]", (e as Error).message);
      return { imageUsd: 0, claudeUsd };
    }
  }

  /** Kartenhintergrund: einmal je Kampagne, sobald es Orte gibt – eine alte, gemalte Landkarte der Gegend (ohne Schrift). */
  private async mapBackground(world: WorldState): Promise<number> {
    const map = world.map;
    if (!map?.places.length || map.bg) return 0;
    const kinds = [...new Set(map.places.map((p) => p.kind))];
    const terrain = kinds.map((k) => MAP_TERRAIN[k]).filter(Boolean).join(", ");
    try {
      const { url, costUsd: usd } = await this.o.images!.make(
        `Top-down antique hand-painted map of a medieval central European countryside: ${terrain || "forests, hills, a river and small villages"}, winding dirt roads between them. Dark aged parchment in deep brown and sepia tones, faded ink and watercolour, strong dark vignette towards the edges, worn and stained. No text, no labels, no letters, no compass rose, no border.`,
        "square", undefined, { style: false });
      map.bg = url;
      await this.o.guard.addUsd(usd);
      return usd;
    } catch (e) {
      console.error("[Bilder] Kartenhintergrund:", (e as Error).message);
      return 0;
    }
  }

  /** Werkzeug bild: malen, speichern, den Spielern zeigen. Fehler beenden den Zug nicht – Claude erfährt sie als Text. */
  private async paint(b: Anthropic.Beta.BetaToolUseBlock, scene: Scene): Promise<{ costUsd: number } | string> {
    const images = this.o.images;
    if (!images?.ready) return "Bilder sind auf dieser Seite nicht eingerichtet – rufe bild nicht mehr auf.";
    const input = (b.input ?? {}) as { motiv?: unknown; titel?: unknown };
    const motif = typeof input.motiv === "string" ? input.motiv : "";
    if (motif.trim().length < 10) return "Bitte beschreibe das Motiv (motiv) in 1–3 englischen Sätzen.";
    try {
      const { url, costUsd } = await images.make(motif, "landscape_4_3");
      await this.o.guard.addUsd(costUsd);
      scene.onImage?.({ url, caption: typeof input.titel === "string" ? input.titel.trim().slice(0, 80) : "" });
      return { costUsd };
    } catch (e) {
      console.error("[Bilder]", (e as Error).message);
      return `Das Bild konnte nicht gemalt werden (${(e as Error).message}). Erzähle einfach weiter.`;
    }
  }

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
        "art: attribute (reine Attributsprobe), skill (Fertigkeit), attack (Waffenangriff, id = waffe), damage (Waffenschaden, id = waffe, sg = 0 – nur außerhalb eines Treffers gegen einen Gegner). " +
        "Im Kampf gib bei attack den Gegner in ziel an – dann gilt seine Rüstung als SG, und bei einem Treffer würfelt der Server den Schaden gleich mit und zieht ihn ab. " +
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
    }, ...autoToolDefs(characters), {
      name: "bild",
      description: "Zeigt den Spielern ein gemaltes Bild der Szene (dauert ein paar Sekunden). Vor allem dafür da, dass sich die Spieler die Orte vorstellen können: Rufe es bei JEDEM Szenen- oder Ortswechsel auf – wenn die Figuren an einem anderen Ort ankommen (Dorf, Burg, Wald, Moor, Kloster, Gasthaus, Höhle …), auch beim Wechsel von drinnen nach draußen oder wenn eine Reise endet. Zeige den neuen Ort selbst, seine Atmosphäre, Licht, Wetter und Tageszeit. Außerdem bei der ersten Antwort, wenn ein Kapitel beginnt und am Ende eines Kampfes. Sonst nur bei wirklich besonderen Momenten; du entscheidest. Höchstens eins pro Antwort.",
      input_schema: {
        type: "object",
        properties: {
          motiv: { type: "string", description: "Bildbeschreibung auf ENGLISCH, 1–3 Sätze: ein klarer Bildmittelpunkt mit höchstens zwei bis drei Figuren (Aussehen, Kleidung, Haltung), dazu Ort, Licht, Wetter, Tageszeit und Stimmung. Keine Menschenmengen, keine Namen, keine Schrift. Den Malstil legt der Server fest." },
          titel: { type: "string", description: "Bildunterschrift auf Deutsch, 2–6 Wörter" },
        },
        required: ["motiv", "titel"],
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
   * Würfelt eine offene Probe. Trifft ein Angriff einen Gegner, würfelt der Server den Schaden gleich mit (spart einen ganzen
   * Modellaufruf). Die Wurf-IDs hängen an der Probe – erneutes Senden liefert dieselben Würfe. Verbucht wird mit applyRolls.
   */
  async rollRecords(pending: PendingCheck, scene: Omit<Scene, "onRoll">): Promise<{ record: RollRecord; damage: RollRecord | null }> {
    const { characters, data, world } = scene;
    const c = characters.find((x) => x.id === pending.characterId)!;
    const base = `gm-${pending.toolUseId.replace(/[^A-Za-z0-9-]/g, "-")}`.slice(0, 60);
    const record = await this.rollCheck(c, data, pending.art, pending.id, base, pending.modus, pending.sg, pending.art === "damage" && !!world.critPending[c.id], world);
    const damage = pending.art === "attack" && pending.ziel && record.success
      ? await this.rollCheck(c, data, "damage", "waffe", `${base}-d`, "normal", null, record.critical === "hit", world) : null;
    return { record, damage };
  }

  /** Würfe im Spielstand verbuchen (Gegner-TP) und das Ergebnis für Claude formulieren. Synchron – passt in eine gesperrte Änderung. */
  applyRolls(pending: PendingCheck, scene: Omit<Scene, "onRoll">, record: RollRecord, damage: RollRecord | null): { result: ToolResult; extra: RollRecord[] } {
    const { characters, data, world } = scene;
    const ctx = { data, characters, world };
    let text = describeRoll(record) + applyPlayerRoll(ctx, pending.characterId, pending.art, pending.ziel ?? null, record);
    const extra: RollRecord[] = [];
    const enemy = damage && world.combat?.enemies.find((e) => e.name === pending.ziel && e.hp > 0);
    if (damage && enemy) {
      extra.push(damage);
      text += ` Schaden: ${describeRoll(damage)}${applyPlayerRoll(ctx, pending.characterId, "damage", enemy.name, damage)}`;
    }
    return { result: { type: "tool_result", tool_use_id: pending.toolUseId, content: text }, extra };
  }

  async rollOne(pending: PendingCheck, scene: Omit<Scene, "onRoll">): Promise<{ record: RollRecord; extra: RollRecord[]; result: ToolResult }> {
    const { record, damage } = await this.rollRecords(pending, scene);
    return { record, ...this.applyRolls(pending, scene, record, damage) };
  }

  private rollCheck(c: Character, data: GameData, art: PendingCheck["art"], id: string, requestId: string, mode: PendingCheck["modus"], dc: number | null, crit: boolean, world?: WorldState) {
    const spec = characterRoll(c, data.rules, data.classes, art, id);
    // Verbesserungen vom Schmied zählen mit
    const g = gearOf(world, c.id);
    const extra = art === "attack" ? g.angriff : art === "damage" ? g.schaden : 0;
    if (extra) spec.parts = [...spec.parts, { label: "Schmied", value: extra }];
    let notation = spec.notation;
    if (art === "damage" && crit) {
      const p = parseNotation(notation);
      notation = `${p.terms[0].count * 2}W${p.terms[0].sides}${p.modifier ? (p.modifier > 0 ? `+${p.modifier}` : String(p.modifier)) : ""}`;
    }
    return this.o.rolls.roll({
      requestId, kind: "check",
      label: `${c.name}: ${spec.label}${notation !== spec.notation ? " (kritisch)" : ""}`,
      notation, mode, modifierParts: spec.parts, dc,
    });
  }

  /**
   * Gegnerangriffe, die Claude zusammen mit den Proben angesagt hat: Der Server wertet sie erst aus, nachdem alle gewürfelt haben
   * (besiegte Gegner greifen nicht mehr an). So erzählt Claude die ganze Runde in einem einzigen Aufruf.
   */
  async enemyTurn(messages: MessageParam[], scene: Scene): Promise<ToolResult[]> {
    const last = [...messages].reverse().find((m) => m.role === "assistant");
    if (!last || typeof last.content === "string") return [];
    const out: ToolResult[] = [];
    for (const b of last.content) {
      if (b.type !== "tool_use" || b.name !== "gegner_greift_an") continue;
      const name = String((b.input as { gegner?: unknown })?.gegner ?? "").toLowerCase();
      const foe = scene.world.combat?.enemies.find((e) => e.name.toLowerCase() === name);
      if (foe && foe.hp <= 0) { out.push({ type: "tool_result", tool_use_id: b.id, content: `${foe.name} ist besiegt und greift nicht mehr an.` }); continue; }
      if (!scene.world.combat) { out.push({ type: "tool_result", tool_use_id: b.id, content: "Der Kampf ist schon vorbei – kein Angriff mehr." }); continue; }
      out.push({ type: "tool_result", tool_use_id: b.id, ...(await runAutoTool(b, { data: scene.data, characters: scene.characters, world: scene.world, rolls: this.o.rolls, onRoll: scene.onRoll })) });
    }
    return out;
  }

  /**
   * Solo: Probe würfeln, danach die angesagten Gegnerangriffe. `content` ist die nächste Nachricht an Claude:
   * zurückgehaltene Werkzeug-Ergebnisse, das Probenergebnis und die Gegnerangriffe.
   */
  async rollPending(pending: PendingCheck, scene: Omit<Scene, "onRoll"> & { onRoll?: Scene["onRoll"] }, held: ToolResult[] = [], messages: MessageParam[] = []): Promise<{ record: RollRecord; extra: RollRecord[]; content: ToolResult[] }> {
    const { record, extra, result } = await this.rollOne(pending, scene);
    const enemies = await this.enemyTurn(messages, { ...scene, onRoll: scene.onRoll ?? (() => {}) });
    return { record, extra, content: [...held, result, ...enemies] };
  }

  /** Erzählt weiter, bis Claude fertig ist oder eine Probe verlangt. Sofort-Werkzeuge werden dabei ausgeführt. */
  /**
   * `compact: false` schaltet die automatische Zusammenfassung ab – nötig, wenn der Aufrufer nur Text speichert
   * (OpenAI-Schnittstelle): Ohne gespeicherten Zusammenfassungs-Block würde sie bei jeder Anfrage neu laufen.
   */
  async converse(messages: MessageParam[], scene: Scene, who: string, onText: (text: string) => void, opts: { compact?: boolean } = {}): Promise<ConverseResult> {
    const compact = opts.compact !== false;
    const { characters, data, world } = scene;
    ensureInventory(world, characters, data.rules);
    const history = [...messages];
    const base = requestBase(this.model, this.o.effort ?? "low");
    let cost = 0, imageUsd = 0, paintedTurn = false;
    const usage = { input: 0, output: 0 };
    const budget = this.o.turnBudgetMs ?? TURN_BUDGET_MS;
    const deadline = Date.now() + budget;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), budget);
    try {
      for (let loop = 0; loop < MAX_LOOPS; loop++) {
        await this.o.guard.check(who);
        let msg: Message;
        try {
          msg = await this.o.llm!.stream({
            ...base,
            betas: [...(base.betas ?? []), THINKING_BINDING_BETA, ...(compact ? ["compact-2026-01-12"] : [])],
            // Passt ein alter Denkblock nicht mehr zum Verlauf (z. B. nach Zusammenfassung oder Wiederholung),
            // lässt die API ihn weg, statt die ganze Anfrage abzulehnen.
            thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
            max_tokens: 8000,
            cache_control: CACHE_1H,
            system: [{ type: "text", text: systemPrompt(data), cache_control: CACHE_1H }],
            tools: this.tools(data, characters),
            tool_choice: { type: "auto" },
            ...(compact ? { context_management: { edits: [{ type: "compact_20260112" as const, trigger: { type: "input_tokens" as const, value: COMPACT_AT }, instructions: COMPACT_INSTRUCTIONS }] } } : {}),
            messages: history,
          }, onText, abort.signal);
        } catch (e) {
          if (abort.signal.aborted) throw new GmError("Der Spielleiter hat zu lange gebraucht und wurde unterbrochen. Bitte erneut versuchen.", "api");
          throw e;
        }
        const c = costUsd(msg.usage, this.model);
        cost += c;
        await this.o.guard.record(msg.usage, this.model);
        const u = msg.usage;
        usage.input += u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
        usage.output += u.output_tokens;
        const compacted = (u.iterations ?? []).some((i) => i.type === "compaction");
        // Nach einer Zusammenfassung stehen frühere <spielstand> nicht mehr im Verlauf: nächstes Mal wieder ausführlich
        if (compacted) delete world.sent;
        console.log(`[Kosten] ${this.model}: Eingabe ${u.input_tokens}, Cache gelesen ${u.cache_read_input_tokens ?? 0}, Cache geschrieben ${u.cache_creation_input_tokens ?? 0}, Ausgabe ${u.output_tokens} (davon Denken ${u.output_tokens_details?.thinking_tokens ?? "?"})${compacted ? ", mit Zusammenfassung" : ""} → ${(c * 100).toFixed(2)} ct`);

        if (msg.stop_reason === "refusal") throw new GmError("Der Spielleiter möchte diese Szene so nicht erzählen. Versuch es mit einer anderen Handlung.", "refusal");
        history.push({ role: "assistant", content: msg.content as Anthropic.Beta.BetaContentBlockParam[] });
        const uses = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
        if (uses.length && msg.stop_reason === "tool_use") {
          // Reihenfolge: erst Sofort-Werkzeuge (z. B. kampf_beginnen – die Gegner müssen für die Proben schon da sein),
          // dann die Probe (höchstens eine), zuletzt Gegnerangriffe – die warten, bis alle gewürfelt haben.
          const byId = new Map<string, ToolResult>();
          const run = async (b: Anthropic.Beta.BetaToolUseBlock) => byId.set(b.id, { type: "tool_result", tool_use_id: b.id, ...(await runAutoTool(b, { data, characters, world, rolls: this.o.rolls, onRoll: scene.onRoll })) });
          let painted = false;
          for (const b of uses) {
            if (b.name === TOOL_NAME || b.name === "gegner_greift_an") continue;
            if (b.name === "bild") {
              const r = painted ? "Nur ein Bild pro Antwort." : await this.paint(b, scene);
              painted = paintedTurn = true;
              if (typeof r !== "string") imageUsd += r.costUsd;
              byId.set(b.id, { type: "tool_result", tool_use_id: b.id, content: typeof r === "string" ? r : "Das Bild wird den Spielern gezeigt." });
              continue;
            }
            if ((AUTO_TOOLS as readonly string[]).includes(b.name)) await run(b);
            else byId.set(b.id, { type: "tool_result", tool_use_id: b.id, is_error: true, content: "Unbekanntes Werkzeug." });
          }
          const pendings: PendingCheck[] = [];
          for (const b of uses.filter((x) => x.name === TOOL_NAME)) {
            const p = this.pendingFor(b, characters, data, world);
            const error = !p ? "INVALID_INPUT: Prüfe figur, art, id (aus der Liste), sg (0–30) und modus."
              : pendings.length ? "Nur eine Probe gleichzeitig – verlange die nächste nach dem Ergebnis." : null;
            if (error) byId.set(b.id, { type: "tool_result", tool_use_id: b.id, is_error: true, content: error });
            else pendings.push(p!);
          }
          // Gegnerzug: mit offenen Proben erst nach den Würfen (siehe enemyTurn), sonst sofort
          if (!pendings.length) for (const b of uses) if (b.name === "gegner_greift_an") await run(b);
          const results = uses.map((b) => byId.get(b.id)).filter((r): r is ToolResult => !!r);
          if (pendings.length) return { history, pending: pendings[0], pendings, held: results, costUsd: cost, imageUsd, painted: paintedTurn, usage };
          const told = msg.content.some((b) => b.type === "text" && splitSuggestions(b.text).suggestions.length > 0);
          const ended = uses.some((b) => b.name === "abenteuer_beenden") && !!world.arc?.finished;
          if ((told || ended) && uses.every((b) => QUIET_TOOLS.has(b.name)) && results.every((r) => !r.is_error)) return { history, pending: null, pendings: [], held: results, costUsd: cost, imageUsd, painted: paintedTurn, usage };
          // Reicht die Zeit nicht mehr für einen weiteren Aufruf, endet der Zug hier: Die Ergebnisse gehen mit der nächsten Handlung an Claude.
          if (deadline - Date.now() < MIN_CALL_MS) {
            console.warn("[Claude] Zeitbudget fast aufgebraucht – Zug endet ohne weiteren Aufruf.");
            return { history, pending: null, pendings: [], held: results, costUsd: cost, imageUsd, painted: paintedTurn, usage };
          }
          history.push({ role: "user", content: results });
          continue;
        }
        if (uses.length) history.pop(); // abgeschnittener Werkzeugaufruf (max_tokens): nicht übernehmen
        return { history, pending: null, pendings: [], held: [], costUsd: cost, imageUsd, painted: paintedTurn, usage };
      }
      throw new GmError("Der Spielleiter hat sich verhaspelt. Bitte versuch es noch einmal.", "api");
    } finally {
      clearTimeout(timer);
    }
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

/** Text der letzten Erzählung – für die Lage beim Freischalten. */
export function lastNarration(messages: MessageParam[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const text = typeof m.content === "string" ? m.content : m.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
    if (text.trim()) return text.trim();
  }
  return "";
}
