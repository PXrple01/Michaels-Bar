// <spielstand> für jede Handlung: Lebenspunkte, Zeit, Kampf, Aufträge, Stufen jedes Mal – ausführliche Teile
// (Kampagnenplan mit Rückblicken und Tempo, Inventar) nur, wenn sie sich geändert haben, und sonst alle ARC_EVERY Züge.
// Jede Wiederholung kostet beim Schreiben in den Cache und bleibt im Verlauf; so spart das einige hundert Tokens pro Zug.
import { createHash } from "node:crypto";
import type { Character, Rules } from "../../shared/schema";
import { ACTS, arcSummary, currentChapter, isArc, worldSummary, type WorldState } from "../../shared/world";
import { inventorySummary } from "../../shared/inventory";
import { shopSummary } from "../../shared/shop";
import { gambleSummary } from "../../shared/gamble";
import { peopleSummary } from "../../shared/people";
import { mapSummary } from "../../shared/map";
import { standingSummary } from "../../shared/standing";

export const ARC_EVERY = 5;
const hashOf = (s: string) => createHash("sha256").update(s).digest("base64url").slice(0, 12);

export function turnSummary(w: WorldState, characters: Pick<Character, "id" | "name">[], rules?: Rules): string {
  const lines = [worldSummary(w, characters, rules, { arc: false })];
  const inv = inventorySummary(w, characters);
  const arc = w.arc && isArc(w.arc) ? w.arc : null;
  const full = arc ? arcSummary(arc) : "";
  const ch = arc ? currentChapter(arc) : null;
  const people = peopleSummary(w);
  const arcHash = hashOf(full), invHash = hashOf(inv), peopleHash = hashOf(people);
  const due = !w.sent || w.sent.turns >= ARC_EVERY - 1;
  const arcFull = !!arc && (due || !arc.plan || !ch || w.sent!.arc !== arcHash);
  const invFull = !!inv && (due || w.sent!.inv !== invHash);
  const peopleFull = !!people && (due || w.sent!.people !== peopleHash);
  const map = mapSummary(w), mapHash = hashOf(map);
  const mapFull = !!map && (due || w.sent!.map !== mapHash);
  const standing = standingSummary(w), standingHash = hashOf(standing);
  const standingFull = !!standing && (due || w.sent!.standing !== standingHash);
  w.sent = { arc: arcHash, inv: invHash, people: peopleHash, map: mapHash, standing: standingHash, turns: due ? 0 : w.sent!.turns + 1 };
  if (map) lines.push(mapFull ? map : `Ort: ${w.map!.current ?? "unterwegs"} (Karte sonst unverändert).`);
  if (people) lines.push(peopleFull ? people : "Personen: unverändert wie im letzten ausführlichen <spielstand>.");
  if (inv) lines.push(invFull ? inv : "Inventar: unverändert wie im letzten ausführlichen <spielstand>.");
  if (standing) lines.push(standingFull ? standing : "Ruf und Schicksal: unverändert wie im letzten ausführlichen <spielstand>.");
  const shop = shopSummary(w);
  if (shop) lines.push(shop);
  const gamble = gambleSummary(w);
  if (gamble) lines.push(gamble);
  if (arc) lines.push(arcFull ? full : `Kampagne: Akt ${ch!.act + 1} „${ACTS[ch!.act].name}“, Kapitel „${ch!.titel}“${ch!.detour ? " (Abzweigung)" : ""} – Plan und Tempo unverändert wie im letzten ausführlichen <spielstand>.`);
  return lines.join("\n");
}
