// Limit Break: Nach dem dritten bestandenen Abenteuer liegen Ketten über dem Bildschirm – als wäre die Figur dahinter
// gefesselt. Leertaste (oder Tippen) hämmern, bis sie reißen (kann nicht scheitern). Dann fliegen die Glieder in einer
// Explosion davon, und groß erscheint „LIMIT BREAK“.
import { playChainRattle, playExplosion, unlockAudio } from "../dice3d/audio";
import { html } from "../lib/dom";
import { settings } from "../lib/settings";

interface Link { el: SVGGElement; x: number; y: number; angle: number }

/** Ketten über den Bildschirm: zwei Diagonalen, eine Waagerechte und eine Senkrechte – verankert an den Rändern. */
function chainLines(w: number, h: number): [number, number, number, number][] {
  return [
    [-20, h * 0.12, w + 20, h * 0.88],
    [-20, h * 0.88, w + 20, h * 0.12],
    [-20, h * 0.5, w + 20, h * 0.46],
    [w * 0.5, -20, w * 0.53, h + 20],
  ];
}

const svgNs = "http://www.w3.org/2000/svg";
const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) => {
  const n = document.createElementNS(svgNs, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};

function buildChains(svg: SVGSVGElement, w: number, h: number): Link[] {
  const links: Link[] = [];
  const L = Math.max(30, Math.min(46, w / 28)); // Länge eines Glieds
  chainLines(w, h).forEach(([x1, y1, x2, y2], ci) => {
    const len = Math.hypot(x2 - x1, y2 - y1), n = Math.ceil(len / (L * 0.72));
    const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
    const row = el("g", { class: `lb-chain c${ci}` });
    for (let i = 0; i <= n; i++) {
      const x = x1 + ((x2 - x1) * i) / n, y = y1 + ((y2 - y1) * i) / n;
      const g = el("g", { transform: `translate(${x} ${y}) rotate(${angle})` }) as SVGGElement;
      // Abwechselnd ein Glied von vorn (Ring) und eines von der Seite (schmaler Steg)
      if (i % 2 === 0) {
        g.append(el("ellipse", { cx: 2, cy: 4, rx: L / 2, ry: L / 3.4, fill: "none", stroke: "rgba(0,0,0,0.55)", "stroke-width": L / 6 }));
        g.append(el("ellipse", { rx: L / 2, ry: L / 3.4, fill: "none", stroke: "url(#lbIron)", "stroke-width": L / 7 }));
        g.append(el("ellipse", { rx: L / 2 - L / 14, ry: L / 3.4 - L / 14, fill: "none", stroke: "rgba(255,255,255,0.18)", "stroke-width": 1.2 }));
      } else {
        g.append(el("rect", { x: -L / 2, y: -L / 12, width: L, height: L / 6, rx: L / 12, fill: "url(#lbIron)" }));
      }
      row.append(g);
      links.push({ el: g, x, y, angle });
    }
    // Eiserne Anker an den Enden
    for (const [ax, ay] of [[x1, y1], [x2, y2]]) row.append(el("circle", { cx: Math.min(w - 6, Math.max(6, ax)), cy: Math.min(h - 6, Math.max(6, ay)), r: L / 2.6, fill: "url(#lbIron)", stroke: "#1a0f0a", "stroke-width": 3 }));
    svg.append(row);
  });
  return links;
}

/** Funken (Canvas): bei jedem Ruck ein paar, bei der Sprengung ein ganzer Sturm. */
function sparks(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")!;
  const ps: { x: number; y: number; vx: number; vy: number; life: number; hue: number; size: number }[] = [];
  let running = true;
  const tick = () => {
    if (!running) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "lighter";
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.18; p.vx *= 0.985; p.life -= 0.016;
      if (p.life <= 0) { ps.splice(i, 1); continue; }
      ctx.strokeStyle = `hsla(${p.hue}, 100%, ${55 + p.life * 30}%, ${p.life})`;
      ctx.lineWidth = p.size;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 2.2, p.y - p.vy * 2.2); ctx.stroke();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return {
    burst(x: number, y: number, count: number, power: number) {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2, v = (0.4 + Math.random()) * power;
        ps.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - power * 0.3, life: 0.6 + Math.random() * 0.6, hue: 20 + Math.random() * 35, size: 1 + Math.random() * 2.2 });
      }
    },
    stop() { running = false; },
  };
}

