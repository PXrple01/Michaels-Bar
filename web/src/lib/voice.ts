// Vorlesen per Knopf: unter jedem Erzähl-Abschnitt ein ▶. Der Server liest mit der Erzählerstimme vor (fal.ai) und
// merkt sich die Datei – nochmal anhören kostet nichts.
import { stripMarkers } from "../../../shared/campaign";
import { looksFemale, segmentVoices, type CastMember } from "../../../shared/voices";
import type { WorldState } from "../../../shared/world";
import { sessionToken } from "./account";
import { html, type Raw } from "./dom";
import { accessCode } from "./gm";
import { icon } from "./icons";
import { toast } from "./ui";

let current: { audio: HTMLAudioElement; button: HTMLElement } | null = null;
let cast: CastMember[] = [];
/** Wer in der Geschichte vorkommt (Personen, Begleiter, Spielfiguren) – für die Figurenstimmen. */
export function setVoiceCast(w: WorldState | null | undefined, players: string[]) {
  cast = [
    ...(w?.people ?? []).map((p) => ({ name: p.name, female: looksFemale(p.role) })),
    ...(w?.companions ?? []).map((c) => ({ name: c.name, female: looksFemale(c.role) })),
    ...players.map((name) => ({ name })),
  ];
}
const cache = new Map<string, string>();
/** Laufende Anfragen (auch Vorbereitungen im Hintergrund) – ein Klick wartet darauf statt neu anzufragen. */
const pending = new Map<string, Promise<string | null>>();

/** Ton holen. prefetch: nur vorbereiten (der Server macht das nur in der Google-Testphase, sonst null). */
function requestAudio(text: string, prefetch = false): Promise<string | null> {
  const hit = cache.get(text);
  if (hit) return Promise.resolve(hit);
  const running = pending.get(text);
  if (running) return running.then((u) => u ?? (prefetch ? null : requestAudio(text)));
  const segments = segmentVoices(text, cast);
  const p = (async () => {
    const res = await fetch("/api/tts", { method: "POST", headers: { "content-type": "application/json", "x-access-code": accessCode(), "x-session": sessionToken() }, body: JSON.stringify({ ...(segments.length > 1 ? { text, segments } : { text }), ...(prefetch ? { prefetch: true } : {}) }) });
    const data = await res.json().catch(() => ({}));
    if (data.skipped) return null;
    if (!res.ok || !data.url) throw new Error(data.error ?? `Fehler ${res.status}`);
    cache.set(text, data.url as string);
    return data.url as string;
  })().finally(() => pending.delete(text));
  // Fehler beim Vorbereiten still schlucken – beim Klick wird dann normal angefragt
  pending.set(text, prefetch ? p.catch(() => null) : p);
  return pending.get(text)!;
}

/**
 * Nach einer Erzählung: die neuesten Abschnitte schon vorlesen lassen, damit ▶ sofort spielt.
 * Nur Abschnitte, die noch nicht vorbereitet wurden.
 */
export function prepareRead(root: ParentNode, newest = 2) {
  const blocks = [...root.querySelectorAll<HTMLElement>(".story-gm")].filter((b) => b.querySelector("[data-read]"));
  for (const b of blocks.slice(-newest)) {
    if (b.dataset.prepared) continue;
    b.dataset.prepared = "1";
    const text = textOf(b);
    if (text) void requestAudio(text, true);
  }
}

export const readButton = (): Raw => html`<button type="button" class="read-btn" data-read title="Vorlesen lassen">${icon("sound")}<span>Vorlesen</span></button>`;

function stop() {
  if (!current) return;
  current.audio.pause();
  current.button.classList.remove("playing", "loading");
  current.button.querySelector("span")!.textContent = "Vorlesen";
  current = null;
}

/** Text eines Abschnitts ohne Knöpfe und Vorschlagszeile. */
function textOf(block: HTMLElement): string {
  const copy = block.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("button, .quill").forEach((b) => b.remove());
  return stripMarkers(copy.innerText).trim();
}

/** Einmal für die ganze Seite: Klicks auf ▶ Vorlesen. */
document.addEventListener("click", async (e) => {
  const button = (e.target as HTMLElement).closest<HTMLElement>("[data-read]");
  if (!button) return;
  if (current?.button === button) return stop();
  stop();
  const block = button.closest<HTMLElement>(".story-gm, .ch-text");
  const text = block ? textOf(block) : "";
  if (!text) return;
  button.classList.add("loading");
  button.querySelector("span")!.textContent = "Lädt …";
  const audio = new Audio();
  current = { audio, button };
  try {
    const url = (await requestAudio(text))!;
    if (current?.audio !== audio) return; // inzwischen gestoppt
    audio.addEventListener("ended", () => { if (current?.audio === audio) stop(); });
    // Frisch gespeicherte Dateien sind manchmal erst nach einem Moment abrufbar: bis zu dreimal versuchen
    for (let i = 0; ; i++) {
      try { audio.src = `${url}${i ? `${url.includes("?") ? "&" : "?"}r=${i}` : ""}`; await audio.play(); break; }
      catch (e) { if (i >= 2 || current?.audio !== audio) throw e; await new Promise((r) => setTimeout(r, 1500)); }
    }
    button.classList.remove("loading");
    button.classList.add("playing");
    button.querySelector("span")!.textContent = "Stopp";
  } catch (err) {
    stop();
    // Fehler des Browsers beim Abspielen sind englisch – verständlich zusammenfassen
    toast(`Vorlesen: ${err instanceof DOMException ? "Der Ton konnte nicht abgespielt werden." : (err as Error).message}`, "error");
  }
});
