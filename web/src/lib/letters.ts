// Brief am Kapitelende: Nach einem abgeschlossenen Kapitel schreibt die Figur einen kurzen Tagebucheintrag (Haiku).
// Aufgehobene Briefe stehen in der Chronik. Gespeichert im Browser (und im Konto synchronisiert) – je Abenteuer.
import type { WorldState } from "../../../shared/world";
import { $, fragment, html } from "./dom";
import { icon } from "./icons";

export interface Letter { chapter: number; title: string; who: string; text: string; at: string }
interface Box { letters: Letter[]; asked: number[] }

const KEY = "wus.letters.v1";
const memory = new Map<string, string>();

function readAll(): Record<string, Box> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? memory.get(KEY) ?? "{}"); } catch { return JSON.parse(memory.get(KEY) ?? "{}"); }
}
function writeAll(v: Record<string, Box>) {
  const raw = JSON.stringify(v);
  memory.set(KEY, raw);
  try { localStorage.setItem(KEY, raw); } catch { /* nur diese Sitzung */ }
  dispatchEvent(new Event("wus:progress"));
}
const box = (key: string): Box => readAll()[key] ?? { letters: [], asked: [] };
function put(key: string, b: Box) { writeAll({ ...readAll(), [key]: b }); }

export const letterStore = {
  list: (key: string) => box(key).letters.sort((a, b) => a.chapter - b.chapter),
  keep(key: string, l: Letter) { const b = box(key); put(key, { ...b, letters: [...b.letters.filter((x) => x.chapter !== l.chapter || x.who !== l.who), l] }); },
  /** Für dieses Kapitel schon gefragt? Merkt es sich gleich (so kommt jeder Brief nur einmal). */
  claim(key: string, chapter: number): boolean {
    const b = box(key);
    if (b.asked.includes(chapter)) return false;
    put(key, { ...b, asked: [...b.asked, chapter] });
    return true;
  },
  remove: (key: string) => { const all = readAll(); delete all[key]; writeAll(all); },
};

/** Kapitel, die mit diesem Zug abgeschlossen wurden (Index). */
export function newlyDone(before: WorldState | null | undefined, after: WorldState | null | undefined): number[] {
  if (!before) return [];
  // Nach Titel vergleichen: Abzweigungen schieben Kapitel nach hinten, der Index allein reicht nicht
  const doneBefore = new Set((before.arc?.chapters ?? []).filter((c) => c.done).map((c) => c.titel));
  return (after?.arc?.chapters ?? []).map((ch, i) => (ch.done && !doneBefore.has(ch.titel) ? i : -1)).filter((i) => i >= 0);
}

/** Pergament mit dem Brief: Aufheben (→ Chronik) oder Verwerfen. */
export function showLetter(l: Omit<Letter, "at">): Promise<boolean> {
  return new Promise((resolve) => {
    const [place, ...rest] = l.text.split("\n");
    const el = fragment(html`
      <div class="modal-backdrop letter-backdrop" role="dialog" aria-modal="true" aria-label="Brief von ${l.who}">
        <div class="letter-sheet">
          <div class="eyebrow">${icon("feather")} Kapitel abgeschlossen: ${l.title}</div>
          <p class="letter-place">${place}</p>
          ${rest.join("\n").trim().split(/\n\s*\n|\n/).filter(Boolean).map((p) => html`<p>${p}</p>`)}
          <div class="letter-actions">
            <button class="btn btn-ghost btn-sm" data-r="0">Verwerfen</button>
            <button class="btn btn-sm" data-r="1">${icon("book")} In der Chronik aufheben</button>
          </div>
        </div>
      </div>`);
    const close = (v: boolean) => { el.remove(); removeEventListener("keydown", onKey); resolve(v); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(false); };
    el.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-r]");
      if (b) close(b.dataset.r === "1");
    });
    addEventListener("keydown", onKey);
    $("#modal-root").append(el);
    el.querySelector<HTMLButtonElement>('[data-r="1"]')?.focus();
  });
}

/** Ablauf nach einem Zug: neue Kapitel erkennen, Brief holen, zeigen, ggf. aufheben. Fehler sind still (nur ein Extra). */
export async function offerLetters(key: string, who: string, before: WorldState | null | undefined, after: WorldState | null | undefined, fetchLetter: (chapter: number) => Promise<{ title: string; text: string } | null>) {
  for (const chapter of newlyDone(before, after)) {
    if (!letterStore.claim(key, chapter)) continue;
    const got = await fetchLetter(chapter).catch(() => null);
    if (!got?.text) continue;
    if (await showLetter({ chapter, title: got.title, who, text: got.text })) letterStore.keep(key, { chapter, title: got.title, who, text: got.text, at: new Date().toISOString() });
  }
}
