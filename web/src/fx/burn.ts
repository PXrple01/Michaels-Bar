// Seitenübergang „Wegbrennen“: Vom Funken aus frisst sich ein Brandloch nach außen durch die Seite – das Papier bräunt
// vor der Glut, der Rand glüht weiß, orange und rot, Funken stieben. Darunter liegt Dunkelheit. Ist alles verbrannt,
// wechselt die Seite (onCovered) und das Dunkel verglimmt. Farben kommen aus dem Theme (Glut oder Amethyst).
import { playIgnite, unlockAudio } from "../dice3d/audio";
import { prefersReducedMotion } from "../lib/dom";
import { settings } from "../lib/settings";

const VERT = "attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }";

const FRAG = `precision highp float;
uniform vec2 uRes, uOrigin;
uniform float uR, uDpr, uSeed;
uniform vec3 uVoid, uChar, uDeep, uHot, uGlow, uPale;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int k = 0; k < 5; k++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
void main() {
  vec2 f = gl_FragCoord.xy;
  float maxD = max(max(distance(uOrigin, vec2(0.0)), distance(uOrigin, vec2(uRes.x, 0.0))), max(distance(uOrigin, vec2(0.0, uRes.y)), distance(uOrigin, uRes)));
  float field = distance(f, uOrigin) / maxD + (fbm(f / (120.0 * uDpr)) - 0.5) * 0.34;
  float e = uR - field;
  const float rim = 0.06;
  if (e > rim) {
    // verbrannt: Dunkel mit einzelnen nachglimmenden Punkten kurz hinter der Front
    float g = step(0.993, hash(floor(f / (3.0 * uDpr)))) * smoothstep(rim + 0.1, rim, e);
    gl_FragColor = vec4(mix(uVoid, uHot, g * 0.85), 1.0);
  } else if (e > 0.0) {
    float t = e / rim;
    vec3 c = t < 0.12 ? mix(uPale, uGlow, t / 0.12)
           : t < 0.38 ? mix(uGlow, uHot, (t - 0.12) / 0.26)
           : t < 0.68 ? mix(uHot, uDeep, (t - 0.38) / 0.30)
           : mix(uDeep, uChar, (t - 0.68) / 0.32);
    c *= 0.82 + 0.36 * noise(f / (10.0 * uDpr) + uR * 40.0);
    gl_FragColor = vec4(c, 1.0);
  } else if (e > -0.05) {
    // Hitze vor der Front: das Papier bräunt und verkohlt (vormultipliziertes Alpha)
    float a = 1.0 + e / 0.05;
    a = a * a * 0.78;
    gl_FragColor = vec4(uChar * a, a);
  } else {
    gl_FragColor = vec4(0.0);
  }
}`;

const COVER_MS = 1500, FADE_MS = 650;
const R_START = -0.2, R_END = 1.42;

const themeColor = (name: string, fallback: [number, number, number]): [number, number, number] => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).split(",").map((x) => Number(x.trim()));
  return v.length === 3 && v.every((x) => Number.isFinite(x)) ? [v[0] / 255, v[1] / 255, v[2] / 255] : fallback;
};

interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number }

/**
 * Lässt die Seite vom Punkt `origin` (Bildschirmkoordinaten) aus wegbrennen. `onCovered` läuft, sobald alles schwarz ist
 * (dort die Seite wechseln); danach verglimmt das Dunkel. Ohne Bewegung (Einstellung/System) sofort weiter.
 */
