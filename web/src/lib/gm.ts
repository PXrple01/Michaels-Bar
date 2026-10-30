// Verbindung zum Spielleiter: POST-Anfrage, Antwort als gestreamte Server-Sent Events.
import { sessionToken } from "./account";
import type { GmEvent } from "../../../shared/campaign";

const CODE_KEY = "wus.access.v1";

export function accessCode(): string {
  try { return localStorage.getItem(CODE_KEY) ?? ""; } catch { return ""; }
}
export function setAccessCode(code: string) {
  try { localStorage.setItem(CODE_KEY, code); } catch { /* nur für diese Sitzung */ }
}

export function streamGm(kind: "start" | "turn" | "roll" | "upgrade" | "choose" | "level" | "shop" | "letter" | "import", body: unknown, onEvent: (ev: GmEvent) => void): Promise<void> {
  return streamSse(`/api/campaign/${kind}`, body, onEvent as (ev: { type: string }) => void);
}

/** So lange darf der Server schweigen (er schickt alle 15 s ein Lebenszeichen), dann gilt die Verbindung als tot. */
const SILENCE_MS = 45_000;

/** Allgemeiner SSE-Leser für POST-Anfragen (Spielleiter und Klassen-Gutachten). Endet immer – nie bleibt die Seite beim Warten hängen. */
export async function streamSse<E extends { type: string }>(url: string, body: unknown, onEvent: (ev: E) => void): Promise<void> {
  const emit = onEvent as (ev: { type: string; message?: string; code?: string }) => void;
  const abort = new AbortController();
  let silent = false;
  let watchdog = 0;
  const alive = () => { clearTimeout(watchdog); watchdog = window.setTimeout(() => { silent = true; abort.abort(); }, SILENCE_MS); };
  alive();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-access-code": accessCode(), "x-session": sessionToken() },
      body: JSON.stringify(body),
      signal: abort.signal,
    });
  } catch {
    clearTimeout(watchdog);
    emit({ type: "error", message: silent ? "Der Server antwortet nicht. Bitte erneut versuchen." : "Keine Verbindung zum Server.", code: "api" });
    return;
  }
  if (!res.ok || !res.body) {
    clearTimeout(watchdog);
    emit({ type: "error", message: `Der Server antwortet nicht richtig (${res.status}).`, code: "api" });
    return;
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let finished = false;
  for (;;) {
    let chunk: ReadableStreamReadResult<string>;
    try { chunk = await reader.read(); } catch { break; }
    const { value, done } = chunk;
    if (done) break;
    alive();
    buffer += value;
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const ev = JSON.parse(line.slice(6)) as E;
      if (ev.type === "done" || ev.type === "error" || ev.type === "review" || ev.type === "view" || ev.type === "upgrade" || ev.type === "letter" || ev.type === "imported") finished = true;
      onEvent(ev);
    }
  }
  clearTimeout(watchdog);
  if (!finished) emit({ type: "error", message: silent ? "Der Server antwortet nicht mehr. Bitte erneut versuchen." : "Die Verbindung brach ab. Bitte noch einmal versuchen.", code: "api" });
}
