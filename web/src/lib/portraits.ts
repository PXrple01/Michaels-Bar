// Figurenporträts (fal.ai): gemalt auf dem Server, der Link wird im Konto gemerkt (wus.portraits.v1).
// Mitspieler-Figuren haben keinen Eintrag hier – deren Porträt wird unter seinem festen Namen versucht.
import type { Character } from "../../../shared/schema";
import { sessionToken } from "./account";
import { html, raw, type Raw } from "./dom";
import { accessCode } from "./gm";
import { sigil } from "./icons";

const KEY = "wus.portraits.v1";
const read = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; } };

let enabled: Promise<boolean> | null = null;
/** Sind Bilder auf dieser Seite eingerichtet (FAL_KEY)? */
export const imagesEnabled = () => (enabled ??= fetch("/api/config").then((r) => r.json()).then((c) => !!c.images).catch(() => false));

export const portraitOf = (characterId: string): string | null => read()[characterId] ?? null;

/**
 * Wappen mit Porträt darüber (falls vorhanden). `probe`: auch ohne gemerkten Link nachsehen (Figuren anderer Spieler).
 * Lädt das Bild nicht, bleibt einfach das Wappen sichtbar.
 */
export function avatar(characterId: string, sigilName: string, opts: { probe?: boolean; draw?: boolean } = {}): Raw {
  const url = portraitOf(characterId) ?? (opts.probe ? `/api/images/portrait-${characterId}` : null);
  return html`<span class="avatar">${sigil(sigilName, opts.draw ? "draw" : "")}${url ? raw(`<img class="avatar-img" src="${url}" alt="" loading="lazy" onload="this.parentElement.classList.add('has-img')" onerror="this.remove()">`) : ""}</span>`;
}

/** Porträt malen lassen (ca. 0,5 Cent). Gibt den neuen Link zurück. */
export async function paintPortrait(c: Character): Promise<string> {
  const res = await fetch("/api/portrait", { method: "POST", headers: { "content-type": "application/json", "x-access-code": accessCode(), "x-session": sessionToken() }, body: JSON.stringify({ character: c }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.url) throw new Error(data.error ?? `Fehler ${res.status}`);
  try { localStorage.setItem(KEY, JSON.stringify({ ...read(), [c.id]: data.url })); } catch { /* Speicher voll */ }
  return data.url;
}
