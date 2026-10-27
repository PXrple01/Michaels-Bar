// Die 3D-Bühne: Tisch, Licht, Schatten, Würfel und Effekte.
// Gerendert wird nur, solange gewürfelt wird oder ein Effekt läuft – danach steht die Schleife still.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { DiceThemeId } from "../lib/settings";
import { playCrit, playFumble, playImpact, playSettle } from "./audio";
import type { PlannedDie, RollPlan } from "./plan";
import type { Arena } from "./simulate";
import { createDieMesh } from "./textures";

export interface PlayOptions {
  dice: PlannedDie[];
  kept: boolean[];
  plan: RollPlan;
  theme: DiceThemeId;
  speed: number;
  slowmoTail: boolean;
  effect: "crit" | "fumble" | null;
  sound: boolean;
  /** Ohne Animation direkt das Endbild zeigen. */
  instant?: boolean;
}

export interface PlayStats { avgFps: number }

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

function spriteTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.8)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function feltTexture(): THREE.Texture {
  const s = 1024;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d")!;
  const base = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  base.addColorStop(0, "rgba(34,20,58,1)");
  base.addColorStop(0.62, "rgba(18,11,32,1)");
  base.addColorStop(0.86, "rgba(10,6,18,0.85)");
  base.addColorStop(1, "rgba(7,5,12,0)");
  g.fillStyle = base;
  g.fillRect(0, 0, s, s);
  // Filzstruktur
  const img = g.getImageData(0, 0, s, s);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    img.data[i] += n; img.data[i + 1] += n * 0.8; img.data[i + 2] += n * 1.2;
  }
  g.putImageData(img, 0, 0);
  // Arkaner Kreis in der Mitte
  g.translate(s / 2, s / 2);
  g.strokeStyle = "rgba(167,139,250,0.10)";
  g.lineWidth = 3;
  for (const r of [s * 0.3, s * 0.27, s * 0.12]) { g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); }
  g.lineWidth = 2;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2, b = a + (Math.PI * 2) / 6 * 2;
    g.beginPath();
    g.moveTo(Math.cos(a) * s * 0.27, Math.sin(a) * s * 0.27);
    g.lineTo(Math.cos(b) * s * 0.27, Math.sin(b) * s * 0.27);
    g.stroke();
  }
  g.font = `${s * 0.024}px Cinzel, serif`;
  g.fillStyle = "rgba(196,181,253,0.13)";
  g.textAlign = "center";
  const runes = "ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ";
  for (let k = 0; k < runes.length; k++) {
    g.save();
    g.rotate((k / runes.length) * Math.PI * 2);
    g.fillText(runes[k], 0, -s * 0.285);
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface LiveDie { group: THREE.Group; mesh: THREE.Mesh; kept: boolean }

export class DiceStage {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);
  private camHome = new THREE.Vector3();
  private camTarget = new THREE.Vector3(0, 0, 0.6);
  private key: THREE.DirectionalLight;
  private table: THREE.Mesh;
  private rim = new THREE.Group();
  private dice: LiveDie[] = [];
  private ring: THREE.Mesh;
  private particles: THREE.Points;
  private shock: THREE.Mesh;
  private host: HTMLElement | null = null;
  private resizeObs = new ResizeObserver(() => this.resize());
  private arenaDims: Arena = { halfW: 9, halfD: 6 };
  private simple = false;
  private loop: ((t: number) => void) | null = null;
  private lastTime = 0;
  private effect: { kind: "crit" | "fumble"; t: number; origin: THREE.Vector3 } | null = null;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.canvas = this.renderer.domElement;
    this.canvas.setAttribute("aria-label", "3D-Würfeltisch");
    this.canvas.setAttribute("role", "img");

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.32;

    this.scene.add(new THREE.HemisphereLight(0xc4b5fd, 0x0a0612, 0.55));
    this.key = new THREE.DirectionalLight(0xfff5ff, 2.6);
    this.key.position.set(-7, 20, 9);
    this.key.castShadow = true;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.03;
    this.key.shadow.radius = 5;
    this.scene.add(this.key);
    const rimLight = new THREE.PointLight(0x8b5cf6, 90, 45, 1.6);
    rimLight.position.set(9, 7, -7);
    this.scene.add(rimLight);
    const fill = new THREE.PointLight(0xa78bfa, 30, 40, 1.8);
    fill.position.set(-10, 5, 8);
    this.scene.add(fill);

    this.table = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ map: feltTexture(), transparent: true, roughness: 0.92, metalness: 0 }));
    this.table.rotation.x = -Math.PI / 2;
    this.table.receiveShadow = true;
    this.scene.add(this.table, this.rim);

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(1.45, 1.62, 64),
      new THREE.MeshBasicMaterial({ color: 0xa78bfa, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.02;
    this.scene.add(this.ring);

    this.shock = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.0, 96),
      new THREE.MeshBasicMaterial({ color: 0xf5d68a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.shock.rotation.x = -Math.PI / 2;
    this.shock.position.y = 0.03;
    this.scene.add(this.shock);

    const N = 220;
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(N * 3), 3));
    pg.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(N * 3), 3));
    this.particles = new THREE.Points(pg, new THREE.PointsMaterial({
      size: 0.45, map: spriteTexture(), vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.particles.userData.vel = new Float32Array(N * 3);
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);

    this.rebuildArena();
  }

  mount(host: HTMLElement) {
    if (this.host === host) return;
    this.resizeObs.disconnect();
    this.host = host;
    host.append(this.canvas);
    this.resizeObs.observe(host);
    this.resize();
  }

  get arena(): Arena { return this.arenaDims; }

  setSimple(simple: boolean) {
    if (this.simple === simple) return;
    this.simple = simple;
    this.renderer.shadowMap.enabled = !simple;
    this.key.castShadow = !simple;
    this.resize();
  }

  private resize() {
    if (!this.host) return;
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.simple ? 1.25 : 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    const a = w / h;
    // Liegen schon Würfel, bleibt der Tisch gleich groß – nur die Kamera passt sich an.
    if (this.dice.length === 0) this.arenaDims = a >= 1
      ? { halfW: Math.min(9.5, Math.max(5.6, 5.2 * a)), halfD: 5.2 }
      : { halfW: 4.8, halfD: Math.min(8.5, Math.max(5.2, (4.8 / a) * 0.8)) };
    this.rebuildArena();
    this.fitCamera();
    if (!this.loop) this.render();
  }

  private rebuildArena() {
    const { halfW, halfD } = this.arenaDims;
    this.table.scale.set(halfW * 2 + 14, halfD * 2 + 14, 1);
    const sh = this.key.shadow;
    const ext = Math.max(halfW, halfD) + 3;
    Object.assign(sh.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 60 });
    sh.camera.updateProjectionMatrix();
    sh.mapSize.set(this.simple ? 1024 : 2048, this.simple ? 1024 : 2048);
    if (sh.map) { sh.map.dispose(); sh.map = null; }

    this.rim.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    this.rim.clear();
    const H = 0.75, T = 0.4;
    const wallMat = new THREE.MeshPhysicalMaterial({ color: 0x0c0816, roughness: 0.35, metalness: 0.2, clearcoat: 0.8, clearcoatRoughness: 0.2 });
    const glowMat = new THREE.MeshStandardMaterial({ color: 0x1a0b33, emissive: 0x8b5cf6, emissiveIntensity: 1.6 });
    const walls: [number, number, number, number][] = [
      [0, -halfD - T / 2, halfW * 2 + T * 2, T], [0, halfD + T / 2, halfW * 2 + T * 2, T],
      [-halfW - T / 2, 0, T, halfD * 2], [halfW + T / 2, 0, T, halfD * 2],
    ];
    for (const [x, z, w, d] of walls) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, H, d), wallMat);
      m.position.set(x, H / 2, z);
      m.castShadow = true;
      m.receiveShadow = true;
      const strip = new THREE.Mesh(new THREE.BoxGeometry(w < d ? 0.08 : w, 0.05, w < d ? d : 0.08), glowMat);
      strip.position.set(x, H + 0.03, z);
      this.rim.add(m, strip);
    }
  }

  /** Kamera so weit zurück, dass der ganze Tisch sichtbar ist (schräg von vorne). */
  private fitCamera() {
    const { halfW, halfD } = this.arenaDims;
    const dir = new THREE.Vector3(0, Math.sin(THREE.MathUtils.degToRad(62)), Math.cos(THREE.MathUtils.degToRad(62)));
    const corners = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => new THREE.Vector3(sx * (halfW + 0.5), 0.8, sz * (halfD + 0.5))));
    let lo = 5, hi = 120;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      this.camera.position.copy(this.camTarget).addScaledVector(dir, mid);
      this.camera.lookAt(this.camTarget);
      this.camera.updateMatrixWorld();
      this.camera.updateProjectionMatrix();
      const fits = corners.every((c) => { const p = c.clone().project(this.camera); return Math.abs(p.x) < 0.94 && Math.abs(p.y) < 0.9; });
      if (fits) hi = mid; else lo = mid;
    }
    this.camera.position.copy(this.camTarget).addScaledVector(dir, hi);
    this.camera.lookAt(this.camTarget);
    this.camHome.copy(this.camera.position);
  }

  clear() {
    for (const d of this.dice) { this.scene.remove(d.group); (d.mesh.material as THREE.Material).dispose(); }
    this.dice = [];
    (this.ring.material as THREE.MeshBasicMaterial).opacity = 0;
    (this.shock.material as THREE.MeshBasicMaterial).opacity = 0;
    (this.particles.material as THREE.PointsMaterial).opacity = 0;
    this.effect = null;
    this.resize(); // Tischgröße an die aktuelle Fläche anpassen, Kamera zurücksetzen
    this.camera.position.copy(this.camHome);
    this.camera.lookAt(this.camTarget);
    if (!this.loop) this.render();
  }

  private render() {
    this.renderer.render(this.scene, this.camera);
  }

  private setPose(i: number, frameF: number, plan: RollPlan) {
    const t = plan.throw;
    const f0 = Math.min(t.frameCount - 1, Math.floor(frameF));
    const f1 = Math.min(t.frameCount - 1, f0 + 1);
    const a = frameF - f0;
    const tr = t.tracks[i];
    const o0 = f0 * 7, o1 = f1 * 7;
    const g = this.dice[i].group;
    g.position.set(tr[o0] + (tr[o1] - tr[o0]) * a, tr[o0 + 1] + (tr[o1 + 1] - tr[o0 + 1]) * a, tr[o0 + 2] + (tr[o1 + 2] - tr[o0 + 2]) * a);
    const q0 = new THREE.Quaternion(tr[o0 + 3], tr[o0 + 4], tr[o0 + 5], tr[o0 + 6]);
    const q1 = new THREE.Quaternion(tr[o1 + 3], tr[o1 + 4], tr[o1 + 5], tr[o1 + 6]);
    g.quaternion.copy(q0.slerp(q1, a));
  }

  /** Spielt einen geplanten Wurf ab. Löst aus, sobald alle Würfel liegen (Effekte laufen kurz weiter). */
  play(opts: PlayOptions): Promise<PlayStats> {
    this.clear();
    const { plan } = opts;
    opts.dice.forEach((d, i) => {
      const group = new THREE.Group();
      const mesh = createDieMesh(d.kind, opts.theme, this.renderer.capabilities.getMaxAnisotropy());
      mesh.quaternion.copy(plan.remap[i]);
      group.add(mesh);
      this.scene.add(group);
      this.dice.push({ group, mesh, kept: opts.kept[i] });
    });

    const last = plan.throw.frameCount - 1;
    if (opts.instant) {
      this.dice.forEach((_, i) => this.setPose(i, last, plan));
      this.highlight(1);
      this.render();
      return Promise.resolve({ avgFps: 60 });
    }

    return new Promise((resolveRaw) => {
      let finished = false;
      const resolve = (stats: PlayStats) => { if (!finished) { finished = true; clearTimeout(watchdog); resolveRaw(stats); } };
      // Sicherheitsnetz: Läuft die Animation nicht (z. B. Tab im Hintergrund), springt sie ans Ende.
      const maxMs = ((last * plan.throw.dt) / opts.speed) * 1000 * (opts.slowmoTail ? 2.5 : 1) + 3000;
      const watchdog = window.setTimeout(() => {
        this.stop();
        this.dice.forEach((_, i) => this.setPose(i, last, plan));
        this.highlight(1);
        this.render();
        resolve({ avgFps: 60 });
      }, maxMs);
      let frameF = 0;
      let impactIdx = 0;
      let phase: "roll" | "settle" | "effect" = "roll";
      let phaseT = 0;
      let fpsFrames = 0, fpsTime = 0;
      let settledResolve = false;
      const tailStart = last - 48;
      this.lastTime = performance.now();
      const focus = this.dice.findIndex((d) => d.kept);

      this.loop = (now: number) => {
        const dt = Math.min(0.05, (now - this.lastTime) / 1000);
        this.lastTime = now;
        if (phase === "roll") {
          fpsFrames++; fpsTime += dt;
          let rate = opts.speed;
          if (opts.slowmoTail && frameF > tailStart) rate *= 0.32;
          frameF = Math.min(last, frameF + (dt / plan.throw.dt) * rate);
          this.dice.forEach((_, i) => this.setPose(i, frameF, plan));
          if (opts.sound) {
            const imp = plan.throw.impacts;
            while (impactIdx < imp.length && imp[impactIdx].frame <= frameF) { playImpact(imp[impactIdx].kind, imp[impactIdx].strength); impactIdx++; }
          } else impactIdx = plan.throw.impacts.length;
          if (frameF >= last) {
            phase = "settle";
            phaseT = 0;
            if (opts.sound) playSettle();
            if (opts.effect) this.startEffect(opts.effect, focus >= 0 ? this.dice[focus].group.position : new THREE.Vector3(), opts.sound);
          }
        } else {
          phaseT += dt;
          const k = easeOut(Math.min(1, phaseT / 0.7));
          this.highlight(k);
          if (focus >= 0 && opts.speed <= 1.2) {
            const p = this.dice[focus].group.position;
            const close = p.clone().addScaledVector(this.camHome.clone().sub(this.camTarget), 0.62);
            this.camera.position.copy(this.camHome).lerp(close, 0.16 * k);
            this.camera.lookAt(this.camTarget.clone().lerp(p, 0.2 * k));
          }
          if (!settledResolve && phaseT > 0.25) {
            settledResolve = true;
            resolve({ avgFps: fpsTime > 0 ? fpsFrames / fpsTime : 60 });
          }
          const effectDone = this.updateEffect(dt);
          if (phaseT > 0.8 && effectDone) this.stop();
        }
        this.render();
      };
      this.renderer.setAnimationLoop(this.loop);
    });
  }

  private stop() {
    this.loop = null;
    this.renderer.setAnimationLoop(null);
    this.render();
  }

  /** Behaltene Würfel bekommen einen Leuchtring, verworfene werden blass. */
  private highlight(k: number) {
    const keptCount = this.dice.filter((d) => d.kept).length;
    const ringMat = this.ring.material as THREE.MeshBasicMaterial;
    this.dice.forEach((d) => {
      const m = d.mesh.material as THREE.MeshPhysicalMaterial;
      m.opacity = d.kept ? 1 : 1 - 0.65 * k;
    });
    const showRing = this.dice.length > 1 && keptCount < this.dice.length;
    const focus = this.dice.find((d) => d.kept);
    if (focus && (showRing || this.dice.length === 1)) {
      this.ring.position.x = focus.group.position.x;
      this.ring.position.z = focus.group.position.z;
      ringMat.opacity = 0.6 * k;
      this.ring.scale.setScalar(0.6 + 0.4 * k);
    }
  }

  private startEffect(kind: "crit" | "fumble", origin: THREE.Vector3, sound: boolean) {
    this.effect = { kind, t: 0, origin: origin.clone() };
    if (sound) (kind === "crit" ? playCrit : playFumble)();
    const pos = this.particles.geometry.getAttribute("position") as THREE.BufferAttribute;
    const col = this.particles.geometry.getAttribute("color") as THREE.BufferAttribute;
    const vel = this.particles.userData.vel as Float32Array;
    const gold = new THREE.Color(0xf5d68a), violet = new THREE.Color(0xa78bfa), red = new THREE.Color(0xe11d48), ash = new THREE.Color(0x3b0764);
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i, origin.x, origin.y + 0.4, origin.z);
      const a = Math.random() * Math.PI * 2;
      if (kind === "crit") {
        const sp = 3 + Math.random() * 9;
        vel.set([Math.cos(a) * sp * 0.6, 6 + Math.random() * 12, Math.sin(a) * sp * 0.6], i * 3);
        const c = Math.random() < 0.55 ? gold : violet;
        col.setXYZ(i, c.r, c.g, c.b);
      } else {
        const sp = 1 + Math.random() * 4;
        vel.set([Math.cos(a) * sp, 1 + Math.random() * 3, Math.sin(a) * sp], i * 3);
        const c = Math.random() < 0.5 ? red : ash;
        col.setXYZ(i, c.r, c.g, c.b);
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    const sm = this.shock.material as THREE.MeshBasicMaterial;
    sm.color.set(kind === "crit" ? 0xf5d68a : 0xe11d48);
    this.shock.position.x = origin.x;
    this.shock.position.z = origin.z;
  }

  /** Gibt true zurück, wenn kein Effekt (mehr) läuft. */
  private updateEffect(dt: number): boolean {
    const e = this.effect;
    if (!e) return true;
    e.t += dt;
    const dur = e.kind === "crit" ? 2.2 : 1.6;
    const pm = this.particles.material as THREE.PointsMaterial;
    const pos = this.particles.geometry.getAttribute("position") as THREE.BufferAttribute;
    const vel = this.particles.userData.vel as Float32Array;
    const g = e.kind === "crit" ? -14 : -3;
    for (let i = 0; i < pos.count; i++) {
      vel[i * 3 + 1] += g * dt;
      vel[i * 3] *= 0.985; vel[i * 3 + 2] *= 0.985;
      pos.setXYZ(i, pos.getX(i) + vel[i * 3] * dt, Math.max(0.05, pos.getY(i) + vel[i * 3 + 1] * dt), pos.getZ(i) + vel[i * 3 + 2] * dt);
    }
    pos.needsUpdate = true;
    pm.opacity = Math.max(0, 1 - e.t / dur);
    pm.size = e.kind === "crit" ? 0.5 : 0.8;
    const sm = this.shock.material as THREE.MeshBasicMaterial;
    const st = Math.min(1, e.t / 1.1);
    this.shock.scale.setScalar(1 + easeOut(st) * 9);
    sm.opacity = (1 - st) * 0.9;
    if (e.kind === "fumble" && e.t < 0.5) {
      const s = (0.5 - e.t) * 0.5;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }
    if (e.t >= dur) { this.effect = null; pm.opacity = 0; sm.opacity = 0; return true; }
    return false;
  }
}
