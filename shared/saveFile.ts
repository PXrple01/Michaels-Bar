// Spielstand als Datei: exportieren (Figur + Abenteuer) und auf einem anderen Gerät oder Konto wieder einlesen.
// Der Server prüft beim Einlesen alles neu: Mit gültiger Signatur geht es nahtlos weiter, sonst übernimmt er Welt und
// Geschichte mit Grenzen (Lebenspunkte, Gepäck, Geld) und fasst den bisherigen Verlauf für Claude zusammen.
import type { CampaignSave, Opening, StoryEntry } from "./campaign";
import type { Character } from "./schema";

export const SAVE_FORMAT = "the-last-ember-spielstand";
export const SAVE_VERSION = 1;
/** Größte Datei, die angenommen wird (Zeichen). */
export const SAVE_MAX_CHARS = 3_000_000;

/**
 * character fehlt bei vorbereiteten Abenteuern (z. B. einem Szenario für eine vorhandene Figur): Dann wählt man beim
 * Einlesen eine eigene Figur – characterName schlägt eine passende vor.
 */
export interface SaveFile { format: typeof SAVE_FORMAT; version: number; exportedAt: string; character?: Character | null; characterName?: string; campaign: CampaignSave }

export function makeSaveFile(character: Character, campaign: CampaignSave, now = new Date()): SaveFile {
  return { format: SAVE_FORMAT, version: SAVE_VERSION, exportedAt: now.toISOString(), character, campaign };
}

/** Datei lesen und grob prüfen. Fehlertext oder die Datei. */
export function parseSaveFile(raw: string): SaveFile | string {
  if (raw.length > SAVE_MAX_CHARS) return "Die Datei ist zu groß für einen Spielstand.";
  let f: Partial<SaveFile>;
  try { f = JSON.parse(raw); } catch { return "Das ist keine Spielstand-Datei (kein gültiges JSON)."; }
  if (!f || f.format !== SAVE_FORMAT) return "Das ist keine Spielstand-Datei von The Last Ember.";
  if (typeof f.version !== "number" || f.version > SAVE_VERSION) return "Diese Datei stammt aus einer neueren Version – bitte die Seite neu laden.";
  if (f.character != null && (typeof f.character !== "object" || typeof (f.character as Character).id !== "string")) return "Die Figur in der Datei ist beschädigt.";
  const c = f.campaign as Partial<CampaignSave> | undefined;
  if (!c || typeof c !== "object" || !Array.isArray(c.story) || !c.state || typeof c.state !== "object") return "In der Datei fehlt das Abenteuer.";
  return f as SaveFile;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const safeUrl = (u: unknown) => typeof u === "string" && (/^\/api\/images\/[\w-]+$/.test(u) || /^https:\/\/[^\s"'<>]+$/.test(u)) ? u : null;

/** Nur bekannte Einträge, Texte gekürzt, Bilder nur von hier oder https. */
export function sanitizeStory(raw: unknown): StoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: StoryEntry[] = [];
  for (const e of raw.slice(-600)) {
    if (!e || typeof e !== "object") continue;
    const x = e as Record<string, unknown>;
    if ((x.type === "gm" || x.type === "player") && typeof x.text === "string" && x.text.trim()) out.push({ type: x.type, text: x.text.slice(0, 20_000) });
    else if (x.type === "image") { const url = safeUrl(x.url); if (url) out.push({ type: "image", url, caption: str(x.caption, 80) }); }
    else if (x.type === "roll" && x.record && typeof x.record === "object") {
      const r = x.record as Record<string, unknown>;
      if (typeof r.label === "string" && typeof r.total === "number" && typeof r.natural === "number" && typeof r.notation === "string") out.push({ type: "roll", record: r as never, auto: x.auto === true });
    }
  }
  return out;
}

export function sanitizeOpening(raw: unknown): Opening {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const npc = (o.npc && typeof o.npc === "object" ? o.npc : {}) as Record<string, unknown>;
  return {
    ort: str(o.ort, 120) || "ein fremder Ort", zeit: str(o.zeit, 80) || "ein Tag wie jeder andere", anlass: str(o.anlass, 200),
    npc: { name: str(npc.name, 60) || "Unbekannt", rolle: str(npc.rolle, 80), eigenschaft: str(npc.eigenschaft, 120) },
    konflikt: str(o.konflikt, 200), detail: str(o.detail, 200),
  };
}
