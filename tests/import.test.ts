import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { GmEvent } from "../shared/campaign";
import { parseSaveFile, sanitizeStory, SAVE_FORMAT } from "../shared/saveFile";
import { buildCharacter } from "../server/characters";
import { RollLog } from "../server/dice/log";
import { GameMaster, type LlmClient } from "../server/gm/engine";
import { importedMessages } from "../server/gm/importer";
import { MemoryCounterStore, UsageGuard } from "../server/gm/usage";
import { loadGameData } from "../server/rules/loader";

const data = await loadGameData(path.resolve(__dirname, "../data"));
const character = buildCharacter({ name: "Makkalot", stand: "bauer", classId: "ritter", attributes: data.classes.find((c) => c.id === "ritter")!.recommendedAttributes, chosenSkills: ["reiten", "wahrnehmung"] }, data);

type Params = Parameters<LlmClient["stream"]>[0];
class FakeLlm implements LlmClient {
  calls: Params[] = [];
  constructor(private reply: string) {}
  async stream(params: Params, onText: (t: string) => void) {
    this.calls.push(structuredClone(params));
    onText(this.reply);
    return { id: "m", type: "message", role: "assistant", model: "fake", stop_reason: "end_turn", usage: { input_tokens: 500, output_tokens: 150 }, content: [{ type: "text", text: this.reply, citations: null }] } as unknown as Anthropic.Beta.BetaMessage;
  }
}
const setup = (llm: LlmClient | null = null) => {
  const gm = new GameMaster({ data: () => data, llm, rolls: new RollLog(), guard: new UsageGuard(new MemoryCounterStore(), 10, 100), secret: "test-secret-0123456789" });
  const run = async (kind: "import" | "letter", body: unknown) => { const evs: GmEvent[] = []; await gm.run(kind, body, "tester", (e) => evs.push(e)); return evs; };
  return { gm, run };
};
const imported = (evs: GmEvent[]) => evs.find((e) => e.type === "imported") as Extract<GmEvent, { type: "imported" }>;

const tournament = {
  title: "Das Turnier zu Falkenstein",
  story: [
    { type: "gm", text: "Fanfaren über Falkenstein. Die Tribünen sind voll." },
    { type: "player", text: "Ich melde mich an." },
    { type: "gm", text: "Der Herold ruft deinen Namen. » Vorschläge: Lanze wählen | Zum Zelt" },
    { type: "image", url: "javascript:alert(1)", caption: "böse" },
  ],
  state: { messages: [{ role: "user", content: "gefälscht" }], world: {
    hp: { "anders-id": 999 }, maxHp: { "anders-id": 999 },
    inventory: { "anders-id": { money: 9_999_999, items: [{ name: "Glutklinge", qty: 1, kind: "waffe", equipped: true, stats: { angriff: 9, schaden: 3, seltenheit: "sagenhaft" } }, { name: "Dolch", qty: 1, kind: "waffe", equipped: true }] } },
    shop: { name: "x" }, vote: { question: "?" },
  } },
};

