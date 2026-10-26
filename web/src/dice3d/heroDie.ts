// Schwebender W20 auf der Startseite. Rendert nur, solange er sichtbar ist.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { prefersReducedMotion } from "../lib/dom";
import { settings } from "../lib/settings";
import { createDieMesh } from "./textures";

export function mountHeroDie(host: HTMLElement): () => void {
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

  let px = 0, py = 0, spin = 0, t = 0, last = performance.now();
  const onMove = (e: PointerEvent) => {
    const r = host.getBoundingClientRect();
    px = ((e.clientX - r.left) / r.width - 0.5) * 2;
    py = ((e.clientY - r.top) / r.height - 0.5) * 2;
  };
  addEventListener("pointermove", onMove, { passive: true });
  const onClick = () => { spin = 14; };
  host.addEventListener("click", onClick);

  const still = prefersReducedMotion();
  die.rotation.set(0.5, 0.6, 0.1);
  renderer.render(scene, camera);
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!visible || document.hidden || still) return;
    t += dt;
    spin *= 0.96;
    die.rotation.y += dt * (0.35 + spin);
    die.rotation.x += dt * (0.18 + spin * 0.4);
    die.position.y = Math.sin(t * 1.3) * 0.12;
    camera.position.x += (px * 0.8 - camera.position.x) * 0.05;
    camera.position.y += (-py * 0.6 - camera.position.y) * 0.05;
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  });

  return () => {
    renderer.setAnimationLoop(null);
    ro.disconnect();
    io.disconnect();
    removeEventListener("pointermove", onMove);
    (die.material as THREE.Material).dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}