export async function burnAway(origin: { x: number; y: number }, onCovered: () => void | Promise<void>): Promise<void> {
  if (prefersReducedMotion() || settings().animation === "off") { await onCovered(); return; }
  if (settings().sound) { unlockAudio(); playIgnite(COVER_MS / 1000 + 0.3); }

  const wrap = document.createElement("div");
  wrap.className = "burn-layer";
  wrap.style.cssText = "position:fixed;inset:0;z-index:10000;pointer-events:auto;";
  const glc = document.createElement("canvas"), fx = document.createElement("canvas");
  for (const c of [glc, fx]) c.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
  wrap.append(glc, fx);
  document.body.append(wrap);

  const dpr = Math.min(devicePixelRatio || 1, 1.25);
  const W = innerWidth, H = innerHeight;
  glc.width = Math.round(W * dpr); glc.height = Math.round(H * dpr);
  fx.width = Math.round(W * dpr); fx.height = Math.round(H * dpr);
  const gl = glc.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });
  const ctx = fx.getContext("2d")!;
  ctx.scale(dpr, dpr);

  const colors = {
    void: themeColor("--c-s07", [0.03, 0.02, 0.02]), char: themeColor("--c-s25", [0.12, 0.04, 0.03]),
    deep: themeColor("--c-deep", [0.6, 0.1, 0.07]), hot: themeColor("--c-accent", [0.89, 0.22, 0.14]),
    glow: themeColor("--c-glow", [1, 0.41, 0.2]), pale: themeColor("--c-pale", [1, 0.93, 0.89]),
  };
  const css = (c: [number, number, number], a: number) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;

  let draw: ((r: number) => void) | null = null;
  if (gl) {
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "p");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const u = (n: string) => gl.getUniformLocation(prog, n);
      gl.uniform2f(u("uRes"), glc.width, glc.height);
      gl.uniform2f(u("uOrigin"), origin.x * dpr, (H - origin.y) * dpr);
      gl.uniform1f(u("uDpr"), dpr);
      gl.uniform1f(u("uSeed"), Math.random() * 100);
      for (const [k, v] of Object.entries(colors)) gl.uniform3fv(u(`u${k[0].toUpperCase()}${k.slice(1)}`), v);
      const uR = u("uR");
      gl.viewport(0, 0, glc.width, glc.height);
      draw = (r) => { gl.uniform1f(uR, r); gl.drawArrays(gl.TRIANGLES, 0, 3); };
    }
  }
  // Ohne WebGL: eine wachsende, glühende Kreisblende
  if (!draw) {
    glc.remove();
    draw = (r) => {
      const maxD = Math.hypot(Math.max(origin.x, W - origin.x), Math.max(origin.y, H - origin.y));
      const rad = Math.max(0, r) * maxD;
      ctx.save();
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = css(colors.void, 1);
      ctx.beginPath(); ctx.arc(origin.x, origin.y, rad, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    };
  }

  const maxD = Math.hypot(Math.max(origin.x, W - origin.x), Math.max(origin.y, H - origin.y));
  const sparks: Spark[] = [];
  const spawn = (r: number, count: number) => {
    for (let i = 0; i < count; i++) {
      if (r <= 0) return;
      const a = Math.random() * Math.PI * 2;
      // an der Glutfront (der Rand ist durch das Rauschen bis etwa ±0,17 unregelmäßig)
      const rad = Math.max(0, r + (Math.random() - 0.5) * 0.24 * Math.min(1, r * 3)) * maxD;
      const x = origin.x + Math.cos(a) * rad, y = origin.y + Math.sin(a) * rad;
      if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
      const out = 40 + Math.random() * 120;
      sparks.push({ x, y, vx: Math.cos(a) * out + (Math.random() - 0.5) * 60, vy: Math.sin(a) * out * 0.5 - 90 - Math.random() * 160, life: 0, max: 0.5 + Math.random() * 0.8, size: 0.8 + Math.random() * 2.2 });
    }
  };
  const drawSparks = (dt: number) => {
    if (gl) ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.life += dt;
      if (s.life >= s.max) { sparks.splice(i, 1); continue; }
      s.vy -= 40 * dt; // heiße Luft trägt sie nach oben
      s.vx *= 0.985;
      const px = s.x, py = s.y;
      s.x += s.vx * dt; s.y += s.vy * dt;
      const k = 1 - s.life / s.max;
      ctx.strokeStyle = css(k > 0.85 ? colors.pale : k > 0.4 ? colors.glow : colors.hot, k);
      ctx.lineWidth = s.size;
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(s.x, s.y); ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
  };

  // Phase 1: Brand frisst sich nach außen (beschleunigend, wie ein Feuer, das Fahrt aufnimmt)
  await new Promise<void>((done) => {
    const start = performance.now();
    let last = start;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / COVER_MS);
      const r = R_START + (R_END - R_START) * Math.pow(t, 1.55);
      draw!(r);
      if (t < 0.92) spawn(r, Math.round(6 + t * 26));
      drawSparks((now - last) / 1000);
      last = now;
      if (t < 1) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  });

  // Seite wechseln, während alles dunkel ist; dann verglimmt das Dunkel
  wrap.style.pointerEvents = "none";
  await onCovered();
  await new Promise((r) => setTimeout(r, 180));
  const fade = wrap.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: "ease-in", fill: "forwards" });
  const tail = performance.now();
  let last = tail;
  const loop = (now: number) => {
    drawSparks((now - last) / 1000);
    last = now;
    if (now - tail < FADE_MS) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  await fade.finished.catch(() => {});
  gl?.getExtension("WEBGL_lose_context")?.loseContext();
  wrap.remove();
}