describe("Spielstand-Datei", () => {
  it("prüft das Format", () => {
    expect(parseSaveFile("kein json")).toMatch(/JSON/);
    expect(parseSaveFile(JSON.stringify({ format: "anders" }))).toMatch(/keine Spielstand-Datei/);
    expect(parseSaveFile(JSON.stringify({ format: SAVE_FORMAT, version: 99, campaign: tournament }))).toMatch(/neueren Version/);
    expect(typeof parseSaveFile(JSON.stringify({ format: SAVE_FORMAT, version: 1, characterName: "Makkalot", campaign: tournament }))).toBe("object");
  });

  it("Geschichte: nur bekannte Einträge, keine fremden Bild-Adressen", () => {
    const s = sanitizeStory(tournament.story);
    expect(s).toHaveLength(3);
    expect(sanitizeStory([{ type: "image", url: "/api/images/abc-1", caption: "ok" }])).toHaveLength(1);
  });

  it("fremder Stand: Welt mit Grenzen für die gewählte Figur, Verlauf als Zusammenfassung", async () => {
    const { run } = setup();
    const ev = imported(await run("import", { character, campaign: tournament }));
    expect(ev.trusted).toBe(false);
    const w = ev.state.world!;
    expect(w.maxHp[character.id]).toBe(300);
    const inv = w.inventory![character.id];
    expect(inv.money).toBe(240 * 500);
    expect(inv.items.find((i) => i.name === "Glutklinge")?.stats).toEqual({ angriff: 3, schaden: 3, seltenheit: "sagenhaft" });
    expect(inv.items.filter((i) => i.equipped && i.kind === "waffe").map((i) => i.name)).toEqual(["Glutklinge"]);
    expect(w.shop).toBeNull();
    expect(w.vote).toBeNull();
    expect((ev.state.messages as { role: string }[]).map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(JSON.stringify(ev.state.messages)).not.toContain("gefälscht");
  });

  it("eigener Stand mit gültiger Signatur geht unverändert weiter", async () => {
    const { run } = setup();
    const first = imported(await run("import", { character, campaign: tournament }));
    const again = imported(await run("import", { character, campaign: { ...tournament, state: first.state } }));
    expect(again.trusted).toBe(true);
    expect(again.state.messages).toEqual(first.state.messages);
  });

  it("ohne Erzählung geht es nicht", () => {
    expect(() => importedMessages([{ type: "player", text: "hallo" }])).toThrow(/Erzählung/);
  });
});

describe("Brief am Kapitelende", () => {
  it("nur für abgeschlossene Kapitel, mit Haiku", async () => {
    const llm = new FakeLlm("Falkenstein, am Abend\n\nIch habe gesiegt.\n\n– Makkalot");
    const { run } = setup(llm);
    const ev = imported(await run("import", { character, campaign: { ...tournament, state: { world: { arc: { plan: null, chapters: [{ titel: "Die Anmeldung", ziel: "x", act: 0, detour: false, rueckweg: null, done: true, rueckblick: "Makkalot wurde zugelassen." }, { titel: "Der Tjost", ziel: "y", act: 0, detour: false, rueckweg: null, done: false, rueckblick: null }], current: 1, detoursUsed: [0, 0, 0], turnsInChapter: 0, finished: false, epilog: null } } } } }));
    const open = await run("letter", { character, state: ev.state, chapter: 1 });
    expect(open.find((e) => e.type === "error")).toBeTruthy();
    const evs = await run("letter", { character, state: ev.state, chapter: 0 });
    const letter = evs.find((e) => e.type === "letter") as Extract<GmEvent, { type: "letter" }>;
    expect(letter.title).toBe("Die Anmeldung");
    expect(letter.text).toContain("Makkalot");
    expect(llm.calls[0].model).toBe("claude-haiku-5-5");
  });
});

describe("Turnier-Datei für Makkalot", () => {
  it("lässt sich mit einer vorhandenen Figur einlesen: eigenes Startgepäck plus Morgenrot (angelegt)", async () => {
    const { readFileSync } = await import("node:fs");
    const f = parseSaveFile(readFileSync(path.resolve(__dirname, "../spielstaende/turnier-zu-falkenstein.ember.json"), "utf8"));
    if (typeof f === "string") throw new Error(f);
    expect(f.character).toBeNull();
    expect(f.characterName).toBe("Makkalot");
    const { run } = setup();
    const ev = imported(await run("import", { character, campaign: f.campaign }));
    const w = ev.state.world!;
    expect(w.hp[character.id]).toBe(character.hp.max);
    const items = w.inventory![character.id].items;
    expect(items.find((i) => i.name === "Morgenrot")).toMatchObject({ equipped: true, stats: { angriff: 3, schaden: 2, seltenheit: "sagenhaft" } });
    expect(items.find((i) => i.name === "Langschwert")?.equipped).toBe(false);
    expect(items.find((i) => i.name === "Heiltrank")?.qty).toBe(2);
    expect(w.arc!.chapters).toHaveLength(7);
    expect(ev.story[0].type).toBe("gm");
  });
});
