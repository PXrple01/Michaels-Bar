import type { CheckRequest, FreeRollRequest, RollRecord } from "../../../shared/dice";
import type { Campaign, Character, CharacterInput, ClassDef, Rules } from "../../../shared/schema";
import { characterStore, rollHistory } from "./store";

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
    throw new ApiError("Server nicht erreichbar. Bitte Verbindung prüfen.");
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

const logged = (p: Promise<RollRecord>) => p.then((r) => { rollHistory.add(r); return r; });

export const api = {
  characters: async () => characterStore.list(),
  character: async (id: string) => {
    const c = characterStore.get(id);
    if (!c) throw new ApiError("Figur nicht gefunden (gespeichert wird nur in diesem Browser)", [], 404);
    return c;
  },
  createCharacter: async (input: CharacterInput) => {
    const c = await request<Character>("POST", "/api/characters", input);
    characterStore.save(c);
    return c;
  },
  deleteCharacter: async (id: string) => characterStore.remove(id),
  roll: (r: FreeRollRequest) => logged(request<RollRecord>("POST", "/api/rolls", r)),
  check: (r: Omit<CheckRequest, "character"> & { characterId: string }) => {
    const { characterId, ...rest } = r;
    return logged(request<RollRecord>("POST", "/api/rolls/check", { ...rest, character: characterStore.get(characterId) }));
  },
  rolls: async (limit = 25) => rollHistory.list().slice(0, limit),
};
