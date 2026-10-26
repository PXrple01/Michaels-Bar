// Geometrie aller Würfel: Flächen, Nummerierung, Ablesen und Symmetrie-Drehungen.
// Kein DOM – läuft auch in Node (Tests).
import * as THREE from "three";
import type { DieKind } from "../../../shared/dice";

export interface DieFace {
  normal: THREE.Vector3;
  center: THREE.Vector3;
  /** Eckpunkte, gegen den Uhrzeigersinn von außen gesehen. */
  polygon: THREE.Vector3[];
  vertexIndices: number[];
  /** Richtung in der Flächenebene, in die die Oberseite der Zahl zeigt. */
  up: THREE.Vector3;
}

export interface ValueDir { dir: THREE.Vector3; value: number; label: string }

export interface DieModel {
  kind: DieKind;
  vertices: THREE.Vector3[];
  faces: DieFace[];
  /** Mögliche Ergebnisse: Flächennormale (bzw. Eckenrichtung beim W4) → Wert. */
  values: ValueDir[];
  /** Beim W4 zählt die oben liegende Ecke, sonst die oben liegende Fläche. */
  readMode: "face" | "vertex";
  /** Für Flächen: Index in values; beim W4 bleibt die Beschriftung pro Ecke. */
  faceValue: (number | null)[];
  radius: number;
}

const EPS = 1e-4;

function keyOf(v: THREE.Vector3) {
  return `${Math.round(v.x / EPS)},${Math.round(v.y / EPS)},${Math.round(v.z / EPS)}`;
}

/** Baut ein konvexes Polyeder aus einer Dreiecksliste: doppelte Ecken zusammenfassen, Dreiecke zu Flächen gruppieren. */
function polyhedronFromTriangles(positions: ArrayLike<number>): { vertices: THREE.Vector3[]; faces: DieFace[] } {
  const vertices: THREE.Vector3[] = [];
  const index = new Map<string, number>();
  const vid = (v: THREE.Vector3) => {
    const k = keyOf(v);
    let i = index.get(k);
    if (i === undefined) { i = vertices.length; vertices.push(v.clone()); index.set(k, i); }
    return i;
  };
  const groups: { normal: THREE.Vector3; ids: Set<number> }[] = [];
  for (let t = 0; t < positions.length; t += 9) {
    const a = new THREE.Vector3(positions[t], positions[t + 1], positions[t + 2]);
    const b = new THREE.Vector3(positions[t + 3], positions[t + 4], positions[t + 5]);
    const c = new THREE.Vector3(positions[t + 6], positions[t + 7], positions[t + 8]);
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (n.lengthSq() < 1e-12) continue;
    n.normalize();
    const centroid = a.clone().add(b).add(c).divideScalar(3);
    if (n.dot(centroid) < 0) n.negate();
    let g = groups.find((x) => x.normal.dot(n) > 1 - 1e-6);
    if (!g) { g = { normal: n, ids: new Set() }; groups.push(g); }
    for (const v of [a, b, c]) g.ids.add(vid(v));
  }
  const faces = groups.map(({ normal, ids }) => {
    const list = [...ids];
    const center = list.reduce((s, i) => s.add(vertices[i]), new THREE.Vector3()).divideScalar(list.length);
    const u = vertices[list[0]].clone().sub(center).normalize();
    const v = new THREE.Vector3().crossVectors(normal, u);
    list.sort((i, j) => {
      const pi = vertices[i].clone().sub(center), pj = vertices[j].clone().sub(center);
      return Math.atan2(pi.dot(v), pi.dot(u)) - Math.atan2(pj.dot(v), pj.dot(u));
    });
    return { normal, center, vertexIndices: list, polygon: list.map((i) => vertices[i]), up: new THREE.Vector3() } satisfies DieFace;
  });
  return { vertices, faces };
}

function trianglesOf(geo: THREE.BufferGeometry): ArrayLike<number> {
  const g = geo.index ? geo.toNonIndexed() : geo;
  return g.getAttribute("position").array;
}

