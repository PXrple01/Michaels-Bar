// Oberflächen-Effekte: Glut-Partikel, Einblenden, Kipp-Karten, magnetische Knöpfe, Zähler, Buchstaben-Animation.
import { prefersReducedMotion } from "../lib/dom";

/* ── Aufsteigende Glut im Hintergrund ── */
export function startEmbers(canvas: HTMLCanvasElement, enabled: () => boolean) {
  const ctx = canvas.getContext("2d")!;
  let w = 0, h = 0, dpr = 1;
  interface P { x: number; y: number; r: number; vy: number; vx: number; life: number; max: number; hue: number; tw: number }
  let parts: P[] = [];
  const spawn = (initial = false): P => ({
    x: Math.random() * w, y: initial ? Math.random() * h : h + 10, r: 0.6 + Math.random() * 2.2,
    vy: 0.15 + Math.random() * 0.55, vx: (Math.random() - 0.5) * 0.25, life: 0, max: 600 + Math.random() * 900,
    hue: 258 + Math.random() * 40, tw: Math.random() * Math.PI * 2,
  });
  const resize = () => {
    dpr = Math.min(devicePixelRatio, 1.5);
    w = innerWidth; h = innerHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.round(Math.min(90, (w * h) / 16000));
    parts = Array.from({ length: count }, () => spawn(true));
  };
  resize();
  addEventListener("resize", resize);
  let mx = 0, my = 0;
  addEventListener("pointermove", (e) => { mx = (e.clientX / w - 0.5) * 2; my = (e.clientY / h - 0.5) * 2; }, { passive: true });

  const frame = () => {
    requestAnimationFrame(frame);
    if (document.hidden || !enabled()) return;
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";
    for (const p of parts) {
      p.life++;
      p.tw += 0.03;
      p.y -= p.vy;
      p.x += p.vx + Math.sin(p.tw) * 0.15 - mx * 0.05 * p.r;
      const fade = Math.min(1, p.life / 120) * Math.min(1, (p.max - p.life) / 200);
      const a = Math.max(0, fade) * (0.5 + 0.5 * Math.sin(p.tw * 2));
      const g = ctx.createRadialGradient(p.x, p.y + my * p.r, 0, p.x, p.y + my * p.r, p.r * 6);
      g.addColorStop(0, `hsla(${p.hue}, 95%, 75%, ${a * 0.9})`);
      g.addColorStop(1, `hsla(${p.hue}, 95%, 60%, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y + my * p.r, p.r * 6, 0, Math.PI * 2);
      ctx.fill();
      if (p.life > p.max || p.y < -20) Object.assign(p, spawn());
    }
  };
  if (!prefersReducedMotion()) frame();
}

/* ── Lichtschein, der dem Mauszeiger folgt ── */
export function startCursorGlow(el: HTMLElement) {
  if (!matchMedia("(pointer: fine)").matches) return;
  let x = innerWidth / 2, y = innerHeight / 2, tx = x, ty = y, running = false;
  const tick = () => {
    x += (tx - x) * 0.12; y += (ty - y) * 0.12;
    el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    if (Math.abs(tx - x) + Math.abs(ty - y) > 0.5) requestAnimationFrame(tick); else running = false;
  };
  addEventListener("pointermove", (e) => {
    document.body.classList.add("has-pointer");
    tx = e.clientX; ty = e.clientY;
    if (!running) { running = true; requestAnimationFrame(tick); }
  }, { passive: true });
}

/* ── Einblenden beim Scrollen ── */
let io: IntersectionObserver | null = null;
export function reveal(root: ParentNode = document) {
  io ??= new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add("is-visible"); io!.unobserve(e.target); }
  }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
  root.querySelectorAll("[data-reveal]:not(.is-visible)").forEach((el) => io!.observe(el));
}

/* ── 3D-Kippen mit Lichtreflex ── */
export function tilt(root: ParentNode = document, max = 8) {
  if (!matchMedia("(pointer: fine)").matches || prefersReducedMotion()) return;
  root.querySelectorAll<HTMLElement>(".tilt").forEach((el) => {
    if (el.dataset.tiltBound) return;
    el.dataset.tiltBound = "1";
    if (!el.querySelector(".glare")) el.insertAdjacentHTML("beforeend", '<span class="glare"></span>');
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      el.style.transform = `perspective(900px) rotateX(${(0.5 - py) * max}deg) rotateY(${(px - 0.5) * max}deg) translateZ(0)`;
      el.style.setProperty("--gx", `${px * 100}%`);
      el.style.setProperty("--gy", `${py * 100}%`);
    });
    el.addEventListener("pointerleave", () => { el.style.transform = ""; });
  });
}

/* ── Magnetische Knöpfe + Wellen beim Klick ── */
export function magnetic(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>(".btn").forEach((el) => {
    if (el.dataset.fxBound) return;
    el.dataset.fxBound = "1";
    el.addEventListener("pointerdown", (e) => {
      const r = el.getBoundingClientRect();
      const s = Math.max(r.width, r.height);
      const span = document.createElement("span");
      span.className = "ripple";
      span.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`;
      el.append(span);
      span.addEventListener("animationend", () => span.remove());
    });
    if (!el.classList.contains("magnetic") || !matchMedia("(pointer: fine)").matches) return;
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      el.style.transform = `translate(${dx * 0.18}px, ${dy * 0.25}px)`;
    });
    el.addEventListener("pointerleave", () => { el.style.transform = ""; });
  });
}

export function enhance(root: ParentNode = document) {
  reveal(root);
  tilt(root);
  magnetic(root);
}

/* ── Hochzählende Zahl ── */
export function countUp(el: HTMLElement, to: number, ms = 900, from = 0) {
  if (prefersReducedMotion() || ms <= 0) { el.textContent = String(to); return; }
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ms);
    const e = 1 - Math.pow(1 - t, 4);
    el.textContent = String(Math.round(from + (to - from) * e));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ── Text in einzelne Buchstaben zerlegen (für gestaffelte Animation) ── */
export function splitLetters(el: HTMLElement, baseDelay = 0, step = 45) {
  const text = el.textContent ?? "";
  el.setAttribute("aria-label", text);
  el.textContent = "";
  [...text].forEach((ch, i) => {
    const s = document.createElement("span");
    s.className = "letter";
    s.setAttribute("aria-hidden", "true");
    s.textContent = ch === " " ? " " : ch;
    s.style.animationDelay = `${baseDelay + i * step}ms`;
    el.append(s);
  });
}
