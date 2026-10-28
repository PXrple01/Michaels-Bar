// Farbthema der Seite anwenden: Attribut am <html>, Browserleiste, Favicon. Farben für Canvas/3D aus den CSS-Variablen.
import type { PaletteId } from "./settings";

/** Farbe aus der aktiven Palette (CSS-Variable --c-…) als rgba()-Text – für Canvas und 3D, die kein CSS verstehen. */
export function paletteColor(name: string, alpha = 1): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--c-${name}`).trim() || "200, 60, 40";
  return `rgba(${v}, ${alpha})`;
}

/** Hexagon mit Glut-Flamme – Farben aus der Palette (für Logo und Favicon). */
export function emberMark(colors: { a: string; b: string; core: string; bg: string }, id = "lg"): string {
  return `<svg class="logo-mark" viewBox="0 0 64 64" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><defs>` +
    `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${colors.a}"/><stop offset="1" stop-color="${colors.b}"/></linearGradient>` +
    `<radialGradient id="${id}c" cx="0.5" cy="0.72" r="0.6"><stop offset="0" stop-color="${colors.core}"/><stop offset="1" stop-color="${colors.b}"/></radialGradient></defs>` +
    `<polygon points="32,3 57,17.5 57,46.5 32,61 7,46.5 7,17.5" fill="${colors.bg}" stroke="url(#${id})" stroke-width="2.5"/>` +
    `<path d="M32 13c6 8 12.5 13.5 12.5 24 0 8.2-5.6 13.5-12.5 13.5S19.5 45.2 19.5 37c0-6 3.6-10 5.8-15 1.2 5.6 3.2 8 5.6 8.2C30 24.4 30 18.8 32 13z" fill="url(#${id}c)" opacity=".95"/>` +
    `<path d="M32 30c3.2 4 5.2 7 5.2 11 0 3.6-2.3 6.2-5.2 6.2s-5.2-2.6-5.2-6.2c0-3.6 3.2-6.2 5.2-11z" fill="${colors.core}" opacity=".9"/></svg>`;
}

const MARK: Record<PaletteId, { a: string; b: string; core: string; bg: string; theme: string }> = {
  glut: { a: "#ffd2a8", b: "#d8321c", core: "#ffe7b0", bg: "#0d0605", theme: "#070404" },
  amethyst: { a: "#ddd6fe", b: "#7c3aed", core: "#f5f3ff", bg: "#0d0a14", theme: "#07050c" },
};

export const logoSvg = (p: PaletteId) => emberMark(MARK[p]);

export function applyPalette(p: PaletteId) {
  document.documentElement.dataset.palette = p;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", MARK[p].theme);
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (link) link.href = `data:image/svg+xml,${encodeURIComponent(emberMark(MARK[p], "f"))}`;
}