function d10Triangles(): number[] {
  const h = 1;
  const ring = 1;
  const c36 = Math.cos(Math.PI / 5);
  const a = h * (1 - c36) / (1 + c36); // Höhe der Ringpunkte, damit die Drachenflächen eben sind
  const T = [0, h, 0], B = [0, -h, 0];
  const U = (k: number) => { const t = (k * 2 * Math.PI) / 5; return [ring * Math.cos(t), a, ring * Math.sin(t)]; };
  const L = (k: number) => { const t = (k * 2 * Math.PI) / 5 + Math.PI / 5; return [ring * Math.cos(t), -a, ring * Math.sin(t)]; };
  const out: number[] = [];
  for (let k = 0; k < 5; k++) {
    out.push(...T, ...U(k), ...L(k), ...T, ...L(k), ...U(k + 1));
    out.push(...B, ...L(k), ...U(k + 1), ...B, ...U(k + 1), ...L(k + 1));
  }
  return out;
}

/** Reihenfolge der Paare: obere Hälfte zuerst, dann nach Azimut – ergibt eine gemischte Verteilung. */
function rankKey(n: THREE.Vector3) {
  return [Math.round(n.y * 1000), Math.round(Math.atan2(n.z, n.x) * 1000)];
}

function oppositePairs(dirs: THREE.Vector3[]): [number, number][] {
  const used = new Set<number>();
  const pairs: [number, number][] = [];
  const order = dirs.map((_, i) => i).sort((i, j) => {
    const a = rankKey(dirs[i]), b = rankKey(dirs[j]);
    return b[0] - a[0] || a[1] - b[1];
  });
  for (const i of order) {
    if (used.has(i)) continue;
    const j = dirs.findIndex((d, k) => k !== i && !used.has(k) && d.dot(dirs[i]) < -1 + 1e-4);
    if (j < 0) throw new Error("Würfel ohne Gegenfläche");
    used.add(i); used.add(j);
    pairs.push([i, j]);
  }
  return pairs;
}

const SPEC: Record<DieKind, { radius: number; sides: number }> = {
  d4: { radius: 1.25, sides: 4 },
  d6: { radius: 1.2, sides: 6 },
  d8: { radius: 1.1, sides: 8 },
  d10: { radius: 1.05, sides: 10 },
  d10t: { radius: 1.05, sides: 10 },
  d10u: { radius: 1.05, sides: 10 },
  d12: { radius: 1.15, sides: 12 },
  d20: { radius: 1.2, sides: 20 },
};

function baseGeometry(kind: DieKind, r: number): ArrayLike<number> {
  switch (kind) {
    case "d4": return trianglesOf(new THREE.TetrahedronGeometry(r, 0));
    case "d6": { const s = (2 * r) / Math.sqrt(3); return trianglesOf(new THREE.BoxGeometry(s, s, s)); }
    case "d8": return trianglesOf(new THREE.OctahedronGeometry(r, 0));
    case "d12": return trianglesOf(new THREE.DodecahedronGeometry(r, 0));
    case "d20": return trianglesOf(new THREE.IcosahedronGeometry(r, 0));
    default: return d10Triangles().map((x) => x * r);
  }
}

function labelFor(kind: DieKind, value: number): string {
  if (kind === "d10t") return value === 0 ? "00" : String(value);
  return String(value);
}

const cache = new Map<DieKind, DieModel>();

