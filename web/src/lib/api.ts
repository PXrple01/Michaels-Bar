import type { CheckRequest, FreeRollRequest, RollRecord } from "../../../shared/dice";
import type { Campaign, Character, CharacterInput, ClassDef, Rules } from "../../../shared/schema";

export class ApiError extends Error {
  constructor(message: string, public problems: string[] = [], public status = 0) { super(message); }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Server nicht erreichbar. Läuft „npm run dev“?");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Fehler ${res.status}`, data.problems ?? [], res.status);
  return data as T;
}

export interface GameData { rules: Rules; campaign: Campaign; classes: ClassDef[] }

let gameData: Promise<GameData> | null = null;
export function loadGameData(): Promise<GameData> {
  gameData ??= request<GameData>("GET", "/api/rules").catch((e) => { gameData = null; throw e; });
  return gameData;
}

export const api = {
  characters: () => request<Character[]>("GET", "/api/characters"),
  character: (id: string) => request<Character>("GET", `/api/characters/${encodeURIComponent(id)}`),
  createCharacter: (c: CharacterInput) => request<Character>("POST", "/api/characters", c),
  patchCharacter: (id: string, patch: { hpCurrent?: number }) => request<Character>("PATCH", `/api/characters/${encodeURIComponent(id)}`, patch),
  deleteCharacter: (id: string) => request<void>("DELETE", `/api/characters/${encodeURIComponent(id)}`),
  roll: (r: FreeRollRequest) => request<RollRecord>("POST", "/api/rolls", r),
  check: (r: CheckRequest) => request<RollRecord>("POST", "/api/rolls/check", r),
  rolls: (limit = 30) => request<RollRecord[]>("GET", `/api/rolls?limit=${limit}`),
};
