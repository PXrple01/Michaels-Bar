// Kleine DOM-Helfer: sichere Templates, Abfragen, Ereignisse.

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
}

/** Markiert vertrauenswürdiges HTML, das in html`` nicht erneut maskiert werden soll. */
export class Raw { constructor(public value: string) {} toString() { return this.value; } }
export const raw = (s: string) => new Raw(s);

/** Template-Tag: alle eingesetzten Werte werden maskiert, außer Raw und Arrays davon. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Raw {
  let out = "";
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) out += render(values[i]);
  });
  return new Raw(out);
}
function render(v: unknown): string {
  if (v instanceof Raw) return v.value;
  if (Array.isArray(v)) return v.map(render).join("");
  if (v === false || v === null || v === undefined) return "";
  return esc(v);
}

export function $<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`Element fehlt: ${sel}`);
  return el;
}
export function $$<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] {
  return [...root.querySelectorAll<T>(sel)];
}

export function setHTML(el: Element, content: Raw) {
  el.innerHTML = content.value;
}

export function fragment(content: Raw): HTMLElement {
  const t = document.createElement("template");
  t.innerHTML = content.value.trim();
  return t.content.firstElementChild as HTMLElement;
}

/** Ereignis-Delegation: reagiert auf Klicks auf [data-action]. */
export function onAction(root: HTMLElement, handlers: Record<string, (el: HTMLElement, ev: Event) => void>) {
  root.addEventListener("click", (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!el || !root.contains(el)) return;
    const h = handlers[el.dataset.action!];
    if (h) h(el, ev);
  });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function uuid(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
