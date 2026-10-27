// Signierter Spielstand: Der Browser speichert den Verlauf, der Server signiert ihn.
// So kann niemand im Browser Würfelergebnisse, Proben, Lebenspunkte oder die Figur nachträglich ändern.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { SignedState } from "../../shared/campaign";
import type { Character } from "../../shared/schema";
import type { WorldState } from "../../shared/world";

/** Fingerabdruck der spielrelevanten Werte einer Figur (Trefferpunkte dürfen sich ändern). */
export function characterHash(c: Character): string {
  const relevant = { id: c.id, classId: c.classId, stand: c.stand, level: c.level, attributes: c.attributes, chosenSkills: [...c.chosenSkills].sort() };
  return createHash("sha256").update(JSON.stringify(relevant)).digest("hex");
}

type Signed = Omit<SignedState, "sig" | "characterHash">;

function mac(secret: string, s: Signed, charHash: string): string {
  const h = createHmac("sha256", secret).update(charHash).update("\n");
  // Ältere Spielstände (ohne Werkzeugstand) wurden nur über den Verlauf signiert.
  if (s.toolset) h.update(JSON.stringify({ t: s.toolset, w: s.world ?? null, h: s.held ?? [] })).update("\n");
  return h.update(JSON.stringify(s.messages)).digest("base64url");
}

export function signState(secret: string, s: { messages: unknown[]; world: WorldState; held: unknown[]; toolset: number }, charHash: string): SignedState {
  return { ...s, characterHash: charHash, sig: mac(secret, s, charHash) };
}

export function verifyState(secret: string, state: SignedState | undefined, c: Character): boolean {
  if (!state || !Array.isArray(state.messages) || typeof state.sig !== "string") return false;
  if (state.characterHash !== characterHash(c)) return false;
  const expected = Buffer.from(mac(secret, state, state.characterHash));
  const given = Buffer.from(state.sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
