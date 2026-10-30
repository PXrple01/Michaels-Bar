// Bilder über fal.ai (FLUX.2 [dev], ca. 1,2 Cent pro Bild): Szenenbilder, wenn Claude eines vorschlägt, und Figurenporträts.
// Der Schlüssel (FAL_KEY) bleibt auf dem Server. Die fertigen Bilder speichern wir selbst (Netlify Blobs bzw. Ordner),
// damit sie nicht verschwinden, wenn fal.ai seine Kopie löscht.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GoogleError, isProviderFailure, type GoogleCloud } from "./google";

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
export const IMAGE_MODEL = "fal-ai/flux-2";
/** Mit Referenzbildern (Porträts der Figuren, bis zu 4): gleiche Gesichter, Haare und Kleidung in der Szene. */
export const IMAGE_EDIT_MODEL = "fal-ai/flux-2-pro/edit";
/** FLUX.2 [pro] edit (Richtwert): 0,03 $ für das erste Megapixel, 0,015 $ je weiteres – Referenzbilder zählen mit. */
const PRO_FIRST_MP = 0.03, PRO_EXTRA_MP = 0.015;
/** Preis laut fal.ai: ca. 0,012 $ pro angefangenem Megapixel. */
const USD_PER_MP = 0.012;

/** Einheitlicher Stil, damit alle Bilder zusammenpassen. */
const STYLE = "Dark medieval fantasy oil painting, painterly brushwork, dramatic chiaroscuro, warm ember and candle light against deep shadows, muted earthy palette with deep reds, Holy Roman Empire around 1400, detailed, cinematic composition. No text, no letters, no watermark, no frame.";

export type ImageShape = "landscape_4_3" | "portrait_4_3" | "square";
/** Quadratisch mit knapp 1 Megapixel – kostet so viel wie ein Querformat-Bild. */
const SIZE: Record<ImageShape, string | { width: number; height: number }> = { landscape_4_3: "landscape_4_3", portrait_4_3: "portrait_4_3", square: { width: 992, height: 992 } };

/** Imagen (Google, Testphase): Preis je Bild (Richtwert für imagen-4.0-generate-001). */
const IMAGEN_USD = 0.04;
const IMAGEN_RATIO: Record<ImageShape, string> = { landscape_4_3: "4:3", portrait_4_3: "3:4", square: "1:1" };

export class ImageMaker {
  constructor(private o: { key?: string; store: ImageStore; fetch?: typeof fetch; google?: GoogleCloud | null }) {}

  get ready() { return !!this.o.key || !!this.o.google?.active(); }
  get store() { return this.o.store; }

  /**
   * Malt ein Bild und speichert es. `id` überschreibt ein vorhandenes (z. B. das Porträt einer Figur).
   * `refs`: Figuren, die im Bild zu sehen sind – ihre Porträts gehen als Referenz mit (ohne Porträt: ohne Referenz).
   * Klappt es mit Referenzen nicht, wird ohne gemalt.
   */
  async make(motif: string, shape: ImageShape, id?: string, opts: { style?: boolean; refs?: { characterId: string; label: string }[] } = {}): Promise<{ url: string; costUsd: number }> {
    // Testphase: Imagen malt (Porträt-Vorlagen gibt es dort nicht). Klappt es nicht, malt wie bisher fal.ai.
    const g = this.o.google;
    if (g?.active()) {
      try { return await this.paintImagen(g, motif, shape, id, opts.style); }
      catch (e) {
        const status = e instanceof GoogleError ? e.status : undefined;
        if (isProviderFailure(status)) g.markBroken("Imagen", (e as Error).message);
        else console.error("[Bilder] Imagen fehlgeschlagen, male mit fal.ai:", (e as Error).message);
        if (!this.o.key) throw e;
      }
    }
    if (!this.o.key) throw new Error("Bilder sind nicht eingerichtet (FAL_KEY fehlt).");
    const refs = await this.references(opts.refs ?? []);
    if (refs.length) {
      try { return await this.paint(motif, shape, id, opts.style, refs); }
      catch (e) { console.error("[Bilder] Mit Porträt-Referenz fehlgeschlagen, male ohne:", (e as Error).message); }
    }
    return this.paint(motif, shape, id, opts.style, []);
  }