/**
 * Zeigt die ganze Szene und löst auf, wenn der Spieler auf „Weiter“ drückt. `onLegend`: optionaler Knopf am Ende
 * („Legendäre Fähigkeit erwecken“).
 */
export function playLimitBreak(name: string, onLegend?: () => void): Promise<void> {
  return new Promise((resolve) => {
    const calm = settings().animation === "off" || matchMedia("(prefers-reduced-motion: reduce)").matches;
    const touch = matchMedia("(pointer: coarse)").matches;
    const w = innerWidth, h = innerHeight;
    const root = document.createElement("div");
    root.className = "lb-overlay";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Limit Break");
    root.innerHTML = html`
      <canvas class="lb-sparks" width="${w}" height="${h}"></canvas>
      <svg class="lb-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
        <defs>
          <linearGradient id="lbIron" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#9aa0a6"/><stop offset="0.45" stop-color="#4b4f55"/><stop offset="0.55" stop-color="#2b2e33"/><stop offset="1" stop-color="#6e5a48"/>
          </linearGradient>
          <radialGradient id="lbHeat"><stop offset="0" stop-color="#ffb347" stop-opacity="0.9"/><stop offset="1" stop-color="#ff3d00" stop-opacity="0"/></radialGradient>
        </defs>
        <circle class="lb-heat" cx="${w / 2}" cy="${h / 2}" r="${Math.max(w, h) * 0.2}" fill="url(#lbHeat)"/>
        <g class="lb-cracks"></g>
      </svg>
      <div class="lb-prompt">
        <div class="lb-bound">${name} liegt in Ketten …</div>
        <div class="lb-key">${touch ? "Tippen!" : "LEERTASTE"}</div>
        <div class="lb-meter"><i></i></div>
        <small>${touch ? "Tippe so schnell du kannst" : "Hämmere auf die Leertaste"}, um dich zu befreien</small>
      </div>
      <div class="lb-flash"></div>
      <div class="lb-result" hidden>
        <h1 class="lb-title"><span>LIMIT</span> <span>BREAK</span></h1>
        <p class="lb-sub">Die Ketten sind gesprengt. ${name} wächst über sich hinaus.</p>
        <ul class="lb-gains"><li>Ruhm-Vorteile über die Obergrenze</li><li>Eine legendäre Fähigkeit</li><li>Meisterschaft III: verstärkte Wirkung</li><li>Zwei Plätze in der Erbstück-Truhe</li></ul>
        <div class="lb-actions">${onLegend ? html`<button class="btn btn-lg" data-lb="legend">Legendäre Fähigkeit erwecken</button>` : ""}<button class="btn btn-lg btn-ghost" data-lb="close">Weiter</button></div>
      </div>`.value;
    document.body.append(root);
    const svg = root.querySelector<SVGSVGElement>(".lb-svg")!;
    const links = buildChains(svg, w, h);
    const fx = sparks(root.querySelector<HTMLCanvasElement>(".lb-sparks")!);
    const meter = root.querySelector<HTMLElement>(".lb-meter i")!;
    const cracks = svg.querySelector<SVGGElement>(".lb-cracks")!;
    const heat = svg.querySelector<SVGCircleElement>(".lb-heat")!;
    let progress = 0, done = false, ready = false;
    const step = calm ? 0.2 : 0.075;

    const crack = () => {
      // Risse wachsen von der Mitte (wo die Ketten sich kreuzen) nach außen
      const a = Math.random() * Math.PI * 2, r1 = 10 + Math.random() * 30, r2 = r1 + 40 + progress * 160;
      const mx = w / 2 + Math.cos(a + 0.4) * (r1 + r2) * 0.3, my = h / 2 + Math.sin(a + 0.4) * (r1 + r2) * 0.3;
      cracks.append(el("path", { d: `M${w / 2 + Math.cos(a) * r1} ${h / 2 + Math.sin(a) * r1} Q${mx} ${my} ${w / 2 + Math.cos(a) * r2} ${h / 2 + Math.sin(a) * r2}`, class: "lb-crack" }));
    };

    const hit = (e?: Event) => {
      if (done) return;
      e?.preventDefault();
      unlockAudio();
      progress = Math.min(1, progress + step * (0.85 + Math.random() * 0.3));
      meter.style.width = `${progress * 100}%`;
      heat.setAttribute("opacity", String(0.15 + progress * 0.85));
      root.style.setProperty("--tension", String(progress));
      playChainRattle(0.8 + progress);
      if (!calm) {
        // Ruck: Ketten zittern, Funken an zufälligen Gliedern
        root.classList.remove("lb-jolt"); void root.offsetWidth; root.classList.add("lb-jolt");
        for (let i = 0; i < 2; i++) { const l = links[(Math.random() * links.length) | 0]; fx.burst(l.x, l.y, 10 + progress * 25, 3 + progress * 4); }
        if (Math.random() < 0.6) crack();
      }
      if (progress >= 1) void shatter();
    };

    const shatter = async () => {
      done = true;
      root.classList.add("lb-strain");
      await new Promise((r) => setTimeout(r, calm ? 100 : 650)); // letzte Anspannung
      playExplosion();
      root.classList.remove("lb-strain");
      root.classList.add("lb-boom");
      if (!calm) {
        fx.burst(w / 2, h / 2, 420, 16);
        for (let i = 0; i < 8; i++) { const l = links[(Math.random() * links.length) | 0]; fx.burst(l.x, l.y, 40, 9); }
        // Jedes Glied fliegt von der Mitte weg und dreht sich dabei
        for (const l of links) {
          const dx = l.x - w / 2, dy = l.y - h / 2, d = Math.hypot(dx, dy) || 1;
          const v = 500 + Math.random() * 900;
          const tx = l.x + (dx / d) * v + (Math.random() - 0.5) * 300, ty = l.y + (dy / d) * v + 260 + Math.random() * 200;
          l.el.animate([
            { transform: `translate(${l.x}px, ${l.y}px) rotate(${l.angle}deg)`, opacity: 1 },
            { transform: `translate(${tx}px, ${ty}px) rotate(${l.angle + (Math.random() - 0.5) * 1440}deg)`, opacity: 0 },
          ], { duration: 1300 + Math.random() * 700, easing: "cubic-bezier(.12,.75,.3,1)", fill: "forwards" });
          l.el.removeAttribute("transform");
        }
        svg.querySelectorAll("circle:not(.lb-heat)").forEach((c) => (c as SVGElement).animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: "forwards" }));
      } else svg.style.opacity = "0";
      cracks.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 800, fill: "forwards" });
      await new Promise((r) => setTimeout(r, calm ? 50 : 500));
      const result = root.querySelector<HTMLElement>(".lb-result")!;
      result.hidden = false;
      root.classList.add("lb-done");
      // Kurz warten, damit weiteres Hämmern nicht gleich einen Knopf auslöst
      setTimeout(() => { ready = true; (result.querySelector("button") as HTMLButtonElement).focus(); }, 900);
    };

    const finish = () => {
      if (!ready) return;
      removeEventListener("keydown", onKey, true);
      fx.stop();
      root.classList.add("lb-out");
      setTimeout(() => { root.remove(); resolve(); }, calm ? 0 : 450);
    };
    // Solange die Szene läuft, gehören Leertaste und Enter ihr (nichts dahinter wird ausgelöst)
    // Die Leertaste löst nie einen Knopf aus (wer weiterhämmert, soll nichts versehentlich wählen) – Enter erst am Ende
    const onKey = (e: KeyboardEvent) => {
      const space = e.code === "Space" || e.key === " ";
      if (!space && e.key !== "Enter") return;
      if (ready && !space) return;
      e.preventDefault(); e.stopPropagation();
      if (!done) hit();
    };
    addEventListener("keydown", onKey, true);
    root.addEventListener("pointerdown", (e) => { if (!(e.target as HTMLElement).closest("button")) hit(e); });
    root.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-lb]");
      if (!b) return;
      if (b.dataset.lb === "legend") onLegend?.();
      finish();
    });
  });
}
