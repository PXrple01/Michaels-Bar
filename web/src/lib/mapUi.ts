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

/** Kompass: Windrose hinter der Karte (back), Ring mit Strichen und N/O/S/W darüber (front). */
function compass(size: number): { back: string; front: string } {
  const c = size / 2, r = c - 3, k = size / 200;
  const ticks = Array.from({ length: 72 }, (_, i) => {
    const a = (i * 5 * Math.PI) / 180, long = i % 18 === 0 ? 9 : i % 6 === 0 ? 5 : 2.5;
    const r1 = r - 2 * k, r2 = r - (2 + long) * k;
    return `M${(c + Math.sin(a) * r1).toFixed(1)} ${(c - Math.cos(a) * r1).toFixed(1)}L${(c + Math.sin(a) * r2).toFixed(1)} ${(c - Math.cos(a) * r2).toFixed(1)}`;
  }).join("");
  const star = (len: number, w: number, rot: number) => [0, 90, 180, 270].map((d) => {
    const a = ((d + rot) * Math.PI) / 180, b = a + Math.PI / 2;
    return `M${c} ${c}L${c + Math.sin(a) * len} ${c - Math.cos(a) * len}L${c + Math.sin(b) * w} ${c - Math.cos(b) * w}Z`;
  }).join("");
  const rose = r * 0.62;
  const letters = ([["N", 0], ["O", 90], ["S", 180], ["W", 270]] as const).map(([l, d]) => {
    const a = (d * Math.PI) / 180, rr = r - 17 * k;
    return `<text class="map-cardinal ${l === "N" ? "north" : ""}" x="${(c + Math.sin(a) * rr).toFixed(1)}" y="${(c - Math.cos(a) * rr + 3.5 * k).toFixed(1)}" style="font-size:${(l === "N" ? 11 : 9) * k}px">${l}</text>`;
  }).join("");
  return {
    back: `<path class="map-rose" d="${star(rose, rose * 0.12, 0)}"/><path class="map-rose minor" d="${star(rose * 0.6, rose * 0.08, 45)}"/>`,
    front: `<circle class="map-ring" cx="${c}" cy="${c}" r="${r}"/><circle class="map-ring inner" cx="${c}" cy="${c}" r="${r - 13 * k}"/><path class="map-ticks" d="${ticks}"/>${letters}`,
  };
}

export function mapSvg(map: TravelMap, big = false): Raw {
  // Runde Karte: alles muss in den inneren Kreis passen. Wenige Orte etwas auseinanderziehen, viele verkleinern.
  const base = big ? 64 : 34, VW = big ? 400 : 200, padX = VW * 0.3, padY = VW * 0.25;
  const xs = map.places.map((p) => p.x), ys = map.places.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = maxX - minX, spanY = maxY - minY;
  const S = Math.max(base, Math.min(base * 1.8, spanX ? (VW - padX * 2) / spanX : Infinity, spanY ? (VW - padY * 2) / spanY : Infinity));
  const size = Math.max(VW, spanX * S + padX * 2, spanY * S + padY * 2), k = size / VW;
  const offX = (size - spanX * S) / 2, offY = (size - spanY * S) / 2;
  const pos = (p: { x: number; y: number }) => [(p.x - minX) * S + offX, (p.y - minY) * S + offY] as const;
  const byName = new Map(map.places.map((p) => [p.name, p]));
  const roads = map.roads.map(([a, b]) => { const A = byName.get(a), B = byName.get(b); if (!A || !B) return ""; const [x1, y1] = pos(A), [x2, y2] = pos(B); const mx = (x1 + x2) / 2 + (y2 - y1) * 0.12, my = (y1 + y2) / 2 - (x2 - x1) * 0.12; return `<path class="map-road" style="stroke-width:${1.4 * k}" d="M${x1} ${y1}Q${mx} ${my} ${x2} ${y2}"/>`; }).join("");
  const nodes = map.places.map((p) => {
    const [x, y] = pos(p);
    const cur = p.name === map.current;
    const g = (big ? 1.5 : 0.95) * k, dot = (big ? 12 : 8) * k;
    return `<g class="map-place ${cur ? "current" : ""}"><title>${esc(p.name)} – ${PLACE_NAME[p.kind]}${p.note ? `: ${esc(p.note)}` : ""}</title>
      ${cur ? `<circle class="map-glow" cx="${x}" cy="${y}" r="${dot * 1.45}"/>` : ""}
      <circle class="map-dot" cx="${x}" cy="${y}" r="${dot}"/>
      <path class="map-glyph k-${p.kind}" d="${GLYPH[p.kind]}" transform="translate(${x - 5 * g} ${y - 5 * g}) scale(${g})"/>
      <text class="map-label" style="font-size:${(big ? 11 : 7.5) * k}px" x="${x}" y="${y + dot + (big ? 13 : 9) * k}">${esc(short(p.name, big ? 28 : 16))}</text></g>`;
  }).join("");
  const { back, front } = compass(size);
  return raw(`<svg class="map-svg ${big ? "big" : ""}" viewBox="0 0 ${Math.round(size)} ${Math.round(size)}" role="img" aria-label="Karte der Reise">${back}${roads}${nodes}${front}</svg>`);
}

/** Gemalter Kartenhintergrund als CSS-Variable (fehlt er, bleibt der dunkle Kartentisch). */
const bgStyle = (map: TravelMap) => (map.bg ? `--map-bg: url("${map.bg}")` : "");

export function mapBlock(map: TravelMap | undefined): Raw {
  if (!map?.places.length) return html``;
  return html`<div class="side-sec map-block">
    <button type="button" class="map-frame ${map.bg ? "has-bg" : ""}" style="${bgStyle(map)}" data-map-open aria-label="Karte groß ansehen" title="Karte groß ansehen">${mapSvg(map)}</button>
    ${map.current ? html`<small class="map-here">${icon("map")} <span>Ihr seid in <b>${map.current}</b></span></small>` : ""}
  </div>`;
}

/** Große Karte im Dialog (mit Liste aller Orte). */
export function openMap(map: TravelMap) {
  const el = fragment(html`<div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Karte der Reise">
    <div class="modal card map-modal">
      <div class="map-head"><h3>${icon("map")} Karte der Reise</h3><button class="icon-btn" data-close aria-label="Schließen">${icon("x")}</button></div>
      <div class="map-frame big ${map.bg ? "has-bg" : ""}" style="${bgStyle(map)}">${mapSvg(map, true)}</div>
      <ul class="map-list">${[...map.places].reverse().map((p) => html`<li class="${p.name === map.current ? "current" : ""}"><b>${p.name}</b> <small class="muted">${PLACE_NAME[p.kind]}${p.visits > 1 ? ` · ${p.visits}× besucht` : ""}</small>${p.note ? html`<span>${p.note}</span>` : ""}</li>`)}</ul>
    </div>
  </div>`);
  const close = () => { el.remove(); removeEventListener("keydown", onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
  el.addEventListener("click", (e) => { if (e.target === el || (e.target as HTMLElement).closest("[data-close]")) close(); });
  addEventListener("keydown", onKey);
  $("#modal-root").append(el);
}
