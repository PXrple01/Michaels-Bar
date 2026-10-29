// OpenAI-kompatible Schnittstelle: Chat-Apps und Programme sprechen den Spielleiter über /v1/chat/completions an.
// Das OpenAI-Format kennt nur Text. Deshalb würfelt der Server Proben sofort selbst (fair wie immer) und schreibt
// den Wurf in die Antwort. Lebenspunkte, Kampf und Aufträge reisen als signierter, unsichtbarer Kommentar am Ende
// jeder Antwort mit – die Chat-App schickt ihn beim nächsten Mal von selbst zurück.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { RollRecord } from "../../shared/dice";
import type { Character } from "../../shared/schema";
import { initArc, initWorld, isArc, worldSummary, type WorldState } from "../../shared/world";
import { buildCharacter, resolveCharacter, ValidationError } from "../characters";
import type { GameData } from "../rules/loader";
import { errorEvent, type MessageParam, type Narrator } from "./narrator";
import { rollOpening, seededRng } from "./openings";
import { kickoffMessage } from "./prompt";
import { applyLevels, chooseLevelReward, effectiveCharacter, levelChoiceDue, levelTitle } from "../../shared/levels";
import { countChapterTurn, enforceDefeat } from "./world";
import type { UsageGuard } from "./usage";

/** Zwei Modelle: mit Spielstand (unsichtbarer Kommentar) oder ohne – falls eine App Kommentare sichtbar anzeigt. */
export const OAI_MODELS = {
  "the-last-ember": { state: true, description: "Spielleiter mit Spielstand (Lebenspunkte, Kampf, Aufträge)" },
  "the-last-ember-einfach": { state: false, description: "Spielleiter ohne Spielstand – für Apps, die HTML-Kommentare sichtbar anzeigen" },
} as const;
type OaiModel = keyof typeof OAI_MODELS;
/** Alte Namen von vor der Umbenennung funktionieren weiter. */
const OAI_ALIASES: Record<string, OaiModel> = { "michaels-bar": "the-last-ember", "michaels-bar-einfach": "the-last-ember-einfach" };

const MAX_MESSAGES = 400;
const MAX_CHARS = 300_000; // etwa 75 000 Tokens – danach bitte ein neues Gespräch beginnen
const MAX_PROBES = 4;
const MARKER = /\n*<!-- (?:the-last-ember|michaels-bar):([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+) -->\s*$/;

export type OaiResult =
  | { status: number; json: unknown }
  | { status: 200; stream: (write: (chunk: string) => void) => Promise<void> };

type ChatMessage = { role: string; content: string };

const oaiError = (status: number, message: string, type = "invalid_request_error", code: string | null = null): OaiResult =>
  ({ status, json: { error: { message, type, code } } });

/** Text aus einer OpenAI-Nachricht (String oder Liste von Teilen). */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => (p && typeof p === "object" && (p as { type?: string }).type === "text" ? String((p as { text?: unknown }).text ?? "") : "")).join("");
  return "";
}

/** So erscheint ein Wurf in der Antwort. */
export function diceLine(r: RollRecord, auto = false): string {
  const dice = r.mode === "normal" ? r.values.join(" + ") : `${r.values.join(" / ")} (${r.mode === "advantage" ? "Vorteil" : "Nachteil"})`;
  const mod = r.modifier ? ` ${r.modifier > 0 ? "+" : "−"} ${Math.abs(r.modifier)}` : "";
  const verdict = r.dc === null ? "" : auto ? (r.success ? " – Treffer" : " – daneben") : r.success ? ` gegen SG ${r.dc} – geschafft` : ` gegen SG ${r.dc} – nicht geschafft`;
  const crit = r.critical === "hit" ? " · natürliche 20!" : r.critical === "fumble" ? " · Patzer!" : "";
  return `\n\n${auto ? "⚔️" : "🎲"} *${r.label}: ${dice}${mod} = **${r.total}**${verdict}${crit}*\n\n`;
}

export class OpenAiGateway {
  private fallback: Character | null = null;

  constructor(private o: { data: () => GameData; narrator: Narrator; guard: UsageGuard; secret: string; apiKey?: string }) {}

  /* ── Spielstand im Kommentar ── */

