// Signierter Spielstand: Der Browser speichert den Verlauf, der Server signiert ihn.
// So kann niemand im Browser Würfelergebnisse, Proben oder die Figur nachträglich ändern.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { SignedState } from "../../shared/campaign";
import type { Character } from "../../shared/schema";

/** Fingerabdruck der spielrelevanten Werte einer Figur (Trefferpunkte dürfen sich ändern). */
export function characterHash(c: Character): string {
  const relevant = { id: c.id, classId: c.classId, stand: c.stand, level: c.level, attributes: c.attributes, chosenSkills: [...c.chosenSkills].sort() };
  return createHash("sha256").update(JSON.stringify(relevant)).digest("hex");
}

function mac(secret: string, messages: unknown[], charHash: string): string {
  return createHmac("sha256", secret).update(charHash).update("\n").update(JSON.stringify(messages)).digest("base64url");
}

export function signState(secret: string, messages: unknown[], charHash: string): SignedState {
  return { messages, characterHash: charHash, sig: mac(secret, messages, charHash) };
}

export function verifyState(secret: string, state: SignedState | undefined, c: Character): boolean {
  if (!state || !Array.isArray(state.messages) || typeof state.sig !== "string") return false;
  if (state.characterHash !== characterHash(c)) return false;
  const expected = Buffer.from(mac(secret, state.messages, state.characterHash));
  const given = Buffer.from(state.sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