export function getDieModel(kind: DieKind): DieModel {
  const hit = cache.get(kind);
  if (hit) return hit;
  const { radius, sides } = SPEC[kind];
  const { vertices, faces } = polyhedronFromTriangles(baseGeometry(kind, radius));
  if (kind === "d4" ? vertices.length !== 4 : faces.length !== sides) throw new Error(`${kind}: falsche Flächenzahl ${faces.length}`);

  // Ausrichtung der Zahlen auf jeder Fläche
  for (const f of faces) {
    let target: THREE.Vector3;
    if (kind === "d6") target = f.polygon[0].clone().add(f.polygon[1]).multiplyScalar(0.5);
    else if (kind.startsWith("d10")) target = f.polygon.reduce((best, p) => (Math.abs(p.y) > Math.abs(best.y) ? p : best));
    else target = f.polygon[0];
    f.up = target.clone().sub(f.center).projectOnPlane(f.normal).normalize();
  }

  let values: ValueDir[];
  let faceValue: (number | null)[];
  let readMode: DieModel["readMode"] = "face";
  if (kind === "d4") {
    readMode = "vertex";
    values = vertices.map((v, i) => ({ dir: v.clone().normalize(), value: i + 1, label: String(i + 1) }));
    faceValue = faces.map(() => null);
  } else {
    const n = faces.length;
    const assigned = new Array<number>(n);
    oppositePairs(faces.map((f) => f.normal)).forEach(([i, j], k0) => {
      const k = k0 + 1;
      const v = k % 2 === 1 ? k : n + 1 - k; // jede Paarung ergibt n+1
      assigned[i] = v;
      assigned[j] = n + 1 - v;
    });
    const mapValue = (v: number) => (kind === "d10u" ? v - 1 : kind === "d10t" ? (v - 1) * 10 : v);
    values = faces.map((f, i) => ({ dir: f.normal.clone(), value: mapValue(assigned[i]), label: labelFor(kind, mapValue(assigned[i])) }));
    faceValue = faces.map((_, i) => i);
  }
  const model: DieModel = { kind, vertices, faces, values, readMode, faceValue, radius };
  cache.set(kind, model);
  return model;
}

export function valueIndexOf(model: DieModel, face: number): number {
  const i = model.values.findIndex((v) => v.value === face);
  if (i < 0) throw new Error(`${model.kind} hat keinen Wert ${face}`);
  return i;
}

/** Welcher Wert liegt bei dieser Orientierung oben? Gibt Index und Neigung (1 = perfekt flach) zurück. */
export function topValue(model: DieModel, q: THREE.Quaternion): { index: number; alignment: number } {
  const up = new THREE.Vector3(0, 1, 0);
  let index = 0, alignment = -Infinity;
  const tmp = new THREE.Vector3();
  model.values.forEach((v, i) => {
    const d = tmp.copy(v.dir).applyQuaternion(q).dot(up);
    if (d > alignment) { alignment = d; index = i; }
  });
  return { index, alignment };
}

/**
 * Sucht eine Drehung aus der Symmetriegruppe des Würfels, die Ergebnis „from“ auf die Position von „to“ bringt.
 * Weil der Körper auf sich selbst abgebildet wird, ändert das die Physik nicht – nur die Beschriftung.
 */
export function symmetryRotation(model: DieModel, from: number, to: number): THREE.Quaternion {
  const a = model.values[from].dir, b = model.values[to].dir;
  const q1 = new THREE.Quaternion().setFromUnitVectors(a, b);
  const verts = model.vertices;
  const tol = model.radius * 1e-3;
  const mapsOntoItself = (q: THREE.Quaternion) =>
    verts.every((v) => {
      const w = v.clone().applyQuaternion(q);
      return verts.some((u) => u.distanceTo(w) < tol);
    });

  const ref = verts.map((v) => v.clone().applyQuaternion(q1)).find((p) => p.clone().projectOnPlane(b).length() > model.radius * 0.1)!;
  const refPerp = ref.clone().projectOnPlane(b);
  for (const target of verts) {
    if (Math.abs(target.dot(b) - ref.dot(b)) > tol) continue;
    const tPerp = target.clone().projectOnPlane(b);
    if (Math.abs(tPerp.length() - refPerp.length()) > tol) continue;
    const angle = Math.atan2(new THREE.Vector3().crossVectors(refPerp, tPerp).dot(b), refPerp.dot(tPerp));
    const q = new THREE.Quaternion().setFromAxisAngle(b, angle).multiply(q1);
    if (mapsOntoItself(q)) return q;
  }
  throw new Error(`Keine Symmetrie für ${model.kind} von ${from} nach ${to}`);
}

/** Orientierung, bei der ein bestimmter Wert exakt oben liegt (für die vereinfachte Animation). */
export function orientationForValue(model: DieModel, index: number, spin: number): THREE.Quaternion {
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(model.values[index].dir.clone().normalize(), up);
  return new THREE.Quaternion().setFromAxisAngle(up, spin).multiply(q);
}
