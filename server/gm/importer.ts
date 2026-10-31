// Spielstand einlesen: Mit gültiger Server-Signatur geht es unverändert weiter. Fremde oder selbst erstellte Spielstände
// übernimmt der Server mit Grenzen (Lebenspunkte, Gepäck, Geld, Erfahrung) und ersetzt den API-Verlauf durch eine
// Zusammenfassung der bisherigen Erzählung – Claude erzählt von dort aus weiter.
import type { StoryEntry } from "../../shared/campaign";
import { addItem, cleanStats, ensureInventory, kindOf, MAX_ITEMS, type InvItem } from "../../shared/inventory";
import type { Character } from "../../shared/schema";
import { GEAR_MAX } from "../../shared/shop";
import { initArc, initWorld, isArc, newWorldId, type WorldState } from "../../shared/world";
import { cleanChallenges, perkCount } from "../../shared/growth";
import type { GameData } from "../rules/loader";
import type { MessageParam } from "./narrator";
import { turnSummary } from "./summary";

const WORLD_MAX_CHARS = 400_000;
const clamp = (v: unknown, lo: number, hi: number, fallback: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback; };
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export class ImportError extends Error {}

/** Welt eines fremden Spielstands auf vernünftige Grenzen bringen. Wirft ImportError, wenn sie unbrauchbar ist. */
export function sanitizeWorld(raw: unknown, c: Character, data: GameData): WorldState {
  let w: WorldState;
  try {
    const json = JSON.stringify(raw ?? {});
    if (json.length > WORLD_MAX_CHARS) throw new ImportError("Der Spielstand ist zu groß.");
    w = JSON.parse(json) as WorldState;
  } catch (e) { throw e instanceof ImportError ? e : new ImportError("Die Spielwelt in der Datei ist beschädigt."); }
  if (!w || typeof w !== "object" || Array.isArray(w)) throw new ImportError("Die Spielwelt in der Datei ist beschädigt.");
  const base = initWorld([c]);
  // Stammt die Welt von einer anderen Figur (vorbereitetes Abenteuer, andere ID), gilt ihr einziger Eintrag für diese Figur
  const keys = [...new Set([...Object.keys(obj(w.hp)), ...Object.keys(obj(w.inventory)), ...Object.keys(obj(w.xp))])];
  const src = keys.includes(c.id) || keys.length !== 1 ? c.id : keys[0];
  const maxHp = clamp(obj(w.maxHp)[src], 1, 300, base.maxHp[c.id]);
  w.maxHp = { [c.id]: maxHp };
  w.hp = { [c.id]: clamp(obj(w.hp)[src], 0, maxHp, maxHp) };
  w.xp = { [c.id]: clamp(obj(w.xp)[src], 0, 1_000_000, 0) };
  w.critPending = {};
  w.quests = Array.isArray(w.quests) ? w.quests.filter((q) => q && typeof q.title === "string").slice(0, 30).map((q) => ({ id: str(q.id, 40) || `q${Math.random().toString(36).slice(2, 8)}`, title: q.title.slice(0, 120), description: str(q.description, 400), status: (["offen", "erledigt", "gescheitert"] as const).includes(q.status) ? q.status : "offen", notes: Array.isArray(q.notes) ? q.notes.filter((n) => typeof n === "string").slice(0, 10).map((n) => n.slice(0, 200)) : [] })) : [];
  w.memory = Array.isArray(w.memory) ? w.memory.filter((m) => typeof m === "string").slice(-40).map((m) => m.slice(0, 300)) : [];
  if (!isArc(w.arc)) w.arc = initArc();
  // Kampf nur mit sauberen Gegnern übernehmen
  const enemies = Array.isArray(w.combat?.enemies) ? w.combat!.enemies.filter((e) => e && typeof e.name === "string").slice(0, 6) : [];
  w.combat = enemies.length ? { round: clamp(w.combat!.round, 1, 99, 1), enemies: enemies.map((e, i) => { const mx = clamp(e.maxHp, 1, 80, 10); return { id: str(e.id, 40) || `e${i}`, name: e.name.slice(0, 40), maxHp: mx, hp: clamp(e.hp, 0, mx, mx), armor: clamp(e.armor, 8, 20, 12) }; }) } : null;
  // Gepäck: Werte begrenzt (wie bei Claude), höchstens 40 Dinge, höchstens 500 Gulden
  const inv = obj(obj(w.inventory)[src]);
  const items: InvItem[] = (Array.isArray(inv.items) ? inv.items : []).filter((i: unknown) => typeof obj(i).name === "string").slice(0, MAX_ITEMS).map((i: Record<string, unknown>) => {
    const stats = cleanStats(obj(i.stats));
    return { name: str(i.name, 60), qty: clamp(i.qty, 1, 99, 1), kind: kindOf(i.kind), ...(str(i.note, 120) ? { note: str(i.note, 120) } : {}), ...(stats ? { stats } : {}), ...(i.equipped === true ? { equipped: true } : {}) };
  });
  // Je Platz höchstens ein angelegtes Stück
  const worn = new Set<string>();
  for (const it of items) if (it.equipped) { if (worn.has(it.kind)) delete it.equipped; else worn.add(it.kind); }
  w.inventory = { [c.id]: { items, money: clamp(inv.money, 0, 240 * 500, 0) } };
  if (src !== c.id) {
    // Vorbereitetes Abenteuer: eigene Startausrüstung und -geld der Figur, die Dinge aus dem Abenteuer kommen dazu
    // (ein Stück mit Werten wird dabei statt der Startwaffe angelegt)
    const start = { ...w, inventory: {} } as WorldState;
    ensureInventory(start, [c], data.rules, data.classes);
    const mine = start.inventory![c.id];
    for (const it of items) { const { equipped: _, ...plain } = it; addItem(mine, plain); }
    mine.money = Math.min(240 * 500, mine.money + w.inventory[c.id].money);
    w.inventory = { [c.id]: mine };
  }
  const g = obj(obj(w.gear)[src]);
  const gear = { angriff: clamp(g.angriff, 0, GEAR_MAX, 0), schaden: clamp(g.schaden, 0, GEAR_MAX, 0), ruestung: clamp(g.ruestung, 0, GEAR_MAX, 0) };
  if (gear.angriff || gear.schaden || gear.ruestung) w.gear = { [c.id]: gear }; else delete w.gear;
  // Entwicklung: neue Abenteuer-Kennung, Einsätze und Narben nur für diese Figur (begrenzt), Ruhm-Boni aus der Figur selbst
  w.id = newWorldId();
  const used = obj(obj(w.abilityUses)[src]);
  w.abilityUses = { [c.id]: Object.fromEntries(Object.entries(used).slice(0, 20).map(([k, v]) => [String(k).slice(0, 60), clamp(v, 0, 999, 0)])) };
  const scar = (Array.isArray(obj(w.scars)[src]) ? (obj(w.scars)[src] as unknown[]) : []).map(obj).find((x) => typeof x.name === "string");
  w.scars = scar ? { [c.id]: [{ name: str(scar.name, 60), text: str(scar.text, 160) }] } : {};
  const erprobt = perkCount(c, "erprobt");
  const wucht = perkCount(c, "wucht"), eisen = perkCount(c, "eisenhaut");
  if (erprobt || wucht || eisen) w.fameBonus = { [c.id]: { angriff: erprobt, ...(wucht ? { schaden: wucht } : {}), ...(eisen ? { ruestung: eisen } : {}) } }; else delete w.fameBonus;
  if (!["aus", "angepasst", "hart"].includes(String(w.powerScaling))) delete w.powerScaling;
  const ch = cleanChallenges(w.challenges);
  if (ch.length) w.challenges = ch; else delete w.challenges;
  delete w.kills;
  // Offene Läden, Spiele, Abstimmungen und Protokolle gehören zur alten Sitzung
  w.shop = null; w.gamble = null; w.vote = null; delete w.itemLog; delete w.drank; delete w.sent; w.sinceImage = 0;
  try { turnSummary(structuredClone(w), [c], data.rules); } catch { throw new ImportError("Die Spielwelt in der Datei ist beschädigt."); }
  return w;
}

/** Ersatz für den API-Verlauf: die bisherige Erzählung als Zusammenfassung, dann die letzte Erzählung des Spielleiters. */
export function importedMessages(story: StoryEntry[]): MessageParam[] {
  const gm = story.filter((e): e is Extract<StoryEntry, { type: "gm" }> => e.type === "gm");
  if (!gm.length) throw new ImportError("In der Datei steht noch keine Erzählung des Spielleiters.");
  const recap = story.slice(0, -1).map((e) => (e.type === "gm" ? e.text : e.type === "player" ? `[Spieler] ${e.text}` : "")).filter(Boolean).join("\n\n").slice(-12_000);
  const last = gm[gm.length - 1].text;
  return [
    { role: "user", content: `<import>\nDieses Abenteuer wurde aus einer Spielstand-Datei übernommen. ${recap ? `Bisheriger Verlauf (ältere Teile gekürzt):\n${recap}` : "Es beginnt mit der folgenden Szene."}\n</import>\n\nSetze die Geschichte nahtlos fort. Halte dich an Figur, Welt und den <spielstand> der nächsten Züge.` },
    { role: "assistant", content: [{ type: "text", text: last }] },
  ];
}
