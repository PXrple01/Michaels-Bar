import { describe, expect, it } from "vitest";
import { ImageMaker, MemoryImageStore, portraitMotif, serveImage } from "../server/images";

const falReply = (w: number, h: number, nsfw = false) => (async () => new Response(JSON.stringify({ images: [{ url: `data:image/webp;base64,${Buffer.from("BILD").toString("base64")}`, width: w, height: h }], has_nsfw_concepts: [nsfw] }))) as unknown as typeof fetch;

describe("Bilder (fal.ai)", () => {
  it("malt, speichert und rechnet pro angefangenem Megapixel ab", async () => {
    let sent: { url: string; body: Record<string, unknown>; auth: string } | null = null;
    const store = new MemoryImageStore();
    const maker = new ImageMaker({ key: "k-123", store, fetch: (async (url: string, init: RequestInit) => {
      sent = { url, body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get("authorization") ?? "" };
      return (falReply(1024, 768) as unknown as () => Promise<Response>)();
    }) as unknown as typeof fetch });
    const { url, costUsd } = await maker.make("A castle at dusk", "landscape_4_3");
    expect(sent!.url).toBe("https://fal.run/fal-ai/flux-2");
    expect(sent!.auth).toBe("Key k-123");
    expect(sent!.body).toMatchObject({ image_size: "landscape_4_3", sync_mode: true, output_format: "webp" });
    expect(String(sent!.body.prompt)).toContain("A castle at dusk");
    expect(costUsd).toBe(0.012);
    const id = url.match(/\/api\/images\/([^?]+)/)![1];
    const res = await serveImage(store, id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("BILD");
    expect((await maker.make("x".repeat(20), "portrait_4_3", "portrait-abc123")).url).toMatch(/^\/api\/images\/portrait-abc123\?v=/);
  });

  it("ohne Schlüssel oder bei Sicherheitsfilter: Fehler statt Bild", async () => {
    await expect(new ImageMaker({ store: new MemoryImageStore() }).make("castle", "landscape_4_3")).rejects.toThrow(/FAL_KEY/);
    await expect(new ImageMaker({ key: "k", store: new MemoryImageStore(), fetch: falReply(1024, 768, true) }).make("castle", "landscape_4_3")).rejects.toThrow(/Sicherheitsfilter/);
    expect((await serveImage(new MemoryImageStore(), "../etc/passwd")).status).toBe(404);
  });

  it("Porträt-Motiv aus Klasse, Herkunft und Aussehen", () => {
    const m = portraitMotif({ appearance: "rotes Haar", personality: { trait: "stur" }, classId: "ritter", stand: "bauer", equipment: ["schwert"] },
      { classes: [{ id: "ritter", name: "Ritter", tagline: "Schild und Schwert" }], rules: { stands: [{ id: "bauer", name: "Bauernkind" }], items: [{ id: "schwert", name: "Langschwert" }] } });
    expect(m).toContain("Ritter");
    expect(m).toContain("rotes Haar");
    expect(m).toContain("Langschwert");
  });
});

describe("Porträt-Beschreibung durch Claude", async () => {
  const { portraitPrompt } = await import("../server/gm/portrait");
  const { UsageGuard, MemoryCounterStore } = await import("../server/gm/usage");
  const c = { id: "x", classId: "ritter", stand: "bauer", appearance: "rotes Haar, Narbe", personality: { trait: "stur", ideal: "", bond: "", flaw: "jähzornig" }, equipment: ["schwert"] } as never;
  const data = { classes: [{ id: "ritter", name: "Ritter", tagline: "Schild und Schwert" }], rules: { stands: [{ id: "bauer", name: "Bauernkind", description: "vom Land" }], items: [{ id: "schwert", name: "Langschwert" }] } } as never;

  it("schickt Aussehen und Klasse an Claude und nimmt dessen Beschreibung", async () => {
    let asked = "";
    const llm = { stream: async (p: { messages: { content: string }[] }) => { asked = p.messages[0].content; return { content: [{ type: "text", text: "A weathered knight in his forties with fiery red hair and a scar across his brow, stubborn frown." }], usage: { input_tokens: 400, output_tokens: 60 } }; } };
    const r = await portraitPrompt({ llm: llm as never, guard: new UsageGuard(new MemoryCounterStore(), 10, 60) }, c, data);
    expect(asked).toContain("rotes Haar, Narbe");
    expect(asked).toContain("Ritter");
    expect(r.prompt).toContain("fiery red hair");
    expect(r.claudeUsd).toBeGreaterThan(0);
  });

  it("ohne Claude oder bei Fehler: einfache Beschreibung", async () => {
    const guard = new UsageGuard(new MemoryCounterStore(), 10, 60);
    expect((await portraitPrompt({ llm: null, guard }, c, data)).prompt).toContain("rotes Haar");
    const broken = { stream: async () => { throw new Error("weg"); } };
    expect(await portraitPrompt({ llm: broken as never, guard }, c, data)).toMatchObject({ claudeUsd: 0 });
  });
});

describe("Bild am Anfang von Kampagne und Kapitel, gemalter Kartenhintergrund", async () => {
  const path = await import("node:path");
  const { Narrator, chapterMark } = await import("../server/gm/narrator");
  const { UsageGuard, MemoryCounterStore } = await import("../server/gm/usage");
  const { RollLog } = await import("../server/dice/log");
  const { loadGameData } = await import("../server/rules/loader");
  const { buildCharacter } = await import("../server/characters");
  const { initWorld } = await import("../shared/world");
  const { visitPlace } = await import("../shared/map");
  const data = await loadGameData(path.resolve(__dirname, "../data"));
  const ritter = data.classes.find((c) => c.id === "ritter")!;
  const hagen = buildCharacter({ name: "Hagen", stand: "bauer", classId: "ritter", attributes: ritter.recommendedAttributes, chosenSkills: ["reiten", "wahrnehmung"] }, data);
  const llm = { stream: async () => ({ content: [{ type: "text", text: "CAPTION: Nebel am Galgen\nPROMPT: A muddy crossroads at dawn with a gallows, fog rising over the fields." }], usage: { input_tokens: 300, output_tokens: 40 } }) };
  let sizes: unknown[] = [];
  const fal = (async (_u: string, init: RequestInit) => { sizes.push(JSON.parse(String(init.body)).image_size); return (falReply(1024, 768) as unknown as () => Promise<Response>)(); }) as unknown as typeof fetch;
  const narrator = new Narrator({ llm: llm as never, rolls: new RollLog(), guard: new UsageGuard(new MemoryCounterStore(), 10, 60), images: new ImageMaker({ key: "k", store: new MemoryImageStore(), fetch: fal }) });
  const narration = "Nebel liegt über der Wegkreuzung, und am Galgen knarrt ein Seil im Wind. Ein Mann wartet dort.";

  it("malt am Anfang und beim Kapitelwechsel – sonst entscheidet Claude", async () => {
    const world = initWorld([hagen]);
    const shown: string[] = [];
    const scene = { characters: [hagen], data, world, onRoll: () => {}, onImage: (i: { caption: string }) => shown.push(i.caption) };
    const start = await narrator.imageIfDue({ mark: "", first: true, painted: false, narration, scene });
    expect(start.imageUsd).toBe(0.012);
    expect(start.claudeUsd).toBeGreaterThan(0);
    world.arc = { ...world.arc!, plan: { ziel: "z", bedrohung: "b" }, chapters: [{ titel: "Der Galgen", ziel: "", act: 0, detour: false, rueckweg: null, done: false, rueckblick: null }, { titel: "Die Mühle", ziel: "", act: 0, detour: false, rueckweg: null, done: false, rueckblick: null }], current: 0 };
    const mark = chapterMark(world);
    // Gleiches Kapitel: kein zusätzliches Bild (das entscheidet Claude)
    expect((await narrator.imageIfDue({ mark, first: false, painted: false, narration, scene })).imageUsd).toBe(0);
    // Claude hat schon ein Bild bestellt: keines zusätzlich
    world.arc.current = 1;
    expect((await narrator.imageIfDue({ mark, first: false, painted: true, narration, scene })).imageUsd).toBe(0);
    // Neues Kapitel: Kapiteltitel als Unterschrift
    expect((await narrator.imageIfDue({ mark, first: false, painted: false, narration, scene })).imageUsd).toBe(0.012);
    expect(shown).toEqual(["Der Anfang", "Die Mühle"]);
    // Sonst entscheidet Claude – auch nach mehreren Antworten ohne Bild
    const m2 = chapterMark(world);
    for (let i = 0; i < 3; i++) expect((await narrator.imageIfDue({ mark: m2, first: false, painted: false, narration, scene })).imageUsd).toBe(0);
    // Kampf vorbei (vorher Kampf, jetzt keiner): Bild
    world.combat = null;
    expect((await narrator.imageIfDue({ mark: m2, first: false, painted: false, narration, scene, wasFighting: true })).imageUsd).toBe(0.012);
    // Kampf läuft noch: kein Zwangsbild
    world.combat = { round: 2, enemies: [] };
    expect((await narrator.imageIfDue({ mark: m2, first: false, painted: false, narration, scene, wasFighting: true })).imageUsd).toBe(0);
    // Ortswechsel: Bild vom neuen Ort; am selben Ort keines
    world.combat = null;
    visitPlace(world, { name: "Kapelle im Moor", kind: "kloster" });
    world.map!.bg = "/api/images/karte"; // Kartenhintergrund gibt es schon
    expect((await narrator.imageIfDue({ mark: m2, first: false, painted: false, narration, scene, placeBefore: "Kapelle im Moor" })).imageUsd).toBe(0);
    visitPlace(world, { name: "Birkenfurt", kind: "dorf" });
    expect((await narrator.imageIfDue({ mark: m2, first: false, painted: false, narration, scene, placeBefore: "Kapelle im Moor" })).imageUsd).toBe(0.012);
  });

  it("Kartenhintergrund einmal je Kampagne, sobald es Orte gibt", async () => {
    const world = initWorld([hagen]);
    visitPlace(world, { name: "Rabenwald", kind: "wald" });
    const scene = { characters: [hagen], data, world, onRoll: () => {} };
    sizes = [];
    const first = await narrator.imageIfDue({ mark: "", first: false, painted: true, narration, scene });
    expect(first.imageUsd).toBe(0.012);
    expect(world.map!.bg).toMatch(/^\/api\/images\//);
    expect(sizes).toEqual([{ width: 992, height: 992 }]);
    expect((await narrator.imageIfDue({ mark: "", first: false, painted: true, narration, scene })).imageUsd).toBe(0);
  });
});
