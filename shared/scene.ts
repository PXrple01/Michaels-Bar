// Szene in Ton und Bild: welche Musik und welches Wetter-Bild gerade passen (ohne Browser – auch für Tests).
import type { WorldState } from "./world";

export type Mood = "taverne" | "wald" | "kampf" | "nacht" | "kirche" | "stadt" | "wildnis" | "dunkel";

/** Welche Musik passt gerade? */
export function moodOf(w: WorldState | null | undefined): Mood | null {
  if (!w) return null;
  if (w.combat) return "kampf";
  const kind = w.map?.places.find((p) => p.name === w.map?.current)?.kind;
  const place: Mood = kind === "gasthaus" ? "taverne" : kind === "wald" ? "wald" : kind === "kloster" ? "kirche"
    : kind === "stadt" || kind === "burg" ? "stadt" : kind === "hoehle" || kind === "ruine" ? "dunkel" : "wildnis";
  // Nachts wird es ruhig – außer drinnen in Taverne, Kirche oder Gewölbe
  if (w.time?.phase === "nacht" && (place === "wald" || place === "stadt" || place === "wildnis")) return "nacht";
  return place;
}

export type WeatherKind = "rain" | "storm" | "snow" | "fog" | null;
export function weatherKind(text: string | undefined): WeatherKind {
  const t = (text ?? "").toLowerCase();
  return /sturm|gewitter|unwetter/.test(t) && /schnee/.test(t) ? "snow" : /gewitter|sturm|stürm|unwetter/.test(t) ? "storm"
    : /schnee|flocken|graupel/.test(t) ? "snow" : /regen|niesel|schauer|verregnet/.test(t) ? "rain" : /nebel|dunst/.test(t) ? "fog" : null;
}
