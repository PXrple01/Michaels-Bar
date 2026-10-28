// Bilder über fal.ai (Z-Image Turbo, ca. 0,5 Cent pro Bild): Szenenbilder, wenn Claude eines vorschlägt, und Figurenporträts.
// Der Schlüssel (FAL_KEY) bleibt auf dem Server. Die fertigen Bilder speichern wir selbst (Netlify Blobs bzw. Ordner),
// damit sie nicht verschwinden, wenn fal.ai seine Kopie löscht.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface StoredImage { bytes: Uint8Array; type: string }
export interface ImageStore {
  put(id: string, img: StoredImage): Promise<void>;
  get(id: string): Promise<StoredImage | null>;
}

export class MemoryImageStore implements ImageStore {
  private map = new Map<string, StoredImage>();
  async put(id: string, img: StoredImage) { this.map.set(id, img); }
  async get(id: string) { return this.map.get(id) ?? null; }
}

export class FileImageStore implements ImageStore {
  constructor(private dir: string) {}
  async put(id: string, img: StoredImage) {
    await mkdir(this.dir, { recursive: true });
    await writeFile(path.join(this.dir, id), img.bytes);
    await writeFile(path.join(this.dir, `${id}.type`), img.type);
  }
  async get(id: string) {
    try { return { bytes: await readFile(path.join(this.dir, id)), type: (await readFile(path.join(this.dir, `${id}.type`), "utf8")).trim() }; }
    catch { return null; }
  }
}

/** Gültige Bild-IDs (auch als Dateiname sicher). */
export const IMAGE_ID = /^[a-z0-9-]{6,80}$/;
export const IMAGE_MODEL = "fal-ai/z-image/turbo";
/** Preis laut fal.ai: 0,005 $ pro angefangenem Megapixel. */
const USD_PER_MP = 0.005;

/** Einheitlicher Stil, damit alle Bilder zusammenpassen. */
const STYLE = "Dark medieval fantasy oil painting, painterly brushwork, dramatic chiaroscuro, warm ember and candle light against deep shadows, muted earthy palette with deep reds, Holy Roman Empire around 1400, detailed, cinematic composition. No text, no letters, no watermark, no frame.";

export type ImageShape = "landscape_4_3" | "portrait_4_3";

export class ImageMaker {
  constructor(private o: { key?: string; store: ImageStore; fetch?: typeof fetch }) {}

  get ready() { return !!this.o.key; }
  get store() { return this.o.store; }

  /** Malt ein Bild und speichert es. `id` überschreibt ein vorhandenes (z. B. das Porträt einer Figur). */
  async make(motif: string, shape: ImageShape, id?: string): Promise<{ url: string; costUsd: number }> {
    if (!this.o.key) throw new Error("Bilder sind nicht eingerichtet (FAL_KEY fehlt).");
    const f = this.o.fetch ?? fetch;
    const res = await f(`https://fal.run/${IMAGE_MODEL}`, {
      method: "POST",
      headers: { authorization: `Key ${this.o.key}`, "content-type": "application/json" },
      body: JSON.stringify({ prompt: `${motif.trim().slice(0, 1200)}\n\n${STYLE}`, image_size: shape, num_images: 1, output_format: "webp", sync_mode: true, enable_safety_checker: true }),
      signal: AbortSignal.timeout(40_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[Bilder] fal.ai ${res.status}: ${text.slice(0, 300)}`);
      throw new Error(res.status === 401 || res.status === 403 ? "Der fal.ai-Schlüssel wurde abgelehnt." : `fal.ai hat abgelehnt (${res.status}).`);
    }
    const out = (await res.json()) as { images?: { url: string; width?: number; height?: number; content_type?: string }[]; has_nsfw_concepts?: boolean[] };
    const img = out.images?.[0];
    if (!img?.url) throw new Error("fal.ai hat kein Bild geliefert.");
    if (out.has_nsfw_concepts?.[0]) throw new Error("Das Bild wurde vom Sicherheitsfilter aussortiert.");
    const stored = await download(img.url, f);
    const finalId = id ?? `img-${randomBytes(9).toString("hex")}`;
    await this.o.store.put(finalId, stored);
    const mp = Math.max(1, Math.ceil(((img.width ?? 1024) * (img.height ?? 768)) / 1_000_000));
    // Version im Link: ein neu gemaltes Porträt unter derselben ID wird nicht aus dem Browser-Zwischenspeicher genommen
    return { url: `/api/images/${finalId}?v=${Date.now().toString(36)}`, costUsd: mp * USD_PER_MP };
  }
}

async function download(url: string, f: typeof fetch): Promise<StoredImage> {
  const m = url.match(/^data:([^;,]+);base64,(.*)$/s);
  if (m) return { type: m[1], bytes: Buffer.from(m[2], "base64") };
  const r = await f(url, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error("Bild konnte nicht geladen werden.");
  return { type: r.headers.get("content-type") ?? "image/webp", bytes: new Uint8Array(await r.arrayBuffer()) };
}

/** Antwort für GET /api/images/:id */
export async function serveImage(store: ImageStore, id: string): Promise<Response> {
  if (!IMAGE_ID.test(id)) return new Response("Not found", { status: 404 });
  const img = await store.get(id);
  if (!img) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  return new Response(new Uint8Array(img.bytes), { headers: { "content-type": img.type, "cache-control": "public, max-age=31536000, immutable" } });
}

/** Bildbeschreibung für ein Figurenporträt (Aussehen und Persönlichkeit dürfen deutsch sein – das Modell versteht beides). */
export function portraitMotif(c: { appearance: string; personality: { trait: string }; classId: string; stand: string; equipment: string[] }, data: { classes: { id: string; name: string; tagline: string }[]; rules: { stands: { id: string; name: string }[]; items: { id: string; name: string }[] } }): string {
  const cls = data.classes.find((x) => x.id === c.classId);
  const stand = data.rules.stands.find((s) => s.id === c.stand);
  const gear = c.equipment.map((id) => data.rules.items.find((i) => i.id === id)?.name).filter(Boolean).slice(0, 4).join(", ");
  return [
    `Head-and-shoulders portrait of a medieval ${cls ? `${cls.name} (${cls.tagline})` : "adventurer"}, looking at the viewer, plain dark background.`,
    stand ? `Origin: ${stand.name}.` : "",
    c.appearance.trim() ? `Appearance: ${c.appearance.trim()}` : "",
    c.personality.trait.trim() ? `Expression fits this personality: ${c.personality.trait.trim()}` : "",
    gear ? `Visible equipment: ${gear}.` : "",
  ].filter(Boolean).join(" ");
}
