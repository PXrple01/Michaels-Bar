// Würfel-Meshes mit sauber beschrifteten Flächen (Canvas-Textur-Atlas).
import * as THREE from "three";
import type { DieKind } from "../../../shared/dice";
import type { DiceThemeId } from "../lib/settings";
import { getDieModel, type DieFace, type DieModel } from "./geometry";

export interface DiceTheme { name: string; body: string; body2: string; ink: string; inkGlow: string; edge: string; roughness: number; clearcoat: number; marble: number }

export const DICE_THEMES: Record<DiceThemeId, DiceTheme> = {
  glut:        { name: "Glut",        body: "#120605", body2: "#3d0e08", ink: "#ffbf8f", inkGlow: "#ff5a24", edge: "#c8321c", roughness: 0.24, clearcoat: 1, marble: 0.55 },
  obsidian:    { name: "Obsidian",    body: "#0b0812", body2: "#1e1433", ink: "#c4a5ff", inkGlow: "#8b5cf6", edge: "#7c3aed", roughness: 0.22, clearcoat: 1, marble: 0.35 },
  amethyst:    { name: "Amethyst",    body: "#4c1d95", body2: "#7c3aed", ink: "#fbf7ff", inkGlow: "#e9d5ff", edge: "#c4b5fd", roughness: 0.18, clearcoat: 1, marble: 0.8 },
  mitternacht: { name: "Mitternacht", body: "#0f0b24", body2: "#2b2266", ink: "#e5e7ff", inkGlow: "#a5b4fc", edge: "#818cf8", roughness: 0.25, clearcoat: 0.9, marble: 0.5 },
  knochen:     { name: "Knochen",     body: "#e8dfc9", body2: "#c9bb98", ink: "#2a1342", inkGlow: "#2a1342", edge: "#8b7a55", roughness: 0.45, clearcoat: 0.4, marble: 0.4 },
};

const CELL = 256;

interface FaceLayout { col: number; row: number; scale: number; right: THREE.Vector3; up: THREE.Vector3 }

function layoutFaces(model: DieModel) {
  const n = model.faces.length;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const layouts: FaceLayout[] = model.faces.map((f, i) => {
    const right = new THREE.Vector3().crossVectors(f.up, f.normal).normalize();
    const R = Math.max(...f.polygon.map((p) => p.distanceTo(f.center)));
    return { col: i % cols, row: Math.floor(i / cols), scale: (CELL * 0.5 * 0.97) / R, right, up: f.up };
  });
  return { cols, rows, layouts };
}

function to2D(f: DieFace, L: FaceLayout, p: THREE.Vector3): [number, number] {
  const d = p.clone().sub(f.center);
  return [d.dot(L.right), d.dot(L.up)];
}

function inradius(f: DieFace, L: FaceLayout): number {
  const pts = f.polygon.map((p) => to2D(f, L, p));
  let min = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
    const len = Math.hypot(bx - ax, by - ay);
    min = Math.min(min, Math.abs(ax * by - ay * bx) / len);
  }
  return min;
}

/** Schriftgröße relativ zum Inkreis der Fläche. */
const FONT_FACTOR: Partial<Record<DieKind, number>> = { d8: 0.95, d10: 0.95, d10t: 0.82, d10u: 0.95, d12: 0.88, d20: 0.98 };

function drawAtlas(model: DieModel, theme: DiceTheme, cols: number, rows: number, layouts: FaceLayout[]): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = cols * CELL;
  canvas.height = rows * CELL;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = theme.body;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  model.faces.forEach((f, i) => {
    const L = layouts[i];
    const cx = (L.col + 0.5) * CELL, cy = (L.row + 0.5) * CELL;
    const pts = f.polygon.map((p) => { const [x, y] = to2D(f, L, p); return [cx + x * L.scale, cy - y * L.scale] as const; });
    ctx.save();
    // Flächengrund mit leichtem Verlauf und Marmorierung
    const g = ctx.createRadialGradient(cx - CELL * 0.15, cy - CELL * 0.2, 4, cx, cy, CELL * 0.6);
    g.addColorStop(0, theme.body2);
    g.addColorStop(1, theme.body);
    ctx.fillStyle = g;
    ctx.fillRect(L.col * CELL, L.row * CELL, CELL, CELL);
    ctx.globalAlpha = 0.18 * theme.marble;
    for (let k = 0; k < 7; k++) {
      ctx.strokeStyle = k % 2 ? theme.body2 : theme.edge;
      ctx.lineWidth = 1 + Math.random() * 5;
      ctx.beginPath();
      let x = L.col * CELL + Math.random() * CELL, y = L.row * CELL + Math.random() * CELL;
      ctx.moveTo(x, y);
      for (let s = 0; s < 4; s++) { x += (Math.random() - 0.5) * 120; y += (Math.random() - 0.5) * 120; ctx.quadraticCurveTo(x + 30, y - 30, x, y); }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Kante: feiner heller Rand, wirkt wie eine Fase
    ctx.beginPath();
    pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.strokeStyle = theme.edge;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();

    const r = inradius(f, L) * L.scale;
    if (model.kind === "d4") drawD4Face(ctx, model, f, L, cx, cy, theme);
    else if (model.kind === "d6") drawPips(ctx, model.values[i].value, cx, cy, r, theme);
    else drawNumber(ctx, model.values[i].label, cx, cy, r * (FONT_FACTOR[model.kind] ?? 0.9), theme, model.kind);
  });
  return canvas;
}

