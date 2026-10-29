// Ruf bei Fraktionen, Schicksals-Entscheidungen und das Vermächtnis am Ende einer Kampagne.
// Claude meldet alles über Werkzeuge, der Server führt Buch – so bleibt es auch in langen Kampagnen verlässlich.
import type { WorldState } from "./world";

export interface Standing { score: number; notes: string[] }
/** Eine große Entscheidung. `folge` ist nur für Claude (mögliche spätere Auswirkung), die Spieler sehen die Entscheidung. */
export interface Fate { text: string; folge: string; day: number }
/** Ehrentitel und Erbstück einer Figur nach einer siegreichen Kampagne – nur zur Ehre, ohne Spielvorteil. */
export interface Legacy { characterId: string; title: string; heirloom: string }

/** Begleiter: reist mit der Gruppe, hat eine eigene Meinung (Treue −5 bis +5) und etwas, das er gut kann. */
export interface Companion { name: string; role: string; skill: string; loyalty: number; notes: string[]; look?: string; portrait?: string }
export interface Rumor { text: string; day: number }

export const REP_MIN = -10, REP_MAX = 10;
export const MAX_COMPANIONS = 3, MAX_RUMORS = 8;
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

export const loyaltyName = (n: number) => n <= -4 ? "kurz vor dem Bruch" : n <= -2 ? "unzufrieden" : n < 2 ? "loyal" : n < 4 ? "treu ergeben" : "würde für euch sterben";

/** Begleiter aufnehmen, ändern oder verabschieden. Fehlertext oder Ergebnistext. */
export function companionAction(w: WorldState, a: { action: string; name: string; role?: string; skill?: string; loyalty?: number; note?: string; look?: string }): { ok: boolean; text: string } {
  const list = (w.companions ??= []);
  const c = list.find((x) => x.name.toLowerCase() === a.name.toLowerCase());
  if (a.action === "verlassen") {
    if (!c) return { ok: false, text: `${a.name} reist nicht mit der Gruppe.` };
    w.companions = list.filter((x) => x !== c);
    return { ok: true, text: `${c.name} verlässt die Gruppe.` };
  }
  if (!c && a.action !== "beitreten") return { ok: false, text: `${a.name} reist nicht mit der Gruppe – erst mit aktion beitreten aufnehmen.` };
  if (!c && list.length >= MAX_COMPANIONS) return { ok: false, text: `Höchstens ${MAX_COMPANIONS} Begleiter gleichzeitig.` };
  const comp = c ?? { name: a.name, role: "", skill: "", loyalty: 1, notes: [] };
  if (!c) list.push(comp);
  if (a.role?.trim()) comp.role = a.role.trim().slice(0, 60);
  if (a.skill?.trim()) comp.skill = a.skill.trim().slice(0, 120);
  if (a.look?.trim() && !comp.look) comp.look = a.look.trim().slice(0, 300);
  if (a.loyalty) comp.loyalty = Math.max(-5, Math.min(5, comp.loyalty + Math.max(-2, Math.min(2, Math.round(a.loyalty)))));
  if (a.note?.trim()) comp.notes = [...comp.notes, a.note.trim().slice(0, 160)].slice(-4);
  return { ok: true, text: `${c ? "Begleiter" : "Neuer Begleiter"}: ${comp.name}${comp.role ? ` (${comp.role})` : ""}, Treue ${comp.loyalty} (${loyaltyName(comp.loyalty)}).` };
}

export function addRumor(w: WorldState, text: string) {
  if ((w.rumors ?? []).some((r) => r.text === text)) return;
  w.rumors = [...(w.rumors ?? []), { text, day: w.time?.day ?? 1 }].slice(-MAX_RUMORS);
}

/** Für Claude im <spielstand>: Ruf und Entscheidungen, auf die die Welt reagieren soll. */
export function standingSummary(w: WorldState): string {
  const lines: string[] = [];
  const rep = Object.entries(w.reputation ?? {});
  if (rep.length) lines.push(`Ruf – ${rep.map(([k, s]) => `${k} ${s.score > 0 ? "+" : ""}${s.score} (${standingName(s.score)})`).join(", ")}. Lass Menschen dieser Gruppen entsprechend reagieren: Türen öffnen oder verschließen sich.`);
  if (w.companions?.length) lines.push(`Begleiter (spiele sie mit eigener Stimme und Meinung, lass sie helfen und widersprechen; Treue sinkt bei Entscheidungen gegen ihre Werte): ${w.companions.map((c) => `${c.name}${c.role ? ` (${c.role})` : ""}, kann: ${c.skill || "–"}, Treue ${c.loyalty} (${loyaltyName(c.loyalty)})`).join(" | ")}`);
  if (w.rumors?.length) lines.push(`Gerüchte, die die Figuren kennen (wahr oder falsch – du entscheidest; daraus können Nebenaufträge werden): ${w.rumors.map((r) => `„${r.text}“`).join("; ")}`);
  if (w.fates?.length) lines.push(`Schicksalsentscheidungen (greife sie später auf, wenn es passt): ${w.fates.map((f) => `„${f.text}“${f.folge ? ` → ${f.folge}` : ""}`).join("; ")}`);
  return lines.join("\n");
}
