// Limit-Angriff: filmreifer Moment vor dem Schlag – Kinobalken, schräges Einblendbild mit Porträt und
// Geschwindigkeitslinien, dann ein Lichtschnitt quer über den Bildschirm, Blitz, Splitter und Funken. Antippen überspringt.
import { playChainRattle, playExplosion, unlockAudio } from "../dice3d/audio";
import { html, raw } from "../lib/dom";
import { settings } from "../lib/settings";

export function playLimitAttack(o: { name: string; portrait: string | null; sigilSvg: string; tier: number }): Promise<void> {
  return new Promise((resolve) => {
    unlockAudio();
    const calm = settings().animation === "off" || matchMedia("(prefers-reduced-motion: reduce)").matches;
    const gold = o.tier >= 2;
    const root = document.createElement("div");
    root.className = `la-overlay ${gold ? "la-gold" : ""} ${calm ? "la-calm" : ""}`;
    root.setAttribute("role", "presentation");
    root.innerHTML = html`
      <div class="la-rays"></div>
      <div class="la-bar top"></div><div class="la-bar bottom"></div>
      <div class="la-band">
        <div class="la-lines"></div>
        <div class="la-face">${o.portrait ? html`<img src="${o.portrait}" alt="">` : raw(o.sigilSvg)}</div>
        <div class="la-words"><small>${o.name}</small><b>LIMIT-ANGRIFF</b></div>
      </div>
      <div class="la-slash"></div>
      <div class="la-flash"></div>
      <div class="la-shards">${Array.from({ length: 14 }, (_, i) => html`<i style="--i:${i};--a:${(i * 360) / 14 + Math.random() * 20}deg;--d:${0.6 + Math.random() * 0.8}"></i>`)}</div>
      <canvas class="la-sparks" width="${innerWidth}" height="${innerHeight}"></canvas>`.value;
    document.body.append(root);

    // Funken beim Schnitt
    const canvas = root.querySelector<HTMLCanvasElement>(".la-sparks")!;
    const ctx = canvas.getContext("2d")!;
    const ps: { x: number; y: number; vx: number; vy: number; life: number }[] = [];
    let raf = 0;
    const tick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = "lighter";
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i];
        p.x += p.vx; p.y += p.vy; p.vy += 0.25; p.vx *= 0.98; p.life -= 0.02;
        if (p.life <= 0) { ps.splice(i, 1); continue; }
        ctx.strokeStyle = gold ? `hsla(48, 100%, ${60 + p.life * 30}%, ${p.life})` : `hsla(${20 + p.life * 25}, 100%, ${55 + p.life * 30}%, ${p.life})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 2.5, p.y - p.vy * 2.5); ctx.stroke();
      }
      raf = requestAnimationFrame(tick);
    };
    const burst = () => {
      const w = canvas.width, h = canvas.height;
      for (let i = 0; i < 260; i++) {
        const t = Math.random(), x = w * t, y = h * (1 - t) * 0.9 + h * 0.05; // entlang des Schnitts
        const a = Math.random() * Math.PI * 2, v = 4 + Math.random() * 12;
        ps.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 3, life: 0.7 + Math.random() * 0.5 });
      }
    };

    let ended = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const end = () => {
      if (ended) return;
      ended = true;
      timers.forEach(clearTimeout);
      root.classList.add("la-out");
      setTimeout(() => { cancelAnimationFrame(raf); root.remove(); resolve(); }, calm ? 0 : 380);
    };
    root.addEventListener("pointerdown", end);

    if (calm) { timers.push(setTimeout(end, 900)); return; }
    raf = requestAnimationFrame(tick);
    playChainRattle(1.4);
    timers.push(setTimeout(() => playChainRattle(1.8), 350));
    // Der Schnitt: Licht quer über den Bildschirm, Blitz, Splitter, Beben
    timers.push(setTimeout(() => { root.classList.add("la-cut"); playExplosion(); burst(); }, 1450));
    timers.push(setTimeout(end, 2700));
  });
}
