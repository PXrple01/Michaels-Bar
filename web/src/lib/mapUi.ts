// Gezeichnete Karte der Reise (SVG): Wege gestrichelt, Orte als kleine Zeichen je Art, der aktuelle Ort glüht.
import { PLACE_NAME, type PlaceKind, type TravelMap } from "../../../shared/map";
import { $, esc, fragment, html, raw, type Raw } from "./dom";
import { icon } from "./icons";

/** Kleine Zeichen in einem 10×10-Feld. */
const GLYPH: Record<PlaceKind, string> = {
  dorf: "M1 9V5l4-3 4 3v4z",
  stadt: "M0 9V5l3-2 3 2v4zM5 9V4l2.5-2L10 4v5z",
  burg: "M1 9V3h2v2h1V3h2v2h1V3h2v6z",
  kloster: "M3 9V5l2-2 2 2v4zM5 0v3M4 1h2",
  wald: "M5 1 1 7h8zM5 7v2",
  hoehle: "M1 9a4 4 0 0 1 8 0z",
  ruine: "M1 9V4h2v2h1V3h2v3h1V5h2v4z",
  gasthaus: "M2 9V4h5v5zM7 5h1.5v2.5H7",
  fluss: "M0 4q2.5-2 5 0t5 0M0 7q2.5-2 5 0t5 0",
  berg: "M0 9 4 2l2 3 1-1 3 5z",
  sonstiges: "M5 1a4 4 0 1 0 0.01 0z",
};

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function mapSvg(map: TravelMap, big = false): Raw {
  // Wenige Orte etwas größer auseinanderziehen, damit die Karte den Rahmen füllt; viele Orte machen die Karte größer.
  const base = big ? 70 : 46, padX = big ? 90 : 60, padY = big ? 50 : 34, VW = big ? 420 : 240, VH = big ? 300 : 150;
  const xs = map.places.map((p) => p.x), ys = map.places.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = maxX - minX, spanY = maxY - minY;
  const S = Math.max(base, Math.min(base * 1.8, spanX ? (VW - padX * 2) / spanX : Infinity, spanY ? (VH - padY * 2) / spanY : Infinity));
  const W = Math.max(VW, spanX * S + padX * 2), H = Math.max(VH, spanY * S + padY * 2);
  const offX = (W - spanX * S) / 2, offY = (H - spanY * S) / 2;
  const pos = (p: { x: number; y: number }) => [(p.x - minX) * S + offX, (p.y - minY) * S + offY] as const;
  const byName = new Map(map.places.map((p) => [p.name, p]));
  const roads = map.roads.map(([a, b]) => { const A = byName.get(a), B = byName.get(b); if (!A || !B) return ""; const [x1, y1] = pos(A), [x2, y2] = pos(B); const mx = (x1 + x2) / 2 + (y2 - y1) * 0.12, my = (y1 + y2) / 2 - (x2 - x1) * 0.12; return `<path class="map-road" d="M${x1} ${y1}Q${mx} ${my} ${x2} ${y2}"/>`; }).join("");
  const nodes = map.places.map((p) => {
    const [x, y] = pos(p);
    const cur = p.name === map.current;
    const g = big ? 1.6 : 1.1;
    return `<g class="map-place ${cur ? "current" : ""}"><title>${esc(p.name)} – ${PLACE_NAME[p.kind]}${p.note ? `: ${esc(p.note)}` : ""}</title>
      ${cur ? `<circle class="map-glow" cx="${x}" cy="${y}" r="${big ? 18 : 13}"/>` : ""}
      <circle class="map-dot" cx="${x}" cy="${y}" r="${big ? 13 : 9}"/>
      <path class="map-glyph k-${p.kind}" d="${GLYPH[p.kind]}" transform="translate(${x - 5 * g} ${y - 5 * g}) scale(${g})"/>
      <text class="map-label" x="${x}" y="${y + (big ? 28 : 20)}">${esc(short(p.name, big ? 32 : 18))}</text></g>`;
  }).join("");
  return raw(`<svg class="map-svg ${big ? "big" : ""}" viewBox="0 0 ${Math.round(W)} ${Math.round(H)}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Karte der Reise">${roads}${nodes}</svg>`);
}

export function mapBlock(map: TravelMap | undefined): Raw {
  if (!map?.places.length) return html``;
  return html`<div class="side-sec map-block">
    <div class="map-head"><span>${icon("map")} Karte</span><button type="button" class="link-btn" data-map-open>groß ansehen</button></div>
    <button type="button" class="map-frame" data-map-open aria-label="Karte groß ansehen">${mapSvg(map)}</button>
    ${map.current ? html`<small class="muted">Ihr seid in: <b>${map.current}</b></small>` : ""}
  </div>`;
}

/** Große Karte im Dialog (mit Liste aller Orte). */
export function openMap(map: TravelMap) {
  const el = fragment(html`<div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Karte der Reise">
    <div class="modal card map-modal">
      <div class="map-head"><h3>${icon("map")} Karte der Reise</h3><button class="icon-btn" data-close aria-label="Schließen">${icon("x")}</button></div>
      <div class="map-frame big">${mapSvg(map, true)}</div>
      <ul class="map-list">${[...map.places].reverse().map((p) => html`<li class="${p.name === map.current ? "current" : ""}"><b>${p.name}</b> <small class="muted">${PLACE_NAME[p.kind]}${p.visits > 1 ? ` · ${p.visits}× besucht` : ""}</small>${p.note ? html`<span>${p.note}</span>` : ""}</li>`)}</ul>
    </div>
  </div>`);
  const close = () => { el.remove(); removeEventListener("keydown", onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
  el.addEventListener("click", (e) => { if (e.target === el || (e.target as HTMLElement).closest("[data-close]")) close(); });
  addEventListener("keydown", onKey);
  $("#modal-root").append(el);
}
