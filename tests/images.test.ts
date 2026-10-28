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
    expect(sent!.url).toBe("https://fal.run/fal-ai/z-image/turbo");
    expect(sent!.auth).toBe("Key k-123");
    expect(sent!.body).toMatchObject({ image_size: "landscape_4_3", sync_mode: true, output_format: "webp" });
    expect(String(sent!.body.prompt)).toContain("A castle at dusk");
    expect(costUsd).toBe(0.005);
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
