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

/* ── Limit Break ── */

/** Nach so vielen abgeschlossenen Abenteuern bricht das Limit: Vorteile über die Obergrenze, legendäre Fähigkeit, Meisterschaft III. */
export const LIMIT_AFTER = 3;
export const limitBroken = (g: { earned: string[] }) => g.earned.length >= LIMIT_AFTER;
/** Obergrenze eines Vorteils – nach dem Limit Break doppelt so hoch. */
export const perkMax = (p: PerkId, g: { earned: string[] }) => PERKS[p].max * (limitBroken(g) ? 2 : 1);

export const ABILITY_TYPES = ["angriff", "verteidigung", "heilung", "unterstuetzung", "kontrolle", "bewegung", "wissen", "sozial", "handwerk", "magie"] as const;
const legendSchema = z.object({
  name: z.string().min(2).max(50),
  type: z.enum(ABILITY_TYPES),
  uses: z.enum(["einmal_pro_kampf", "einmal_pro_rast", "einmal_pro_tag"]),
  text: z.string().min(10).max(400),
  beginnerText: z.string().min(5).max(200),
});
export type Legend = z.infer<typeof legendSchema>;
export { legendSchema };

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
/** Meisterschaft III (erst nach dem Limit Break): verstärkte Wirkung. */
export const MASTERY_BOOST = 50;
export const BOOST_TEXT = "Meisterschaft III: verstärkte Wirkung – ein zusätzlicher Würfel bzw. +2 auf den Effekt";
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
  perks: z.record(z.string(), z.number().int().min(0).max(10)).default({}) as unknown as z.ZodDefault<z.ZodType<Partial<Record<PerkId, number>>>>,
  scars: z.array(z.object({ campaign: z.string().max(80), name: z.string().max(60), text: z.string().max(160) })).max(SCARS_MAX).default([]),
  /** Erbstück-Truhe: 1 Platz, ab HEIRLOOM_TWO_AFTER abgeschlossenen Abenteuern 2. */
  heirlooms: z.array(heirloomSchema).max(2).default([]),
  /** Einsätze je Abenteuer und Fähigkeit (damit nichts doppelt zählt). */
  uses: z.record(z.string().max(80), z.record(z.string().max(60), z.number().int().min(0).max(999))).default({}),
  /** Die Limit-Break-Animation wurde gezeigt. */
  limitSeen: z.boolean().optional(),
  /** Legendäre Fähigkeit (nach dem Limit Break, aus der Geschichte der Figur). */
  legend: legendSchema.nullable().optional(),
}).refine((g) => g.heirlooms.length <= heirloomSlots(g), "Zu viele Erbstücke für die Truhe")
  .refine((g) => Object.keys(g.perks).every((p) => p in PERKS && (g.perks[p as PerkId] ?? 0) <= perkMax(p as PerkId, g)), "Unbekannter oder zu oft gewählter Vorteil")
  .refine((g) => !g.legend || limitBroken(g), "Eine legendäre Fähigkeit gibt es erst nach dem Limit Break");
export type Growth = z.infer<typeof growthSchema>;

type WithGrowth = { id: string; growth?: Growth | null };
export const growthOf = (c: WithGrowth | null | undefined): Growth => c?.growth ?? { fame: 0, earned: [], perks: {}, scars: [], heirlooms: [], uses: {} };
export const perkCount = (c: WithGrowth | null | undefined, p: PerkId) => growthOf(c).perks[p] ?? 0;

