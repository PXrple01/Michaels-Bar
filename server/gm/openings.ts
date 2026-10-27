// Würfelt den Startimpuls aus data/openings.json – mit kryptografischem Zufall, nicht durch Claude.
import type { Opening } from "../../shared/campaign";
import type { Openings } from "../../shared/schema";
import { createHash } from "node:crypto";
import { cryptoRandomInt, type RandomInt } from "../dice/rng";

const pick = <T,>(list: T[], rng: RandomInt) => list[rng(list.length) - 1];

export function openingSummary(o: Opening): string {
  return `${o.ort} · ${o.zeit} · ${o.anlass} · ${o.npc.name}, ${o.npc.rolle} · ${o.konflikt}`;
}

/** Würfelt neu, solange Ort oder Anlass schon in einem der letzten Einstiege vorkam (höchstens 12 Versuche). */
export function rollOpening(tables: Openings, previous: string[], rng: RandomInt = cryptoRandomInt): Opening {
  const recent = previous.slice(-8);
  let o: Opening;
  let tries = 0;
  do {
    o = {
      ort: pick(tables.orte, rng),
      zeit: pick(tables.zeiten, rng),
      anlass: pick(tables.anlaesse, rng),
      npc: { name: pick(tables.npc_namen, rng), rolle: pick(tables.npc_rollen, rng), eigenschaft: pick(tables.npc_eigenschaften, rng) },
      konflikt: pick(tables.konflikte, rng),
      detail: pick(tables.details, rng),
    };
  } while (++tries < 12 && recent.some((p) => p.includes(o.ort) || p.includes(o.anlass)));
  return o;
}

/** Immer gleicher „Zufall“ zu einem Text – damit derselbe Gesprächsanfang immer denselben Startimpuls ergibt. */
export function seededRng(seed: string): RandomInt {
  let counter = 0;
  return (sides) => createHash("sha256").update(`${seed}\n${counter++}`).digest().readUInt32BE(0) % sides + 1;
}