function inkText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, theme: DiceTheme) {
  ctx.font = `700 ${size}px Cinzel, Georgia, serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // eingravierter Eindruck: dunkler Versatz, dann leuchtende Tinte
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillText(text, x + size * 0.03, y + size * 0.05);
  ctx.shadowColor = theme.inkGlow;
  ctx.shadowBlur = size * 0.25;
  ctx.fillStyle = theme.ink;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
}

function drawNumber(ctx: CanvasRenderingContext2D, label: string, cx: number, cy: number, r: number, theme: DiceTheme, kind: DieKind) {
  let size = r * 1.25;
  ctx.font = `700 ${size}px Cinzel, Georgia, serif`;
  const maxW = r * (label.length > 1 ? 1.75 : 1.3);
  const w = ctx.measureText(label).width;
  if (w > maxW) size *= maxW / w;
  const y = cy + size * 0.06;
  inkText(ctx, label, cx, y, size, theme);
  // 6 und 9 unterstreichen, damit man sie unterscheiden kann
  if ((label === "6" || label === "9") && kind !== "d6") {
    ctx.fillStyle = theme.ink;
    ctx.fillRect(cx - size * 0.22, y + size * 0.45, size * 0.44, Math.max(3, size * 0.07));
  }
}

function drawPips(ctx: CanvasRenderingContext2D, value: number, cx: number, cy: number, r: number, theme: DiceTheme) {
  const s = r * 0.55;
  const spots: Record<number, [number, number][]> = {
    1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
    5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
  };
  for (const [x, y] of spots[value]) {
    const px = cx + x * s, py = cy + y * s, pr = r * (value === 1 ? 0.24 : 0.16);
    ctx.beginPath();
    ctx.arc(px + 2, py + 3, pr, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.shadowColor = theme.inkGlow;
    ctx.shadowBlur = pr * 0.8;
    ctx.fillStyle = theme.ink;
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

/** W4: Jede Fläche zeigt die drei Zahlen ihrer Ecken; abgelesen wird die Zahl an der oberen Spitze. */
function drawD4Face(ctx: CanvasRenderingContext2D, model: DieModel, f: DieFace, L: FaceLayout, cx: number, cy: number, theme: DiceTheme) {
  for (const vi of f.vertexIndices) {
    const [x, y] = to2D(f, L, model.vertices[vi]);
    const px = cx + x * L.scale * 0.58, py = cy - y * L.scale * 0.58;
    const angle = Math.atan2(x, y); // Oberseite der Zahl zeigt zur Ecke
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    inkText(ctx, model.values[vi].label, 0, 0, CELL * 0.17, theme);
    ctx.restore();
  }
}

function buildGeometry(model: DieModel, cols: number, rows: number, layouts: FaceLayout[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  model.faces.forEach((f, i) => {
    const L = layouts[i];
    const toUV = (p: THREE.Vector3) => {
      const [x, y] = to2D(f, L, p);
      return [(L.col + 0.5 + (x * L.scale) / CELL) / cols, 1 - (L.row + 0.5 - (y * L.scale) / CELL) / rows];
    };
    for (let k = 1; k < f.polygon.length - 1; k++) {
      for (const p of [f.polygon[0], f.polygon[k], f.polygon[k + 1]]) {
        pos.push(p.x, p.y, p.z);
        nor.push(f.normal.x, f.normal.y, f.normal.z);
        uv.push(...toUV(p));
      }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

const cache = new Map<string, { geometry: THREE.BufferGeometry; material: THREE.MeshPhysicalMaterial }>();

export function createDieMesh(kind: DieKind, themeId: DiceThemeId, maxAnisotropy = 4): THREE.Mesh {
  const key = `${kind}:${themeId}`;
  let entry = cache.get(key);
  if (!entry) {
    const model = getDieModel(kind);
    const theme = DICE_THEMES[themeId];
    const { cols, rows, layouts } = layoutFaces(model);
    const tex = new THREE.CanvasTexture(drawAtlas(model, theme, cols, rows, layouts));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAnisotropy;
    const material = new THREE.MeshPhysicalMaterial({
      map: tex, roughness: theme.roughness, metalness: 0.05, clearcoat: theme.clearcoat, clearcoatRoughness: 0.12,
      sheen: 0.4, sheenColor: new THREE.Color(theme.edge), transparent: true,
    });
    entry = { geometry: buildGeometry(model, cols, rows, layouts), material };
    cache.set(key, entry);
  }
  const mesh = new THREE.Mesh(entry.geometry, entry.material.clone());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Nach Schriftwechsel/Theme-Wechsel Texturen neu erzeugen. */
export function clearDieCache() {
  for (const e of cache.values()) { e.geometry.dispose(); e.material.map?.dispose(); e.material.dispose(); }
  cache.clear();
}
