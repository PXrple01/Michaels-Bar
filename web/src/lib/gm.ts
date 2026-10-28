// Verbindung zum Spielleiter: POST-Anfrage, Antwort als gestreamte Server-Sent Events.
import type { GmEvent } from "../../../shared/campaign";

const CODE_KEY = "wus.access.v1";

export function accessCode(): string {
  try { return localStorage.getItem(CODE_KEY) ?? ""; } catch { return ""; }
}
export function setAccessCode(code: string) {
  try { localStorage.setItem(CODE_KEY, code); } catch { /* nur für diese Sitzung */ }
}

export function streamGm(kind: "start" | "turn" | "roll" | "upgrade" | "choose" | "level", body: unknown, onEvent: (ev: GmEvent) => void): Promise<void> {
  return streamSse(`/api/campaign/${kind}`, body, onEvent as (ev: { type: string }) => void);
}

/** Allgemeiner SSE-Leser für POST-Anfragen (Spielleiter und Klassen-Gutachten). */
export async function streamSse<E extends { type: string }>(url: string, body: unknown, onEvent: (ev: E) => void): Promise<void> {
  const emit = onEvent as (ev: { type: string; message?: string; code?: string }) => void;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-access-code": accessCode() },
      body: JSON.stringify(body),
    });
  } catch {
    emit({ type: "error", message: "Keine Verbindung zum Server.", code: "api" });
    return;
  }
  if (!res.ok || !res.body) {
    emit({ type: "error", message: `Der Server antwortet nicht richtig (${res.status}).`, code: "api" });
    return;
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let finished = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const ev = JSON.parse(line.slice(6)) as E;
      if (ev.type === "done" || ev.type === "error" || ev.type === "review" || ev.type === "view" || ev.type === "upgrade") finished = true;
      onEvent(ev);
    }
  }
  if (!finished) emit({ type: "error", message: "Die Verbindung brach ab. Bitte noch einmal versuchen.", code: "api" });
}
