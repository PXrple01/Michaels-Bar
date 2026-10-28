// Szenenbilder in der Erzählung: eingebettet mit Bildunterschrift, antippen zeigt das Bild groß.
import type { SceneImage } from "../../../shared/campaign";
import { $, fragment, html, type Raw } from "./dom";
import { icon } from "./icons";

export function sceneFigure(img: SceneImage): Raw {
  return html`<figure class="story-image">
    <button type="button" class="si-frame" data-zoom="${img.url}" data-caption="${img.caption}" aria-label="Bild groß ansehen">
      <img src="${img.url}" alt="${img.caption || "Bild zur Szene"}" loading="lazy" onerror="this.closest('figure').classList.add('broken')">
    </button>
    ${img.caption ? html`<figcaption>${icon("feather")} ${img.caption}</figcaption>` : ""}
  </figure>`;
}

/** Großansicht (einmal für die ganze Seite). */
document.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-zoom]");
  if (!b) return;
  const el = fragment(html`<div class="modal-backdrop lightbox" role="dialog" aria-modal="true" aria-label="Bild">
    <figure><img src="${b.dataset.zoom!}" alt="${b.dataset.caption ?? ""}">${b.dataset.caption ? html`<figcaption>${b.dataset.caption}</figcaption>` : ""}</figure>
    <button class="icon-btn lb-close" aria-label="Schließen">${icon("x")}</button>
  </div>`);
  const close = () => { el.remove(); removeEventListener("keydown", onKey); };
  const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") close(); };
  el.addEventListener("click", close);
  addEventListener("keydown", onKey);
  $("#modal-root").append(el);
});
