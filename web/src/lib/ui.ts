// Meldungen, Dialoge, Tooltips und Segment-Schalter.
import { $, fragment, html, type Raw } from "./dom";
import { GLOSSARY } from "./glossary";
import { icon } from "./icons";

export function toast(message: string, kind: "info" | "error" | "success" = "info", ms = 4200) {
  const el = fragment(html`<div class="toast ${kind}">${icon(kind === "error" ? "info" : kind === "success" ? "check" : "sparkles")}<div>${message}</div></div>`);
  $("#toasts").append(el);
  setTimeout(() => { el.classList.add("out"); el.addEventListener("animationend", () => el.remove()); }, ms);
}

export function confirmDialog(title: string, text: string, okLabel = "Ja", danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    const el = fragment(html`
      <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="${title}">
        <div class="modal card glow-border">
          <h3>${title}</h3>
          <p>${text}</p>
          <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">
            <button class="btn btn-ghost btn-sm" data-r="0">Abbrechen</button>
            <button class="btn btn-sm ${danger ? "btn-danger" : ""}" data-r="1">${okLabel}</button>
          </div>
        </div>
      </div>`);
    const close = (v: boolean) => { el.remove(); removeEventListener("keydown", onKey); resolve(v); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(false); };
    el.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t === el) close(false);
      const b = t.closest<HTMLElement>("[data-r]");
      if (b) close(b.dataset.r === "1");
    });
    addEventListener("keydown", onKey);
    $("#modal-root").append(el);
    el.querySelector<HTMLButtonElement>('[data-r="1"]')?.focus();
  });
}

/** Tooltips für alle .term-Elemente (Maus, Tastatur und Tippen). */
export function initTooltips() {
  const tip = $("#tooltip");
  let anchor: HTMLElement | null = null;
  const show = (el: HTMLElement) => {
    const t = GLOSSARY[el.dataset.term ?? ""];
    if (!t) return;
    anchor = el;
    tip.innerHTML = html`<strong>${t.title}</strong>${t.short}`.value;
    tip.hidden = false;
    tip.style.animation = "none"; void tip.offsetWidth; tip.style.animation = "";
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = r.left + r.width / 2 - w / 2;
    x = Math.max(16, Math.min(innerWidth - w - 16, x));
    let y = r.top - h - 10;
    if (y < 10) y = r.bottom + 10;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };
  const hide = () => { tip.hidden = true; anchor = null; };
  document.addEventListener("pointerover", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".term");
    if (el && e.pointerType === "mouse") show(el);
  });
  document.addEventListener("pointerout", (e) => {
    if ((e.target as HTMLElement).closest(".term") && (e as PointerEvent).pointerType === "mouse") hide();
  });
  document.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".term");
    if (el) { e.preventDefault(); if (anchor === el) hide(); else show(el); }
    else hide();
  });
  document.addEventListener("focusin", (e) => { const el = (e.target as HTMLElement).closest<HTMLElement>(".term"); if (el) show(el); });
  document.addEventListener("focusout", hide);
  addEventListener("scroll", hide, { passive: true });
}

/** Segment-Schalter mit gleitendem Hintergrund. */
export function segmented<T extends string>(name: string, options: { value: T; label: string }[], value: T): Raw {
  return html`<div class="segmented" role="group" data-seg="${name}">
    <span class="seg-thumb"></span>
    ${options.map((o) => html`<button type="button" data-value="${o.value}" aria-pressed="${o.value === value}">${o.label}</button>`)}
  </div>`;
}

export function bindSegmented<T extends string>(root: HTMLElement, name: string, onChange: (v: T) => void) {
  const seg = root.querySelector<HTMLElement>(`[data-seg="${name}"]`);
  if (!seg) return;
  const thumb = seg.querySelector<HTMLElement>(".seg-thumb")!;
  const place = () => {
    const active = seg.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!active) return;
    thumb.style.left = `${active.offsetLeft}px`;
    thumb.style.width = `${active.offsetWidth}px`;
  };
  requestAnimationFrame(place);
  new ResizeObserver(place).observe(seg);
  seg.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-value]");
    if (!b || b.disabled) return;
    seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    place();
    onChange(b.dataset.value as T);
  });
}

export function setSegmented(root: HTMLElement, name: string, value: string) {
  const seg = root.querySelector<HTMLElement>(`[data-seg="${name}"]`);
  seg?.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.value === value)));
  seg?.dispatchEvent(new Event("resize"));
  const thumb = seg?.querySelector<HTMLElement>(".seg-thumb");
  const active = seg?.querySelector<HTMLElement>('[aria-pressed="true"]');
  if (thumb && active) { thumb.style.left = `${active.offsetLeft}px`; thumb.style.width = `${active.offsetWidth}px`; }
}

export function toggleSwitch(name: string, on: boolean, label: string): Raw {
  return html`<button type="button" class="toggle" role="switch" aria-checked="${on}" aria-label="${label}" data-toggle="${name}"></button>`;
}
