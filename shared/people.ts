// Personen, denen die Figuren begegnet sind: Name, Rolle, Haltung zur Gruppe und die letzten Notizen.
// Claude pflegt die Liste (Werkzeug person), die Spieler sehen sie in der Seitenleiste – nichts geht in langen Kampagnen verloren.
import type { WorldState } from "./world";

export const ATTITUDES = ["freund", "neutral", "misstrauisch", "feind"] as const;
export type Attitude = (typeof ATTITUDES)[number];
export const ATTITUDE_NAME: Record<Attitude, string> = { freund: "Freund", neutral: "neutral", misstrauisch: "misstrauisch", feind: "Feind" };
export interface Person { name: string; role: string; attitude: Attitude; notes: string[]; met: number; seen: number }

export const MAX_PEOPLE = 40;
const day = (w: WorldState) => w.time?.day ?? 1;

/** Person anlegen oder aktualisieren. Bei vollem Verzeichnis fällt die am längsten nicht gesehene neutrale Person heraus. */
export function upsertPerson(w: WorldState, p: { name: string; role?: string; attitude?: string; note?: string }): { person: Person; created: boolean } {
  w.people ??= [];
  const name = p.name.trim().slice(0, 60);
  let person = w.people.find((x) => x.name.toLowerCase() === name.toLowerCase());
  const created = !person;
  if (!person) {
    if (w.people.length >= MAX_PEOPLE) {
      const drop = [...w.people].filter((x) => x.attitude === "neutral").sort((a, b) => a.seen - b.seen)[0] ?? [...w.people].sort((a, b) => a.seen - b.seen)[0];
      w.people.splice(w.people.indexOf(drop), 1);
    }
    person = { name, role: "", attitude: "neutral", notes: [], met: day(w), seen: day(w) };
    w.people.push(person);
  }
  if (p.role?.trim()) person.role = p.role.trim().slice(0, 80);
  if ((ATTITUDES as readonly string[]).includes(String(p.attitude))) person.attitude = p.attitude as Attitude;
  if (p.note?.trim()) person.notes = [...person.notes, p.note.trim().slice(0, 200)].slice(-5);
  person.seen = day(w);
  return { person, created };
}

/** Für Claude: kompakt, wer wer ist (Notizen stehen im Verlauf). */
export function peopleSummary(w: WorldState): string {
  if (!w.people?.length) return "";
  return `Personen – ${w.people.map((p) => `${p.name}${p.role ? ` (${p.role})` : ""}: ${ATTITUDE_NAME[p.attitude]}`).join(" | ")}`;
}
