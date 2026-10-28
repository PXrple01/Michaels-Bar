// Mehrspieler im Browser: Mitgliedschaften merken, Server fragen, Zugangscode bei Bedarf abfragen.
import type { PartyEvent, PartyJoinResult, PartyView } from "../../../shared/party";
import { accessCode, setAccessCode, streamSse } from "./gm";
import { promptDialog } from "./ui";

export interface Membership { code: string; playerId: string; token: string; characterId: string; joinedAt: string }

const KEY = "wus.parties.v1";
const read = (): Membership[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; } };
const write = (l: Membership[]) => { try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* nur Sitzung */ } };

export const memberships = {
  list: read,
  get: (code: string) => read().find((m) => m.code === code.toUpperCase()) ?? null,
  save: (m: Membership) => write([m, ...read().filter((x) => x.code !== m.code)].slice(0, 20)),
  remove: (code: string) => write(read().filter((m) => m.code !== code)),
};

export class PartyApiError extends Error { constructor(message: string, public status: number) { super(message); } }

async function post<T>(op: string, body: unknown, retried = false): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/party/${op}`, { method: "POST", headers: { "content-type": "application/json", "x-access-code": accessCode() }, body: JSON.stringify(body) });
  } catch {
    throw new PartyApiError("Keine Verbindung zum Server.", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 403 && data.code === "access" && !retried) {
    const code = await promptDialog("Zugangscode", "Diese Seite ist geschützt. Bitte gib den Zugangscode ein.", { password: true, okLabel: "Weiter" });
    if (code) { setAccessCode(code); return post<T>(op, body, true); }
  }
  if (!res.ok) throw new PartyApiError(data.error ?? `Fehler ${res.status}`, res.status);
  return data as T;
}

export const partyApi = {
  create: (character: unknown) => post<PartyJoinResult>("create", { character }),
  join: (code: string, character: unknown) => post<PartyJoinResult>("join", { code, character }),
  state: (m: Membership) => post<PartyView>("state", { code: m.code, token: m.token }),
  leave: (m: Membership) => post<{ ok: true }>("leave", { code: m.code, token: m.token }),
  choose: (m: Membership, option: number) => post<PartyView>("choose", { code: m.code, token: m.token, option }),
  level: (m: Membership, choice: { skill?: string; attrs?: Record<string, number> }) => post<PartyView>("level", { code: m.code, token: m.token, ...choice }),
  stream: (op: "start" | "action" | "roll" | "upgrade", m: Membership, extra: Record<string, unknown>, onEvent: (ev: PartyEvent) => void) =>
    streamSse<PartyEvent>(`/api/party/${op}`, { code: m.code, token: m.token, ...extra }, onEvent),
};
