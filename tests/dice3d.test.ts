import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { DieKind } from "../shared/dice";
import { getDieModel, symmetryRotation, topValue, valueIndexOf } from "../web/src/dice3d/geometry";
import { planPhysicalRoll, planSimpleRoll } from "../web/src/dice3d/plan";

const KINDS: DieKind[] = ["d4", "d6", "d8", "d10", "d10t", "d10u", "d12", "d20"];
const OPPOSITE_SUM: Partial<Record<DieKind, number>> = { d6: 7, d8: 9, d10: 11, d10u: 9, d10t: 90, d12: 13, d20: 21 };

/** Kleiner deterministischer Zufallsgenerator für reproduzierbare Simulationen. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function finalTop(plan: ReturnType<typeof planPhysicalRoll>, i: number, kind: DieKind) {
  const t = plan.throw, tr = t.tracks[i], o = (t.frameCount - 1) * 7;
  const q = new THREE.Quaternion(tr[o + 3], tr[o + 4], tr[o + 5], tr[o + 6]).multiply(plan.remap[i]);
  const m = getDieModel(kind);
  const top = topValue(m, q);
  return { value: m.values[top.index].value, alignment: top.alignment };
}

describe("Würfelgeometrie", () => {
  it("hat die richtige Anzahl Flächen und jeden Wert genau einmal", () => {
    for (const k of KINDS) {
      const m = getDieModel(k);
      const sides = k === "d4" ? 4 : Number(k.replace(/\D/g, ""));
      expect(m.values).toHaveLength(sides);
      expect(new Set(m.values.map((v) => v.value)).size, k).toBe(sides);
    }
    expect(getDieModel("d20").values.map((v) => v.value).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(getDieModel("d10t").values.map((v) => v.label).sort()).toEqual(["00", "10", "20", "30", "40", "50", "60", "70", "80", "90"]);
  });

  it("gegenüberliegende Flächen ergeben die richtige Summe (W20: 21)", () => {
    for (const [k, sum] of Object.entries(OPPOSITE_SUM) as [DieKind, number][]) {
      const m = getDieModel(k);
      for (const a of m.values) {
        const opp = m.values.find((b) => b.dir.dot(a.dir) < -0.999)!;
        expect(opp, k).toBeDefined();
        expect(a.value + opp.value, `${k}: ${a.value}`).toBe(sum);
      }
    }
  });

  it("findet für jedes Wertepaar eine echte Symmetriedrehung", () => {
    for (const k of KINDS) {
      const m = getDieModel(k);
      for (let from = 0; from < m.values.length; from++) {
        for (let to = 0; to < m.values.length; to++) {
          const q = symmetryRotation(m, from, to);
          expect(m.values[from].dir.clone().applyQuaternion(q).distanceTo(m.values[to].dir), `${k} ${from}->${to}`).toBeLessThan(1e-6);
        }
      }
    }
  });
});

describe("Animation endet exakt auf dem Server-Ergebnis", () => {
  it("Physik-Simulation: alle Würfelarten, viele Ergebnisse", () => {
    const rand = mulberry32(42);
    for (const kind of KINDS) {
      const m = getDieModel(kind);
      for (const v of m.values) {
        const plan = planPhysicalRoll([{ kind, face: v.value }], { halfW: 9, halfD: 5.2 }, rand);
        const top = finalTop(plan, 0, kind);
        expect(top.value, `${kind} soll ${v.value}`).toBe(v.value);
        expect(top.alignment).toBeGreaterThan(0.99);
      }
    }
  });

  it("mehrere Würfel gleichzeitig (Vorteil, W100, Schaden)", () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 15; i++) {
      const dice = [
        { kind: "d20" as const, face: 1 + (i % 20) },
        { kind: "d20" as const, face: 20 - (i % 20) },
        { kind: "d10t" as const, face: (i % 10) * 10 },
        { kind: "d10u" as const, face: i % 10 },
        { kind: "d6" as const, face: 1 + (i % 6) },
      ];
      const plan = planPhysicalRoll(dice, { halfW: 9, halfD: 5.2 }, rand);
      dice.forEach((d, j) => expect(finalTop(plan, j, d.kind).value).toBe(d.face));
    }
  });

  it("vereinfachte Animation endet ebenfalls exakt", () => {
    for (const kind of KINDS) {
      const m = getDieModel(kind);
      for (const v of m.values) {
        const plan = planSimpleRoll([{ kind, face: v.value }], { halfW: 6, halfD: 5 });
        expect(finalTop(plan, 0, kind).value).toBe(v.value);
      }
    }
    expect(() => valueIndexOf(getDieModel("d6"), 7)).toThrow();
  });
});
