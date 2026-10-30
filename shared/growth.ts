// Entwicklung über Kampagnen hinweg: Ruhm (gegen dauerhafte Vorteile eintauschen), Erbstück-Truhe (ein Gegenstand reist
// mit), Narben (Spuren schwerer Kämpfe) und Meisterschaft (oft genutzte Fähigkeiten werden häufiger einsetzbar).
// Gespeichert an der Figur. Der Server prüft alles mit Obergrenzen; die Signatur laufender Spielstände bleibt gültig,
// weil diese Werte nicht zum Fingerabdruck der Figur gehören.
import { z } from "zod";
import type { InvItem } from "./inventory";
import type { WorldState } from "./world";

/* ── Ruhm ── */

export const FAME_FOR = { sieg: 3, niederlage: 1 } as const;
export const FAME_MAX = 99;

export const PERKS = {
  zaeh: { name: "Zäh wie Leder", text: "+2 Trefferpunkte zu Beginn jedes Abenteuers", cost: 2, max: 3 },
  erspart: { name: "Erspartes", text: "+1 Gulden Startgeld", cost: 1, max: 5 },
  vorrat: { name: "Vorrat", text: "Ein Heiltrank mehr im Startgepäck", cost: 2, max: 1 },
  erprobt: { name: "Kampferprobt", text: "+1 auf alle Angriffswürfe", cost: 4, max: 1 },
} as const;
export type PerkId = keyof typeof PERKS;
export const PERK_IDS = Object.keys(PERKS) as PerkId[];

/* ── Narben ── */

export const SCARS_MAX = 3;

/* ── Erbstück-Truhe ── */

/** Ab so vielen abgeschlossenen Abenteuern („Wiedergeburten“) fasst die Truhe zwei Gegenstände. */
export const HEIRLOOM_TWO_AFTER = 3;
export const heirloomSlots = (g: { earned: string[] }) => (g.earned.length >= HEIRLOOM_TWO_AFTER ? 2 : 1);
export interface Scar { campaign: string; name: string; text: string }

/* ── Meisterschaft ── */

/** Einsätze bis zur nächsten Stufe (über alle Abenteuer gezählt). */
export const MASTERY_STEPS = [8, 20] as const;
const FASTER: Record<string, string> = { einmal_pro_tag: "einmal_pro_rast", einmal_pro_rast: "einmal_pro_kampf", einmal_pro_kampf: "zweimal_pro_kampf" };
const USES_TEXT: Record<string, string> = { zweimal_pro_kampf: "2× pro Kampf", einmal_pro_kampf: "1× pro Kampf", einmal_pro_rast: "1× pro Rast", einmal_pro_tag: "1× pro Tag" };

/* ── Speicherform an der Figur ── */

const heirloomSchema = z.object({
  name: z.string().min(1).max(60), qty: z.number().int().min(1).max(1), kind: z.enum(["waffe", "ruestung", "schild", "trank", "werkzeug", "schatz", "gegenstand"]),
  note: z.string().max(120).optional(),
  stats: z.object({ angriff: z.number().int().min(1).max(3).optional(), schaden: z.number().int().min(1).max(3).optional(), ruestung: z.number().int().min(1).max(3).optional(), heilung: z.string().max(12).optional(), seltenheit: z.enum(["gewoehnlich", "ungewoehnlich", "selten", "sagenhaft"]).optional() }).optional(),
});
export const growthSchema = z.object({
  fame: z.number().int().min(0).max(FAME_MAX).default(0),
  /** Abenteuer, für die schon Ruhm gutgeschrieben wurde. */
  earned: z.array(z.string().max(80)).max(500).default([]),
  perks: z.record(z.string(), z.number().int().min(0).max(5)).default({}) as unknown as z.ZodDefault<z.ZodType<Partial<Record<PerkId, number>>>>,
  scars: z.array(z.object({ campaign: z.string().max(80), name: z.string().max(60), text: z.string().max(160) })).max(SCARS_MAX).default([]),
  /** Erbstück-Truhe: 1 Platz, ab HEIRLOOM_TWO_AFTER abgeschlossenen Abenteuern 2. */
  heirlooms: z.array(heirloomSchema).max(2).default([]),
  /** Einsätze je Abenteuer und Fähigkeit (damit nichts doppelt zählt). */
  uses: z.record(z.string().max(80), z.record(z.string().max(60), z.number().int().min(0).max(999))).default({}),
}).refine((g) => g.heirlooms.length <= heirloomSlots(g), "Zu viele Erbstücke für die Truhe").refine((g) => Object.keys(g.perks).every((p) => p in PERKS && (g.perks[p as PerkId] ?? 0) <= PERKS[p as PerkId].max), "Unbekannter oder zu oft gewählter Vorteil");
export type Growth = z.infer<typeof growthSchema>;

type WithGrowth = { id: string; growth?: Growth | null };
export const growthOf = (c: WithGrowth | null | undefined): Growth => c?.growth ?? { fame: 0, earned: [], perks: {}, scars: [], heirlooms: [], uses: {} };
export const perkCount = (c: WithGrowth | null | undefined, p: PerkId) => growthOf(c).perks[p] ?? 0;

/** Vorteil einlösen (außerhalb eines Abenteuers). Fehlertext oder die neue Entwicklung. */
export function buyPerk(g: Growth, p: PerkId): Growth | string {
  const perk = PERKS[p];
  if (!perk) return "Diesen Vorteil gibt es nicht.";
  const have = g.perks[p] ?? 0;
  if (have >= perk.max) return `„${perk.name}“ hast du schon so oft wie möglich.`;
  if (g.fame < perk.cost) return `Dafür fehlt Ruhm (${g.fame} von ${perk.cost}).`;
  return { ...g, fame: g.fame - perk.cost, perks: { ...g.perks, [p]: have + 1 } };
}

