// Figuren und Wurf-Verlauf im Browser (localStorage; bei gesperrtem Speicher nur für diese Sitzung).
import type { RollRecord } from "../../../shared/dice";
import type { Character } from "../../../shared/schema";

const CHARS = "wus.characters.v1";
const ROLLS = "wus.rolls.v1";
const memory = new Map<string, string>();

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key) ?? memory.get(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    const raw = memory.get(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  }
}
function write(key: string, value: unknown) {
  const raw = JSON.stringify(value);
  memory.set(key, raw);
  try { localStorage.setItem(key, raw); } catch { /* nur im Arbeitsspeicher */ }
}

export const characterStore = {
  list(): Character[] {
    return read<Character[]>(CHARS, []).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  get(id: string): Character | null {
    return this.list().find((c) => c.id === id) ?? null;
  },
  save(c: Character) {
    write(CHARS, [...read<Character[]>(CHARS, []).filter((x) => x.id !== c.id), c]);
    dispatchEvent(new Event("wus:progress"));
  },
  remove(id: string) {
    write(CHARS, read<Character[]>(CHARS, []).filter((x) => x.id !== id));
  },
};

export const rollHistory = {
  list(): RollRecord[] { return read<RollRecord[]>(ROLLS, []); },
  add(r: RollRecord) { write(ROLLS, [r, ...this.list().filter((x) => x.id !== r.id)].slice(0, 25)); },
};
