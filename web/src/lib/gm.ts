// Verbindung zum Spielleiter: POST-Anfrage, Antwort als gestreamte Server-Sent Events.
import type { GmEvent } from "../../../shared/campaign";

const CODE_KEY = "wus.access.v1";

export function accessCode(): string {
  try { return localStorage.getItem(CODE_KEY) ?? ""; } catch { return ""; }
}
export function setAccessCode(code: string) {
  try { localStorage.setItem(CODE_KEY, code); } catch { /* nur für diese Sitzung */ }
}

export async function streamGm(kind: "start" | "turn" | "roll", body: unknown, onEvent: (ev: GmEvent) => void): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api/campaign/${kind}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-access-code": accessCode() },
      body: JSON.stringify(body),
    });
  } catch {
    onEvent({ type: "error", message: "Keine Verbindung zum Server.", code: "api" });
    return;
  }
  if (!res.ok || !res.body) {
    onEvent({ type: "error", message: `Der Server antwortet nicht richtig (${res.status}).`, code: "api" });
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
      const ev = JSON.parse(line.slice(6)) as GmEvent;
      if (ev.type === "done" || ev.type === "error") finished = true;
      onEvent(ev);
    }
  }
  if (!finished) onEvent({ type: "error", message: "Die Verbindung brach mitten in der Erzählung ab. Bitte noch einmal versuchen.", code: "api" });
}
