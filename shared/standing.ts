// Ruf bei Fraktionen, Schicksals-Entscheidungen und das Vermächtnis am Ende einer Kampagne.
// Claude meldet alles über Werkzeuge, der Server führt Buch – so bleibt es auch in langen Kampagnen verlässlich.
import type { WorldState } from "./world";

export interface Standing { score: number; notes: string[] }
/** Eine große Entscheidung. `folge` ist nur für Claude (mögliche spätere Auswirkung), die Spieler sehen die Entscheidung. */
export interface Fate { text: string; folge: string; day: number }
/** Ehrentitel und Erbstück einer Figur nach einer siegreichen Kampagne – nur zur Ehre, ohne Spielvorteil. */
export interface Legacy { characterId: string; title: string; heirloom: string }

export const REP_MIN = -10, REP_MAX = 10;
export const MAX_FACTIONS = 12, MAX_FATES = 30;

/** Wie eine Fraktion zur Gruppe steht – in Worten. */
export function standingName(score: number): string {
  return score <= -6 ? "verhasst" : score <= -3 ? "feindselig" : score < 0 ? "misstrauisch" : score === 0 ? "neutral" : score < 3 ? "wohlgesinnt" : score < 6 ? "geachtet" : "verehrt";
}

export function changeStanding(w: WorldState, faction: string, delta: number, note: string): { name: string; score: number } {
  const rep = (w.reputation ??= {});
  const key = Object.keys(rep).find((k) => k.toLowerCase() === faction.toLowerCase()) ?? faction;
  if (!rep[key] && Object.keys(rep).length >= MAX_FACTIONS) {
    // Die unwichtigste (am nächsten an neutral) weicht
    const drop = Object.entries(rep).sort((a, b) => Math.abs(a[1].score) - Math.abs(b[1].score))[0][0];
    delete rep[drop];
  }
  const s = (rep[key] ??= { score: 0, notes: [] });
  s.score = Math.max(REP_MIN, Math.min(REP_MAX, s.score + delta));
  if (note) s.notes = [...s.notes, note].slice(-4);
  return { name: key, score: s.score };
}

export function addFate(w: WorldState, text: string, folge: string): Fate {
  const fate = { text, folge, day: w.time?.day ?? 1 };
  w.fates = [...(w.fates ?? []), fate].slice(-MAX_FATES);
  return fate;
}

/** Für Claude im <spielstand>: Ruf und Entscheidungen, auf die die Welt reagieren soll. */
export function standingSummary(w: WorldState): string {
  const lines: string[] = [];
  const rep = Object.entries(w.reputation ?? {});
  if (rep.length) lines.push(`Ruf – ${rep.map(([k, s]) => `${k} ${s.score > 0 ? "+" : ""}${s.score} (${standingName(s.score)})`).join(", ")}. Lass Menschen dieser Gruppen entsprechend reagieren: Türen öffnen oder verschließen sich.`);
  if (w.fates?.length) lines.push(`Schicksalsentscheidungen (greife sie später auf, wenn es passt): ${w.fates.map((f) => `„${f.text}“${f.folge ? ` → ${f.folge}` : ""}`).join("; ")}`);
  return lines.join("\n");
}