  private async paintImagen(g: GoogleCloud, motif: string, shape: ImageShape, id: string | undefined, style: boolean | undefined): Promise<{ url: string; costUsd: number }> {
    const prompt = style === false ? motif.trim().slice(0, 1600) : `${motif.trim().slice(0, 1200)}\n\n${STYLE}`;
    const { projectId, imageRegion, imageModel } = g.cfg;
    const res = await (this.o.fetch ?? fetch)(`https://${imageRegion}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${imageRegion}/publishers/google/models/${imageModel}:predict`, {
      method: "POST",
      headers: { authorization: `Bearer ${await g.token()}`, "content-type": "application/json" },
      body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio: IMAGEN_RATIO[shape], personGeneration: "allow_adult", outputOptions: { mimeType: "image/jpeg" } } }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new GoogleError(`Imagen ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`, res.status);
    const out = (await res.json()) as { predictions?: { bytesBase64Encoded?: string; mimeType?: string }[] };
    const img = out.predictions?.[0];
    if (!img?.bytesBase64Encoded) throw new GoogleError("Imagen hat kein Bild geliefert (vermutlich vom Sicherheitsfilter aussortiert)", 200);
    const finalId = id ?? `img-${randomBytes(9).toString("hex")}`;
    await this.o.store.put(finalId, { type: img.mimeType ?? "image/jpeg", bytes: new Uint8Array(Buffer.from(img.bytesBase64Encoded, "base64")) });
    return { url: `/api/images/${finalId}?v=${Date.now().toString(36)}`, costUsd: IMAGEN_USD };
  }

  /** Porträts der Figuren als data-URI (höchstens 4). */
  private async references(list: { characterId: string; label: string }[]): Promise<{ label: string; uri: string }[]> {
    const out: { label: string; uri: string }[] = [];
    for (const r of list.slice(0, 4)) {
      const img = await this.o.store.get(`portrait-${r.characterId}`);
      if (img) out.push({ label: r.label, uri: `data:${img.type};base64,${Buffer.from(img.bytes).toString("base64")}` });
    }
    return out;
  }

  private async paint(motif: string, shape: ImageShape, id: string | undefined, style: boolean | undefined, refs: { label: string; uri: string }[]): Promise<{ url: string; costUsd: number }> {
    const f = this.o.fetch ?? fetch;
    const base = style === false ? motif.trim().slice(0, 1600) : `${motif.trim().slice(0, 1200)}\n\n${STYLE}`;
    const prompt = refs.length
      ? `${refs.map((r, i) => `The person in image ${i + 1} is ${r.label}.`).join(" ")} Show them in this scene with the same face, hair, build and clothing as in their reference image, but as part of a new painting (not a copy of the portrait).\n\n${base}`
      : base;
    const res = await f(`https://fal.run/${refs.length ? IMAGE_EDIT_MODEL : IMAGE_MODEL}`, {
      method: "POST",
      headers: { authorization: `Key ${this.o.key}`, "content-type": "application/json" },
      body: JSON.stringify({ prompt, ...(refs.length ? { image_urls: refs.map((r) => r.uri) } : {}), image_size: SIZE[shape], num_images: 1, output_format: "webp", sync_mode: true, enable_safety_checker: true }),
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
    // Referenzbilder werden wie zusätzliche Megapixel berechnet (je Porträt knapp 1 MP)
    const outMp = Math.max(1, Math.ceil(((img.width ?? 1024) * (img.height ?? 768)) / 1_000_000));
    const cost = refs.length ? PRO_FIRST_MP + (outMp - 1 + refs.length) * PRO_EXTRA_MP : outMp * USD_PER_MP;
    // Version im Link: ein neu gemaltes Porträt unter derselben ID wird nicht aus dem Browser-Zwischenspeicher genommen
    return { url: `/api/images/${finalId}?v=${Date.now().toString(36)}`, costUsd: cost };
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
  // Szenenbilder ändern sich nie: ein Jahr im Browser und dauerhaft im Netlify-Zwischenspeicher (spart Funktionsaufrufe).
  // Porträts können neu gemalt werden (gleiche ID): nur kurz zwischenspeichern, Version im Link unterscheidet sie.
  const portrait = id.startsWith("portrait-");
  return new Response(new Uint8Array(img.bytes), {
    headers: portrait
      ? { "content-type": img.type, "cache-control": "public, max-age=300", "netlify-cdn-cache-control": "public, max-age=300, stale-while-revalidate=600", "netlify-vary": "query" }
      : { "content-type": img.type, "cache-control": "public, max-age=31536000, immutable", "netlify-cdn-cache-control": "public, max-age=31536000, immutable, durable" },
  });
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