  private sign(payload: string) {
    return createHmac("sha256", this.o.secret).update(`oai-world:${payload}`).digest("base64url").slice(0, 32);
  }

  marker(world: WorldState, characterId: string): string {
    const payload = Buffer.from(JSON.stringify({ w: world, c: characterId })).toString("base64url");
    return `\n\n<!-- the-last-ember:${payload}.${this.sign(payload)} -->`;
  }

  /** Liest den Spielstand aus einer Antwort – nur mit gültiger Signatur. */
  readMarker(text: string): { world: WorldState; characterId: string } | null {
    const m = text.match(MARKER);
    if (!m) return null;
    const expected = Buffer.from(this.sign(m[1])), given = Buffer.from(m[2]);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const v = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8"));
      return v && v.w && typeof v.c === "string" ? { world: v.w, characterId: v.c } : null;
    } catch { return null; }
  }

  /* ── Figur ── */

  /** Ohne mitgeschickte Figur spielt ein fester Söldner – immer derselbe, damit der Spielstand passt. */
  private defaultCharacter(data: GameData): Character {
    if (this.fallback) return this.fallback;
    const cls = data.classes.find((c) => c.id === "soeldner") ?? data.classes[0];
    const c = buildCharacter({
      name: "Wanderer", stand: data.rules.stands[0].id, classId: cls.id,
      attributes: cls.recommendedAttributes, chosenSkills: cls.skillChoices.from.slice(0, cls.skillChoices.count),
    }, data);
    this.fallback = { ...c, id: "standard-wanderer", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
    return this.fallback;
  }

  /* ── Anfragen ── */

  async handle(method: string, path: string, auth: string | null, body: unknown, who: string): Promise<OaiResult> {
    if (!this.o.apiKey) return oaiError(404, "Die OpenAI-Schnittstelle ist nicht eingerichtet: Lege die Umgebungsvariable OPENAI_COMPAT_KEY an.", "invalid_request_error", "not_configured");
    const token = (auth ?? "").replace(/^Bearer\s+/i, "");
    const a = Buffer.from(token), b = Buffer.from(this.o.apiKey);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return oaiError(401, "Ungültiger API-Schlüssel.", "authentication_error", "invalid_api_key");

    if (method === "GET" && path === "/v1/models") {
      return { status: 200, json: { object: "list", data: Object.entries(OAI_MODELS).map(([id, m]) => ({ id, object: "model", created: 1767225600, owned_by: "the-last-ember", description: m.description })) } };
    }
    if (method === "POST" && path === "/v1/chat/completions") return this.chat((body ?? {}) as Record<string, unknown>, `oai:${who}`);
    return oaiError(404, `Unbekannter Endpunkt ${method} ${path}`, "invalid_request_error", "unknown_url");
  }

  private async chat(req: Record<string, unknown>, who: string): Promise<OaiResult> {
    const asked = String(req.model ?? "the-last-ember");
    const modelId = (OAI_ALIASES[asked] ?? asked) as OaiModel;
    if (!(modelId in OAI_MODELS)) return oaiError(404, `Unbekanntes Modell „${String(req.model)}“. Verfügbar: ${Object.keys(OAI_MODELS).join(", ")}`, "invalid_request_error", "model_not_found");
    const withState = OAI_MODELS[modelId].state;
    if (!Array.isArray(req.messages) || !req.messages.length) return oaiError(400, "messages fehlt oder ist leer.");
    if (req.messages.length > MAX_MESSAGES) return oaiError(400, `Zu viele Nachrichten (höchstens ${MAX_MESSAGES}). Beginne ein neues Abenteuer.`, "invalid_request_error", "context_length_exceeded");
    const messages: ChatMessage[] = (req.messages as { role?: unknown; content?: unknown }[])
      .map((m) => ({ role: String(m?.role ?? ""), content: textOf(m?.content) }))
      .filter((m) => ["system", "developer", "user", "assistant"].includes(m.role));
    if (messages.reduce((s, m) => s + m.content.length, 0) > MAX_CHARS) return oaiError(400, "Das Gespräch ist zu lang geworden. Beginne ein neues Abenteuer.", "invalid_request_error", "context_length_exceeded");
    if (messages.at(-1)?.role !== "user" || !messages.at(-1)!.content.trim()) return oaiError(400, "Die letzte Nachricht muss von der Person (role: user) kommen und Text enthalten.");

    // Figur: mitgeschickt (Erweiterung „character“, z. B. vom Charakterbogen kopiert) oder der feste Wanderer
    let character: Character, data: GameData;
    try {
      if (req.character) ({ c: character, data } = resolveCharacter(req.character, this.o.data(), this.o.secret));
      else { data = this.o.data(); character = this.defaultCharacter(data); }
    } catch (e) {
      return oaiError(400, e instanceof ValidationError ? `Figur ungültig: ${e.problems.join(", ")}` : "Figur ungültig.");
    }

    // Verlauf für Claude: Startnachricht (Figur + Startimpuls, immer gleich für denselben Gesprächsanfang), dann der Text
    const notes = messages.filter((m) => m.role === "system" || m.role === "developer").map((m) => m.content.trim()).filter(Boolean).join("\n");
    const chat = messages.filter((m) => m.role === "user" || m.role === "assistant");
    const first = chat.findIndex((m) => m.role === "user");
    const opening = rollOpening(data.openings, [], seededRng(chat[first].content));
    const kickoff = kickoffMessage([character], data, opening, [])
      + (notes ? `\n\n<hinweise_der_person>\n${notes.slice(0, 2000)}\n</hinweise_der_person>` : "")
      + `\n\nDie Person schreibt zum Start: „${chat[first].content.trim()}“`;
    const history: MessageParam[] = [{ role: "user", content: kickoff }];
    let saved: { world: WorldState; characterId: string } | null = null;
    for (const m of chat.slice(first + 1)) {
      if (m.role === "assistant") saved = this.readMarker(m.content) ?? saved;
      const text = m.content.replace(MARKER, "").trim();
      if (!text) continue;
      const last = history[history.length - 1];
      if (last.role === m.role) last.content = `${last.content as string}\n\n${text}`;
      else history.push({ role: m.role as "user" | "assistant", content: text });
    }
    const world = withState && saved && saved.characterId === character.id ? saved.world : initWorld([character]);
    if (!isArc(world.arc)) world.arc = initArc();
    if (withState && world.arc.finished) {
      // Das Abenteuer ist zu Ende: freundlich antworten, ohne Claude zu fragen (kostet nichts)
      const text = `*Dieses Abenteuer ist abgeschlossen.*${world.arc.epilog ? `\n\n${world.arc.epilog}` : ""}\n\nBeginne ein neues Gespräch für das nächste Abenteuer.`;
      return req.stream === true
        ? { status: 200, stream: async (write) => { write(`data: ${JSON.stringify({ id: "chatcmpl-ende", object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: modelId, choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: "stop" }] })}\n\n`); write("data: [DONE]\n\n"); } }
        : { status: 200, json: { id: "chatcmpl-ende", object: "chat.completion", created: Math.floor(Date.now() / 1000), model: modelId, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } } };
    }
    if (withState && history.length > 1) countChapterTurn(world);
    if (withState && history.length > 1) {
      const last = history[history.length - 1];
      last.content = `${last.content as string}\n\n<spielstand>\n${worldSummary(world, [character], data.rules)}\n</spielstand>`;
    }

    try { this.o.narrator.ensureReady(); } catch (e) { return oaiError(503, errorEvent(e).message, "api_error", "no_api_key"); }

    const id = `chatcmpl-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const created = Math.floor(Date.now() / 1000);
    const run = async (onText: (t: string) => void) => {
      const scene = { characters: [effectiveCharacter(character, world)], data, world, onRoll: (r: RollRecord) => onText(diceLine(r, true)) };
      let msgs = history;
      const usage = { input: 0, output: 0 };
      const t0 = Date.now();
      for (let probe = 0; ; probe++) {
        const res = await this.o.narrator.converse(msgs, scene, who, onText, { compact: false });
        usage.input += res.usage.input;
        usage.output += res.usage.output;
        if (!res.pending || world.arc?.finished) break;
        // Zeitlimit der Funktion (Netlify): lieber eine Pause als ein abgebrochener Stream
        if (probe >= MAX_PROBES || Date.now() - t0 > 25_000) { onText("\n\n*(Der Spielleiter macht hier eine Pause – schreib, wie es weitergeht.)*"); break; }
        // Kein Würfeln-Knopf in Chat-Apps: Der Server würfelt die verlangte Probe sofort.
        const enemyRolls: RollRecord[] = [];
        const { record, extra, content } = await this.o.narrator.rollPending(res.pending, { ...scene, onRoll: (r) => enemyRolls.push(r) }, res.held, res.history);
        onText(diceLine(record));
        for (const r of [...extra, ...enemyRolls]) onText(diceLine(r, true));
        msgs = [...res.history, { role: "user", content }];
      }
      if (enforceDefeat(world, [character])) onText(`\n\n*Alle sind gefallen – das Abenteuer endet mit einer Niederlage.*\n\n${world.arc!.epilog}`);
      if (withState) {
        // Stufen nachziehen; Wahlen (Stufe 4/7) trifft hier der Server, weil Chat-Apps keine Auswahl-Knöpfe haben
        for (const up of applyLevels(world, [character], data.classes, data.rules)) onText(`\n\n⭐ *Stufe ${up.to} erreicht – ${levelTitle(up.to, data.rules)}!*`);
        autoLevelChoices(world, character, data);
        onText(this.marker(world, character.id));
      }
      return usage;
    };

    if (req.stream === true) {
      const includeUsage = !!(req.stream_options as { include_usage?: boolean } | undefined)?.include_usage;
      return {
        status: 200,
        stream: async (write) => {
          const chunk = (delta: object, finish: string | null = null, extra: object = {}) =>
            write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`);
          chunk({ role: "assistant", content: "" });
          try {
            const usage = await run((t) => chunk({ content: t }));
            chunk({}, "stop");
            if (includeUsage) write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: modelId, choices: [], usage: { prompt_tokens: usage.input, completion_tokens: usage.output, total_tokens: usage.input + usage.output } })}\n\n`);
          } catch (e) {
            write(`data: ${JSON.stringify({ error: { message: errorEvent(e).message, type: "api_error", code: errorEvent(e).code ?? null } })}\n\n`);
          }
          write("data: [DONE]\n\n");
        },
      };
    }

    let text = "";
    try {
      const usage = await run((t) => { text += t; });
      return {
        status: 200,
        json: {
          id, object: "chat.completion", created, model: modelId,
          choices: [{ index: 0, message: { role: "assistant", content: text.trim() }, finish_reason: "stop" }],
          usage: { prompt_tokens: usage.input, completion_tokens: usage.output, total_tokens: usage.input + usage.output },
        },
      };
    } catch (e) {
      const ev = errorEvent(e);
      const status = ev.code === "budget" || ev.code === "rate" ? 429 : ev.code === "refusal" ? 400 : 502;
      return oaiError(status, ev.message, status === 429 ? "rate_limit_error" : "api_error", ev.code ?? null);
    }
  }
}

/** Ohne Auswahl-Knöpfe: Bei Stufe 4 die erste noch nicht geübte Fertigkeit der Klassenauswahl, bei Stufe 3, 6 und 9 +1 auf die zwei Hauptattribute. */
function autoLevelChoices(world: WorldState, c: Character, data: GameData) {
  const cls = data.classes.find((x) => x.id === c.classId);
  for (let i = 0; i < 5; i++) {
    const due = levelChoiceDue(world, c.id, data.rules);
    if (due === "skill") {
      const pick = [...(cls?.skillChoices.from ?? []), ...data.rules.skills.map((s) => s.id)].find((id) => !chooseLevelReward(structuredClone(world), c, data.classes, data.rules, { skill: id }));
      if (pick) chooseLevelReward(world, c, data.classes, data.rules, { skill: pick });
    } else if (due === "attrs") {
      const [a, b] = cls?.primaryAttributes ?? [];
      const first = a && b ? { [a]: 1, [b]: 1 } : { [a ?? "konstitution"]: 2 };
      // Hauptattribute schon am Höchstwert: auf andere ausweichen, sonst die Wahl überspringen
      const options = [first, { konstitution: 1, geschick: 1 }, { weisheit: 1, verstand: 1 }, { ausstrahlung: 1, staerke: 1 }];
      if (!options.some((o) => !chooseLevelReward(world, c, data.classes, data.rules, { attrs: o }))) break;
    }
  }
}
