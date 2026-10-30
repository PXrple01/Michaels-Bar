// Abstimmung in der Gruppe: Claude stellt bei großen Entscheidungen eine Frage mit 2–4 Antworten, jede Person stimmt per Knopf
// ab (das zählt zugleich als ihre Handlung). Ausgezählt wird, wenn erzählt wird: Mehrheit gewinnt, bei Gleichstand der Würfel.
import type { Character } from "./schema";
import type { WorldState } from "./world";

export interface VoteResult { option: number; counts: number[]; tie: boolean }
export interface Vote { question: string; options: string[]; votes: Record<string, number>; since: string; result?: VoteResult }

export const VOTE_OPTIONS_MAX = 4;

export function openVote(w: WorldState, question: string, options: string[], now = new Date()): string | null {
  const opts = options.map((o) => o.trim().slice(0, 60)).filter((o, i, all) => o && all.findIndex((x) => x.toLowerCase() === o.toLowerCase()) === i).slice(0, VOTE_OPTIONS_MAX);
  if (opts.length < 2) return "Eine Abstimmung braucht mindestens zwei verschiedene Antworten.";
  w.vote = { question: question.trim().slice(0, 160) || "Wie entscheidet ihr?", options: opts, votes: {}, since: now.toISOString() };
  return null;
}

/** Stimme abgeben (oder ändern, solange noch nicht ausgezählt ist). Fehlertext oder null. */
export function castVote(w: WorldState | null | undefined, characterId: string, raw: unknown): string | null {
  const v = w?.vote;
  if (!v || v.result) return "Gerade läuft keine Abstimmung.";
  const i = Number(raw);
  if (!Number.isInteger(i) || i < 0 || i >= v.options.length) return "Diese Antwort gibt es nicht.";
  v.votes[characterId] = i;
  return null;
}

/** Auszählen: Mehrheit gewinnt; bei Gleichstand (oder ohne Stimmen) entscheidet der Würfel unter den Besten. */
export function resolveVote(w: WorldState, rand: (n: number) => number): VoteResult | null {
  const v = w.vote;
  if (!v || v.result) return v?.result ?? null;
  const counts = v.options.map((_, i) => Object.values(v.votes).filter((x) => x === i).length);
  const top = Math.max(...counts);
  const best = counts.map((n, i) => (n === top ? i : -1)).filter((i) => i >= 0);
  v.result = { option: best.length > 1 ? best[rand(best.length)] : best[0], counts, tie: best.length > 1 };
  return v.result;
}

/** Für Claude: offene Frage bzw. Ergebnis (danach ist die Abstimmung vorbei). */
export function voteSummary(w: WorldState, characters: Pick<Character, "id" | "name">[]): string {
  const v = w.vote;
  if (!v) return "";
  if (!v.result) return `Abstimmung läuft: „${v.question}“ (${v.options.join(" / ")}) – noch nicht ausgezählt.`;
  const who = characters.filter((c) => c.id in v.votes).map((c) => `${c.name}: ${v.options[v.votes[c.id]]}`).join(", ");
  const r = v.result;
  w.vote = null;
  return `Abstimmung „${v.question}“ entschieden: ${v.options[r.option]} (${v.options.map((o, i) => `${o} ${r.counts[i]}`).join(", ")}${r.tie ? "; Gleichstand – der Würfel hat entschieden" : ""})${who ? `. Stimmen: ${who}` : ""}. Erzähle mit diesem Ergebnis weiter.`;
}
