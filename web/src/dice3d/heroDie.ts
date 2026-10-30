// Schwebender W20 auf der Startseite. Rendert nur, solange er sichtbar ist.
// `roll(value)` lässt ihn taumeln und mit genau dieser Zahl zum Betrachter zur Ruhe kommen (Probewurf der Startseite).
import * as THREE from "three";
import { getDieModel } from "./geometry";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { prefersReducedMotion } from "../lib/dom";
import { settings } from "../lib/settings";
import { createDieMesh } from "./textures";

export interface HeroDie { dispose(): void; roll(value: number): Promise<void> }

/** Drehung, bei der die Fläche mit diesem Wert aufrecht zur Kamera zeigt – leicht geneigt, damit er räumlich wirkt. */
function faceTowardCamera(value: number): THREE.Quaternion {
  const model = getDieModel("d20");
  const vi = model.values.findIndex((v) => v.value === value);
  const face = model.faces[model.faceValue.indexOf(vi)];
  const toCam = new THREE.Quaternion().setFromUnitVectors(face.normal.clone().normalize(), new THREE.Vector3(0, 0, 1));
  const up = face.up.clone().applyQuaternion(toCam);
  const upright = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.atan2(up.x, up.y));
  const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.16, 0.24, 0));
  return tilt.multiply(upright).multiply(toCam);
}

export function mountHeroDie(host: HTMLElement): HeroDie {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearColor(0, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 0, 7.2);
  scene.add(new THREE.HemisphereLight(0xc4b5fd, 0x0a0612, 0.7));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(-3, 4, 5);
  scene.add(key);
  const rim = new THREE.PointLight(0x8b5cf6, 60, 20, 1.5);
  rim.position.set(3, -1, -2);
  scene.add(rim);
  const rim2 = new THREE.PointLight(0xc084fc, 40, 20, 1.5);
  rim2.position.set(-3, 2, -3);
  scene.add(rim2);

  const die = createDieMesh("d20", settings().diceTheme);
  die.scale.setScalar(1.25);
  scene.add(die);

  const resize = () => {
    const w = host.clientWidth || 1, h = host.clientHeight || 1;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  let visible = true;
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
  io.observe(host);

  let px = 0, py = 0, t = 0, last = performance.now();
  const onMove = (e: PointerEvent) => {
    const r = host.getBoundingClientRect();
    px = ((e.clientX - r.left) / r.width - 0.5) * 2;
    py = ((e.clientY - r.top) / r.height - 0.5) * 2;
  };
  addEventListener("pointermove", onMove, { passive: true });
  const still = prefersReducedMotion();
  die.rotation.set(0.5, 0.6, 0.1);
  renderer.render(scene, camera);
  // Wurf: erst taumeln (tumbleMs), dann sanft auf die Zielfläche drehen (settleMs), danach liegen lassen
  let throwState: { start: number; from: THREE.Quaternion | null; target: THREE.Quaternion; done: () => void } | null = null;
  let resting = false;
  const tumbleMs = still ? 0 : 950, settleMs = still ? 0 : 750;
  const axis = new THREE.Vector3(1, 0.6, 0.3).normalize();
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // Ein laufender Wurf wird auch außerhalb des Bildes zu Ende gerechnet (sonst wartet die Seite ewig auf ihn)
    if ((!visible && !throwState) || document.hidden) return;
    const moved = !!throwState;
    if (throwState) {
      const el = now - throwState.start;
      if (el < tumbleMs) {
        const speed = 18 * (1 - el / tumbleMs) + 4;
        die.rotateOnWorldAxis(axis, dt * speed);
        die.rotation.z += dt * speed * 0.3;
      } else {
        throwState.from ??= die.quaternion.clone();
        const k = Math.min(1, (el - tumbleMs) / Math.max(1, settleMs));
        const ease = 1 - Math.pow(1 - k, 3);
        die.quaternion.copy(throwState.from).slerp(throwState.target, ease);
        if (k >= 1) { const d = throwState.done; throwState = null; resting = true; d(); }
      }
    } else if (!resting && !still) {
      die.rotation.y += dt * 0.35;
      die.rotation.x += dt * 0.18;
    }
    if (still) { if (moved) renderer.render(scene, camera); return; }
    t += dt;
    die.position.y = Math.sin(t * 1.3) * 0.12;
    camera.position.x += (px * 0.8 - camera.position.x) * 0.05;
    camera.position.y += (-py * 0.6 - camera.position.y) * 0.05;
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  });

  return {
    roll(value) {
      return new Promise<void>((done) => {
        throwState?.done();
        resting = false;
        throwState = { start: performance.now(), from: null, target: faceTowardCamera(value), done };
      });
    },
    dispose() {
      throwState?.done();
      renderer.setAnimationLoop(null);
      ro.disconnect();
      io.disconnect();
      removeEventListener("pointermove", onMove);
      (die.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
