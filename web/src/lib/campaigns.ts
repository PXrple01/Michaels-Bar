// Abenteuer im Browser speichern (wie die Figuren). Der Spielverlauf ist vom Server signiert.
import type { CampaignSave } from "../../../shared/campaign";

const KEY = "wus.campaigns.v1";
const OPENINGS = "wus.openings.v1";
const memory = new Map<string, string>();

function read<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key) ?? memory.get(key); return raw ? JSON.parse(raw) : fallback; }
  catch { const raw = memory.get(key); return raw ? JSON.parse(raw) : fallback; }
}
function write(key: string, value: unknown) {
  const raw = JSON.stringify(value);
  memory.set(key, raw);
  try { localStorage.setItem(key, raw); } catch { /* Speicher voll oder gesperrt: nur diese Sitzung */ }
}

export const campaignStore = {
  list(characterId?: string): CampaignSave[] {
    return read<CampaignSave[]>(KEY, []).filter((c) => !characterId || c.characterId === characterId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  get(id: string) { return this.list().find((c) => c.id === id) ?? null; },
  save(c: CampaignSave) {
    c.updatedAt = new Date().toISOString();
    write(KEY, [...read<CampaignSave[]>(KEY, []).filter((x) => x.id !== c.id), c]);
  },
  remove(id: string) { write(KEY, read<CampaignSave[]>(KEY, []).filter((x) => x.id !== id)); },
  /** Kurzfassungen aller bisherigen Einstiege (auch verworfener), damit sich nichts wiederholt. */
  previousOpenings(): string[] { return read<string[]>(OPENINGS, []); },
  rememberOpening(summary: string) { write(OPENINGS, [...this.previousOpenings().filter((s) => s !== summary), summary].slice(-20)); },
};
