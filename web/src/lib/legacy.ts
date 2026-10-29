// Vermächtnis: Ehrentitel und Erbstücke, die Figuren am Ende siegreicher Kampagnen bekommen – gemerkt im Konto
// (wus.legacy.v1), damit sie auch nach dem Löschen eines Abenteuers in Heldenhalle und Figurenbogen bleiben.
import type { WorldState } from "../../../shared/world";

const KEY = "wus.legacy.v1";
export interface LegacyEntry { campaign: string; campaignTitle: string; title: string; heirloom: string; date: string }

const read = (): Record<string, LegacyEntry[]> => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; } };

export const legacyOf = (characterId: string): LegacyEntry[] => read()[characterId] ?? [];

/** Vermächtnis aus einem abgeschlossenen Abenteuer übernehmen (nur einmal je Kampagne und Figur). */
export function noteLegacy(w: WorldState | null | undefined, campaign: string, campaignTitle: string) {
  if (!w?.legacy?.length) return;
  const all = read();
  let changed = false;
  for (const l of w.legacy) {
    const list = all[l.characterId] ?? [];
    if (list.some((e) => e.campaign === campaign)) continue;
    all[l.characterId] = [...list, { campaign, campaignTitle, title: l.title, heirloom: l.heirloom, date: new Date().toISOString() }];
    changed = true;
  }
  if (changed) try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* Speicher voll */ }
}
