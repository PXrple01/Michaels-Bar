import { describe, expect, it } from "vitest";
import { NotationError, parseNotation } from "../shared/dice";
import { performRoll } from "../server/dice/engine";
import { RollLog } from "../server/dice/log";
import { cryptoRandomInt } from "../server/dice/rng";

/** Liefert vorgegebene Zahlen nacheinander – für deterministische Tests. */
const scripted = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe("cryptoRandomInt", () => {
  it("bleibt immer im Bereich 1..n", () => {
    for (const sides of [2, 4, 6, 8, 10, 12, 20, 100]) {
      for (let i = 0; i < 2000; i++) {
        const v = cryptoRandomInt(sides);
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(sides);
        expect(Number.isInteger(v)).toBe(true);
      }
    }
  });

  it("ist grob gleichverteilt (Chi-Quadrat, W20)", () => {
    const N = 200_000;
    const counts = new Array(21).fill(0);
    for (let i = 0; i < N; i++) counts[cryptoRandomInt(20)]++;
    const expected = N / 20;
    const chi2 = counts.slice(1).reduce((s, c) => s + (c - expected) ** 2 / expected, 0);
    // 19 Freiheitsgrade: p = 0.001 liegt bei ~43.8
    expect(chi2).toBeLessThan(43.8);
  });

  it("lehnt ungültige Seitenzahlen ab", () => {
    expect(() => cryptoRandomInt(0)).toThrow();
    expect(() => cryptoRandomInt(2.5)).toThrow();
  });
});

describe("parseNotation", () => {
  it("versteht deutsche und englische Schreibweise", () => {
    expect(parseNotation("2W6+3")).toMatchObject({ terms: [{ count: 2, sides: 6 }], modifier: 3, text: "2W6+3" });
    expect(parseNotation("1d20-1")).toMatchObject({ terms: [{ count: 1, sides: 20 }], modifier: -1 });
    expect(parseNotation("W100").text).toBe("1W100");
    expect(parseNotation("1W8 + 1W8 + 2").text).toBe("2W8+2");
  });

  it("lehnt Unsinn ab", () => {
    for (const bad of ["", "abc", "1W7", "0W6", "21W6", "1W6-1W4", "1W6+", "W"]) {
      expect(() => parseNotation(bad), bad).toThrow(NotationError);
    }
  });
});

describe("performRoll", () => {
  it("addiert Würfel und Modifikator", () => {
    const r = performRoll({ requestId: "test-0001", kind: "free", label: "x", notation: "2W6+3" }, scripted(4, 5));
    expect(r.values).toEqual([4, 5]);
    expect(r.total).toBe(12);
    expect(r.dice.map((d) => [d.kind, d.face])).toEqual([["d6", 4], ["d6", 5]]);
    expect(r.natural).toBeNull();
  });

  it("Vorteil nimmt den höheren, Nachteil den niedrigeren W20", () => {
    const adv = performRoll({ requestId: "test-0002", kind: "free", label: "x", notation: "1W20+2", mode: "advantage" }, scripted(7, 15));
    expect(adv.natural).toBe(15);
    expect(adv.total).toBe(17);
    expect(adv.dice.map((d) => d.kept)).toEqual([false, true]);
    const dis = performRoll({ requestId: "test-0003", kind: "free", label: "x", notation: "1W20", mode: "disadvantage" }, scripted(7, 15));
    expect(dis.natural).toBe(7);
    expect(dis.dice.map((d) => d.kept)).toEqual([true, false]);
  });

  it("erlaubt Vorteil nur für einen einzelnen W20", () => {
    expect(() => performRoll({ requestId: "test-0004", kind: "free", label: "x", notation: "2W6", mode: "advantage" })).toThrow(NotationError);
  });

  it("natürliche 20 gelingt immer, natürliche 1 misslingt immer", () => {
    const hit = performRoll({ requestId: "test-0005", kind: "check", label: "x", notation: "1W20", dc: 30 }, scripted(20));
    expect(hit).toMatchObject({ success: true, critical: "hit" });
    const fumble = performRoll({ requestId: "test-0006", kind: "check", label: "x", notation: "1W20", modifierParts: [{ label: "Bonus", value: 15 }], dc: 5 }, scripted(1));
    expect(fumble).toMatchObject({ success: false, critical: "fumble", total: 16 });
    const normal = performRoll({ requestId: "test-0007", kind: "check", label: "x", notation: "1W20", modifierParts: [{ label: "Bonus", value: 2 }], dc: 13 }, scripted(11));
    expect(normal).toMatchObject({ success: true, total: 13 });
  });

  it("W100 besteht aus Zehner- und Einerwürfel, 00 + 0 = 100", () => {
    const r = performRoll({ requestId: "test-0008", kind: "free", label: "x", notation: "1W100" }, scripted(5, 8)); // Zehner 4, Einer 7
    expect(r.values).toEqual([47]);
    expect(r.dice.map((d) => [d.kind, d.face])).toEqual([["d10t", 40], ["d10u", 7]]);
    const hundred = performRoll({ requestId: "test-0009", kind: "free", label: "x", notation: "1W100" }, scripted(1, 1));
    expect(hundred.values).toEqual([100]);
  });

  it("W100 ist über echten Zufall gleichverteilt auf 1–100", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const r = performRoll({ requestId: `t100-${String(i).padStart(4, "0")}`, kind: "free", label: "x", notation: "1W100" });
      expect(r.total).toBeGreaterThanOrEqual(1);
      expect(r.total).toBeLessThanOrEqual(100);
      seen.add(r.total);
    }
    expect(seen.size).toBe(100);
  });
});

describe("RollLog", () => {
  it("würfelt jede requestId nur einmal – kein Neuwürfeln möglich", async () => {
    const log = new RollLog(null);
    const first = await log.roll({ requestId: "same-request-1", kind: "free", label: "x", notation: "1W20" });
    for (let i = 0; i < 20; i++) {
      const again = await log.roll({ requestId: "same-request-1", kind: "free", label: "x", notation: "1W20" });
      expect(again.id).toBe(first.id);
      expect(again.total).toBe(first.total);
      expect(again.repeated).toBe(true);
    }
    // Auch eine veränderte Anfrage mit derselben ID bekommt den alten Wurf
    const tampered = await log.roll({ requestId: "same-request-1", kind: "free", label: "x", notation: "1W20+50" });
    expect(tampered.total).toBe(first.total);
    expect(log.recent()).toHaveLength(1);
  });

  it("lehnt ungültige requestIds ab", async () => {
    const log = new RollLog(null);
    await expect(log.roll({ requestId: "x", kind: "free", label: "x", notation: "1W20" })).rejects.toThrow();
  });
});
