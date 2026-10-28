// Eigene Klassen im Browser (vom Server signiert) und Hilfen, um sie mit den Grundklassen zusammenzuführen.
import type { SignedClass } from "../../../shared/classreview";
import type { Character, ClassDef } from "../../../shared/schema";
import type { GameData } from "./api";

const KEY = "wus.classes.v1";
let memory: SignedClass[] | null = null;

function read(): SignedClass[] {
  try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch { /* gesperrt */ }
  return memory ?? [];
}
function write(list: SignedClass[]) {
  memory = list;
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* nur diese Sitzung */ }
}

export const classStore = {
  list: read,
  get: (id: string) => read().find((s) => s.cls.id === id) ?? null,
  save(s: SignedClass, replaces?: string) { write([...read().filter((x) => x.cls.id !== s.cls.id && x.cls.id !== replaces), s]); dispatchEvent(new Event("wus:progress")); },
  remove(id: string) { write(read().filter((x) => x.cls.id !== id)); },
};

/** Grundklassen plus eigene Klassen dieses Browsers (ohne Doppelte). */
export function allClasses(data: GameData): ClassDef[] {
  const known = new Set(data.classes.map((c) => c.id));
  return [...data.classes, ...read().map((s) => s.cls).filter((c) => !known.has(c.id))];
}

/** Spieldaten inklusive der Klasse, die eine Figur mitbringt. */
export function dataFor(data: GameData, c: Pick<Character, "customClass">): GameData {
  const own = c.customClass?.cls;
  if (!own || data.classes.some((x) => x.id === own.id)) return data;
  return { ...data, classes: [...data.classes, own] };
}
