import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { buildCharacter } from "../server/characters";
import { RollLog } from "../server/dice/log";
import { Narrator, type LlmClient } from "../server/gm/narrator";
import { MemoryPartyStore, PartyService } from "../server/gm/party";
import { MemoryCounterStore, UsageGuard } from "../server/gm/usage";
import { loadGameData } from "../server/rules/loader";

const data = await loadGameData(path.resolve(__dirname, "../data"));
const mk = (name: string, classId: string, skills: string[]) =>
  buildCharacter({ name, stand: "bauer", classId, attributes: data.classes.find((c) => c.id === classId)!.recommendedAttributes, chosenSkills: skills }, data);
const hagen = mk("Hagen", "ritter", ["reiten", "wahrnehmung"]);
const agnes = mk("Agnes", "moench", ["glaube_sagen"]);

const llm: LlmClient = {
  async stream(_p, onText) {
    onText("Es geht los. » Vorschläge: A | B");
    return { id: "m", type: "message", role: "assistant", model: "fake", stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: "Es geht los. » Vorschläge: A | B", citations: null }] } as unknown as Anthropic.Beta.BetaMessage;
  },
};
function setup() {
  const guard = new UsageGuard(new MemoryCounterStore(), 10, 100);
  const store = new MemoryPartyStore();
  const svc = new PartyService({ data: () => data, narrator: new Narrator({ llm, rolls: new RollLog(), guard }), guard, store, secret: "s".repeat(20) });
  const start = (code: string, token: string) => svc.run("start", { code, token }, "t", () => {});
  const finish = async (code: string) => { const g = (await store.get(code))!; g.party.world!.arc!.finished = true; await store.put(g.party, g.etag); };
  return { svc, store, start, finish };
}

describe("Alte Gruppen löschen", () => {
  it("Überblick zeigt Lobby, läuft, beendet und verschwundene Gruppen – nur mit gültigem Zugang", async () => {
    const { svc, start, finish } = setup();
    const lobby = await svc.create({ character: hagen });
    const playing = await svc.create({ character: hagen });
    await svc.join({ code: playing.code, character: agnes });
    await start(playing.code, playing.token);
    const done = await svc.create({ character: hagen });
    await start(done.code, done.token);
    await finish(done.code);
    const { items } = await svc.overview({ items: [lobby, playing, done, { code: "ZZZZZZ", token: "x" }, { code: playing.code, token: "falsch" }].map((x) => ({ code: x.code, token: x.token })) });
    expect(items.map((i) => i.status)).toEqual(["lobby", "playing", "finished", "gone", "gone"]);
    expect(items[1].players).toEqual(["Hagen", "Agnes"]);
    expect(items[2].outcome).toBe("sieg");
  });

  it("allein oder beendet als Gastgeber: endgültig gelöscht", async () => {
    const { svc, store, start, finish } = setup();
    const alone = await svc.create({ character: hagen });
    expect(await svc.remove({ code: alone.code, token: alone.token })).toEqual({ deleted: true });
    expect(await store.get(alone.code)).toBeNull();

    const soloRun = await svc.create({ character: hagen });
    await start(soloRun.code, soloRun.token);
    expect((await svc.remove({ code: soloRun.code, token: soloRun.token })).deleted).toBe(true);

    const done = await svc.create({ character: hagen });
    const guest = await svc.join({ code: done.code, character: agnes });
    await start(done.code, done.token);
    await finish(done.code);
    expect((await svc.remove({ code: done.code, token: guest.token })).deleted).toBe(false); // Gast: nur aus der eigenen Liste
    expect(await store.get(done.code)).not.toBeNull();
    expect((await svc.remove({ code: done.code, token: done.token })).deleted).toBe(true);
    expect(await store.get(done.code)).toBeNull();
  });

  it("laufende Gruppen anderer bleiben unberührt; in der Lobby wird nur verlassen", async () => {
    const { svc, start } = setup();
    const running = await svc.create({ character: hagen });
    const guest = await svc.join({ code: running.code, character: agnes });
    await start(running.code, running.token);
    expect((await svc.remove({ code: running.code, token: running.token })).deleted).toBe(false);
    const v = await svc.state({ code: running.code, token: guest.token });
    expect(v.status).toBe("playing");
    expect(v.players).toHaveLength(2);

    const lobby = await svc.create({ character: hagen });
    const g2 = await svc.join({ code: lobby.code, character: agnes });
    expect((await svc.remove({ code: lobby.code, token: lobby.token })).deleted).toBe(false);
    const after = await svc.state({ code: lobby.code, token: g2.token });
    expect(after.players.map((p) => [p.name, p.host])).toEqual([["Agnes", true]]);

    await expect(svc.remove({ code: running.code, token: "falsch" })).rejects.toThrow(/gehörst nicht/);
  });
});
