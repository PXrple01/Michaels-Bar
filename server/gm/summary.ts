// <spielstand> für jede Handlung: Lebenspunkte, Kampf, Aufträge, Stufen jedes Mal – der ausführliche Kampagnenstand
// (Plan, Rückblicke, Tempo) nur, wenn er sich geändert hat, und sonst alle ARC_EVERY Züge. Jede Wiederholung kostet
// beim Schreiben in den Cache und bleibt im Verlauf; so spart das etwa 300 Tokens pro Zug.
import { createHash } from "node:crypto";
import type { Character, Rules } from "../../shared/schema";
import { ACTS, arcSummary, currentChapter, isArc, worldSummary, type WorldState } from "../../shared/world";

export const ARC_EVERY = 5;

export function turnSummary(w: WorldState, characters: Pick<Character, "id" | "name">[], rules?: Rules): string {
  const base = worldSummary(w, characters, rules, { arc: false });
  if (!w.arc || !isArc(w.arc)) return base;
  const full = arcSummary(w.arc);
  const ch = currentChapter(w.arc);
  const hash = createHash("sha256").update(full).digest("base64url").slice(0, 12);
  const due = !w.arc.plan || !ch || !w.sent || w.sent.arc !== hash || w.sent.turns >= ARC_EVERY - 1;
  w.sent = { arc: hash, turns: due ? 0 : w.sent!.turns + 1 };
  if (due) return `${base}\n${full}`;
  return `${base}\nKampagne: Akt ${ch.act + 1} „${ACTS[ch.act].name}“, Kapitel „${ch.titel}“${ch.detour ? " (Abzweigung)" : ""} – Plan und Tempo unverändert wie im letzten ausführlichen <spielstand>.`;
}