/** Vorteil einlösen (außerhalb eines Abenteuers). Fehlertext oder die neue Entwicklung. */
export function buyPerk(g: Growth, p: PerkId): Growth | string {
  const perk = PERKS[p];
  if (!perk) return "Diesen Vorteil gibt es nicht.";
  const have = g.perks[p] ?? 0;
  if (have >= perkMax(p, g)) return limitBroken(g) ? `„${perk.name}“ hast du schon so oft wie möglich.` : `„${perk.name}“ ist ausgereizt – nach dem Limit Break (${LIMIT_AFTER} bestandene Abenteuer) geht mehr.`;
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

export interface MasteryInfo {
  /** Erreichte Stufe (Schneller-Stufen plus ggf. Meisterschaft III) und höchste erreichbare. */
  level: number; max: number; uses: number;
  /** Einsätze bis zur nächsten Stufe (null = voll gemeistert) und Beginn der jetzigen Stufe (für die Leiste). */
  next: number | null; from: number;
  now: string; then: string | null;
  boost: boolean;
  /** Meisterschaft III wäre die nächste Stufe, ist aber noch gesperrt (vor dem Limit Break). */
  locked: boolean;
}

/** Häufigkeit nach Meisterschaft: jede Stufe eine Stufe schneller (Tag → Rast → Kampf). */
export function masteredUses(uses: string, level: number): string {
  let u = uses;
  for (let i = 0; i < level && FASTER[u]; i++) u = FASTER[u];
  return u;
}

/** Für die Anzeige: Fortschritt, nächste Stufe und was sie bringt. null = Fähigkeit kann nicht gemeistert werden. */
export function masteryInfo(baseUses: string, uses: number, limit = false): MasteryInfo | null {
  if (!FASTER[baseUses]) return null; // passiv oder beliebig oft
  // Erreichbare Schneller-Stufen: so viele Schritte, wie es schneller geht (höchstens zwei)
  let shifts = 0;
  for (let u = baseUses; FASTER[u] && shifts < MASTERY_STEPS.length; u = FASTER[u]) shifts++;
  const shift = Math.min(shifts, masteryLevel(uses));
  const now = masteredUses(baseUses, shift);
  const boost = limit && shift === shifts && uses >= MASTERY_BOOST;
  const nowText = (USES_TEXT[now] ?? now) + (boost ? ", verstärkte Wirkung" : "");
  if (shift < shifts) return { level: shift, max: shifts + (limit ? 1 : 0), uses, next: MASTERY_STEPS[shift], from: shift ? MASTERY_STEPS[shift - 1] : 0, now: nowText, then: USES_TEXT[FASTER[now]], boost: false, locked: false };
  if (limit && !boost) return { level: shift, max: shifts + 1, uses, next: MASTERY_BOOST, from: shift ? MASTERY_STEPS[shift - 1] : 0, now: nowText, then: "verstärkte Wirkung (Meisterschaft III)", boost: false, locked: false };
  return { level: shift + (boost ? 1 : 0), max: shifts + (limit ? 1 : 0), uses, next: null, from: 0, now: nowText, then: null, boost, locked: !limit };
}

/** Fähigkeiten mit Meisterschaft (Server und Anzeige rechnen gleich). */
export function applyMastery<A extends { id: string; uses: string; text: string }>(abilities: A[], c: WithGrowth, w: WorldState | null | undefined): (A & { mastery?: number })[] {
  const limit = limitBroken(growthOf(c));
  return abilities.map((a) => {
    const info = masteryInfo(a.uses, masteryUses(c, w, a.id), limit);
    if (!info?.level) return a;
    const shifted = info.level - (info.boost ? 1 : 0);
    return { ...a, uses: masteredUses(a.uses, shifted), mastery: info.level, ...(info.boost ? { text: `${a.text} [${BOOST_TEXT}]` } : {}) };
  });
}

/** Legendäre Fähigkeit als normale Fähigkeit (für Liste, Einsatz und Meisterschaft). */
export function legendAbility(c: WithGrowth) {
  const l = growthOf(c).legend;
  if (!l || !limitBroken(growthOf(c))) return null;
  return { id: "legende", name: l.name, type: l.type, uses: l.uses, text: l.text, beginnerText: l.beginnerText, legendary: true as const };
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

/* ── Erwachende Erbstücke ── */

const RARITY_ORDER = ["gewoehnlich", "ungewoehnlich", "selten", "sagenhaft"] as const;
/** Nach jedem Abenteuer, das ein Erbstück mitgemacht hat: +1 auf einen Wert (Waffe: Angriff/Schaden, Rüstung/Schild:
 * Rüstung), höchstens 3 je Wert. Die Seltenheit steigt mit der Stärke. Andere Gegenstände erwachen nicht. */
export function awakenHeirloom<H extends Growth["heirlooms"][number]>(h: H): H {
  if (!["waffe", "ruestung", "schild"].includes(h.kind)) return h;
  const s = { ...h.stats };
  const a = s.angriff ?? 0, d = s.schaden ?? 0, r = s.ruestung ?? 0;
  if (h.kind === "waffe") { if (a <= d && a < 3) s.angriff = a + 1; else if (d < 3) s.schaden = d + 1; else if (a < 3) s.angriff = a + 1; else return h; }
  else if (r < 3) s.ruestung = r + 1; else return h;
  const sum = (s.angriff ?? 0) + (s.schaden ?? 0) + (s.ruestung ?? 0);
  const earnedRarity = sum >= 4 ? "sagenhaft" : sum === 3 ? "selten" : sum === 2 ? "ungewoehnlich" : "gewoehnlich";
  const was = s.seltenheit ?? "gewoehnlich";
  s.seltenheit = RARITY_ORDER.indexOf(earnedRarity) > RARITY_ORDER.indexOf(was) ? earnedRarity : was;
  return { ...h, stats: s };
}

/* ── Machtstufe (Gegnerstärke passt sich an) ── */

export type PowerScaling = "aus" | "angepasst" | "hart";
/** Grobe Stärke einer Figur aus allem, was sie mitbringt (0 = frisch). */
export function powerScore(c: WithGrowth): number {
  const g = growthOf(c);
  const perks = Object.values(g.perks).reduce((n: number, v) => n + (v ?? 0), 0);
  const items = g.heirlooms.reduce((n, h) => n + (h.stats?.angriff ?? 0) + (h.stats?.schaden ?? 0) + (h.stats?.ruestung ?? 0), 0);
  return g.earned.length + perks + items + (g.legend ? 3 : 0) + (limitBroken(g) ? 3 : 0);
}
/** Für Claude: wie stark die Gegner sein sollen. Leer, wenn ausgeschaltet oder die Figuren frisch sind. */
export function powerHint(characters: (WithGrowth & { name: string })[], scaling: PowerScaling | undefined): string {
  if (!scaling || scaling === "aus") return "";
  const scores = characters.map((c) => ({ name: c.name, score: powerScore(c) }));
  const top = Math.max(0, ...scores.map((x) => x.score));
  if (!top && scaling !== "hart") return "";
  const tier = top >= 20 ? "legendär" : top >= 12 ? "sehr erfahren" : top >= 6 ? "erfahren" : "etwas erfahren";
  const push = scaling === "hart" ? "deutlich stärker als üblich (mehr Gegner, mehr Trefferpunkte und Rüstung, höhere Angriffsboni) – sie sollen ins Schwitzen kommen" : "passend stärker als üblich, damit Kämpfe spannend bleiben";
  return `Machtstufe: ${scores.map((x) => `${x.name} ${x.score}`).join(", ")} (${tier}). Gestalte Gegner ${push}.`;
}

/* ── Nach jedem Zug (im Browser): Stand aus dem Spielstand an die Figur übernehmen ── */

export function syncGrowth<C extends WithGrowth>(c: C, w: WorldState | null | undefined): C | null {
  if (!w?.id) return null;
  const g = growthOf(c);
  const uses = { ...g.uses };
  const mine = w.abilityUses?.[c.id];
  if (mine && Object.keys(mine).length) uses[w.id] = { ...mine };
  const scars = [...g.scars.filter((s) => s.campaign !== w.id), ...(w.scars?.[c.id] ?? []).map((s) => ({ ...s, campaign: w.id! }))].slice(-SCARS_MAX);
  let { fame, earned, heirlooms } = g;
  if (w.arc?.finished && !earned.includes(w.id)) {
    fame = Math.min(FAME_MAX, fame + FAME_FOR[w.arc.outcome === "niederlage" ? "niederlage" : "sieg"]);
    earned = [...earned, w.id].slice(-500);
    // Erbstücke, die dieses Abenteuer mitgemacht haben, erwachen ein Stück weiter
    heirlooms = heirlooms.map(awakenHeirloom);
  }
  const next: Growth = { ...g, uses, scars, fame, earned, heirlooms };
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
  if (limitBroken(g)) parts.push(`hat das Limit gebrochen – eine Legende`);
  if (g.legend && limitBroken(g)) parts.push(`legendäre Fähigkeit „${g.legend.name}“ (${g.legend.uses.replace(/_/g, " ")}): ${g.legend.text}`);
  return parts.join(". ");
}
