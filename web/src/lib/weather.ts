// Wetter im Hintergrund: Regen, Sturm (mit Blitzen), Schnee oder Nebel – passend zum Wetter im Spiel.
// Sanft und leicht: wenige Partikel, pausiert in Hintergrund-Tabs, aus bei „ruhigem Hintergrund“ oder weniger Bewegung.
import { weatherKind, type WeatherKind } from "../../../shared/scene";
import { settings } from "./settings";

type Kind = WeatherKind;
let canvas: HTMLCanvasElement | null = null, fogEl: HTMLDivElement | null = null, raf = 0, kind: Kind = null;
interface P { x: number; y: number; v: number; l: number; d: number }
let parts: P[] = [];

function stop() {
  cancelAnimationFrame(raf);
  canvas?.remove(); canvas = null;
  fogEl?.remove(); fogEl = null;
  parts = [];
}

export function setWeather(text: string | undefined) {
  const next = settings().backgroundFx && !matchMedia("(prefers-reduced-motion: reduce)").matches ? weatherKind(text) : null;
  if (next === kind) return;
  stop();
  kind = next;
  if (!kind) return;
  if (kind === "fog") {
    fogEl = document.createElement("div");
    fogEl.className = "bg-fog";
    fogEl.setAttribute("aria-hidden", "true");
    fogEl.innerHTML = "<i></i><i></i>";
    document.body.append(fogEl);
    return;
  }
  canvas = document.createElement("canvas");
  canvas.className = "bg-weather";
  canvas.setAttribute("aria-hidden", "true");
  document.body.append(canvas);
  const ctx = canvas.getContext("2d")!;
  const resize = () => { canvas!.width = innerWidth; canvas!.height = innerHeight; };
  resize();
  addEventListener("resize", resize);
  const count = kind === "storm" ? 160 : kind === "rain" ? 110 : 90;
  const spawn = (top = false): P => ({ x: Math.random() * innerWidth * 1.2, y: top ? -20 : Math.random() * innerHeight, v: kind === "snow" ? 0.4 + Math.random() * 0.8 : 7 + Math.random() * 6 + (kind === "storm" ? 4 : 0), l: kind === "snow" ? 1 + Math.random() * 2.2 : 10 + Math.random() * 14, d: Math.random() * Math.PI * 2 });
  parts = Array.from({ length: count }, () => spawn());
  let flash = 0, last = performance.now();
  const frame = (t: number) => {
    if (!canvas) return;
    const dt = Math.min(3, (t - last) / 16.7); last = t;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (kind === "snow") {
      ctx.fillStyle = "rgba(235, 240, 255, 0.55)";
      for (const p of parts) {
        p.y += p.v * dt; p.d += 0.01 * dt; p.x += Math.sin(p.d) * 0.4 * dt;
        if (p.y > innerHeight + 10) Object.assign(p, spawn(true));
        ctx.beginPath(); ctx.arc(p.x, p.y, p.l, 0, Math.PI * 2); ctx.fill();
      }
    } else {
      const wind = kind === "storm" ? 0.35 : 0.18;
      ctx.strokeStyle = "rgba(180, 200, 230, 0.22)"; ctx.lineWidth = 1;
      ctx.beginPath();
      for (const p of parts) {
        p.y += p.v * dt; p.x -= p.v * wind * dt;
        if (p.y > innerHeight + 20 || p.x < -40) Object.assign(p, spawn(true));
        ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + p.l * wind, p.y - p.l);
      }
      ctx.stroke();
      if (kind === "storm") {
        if (flash <= 0 && Math.random() < 0.0015 * dt) flash = 1;
        if (flash > 0) { ctx.fillStyle = `rgba(220, 230, 255, ${0.12 * flash})`; ctx.fillRect(0, 0, canvas.width, canvas.height); flash -= 0.06 * dt; }
      }
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
}
document.addEventListener("visibilitychange", () => {
  if (!canvas) return;
  if (document.hidden) cancelAnimationFrame(raf);
  else { const k = kind; kind = null; stop(); setWeather(k === "storm" ? "gewitter" : k === "snow" ? "schnee" : k === "rain" ? "regen" : undefined); }
});
