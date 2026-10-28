// Karte der Reise: Orte, an denen die Figuren waren, und die Wege dazwischen. Claude meldet Ankünfte (Werkzeug ort),
// der Server legt die Orte so aus, dass eine lesbare Karte entsteht – neue Orte grob in Reiserichtung, ohne Überlappung.
import type { WorldState } from "./world";

export const PLACE_KINDS = ["dorf", "stadt", "burg", "kloster", "wald", "hoehle", "ruine", "gasthaus", "fluss", "berg", "sonstiges"] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];
export interface Place { name: string; kind: PlaceKind; x: number; y: number; note?: string; visits: number; day: number }
export interface TravelMap { places: Place[]; roads: [string, string][]; current: string | null; /** Gemalter Hintergrund (Link zu /api/images/…). */ bg?: string }

export const MAX_PLACES = 40;
export const PLACE_NAME: Record<PlaceKind, string> = { dorf: "Dorf", stadt: "Stadt", burg: "Burg", kloster: "Kloster", wald: "Wald", hoehle: "Höhle", ruine: "Ruine", gasthaus: "Gasthaus", fluss: "Fluss", berg: "Berg", sonstiges: "Ort" };

/** Art eines Ortes aus seinem Namen erraten (für den Startimpuls). */
export function guessKind(name: string): PlaceKind {
  const n = name.toLowerCase();
  return /burg|feste|festung|schloss/.test(n) ? "burg" : /kloster|abtei|kapelle|kirche|dom/.test(n) ? "kloster" : /taverne|gasthaus|herberge|schenke|wirtshaus|hospiz|zollstation/.test(n) ? "gasthaus"
    : /stadt|markt|hafen/.test(n) ? "stadt" : /dorf|weiler|hof|gehöft|mühle|siedlung/.test(n) ? "dorf" : /wald|forst|hain/.test(n) ? "wald" : /höhle|grotte|mine|bergwerk|stollen/.test(n) ? "hoehle"
    : /ruine|trümmer/.test(n) ? "ruine" : /fluss|brücke|furt|see|moor|sumpf/.test(n) ? "fluss" : /berg|pass|gipfel|klippe/.test(n) ? "berg" : "sonstiges";
}

/** Aus dem Ort des Startimpulses („eine Kapelle auf einer Insel im Moor“) einen kurzen Kartennamen machen. */
export function startPlace(ort: string): { name: string; kind: PlaceKind } {
  const kind = guessKind(ort);
  let name = ort.trim().replace(/^(ein|eine|einer|einem|der|die|das|dem|den)\s+/i, "");
  name = name.split(/,|\s(?:mit|im|in|am|an|bei|nahe|unter|über|während|wo|tief)\s/)[0].trim() || name;
  return { name: name.charAt(0).toUpperCase() + name.slice(1), kind };
}

const hashAngle = (s: string) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return (h % 360) * (Math.PI / 180); };

/** Ankunft an einem Ort: neu anlegen (mit Weg vom letzten Ort) oder wieder besuchen. */
export function visitPlace(w: WorldState, p: { name: string; kind?: string; note?: string }): { place: Place; created: boolean } {
  const map = (w.map ??= { places: [], roads: [], current: null });
  const name = p.name.trim().slice(0, 60);
  const from = map.places.find((x) => x.name === map.current) ?? null;
  let place = map.places.find((x) => x.name.toLowerCase() === name.toLowerCase());
  const created = !place;
  if (!place) {
    if (map.places.length >= MAX_PLACES) {
      const drop = map.places.filter((x) => x.name !== map.current).sort((a, b) => a.visits - b.visits || a.day - b.day)[0];
      map.places.splice(map.places.indexOf(drop), 1);
      map.roads = map.roads.filter(([a, b]) => a !== drop.name && b !== drop.name);
    }
    let x = 0, y = 0;
    if (from) {
      // Grob weiter in Reiserichtung, sonst eine freie Richtung suchen
      const base = hashAngle(name);
      for (let i = 0; i < 12; i++) {
        const a = base + i * (Math.PI / 6), r = 1 + (i >= 6 ? 0.6 : 0);
        x = from.x + Math.cos(a) * r; y = from.y + Math.sin(a) * r;
        if (map.places.every((o) => Math.hypot(o.x - x, o.y - y) > 0.75)) break;
      }
    }
    place = { name, kind: (PLACE_KINDS as readonly string[]).includes(String(p.kind)) ? (p.kind as PlaceKind) : guessKind(name), x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, visits: 0, day: w.time?.day ?? 1 };
    map.places.push(place);
  }
  if (p.note?.trim()) place.note = p.note.trim().slice(0, 160);
  place.visits++;
  if (from && from !== place && !map.roads.some(([a, b]) => (a === from.name && b === place!.name) || (b === from.name && a === place!.name))) map.roads.push([from.name, place.name]);
  map.current = place.name;
  return { place, created };
}

/** Für Claude: wo die Gruppe ist und welche Orte sie kennt. */
export function mapSummary(w: WorldState): string {
  if (!w.map?.places.length) return "";
  return `Karte – jetzt in: ${w.map.current ?? "unterwegs"} | bekannte Orte: ${w.map.places.map((p) => `${p.name} (${PLACE_NAME[p.kind]})`).join(", ")}`;
}