/* ── Meisterschaft ── */

/** Alle Einsätze einer Fähigkeit: frühere Abenteuer (an der Figur) plus dieses (im Spielstand). */
export function masteryUses(c: WithGrowth, w: WorldState | null | undefined, abilityId: string): number {
  const g = growthOf(c);
  const before = Object.entries(g.uses).filter(([k]) => k !== w?.id).reduce((n, [, m]) => n + (m[abilityId] ?? 0), 0);
  return before + (w?.abilityUses?.[c.id]?.[abilityId] ?? 0);
}
export const masteryLevel = (uses: number) => MASTERY_STEPS.filter((s) => uses >= s).length;

/** Häufigkeit nach Meisterschaft: jede Stufe eine Stufe schneller (Tag → Rast → Kampf). */
export function masteredUses(uses: string, level: number): string {
  let u = uses;
  for (let i = 0; i < level && FASTER[u]; i++) u = FASTER[u];
  return u;
}

/** Für die Anzeige: Fortschritt, nächste Stufe und was sie bringt. null = Fähigkeit kann nicht gemeistert werden. */
export function masteryInfo(baseUses: string, uses: number): { level: number; max: number; uses: number; next: number | null; from: number; now: string; then: string | null } | null {
  if (!FASTER[baseUses]) return null; // passiv oder beliebig oft
  // Erreichbare Stufen: so viele Schritte, wie es schneller geht (höchstens zwei)
  let max = 0;
  for (let u = baseUses; FASTER[u] && max < MASTERY_STEPS.length; u = FASTER[u]) max++;
  const level = Math.min(max, masteryLevel(uses));
  const now = masteredUses(baseUses, level);
  const canImprove = !!FASTER[now] && level < MASTERY_STEPS.length;
  return { level, max, uses, next: canImprove ? MASTERY_STEPS[level] : null, from: level ? MASTERY_STEPS[level - 1] : 0, now: USES_TEXT[now] ?? now, then: canImprove ? USES_TEXT[FASTER[now]] : null };
}

/** Fähigkeiten mit Meisterschaft (Server und Anzeige rechnen gleich). */
export function applyMastery<A extends { id: string; uses: string }>(abilities: A[], c: WithGrowth, w: WorldState | null | undefined): (A & { mastery?: number })[] {
  return abilities.map((a) => {
    const level = masteryInfo(a.uses, masteryUses(c, w, a.id))?.level ?? 0;
    return level ? { ...a, uses: masteredUses(a.uses, level), mastery: level } : a;
  });
}

/* ── Zu Beginn eines Abenteuers ── */

/** Startwerte aus Ruhm-Vorteilen für eine neue Welt. */
export const startHpBonus = (c: WithGrowth) => perkCount(c, "zaeh") * 2;
export const startMoneyBonus = (c: WithGrowth) => perkCount(c, "erspart") * 240;

/** Erbstücke aus der Truhe als Gegenstände fürs Startgepäck. */
export function heirloomItems(c: WithGrowth): InvItem[] {
  return growthOf(c).heirlooms.slice(0, heirloomSlots(growthOf(c))).map((h) => ({ ...h, qty: 1, note: h.note ?? "Erbstück – reist von Abenteuer zu Abenteuer mit" }));
}

/** Gegenstand in die Truhe legen oder wieder herausnehmen. Ist sie voll, ersetzt er das älteste Stück. */
export function toggleHeirloom(g: Growth, item: Growth["heirlooms"][number]): Growth {
  const has = g.heirlooms.some((h) => h.name === item.name);
  const list = has ? g.heirlooms.filter((h) => h.name !== item.name) : [...g.heirlooms, { ...item, qty: 1 }].slice(-heirloomSlots(g));
  return { ...g, heirlooms: list };
}

/* ── Nach jedem Zug (im Browser): Stand aus dem Spielstand an die Figur übernehmen ── */

export function syncGrowth<C extends WithGrowth>(c: C, w: WorldState | null | undefined): C | null {
  if (!w?.id) return null;
  const g = growthOf(c);
  const uses = { ...g.uses };
  const mine = w.abilityUses?.[c.id];
  if (mine && Object.keys(mine).length) uses[w.id] = { ...mine };
  const scars = [...g.scars.filter((s) => s.campaign !== w.id), ...(w.scars?.[c.id] ?? []).map((s) => ({ ...s, campaign: w.id! }))].slice(-SCARS_MAX);
  let { fame, earned } = g;
  if (w.arc?.finished && !earned.includes(w.id)) {
    fame = Math.min(FAME_MAX, fame + FAME_FOR[w.arc.outcome === "niederlage" ? "niederlage" : "sieg"]);
    earned = [...earned, w.id].slice(-500);
  }
  const next: Growth = { ...g, uses, scars, fame, earned };
  if (JSON.stringify(next) === JSON.stringify(g)) return null;
  return { ...c, growth: next };
}

/* ── Für Claude ── */

export function growthSummary(c: WithGrowth & { name: string }): string {
  const g = growthOf(c);
  const parts: string[] = [];
  if (g.scars.length) parts.push(`Narben aus früheren Abenteuern: ${g.scars.map((s) => `${s.name} (${s.text})`).join("; ")} – greif sie gelegentlich erzählerisch auf`);
  if (g.heirlooms.length) parts.push(`${g.heirlooms.length > 1 ? "Erbstücke" : "Erbstück"}, das ${c.name} immer bei sich trägt: ${g.heirlooms.map((h) => h.name).join(", ")}`);
  if (g.earned.length) parts.push(`hat schon ${g.earned.length} ${g.earned.length === 1 ? "Abenteuer" : "Abenteuer"} bestanden`);
  return parts.join(". ");
}
