// Verbindet Server-Ergebnis und Animation: Simulation (oder vereinfachte Bahn) + Umbeschriftung per Symmetrie.
import * as THREE from "three";
import type { DieKind } from "../../../shared/dice";
import { getDieModel, orientationForValue, symmetryRotation, valueIndexOf } from "./geometry";
import { simulateThrow, type Arena, type ThrowResult } from "./simulate";

export interface PlannedDie { kind: DieKind; face: number }

export interface RollPlan {
  throw: ThrowResult;
  /** Pro Würfel: feste Drehung des sichtbaren Modells relativ zum Physikkörper. */
  remap: THREE.Quaternion[];
}

export function planPhysicalRoll(dice: PlannedDie[], arena: Arena, rand: () => number = Math.random): RollPlan {
  const kinds = dice.map((d) => d.kind);
  const t = simulateThrow(kinds, arena, rand);
  const remap = dice.map((d, i) => {
    const model = getDieModel(d.kind);
    return symmetryRotation(model, valueIndexOf(model, d.face), t.landed[i]);
  });
  return { throw: t, remap };
}

const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);

/**
 * Vereinfachte Animation für schwache Geräte: berechnete Bahn mit Sprüngen und Drehung,
 * die exakt in der Zielorientierung endet. Keine Physik nötig.
 */
export function planSimpleRoll(dice: PlannedDie[], arena: Arena, rand: () => number = Math.random, seconds = 1.6): RollPlan {
  const dt = 1 / 60;
  const frames = Math.round(seconds / dt);
  const spacing = Math.min(2.8, (arena.halfW * 1.4) / Math.max(1, dice.length));
  const tracks = dice.map((d, i) => {
    const model = getDieModel(d.kind);
    const index = valueIndexOf(model, d.face);
    const end = orientationForValue(model, index, rand() * Math.PI * 2);
    const restY = restingHeight(model.kind, end);
    const endPos = new THREE.Vector3((i - (dice.length - 1) / 2) * spacing + (rand() - 0.5), restY, (rand() - 0.5) * arena.halfD * 0.6);
    const startPos = new THREE.Vector3(-arena.halfW * 0.9, 4, endPos.z + (rand() - 0.5) * 3);
    const axis = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
    const turns = (2.5 + rand() * 2) * Math.PI * 2;
    const out = new Float32Array(frames * 7);
    const q = new THREE.Quaternion();
    for (let f = 0; f < frames; f++) {
      const t = f / (frames - 1);
      const e = easeOutCubic(t);
      const x = startPos.x + (endPos.x - startPos.x) * e;
      const z = startPos.z + (endPos.z - startPos.z) * e;
      const bounce = Math.abs(Math.cos(t * Math.PI * 3.2)) * Math.pow(1 - t, 2.2) * 4;
      const y = restY + bounce;
      q.setFromAxisAngle(axis, turns * Math.pow(1 - t, 2.4)).multiply(end);
      const o = f * 7;
      out.set([x, y, z, q.x, q.y, q.z, q.w], o);
    }
    return out;
  });
  const impacts = [0.32, 0.58, 0.78].map((p, i) => ({ frame: Math.round(p * frames), strength: 6 - i * 2, kind: "table" as const }));
  return {
    throw: { dt, frameCount: frames, tracks, landed: dice.map((d) => valueIndexOf(getDieModel(d.kind), d.face)), impacts },
    remap: dice.map(() => new THREE.Quaternion()),
  };
}

/** Höhe des Mittelpunkts, wenn der Würfel in dieser Orientierung auf dem Tisch liegt. */
export function restingHeight(kind: DieKind, q: THREE.Quaternion): number {
  const model = getDieModel(kind);
  let min = Infinity;
  for (const v of model.vertices) min = Math.min(min, v.clone().applyQuaternion(q).y);
  return -min;
}
