// Bewegungen der Startseite: Titel fängt Feuer, Text schreibt sich, Funken, Rauch, aufsteigende Glut.
// Alles respektiert „Bewegung reduzieren“ (System) und die Animations-Einstellung „aus“.
import { prefersReducedMotion } from "../lib/dom";
import { settings } from "../lib/settings";

export const calmMotion = () => prefersReducedMotion() || settings().animation === "off";
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, calmMotion() ? 0 : ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Titel in Buchstaben zerlegen; jeder fängt nacheinander Feuer wie an einer Zündschnur. */
export function igniteTitle(h: HTMLElement, startMs: number, stepMs = 55) {
  const text = h.textContent ?? "";
  const words = text.split(" ");
  let i = 0;
  h.setAttribute("aria-label", text);
  h.innerHTML = words.map((w, wi) =>
    `<span class="hm-word ${wi === words.length - 1 ? "is-deep" : "is-light"}" aria-hidden="true">${[...w].map((ch) =>
      `<span class="hm-l" style="--d:${startMs + i++ * stepMs}ms;--sx:${rand(-14, 14).toFixed(0)}px">${ch}</span>`).join("")}</span>`).join(" ");
}

/** Text Wort für Wort „einschreiben“ (wie Tinte, die glüht und abkühlt). Gibt das Ende in ms zurück. */
export function inkWords(els: HTMLElement[], startMs: number, stepMs: number): number {
  let i = 0;
  for (const el of els) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    for (const node of nodes) {
      const parts = (node.textContent ?? "").split(/(\s+)/);
      const frag = document.createDocumentFragment();
      for (const part of parts) {
        if (!part) continue;
        if (/^\s+$/.test(part)) { frag.append(part); continue; }
        const s = document.createElement("span");
        s.className = "hm-w";
        s.style.setProperty("--d", `${startMs + i++ * stepMs}ms`);
        s.textContent = part;
        frag.append(s);
      }
      node.replaceWith(frag);
    }
    // Hüllen mit eigenem Rahmen (Lexikon-Begriffe, gepunktet unterstrichen) erscheinen mit ihrem ersten Wort
    el.querySelectorAll<HTMLElement>(".term").forEach((t) => {
      const first = t.querySelector<HTMLElement>(".hm-w");
      if (first) { t.style.setProperty("--d", first.style.getPropertyValue("--d")); t.classList.add("hm-inked"); }
    });
  }
  return startMs + i * stepMs;
}

/** Aufsteigende Glut über dem Feuer (dauerhaft, sehr leicht). */
export function embers(host: HTMLElement, count = 16) {
  host.innerHTML = Array.from({ length: count }, () =>
    `<i style="--x:${rand(-34, 34).toFixed(1)}%;--dx:${rand(-40, 40).toFixed(0)}px;--dur:${rand(2.4, 4.6).toFixed(2)}s;--delay:${rand(0, 4.5).toFixed(2)}s;--s:${rand(2, 5).toFixed(1)}px"></i>`).join("");
}

export type BurstKind = "crit" | "hit" | "miss" | "fumble";

/** Funkenregen (Erfolg), Goldregen (kritisch) oder Rauch (Fehlschlag, Patzer) rund um den Würfel. */
export function burst(host: HTMLElement, kind: BurstKind) {
  if (calmMotion()) return;
  const smoke = kind === "miss" || kind === "fumble";
  const n = kind === "crit" ? 34 : kind === "hit" ? 16 : kind === "fumble" ? 12 : 7;
  const layer = document.createElement("div");
  layer.className = `hm-burst is-${kind}`;
  layer.innerHTML = Array.from({ length: n }, (_, i) => {
    const a = smoke ? rand(-150, -30) : (360 / n) * i + rand(-8, 8);
    const d = smoke ? rand(60, 150) : rand(kind === "crit" ? 120 : 80, kind === "crit" ? 260 : 170);
    return `<i style="--a:${a.toFixed(0)}deg;--d:${d.toFixed(0)}px;--s:${(smoke ? rand(18, 42) : rand(3, kind === "crit" ? 8 : 6)).toFixed(1)}px;--t:${rand(0.7, 1.3).toFixed(2)}s;--delay:${rand(0, 0.12).toFixed(2)}s"></i>`;
  }).join("") + (kind === "crit" ? '<b class="hm-ring"></b><b class="hm-ring is-late"></b>' : kind === "hit" ? '<b class="hm-ring"></b>' : "");
  host.append(layer);
  setTimeout(() => layer.remove(), 1800);
}

/** Einmal auslösen, sobald das Element ins Bild kommt. */
export function onceInView(el: Element, fn: () => void, threshold = 0.35) {
  if (calmMotion() || !("IntersectionObserver" in window)) { fn(); return; }
  const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { io.disconnect(); fn(); } }, { threshold });
  io.observe(el);
}

/** Zahl in einem Element hochzählen. */
export function countTo(el: HTMLElement, from: number, to: number, ms: number) {
  if (calmMotion() || ms <= 0) { el.textContent = String(to); return; }
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ms);
    el.textContent = String(Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3))));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
