// Unsichtbare Vorab-Simulation eines Wurfs mit cannon-es.
// Die Bahn wird aufgezeichnet und später abgespielt; das Ergebnis selbst kommt vom Server.
import * as CANNON from "cannon-es";
import * as THREE from "three";
import type { DieKind } from "../../../shared/dice";
import { getDieModel, topValue, type DieModel } from "./geometry";

export interface Arena { halfW: number; halfD: number }

export interface Impact { frame: number; strength: number; kind: "table" | "wall" | "die" }

export interface ThrowResult {
  /** Sekunden pro aufgezeichnetem Frame. */
  dt: number;
  frameCount: number;
  /** Pro Würfel: 7 Zahlen pro Frame (x, y, z, qx, qy, qz, qw). */
  tracks: Float32Array[];
  /** Pro Würfel: Index in model.values, der nach der Simulation oben liegt. */
  landed: number[];
  impacts: Impact[];
}

const FRAME = 1 / 60;
const SUBSTEPS = 3;
const MAX_FRAMES = 60 * 9;
const GRAVITY = -48;

const shapeCache = new Map<DieKind, CANNON.ConvexPolyhedron>();
function shapeFor(model: DieModel): CANNON.ConvexPolyhedron {
  let s = shapeCache.get(model.kind);
  if (!s) {
    s = new CANNON.ConvexPolyhedron({
      vertices: model.vertices.map((v) => new CANNON.Vec3(v.x, v.y, v.z)),
      faces: model.faces.map((f) => [...f.vertexIndices]),
    });
    shapeCache.set(model.kind, s);
  }
  return s;
}

type Rand = () => number;
const between = (r: Rand, a: number, b: number) => a + (b - a) * r();

function randomQuat(r: Rand) {
  // gleichverteilte Rotation (Shoemake)
  const u1 = r(), u2 = r() * Math.PI * 2, u3 = r() * Math.PI * 2;
  const s1 = Math.sqrt(1 - u1), s2 = Math.sqrt(u1);
  return new CANNON.Quaternion(s1 * Math.sin(u2), s1 * Math.cos(u2), s2 * Math.sin(u3), s2 * Math.cos(u3));
}

