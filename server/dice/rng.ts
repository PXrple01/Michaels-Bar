// Kryptografischer Zufall ohne Modulo-Verzerrung (Rejection Sampling).
// Nur hier im Server entstehen Würfelergebnisse – Browser und Claude bekommen sie fertig.

export type RandomInt = (sides: number) => number;

const RANGE = 0x1_0000_0000; // 2^32
const buf = new Uint32Array(1);

/** Gleichverteilte Ganzzahl in [1, sides]. */
export const cryptoRandomInt: RandomInt = (sides) => {
  if (!Number.isInteger(sides) || sides < 1 || sides > 1_000_000) throw new RangeError(`Ungültige Seitenzahl: ${sides}`);
  const limit = RANGE - (RANGE % sides); // größtes Vielfaches von sides, das in 2^32 passt
  let x: number;
  do {
    globalThis.crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return (x % sides) + 1;
};