function attempt(models: DieModel[], arena: Arena, r: Rand): ThrowResult | null {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, GRAVITY, 0) });
  world.allowSleep = true;
  world.broadphase = new CANNON.NaiveBroadphase();
  (world.solver as CANNON.GSSolver).iterations = 14;

  const diceMat = new CANNON.Material("die");
  const tableMat = new CANNON.Material("table");
  const wallMat = new CANNON.Material("wall");
  world.addContactMaterial(new CANNON.ContactMaterial(diceMat, tableMat, { friction: 0.28, restitution: 0.42 }));
  world.addContactMaterial(new CANNON.ContactMaterial(diceMat, wallMat, { friction: 0.05, restitution: 0.65 }));
  world.addContactMaterial(new CANNON.ContactMaterial(diceMat, diceMat, { friction: 0.12, restitution: 0.5 }));

  const planes: [CANNON.Vec3, CANNON.Quaternion, CANNON.Material][] = [];
  const q = (axis: CANNON.Vec3, a: number) => new CANNON.Quaternion().setFromAxisAngle(axis, a);
  const X = new CANNON.Vec3(1, 0, 0), Y = new CANNON.Vec3(0, 1, 0);
  planes.push([new CANNON.Vec3(0, 0, 0), q(X, -Math.PI / 2), tableMat]);
  planes.push([new CANNON.Vec3(-arena.halfW, 0, 0), q(Y, Math.PI / 2), wallMat]);
  planes.push([new CANNON.Vec3(arena.halfW, 0, 0), q(Y, -Math.PI / 2), wallMat]);
  planes.push([new CANNON.Vec3(0, 0, -arena.halfD), q(Y, 0), wallMat]);
  planes.push([new CANNON.Vec3(0, 0, arena.halfD), q(Y, Math.PI), wallMat]);
  const statics = new Map<CANNON.Body, Impact["kind"]>();
  planes.forEach(([pos, quat, mat], i) => {
    const b = new CANNON.Body({ mass: 0, material: mat, shape: new CANNON.Plane() });
    b.position.copy(pos);
    b.quaternion.copy(quat);
    world.addBody(b);
    statics.set(b, i === 0 ? "table" : "wall");
  });

  // Wurf von einer zufälligen Seite (links, rechts oder vorne) in Richtung Tischmitte
  const side = Math.floor(r() * 3);
  const dirToCenter = side === 0 ? new THREE.Vector3(1, 0, 0) : side === 1 ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3(0, 0, -1);
  const lateral = new THREE.Vector3(-dirToCenter.z, 0, dirToCenter.x);
  const start = side === 2
    ? new THREE.Vector3(between(r, -arena.halfW * 0.4, arena.halfW * 0.4), 0, arena.halfD * 0.72)
    : new THREE.Vector3(dirToCenter.x * -arena.halfW * 0.78, 0, between(r, -arena.halfD * 0.35, arena.halfD * 0.35));
  const aim = new THREE.Vector3(between(r, -arena.halfW, arena.halfW) * 0.3, 0, between(r, -arena.halfD, arena.halfD) * 0.3);
  const dir = aim.sub(start).normalize();
  const speed = between(r, 17, 27);
  const spread = Math.min(2.6, (arena.halfD * 1.4) / Math.max(1, models.length));

  const impacts: Impact[] = [];
  let frame = 0;
  const bodies = models.map((m, i) => {
    const b = new CANNON.Body({ mass: 1, material: diceMat, shape: shapeFor(m), allowSleep: true, sleepSpeedLimit: 0.25, sleepTimeLimit: 0.35 });
    b.linearDamping = 0.08;
    b.angularDamping = 0.12;
    const offset = (i - (models.length - 1) / 2) * spread;
    b.position.set(start.x + lateral.x * offset + between(r, -0.3, 0.3), between(r, 2.6, 4.6), start.z + lateral.z * offset + between(r, -0.3, 0.3));
    b.quaternion.copy(randomQuat(r));
    const s = speed * between(r, 0.88, 1.1);
    b.velocity.set(dir.x * s + between(r, -2, 2), between(r, -1, 4), dir.z * s + between(r, -2, 2));
    const spin = between(r, 14, 32);
    const axis = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(spin);
    b.angularVelocity.set(axis.x, axis.y, axis.z);
    b.addEventListener("collide", (e: { body: CANNON.Body; contact: CANNON.ContactEquation }) => {
      const strength = Math.abs(e.contact.getImpactVelocityAlongNormal());
      if (strength < 1.2) return;
      const kind = statics.get(e.body) ?? "die";
      if (kind === "die" && e.body.id < b.id) return; // Würfel-Würfel nur einmal zählen
      const last = impacts[impacts.length - 1];
      if (last && last.frame === frame && last.kind === kind) last.strength = Math.max(last.strength, strength);
      else impacts.push({ frame, strength, kind });
    });
    world.addBody(b);
    return b;
  });

  const tracks = models.map(() => new Float32Array(MAX_FRAMES * 7));
  const record = () => {
    bodies.forEach((b, i) => {
      const o = frame * 7, t = tracks[i];
      t[o] = b.position.x; t[o + 1] = b.position.y; t[o + 2] = b.position.z;
      t[o + 3] = b.quaternion.x; t[o + 4] = b.quaternion.y; t[o + 5] = b.quaternion.z; t[o + 6] = b.quaternion.w;
    });
  };
  record();
  let quietFrames = 0;
  while (frame < MAX_FRAMES - 1) {
    for (let s = 0; s < SUBSTEPS; s++) world.step(FRAME / SUBSTEPS);
    frame++;
    record();
    const allAsleep = bodies.every((b) => b.sleepState === CANNON.Body.SLEEPING);
    quietFrames = allAsleep ? quietFrames + 1 : 0;
    if (quietFrames > 12) break;
  }
  if (quietFrames === 0) return null; // nicht zur Ruhe gekommen

  const landed: number[] = [];
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    const quat = new THREE.Quaternion(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    const top = topValue(models[i], quat);
    // Würfel muss flach liegen und darf nicht auf einem anderen Würfel liegen
    if (top.alignment < 0.995 || b.position.y > models[i].radius * 1.02) return null;
    landed.push(top.index);
  }
  const frameCount = frame + 1;
  return { dt: FRAME, frameCount, tracks: tracks.map((t) => t.slice(0, frameCount * 7)), landed, impacts };
}

export function simulateThrow(kinds: DieKind[], arena: Arena, rand: Rand = Math.random, maxAttempts = 12): ThrowResult {
  const models = kinds.map(getDieModel);
  for (let i = 0; i < maxAttempts; i++) {
    const res = attempt(models, arena, rand);
    if (res) return res;
  }
  throw new Error("Wurf-Simulation kam nicht zur Ruhe");
}
