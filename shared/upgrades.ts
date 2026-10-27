// Verbesserte Fähigkeiten: zwei Freischaltungen pro Kampagne (Mitte und Finale), je eine Fähigkeit, je 1 aus 2.
// Claude erfindet die Verbesserungen im Moment der Freischaltung – dieser Code entscheidet, ob sie erlaubt sind.
import { abilityCost, clampMechanics, forbiddenHits } from "./classbuilder";
import type { Ability, Mechanics, Rules } from "./schema";
import { ACTS, currentChapter, isArc, type WorldState } from "./world";

export type UpgradeTier = 1 | 2;

/** Erfahrung, ab der die Freischaltung im jeweiligen Akt kommt (Stufe 1: Mitte, Stufe 2: Finale). */
export const UPGRADE_XP: Record<UpgradeTier, number> = { 1: 200, 2: 550 };
/** Akt, in dem die Stufe frei wird. */
export const UPGRADE_ACT: Record<UpgradeTier, 1 | 2> = { 1: 1, 2: 2 };
/** Eine Verbesserung muss lohnen, darf die Fähigkeit aber nur begrenzt stärker machen (Punkte wie im Klassen-Editor). */
export const UPGRADE_POINTS = { min: 0.5, max: 3 } as const;

export interface AbilityUpgrade {
  /** Welche Fähigkeit verbessert wird (ID aus der Klasse). */
  abilityId: string;
  tier: UpgradeTier;
  /** Name der ursprünglichen Fähigkeit. */
  basedOn: string;
  name: string;
  text: string;
  beginnerText: string;
  uses: string;
  scope: "eng" | "breit";
  mechanics: Mechanics;
  /** Passt besonders zur Lage beim Freischalten. */
  situational: boolean;
  /** Zusätzliche Stärke in Punkten (nur zur Anzeige und Prüfung). */
  points: number;
}

export interface UpgradeOffer { tier: UpgradeTier; abilityId: string; options: AbilityUpgrade[] }

export interface Progression {
  /** Die zwei verbesserbaren Fähigkeiten – erst bei der ersten Freischaltung festgelegt (vorher geheim). */
  abilities: [string, string] | null;
  chosen: AbilityUpgrade[];
  offer: UpgradeOffer | null;
}

export const emptyProgression = (): Progression => ({ abilities: null, chosen: [], offer: null });

/** Fähigkeiten einer Figur nach ihren gewählten Verbesserungen. */
export function effectiveAbilities<A extends Pick<Ability, "id" | "name" | "type" | "uses" | "text" | "beginnerText">>(abilities: A[], prog: Progression | undefined): (A & { upgraded?: AbilityUpgrade })[] {
  return abilities.map((a) => {
    const up = prog?.chosen.find((u) => u.abilityId === a.id);
    return up ? { ...a, name: up.name, text: up.text, beginnerText: up.beginnerText, uses: up.uses, scope: up.scope, mechanics: up.mechanics, upgraded: up } : a;
  });
}

/** Welche Stufe ist für diese Figur jetzt fällig (und noch nicht angeboten oder gewählt)? */
export function upgradeDue(w: WorldState, characterId: string): UpgradeTier | null {
  const arc = w.arc;
  if (!isArc(arc) || !arc.plan || arc.finished) return null;
  const ch = currentChapter(arc);
  if (!ch) return null;
  const prog = w.progress?.[characterId];
  if (prog?.offer) return null;
  const tier = ((prog?.chosen.length ?? 0) + 1) as UpgradeTier;
  if (tier > 2 || ch.act < UPGRADE_ACT[tier]) return null;
  // Jede Fähigkeit wird höchstens einmal verbessert: Hat die Figur keine zweite Fähigkeit, gibt es keine zweite Freischaltung.
  if (tier === 2 && prog?.abilities && prog.abilities[1] === prog.abilities[0]) return null;
  // Spätestens im letzten Kapitel des Akts – auch wenn noch nicht genug Erfahrung gesammelt ist.
  const inAct = arc.chapters.filter((c) => c.act === ch.act);
  const lastOfAct = inAct.indexOf(ch) === inAct.length - 1;
  const lateAct = ch.act > UPGRADE_ACT[tier];
  return (w.xp[characterId] ?? 0) >= UPGRADE_XP[tier] || lastOfAct || lateAct ? tier : null;
}

/** Ein Vorschlag von Claude, bevor der Code ihn geprüft hat. */
export interface UpgradeDraft {
  name: string; text: string; beginnerText: string; uses: string; scope: string; situational: boolean;
  mechanics: Partial<Record<keyof Mechanics, unknown>>;
}

const toDice = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const toInt = (v: unknown) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);

/** Prüft eine vorgeschlagene Verbesserung hart gegen die Regeln: Grenzen kürzen, verbotene Effekte und zu viel Stärke ablehnen. */
export function checkUpgrade(original: Ability, draft: UpgradeDraft, tier: UpgradeTier, rules: Rules): { upgrade: AbilityUpgrade | null; errors: string[] } {
  const cb = rules.classBuilder;
  const errors: string[] = [];
  const name = String(draft.name ?? "").trim().slice(0, 60);
  const text = String(draft.text ?? "").trim().slice(0, 600);
  const beginnerText = String(draft.beginnerText ?? "").trim().slice(0, 300);
  if (!name || !text || !beginnerText) errors.push("Name, Regeltext und Einsteigertext sind Pflicht.");
  const uses = cb.abilityUses.includes(draft.uses) ? draft.uses : original.uses;
  const scope = draft.scope === "eng" ? "eng" : "breit";
  const raw = draft.mechanics ?? {};
  const mechanics = clampMechanics({
    name,
    mechanics: {
      extraDamage: toDice(raw.extraDamage), heal: toDice(raw.heal), bonusDie: toDice(raw.bonusDie),
      flatBonus: toInt(raw.flatBonus), advantage: raw.advantage === true, imposeDisadvantage: raw.imposeDisadvantage === true,
      armorBonus: toInt(raw.armorBonus), attackBonus: toInt(raw.attackBonus),
    },
  }, rules, []);
  if (uses === "beliebig" && (mechanics.extraDamage || mechanics.heal || mechanics.advantage || mechanics.imposeDisadvantage)) {
    errors.push("Schaden, Heilung oder Vorteil/Nachteil dürfen nicht beliebig oft einsetzbar sein.");
  }
  const hits = forbiddenHits(`${name} ${text} ${beginnerText}`, rules);
  if (hits.length) errors.push(`Spielbrechende Effekte sind nicht erlaubt (${hits.join(", ")}).`);
  const before = abilityCost(original, rules);
  const after = abilityCost({ ...original, uses, scope, mechanics }, rules);
  const points = Math.round((after - before) * 10) / 10;
  if (points > UPGRADE_POINTS.max) errors.push(`Zu stark: +${points} Punkte (erlaubt sind höchstens +${UPGRADE_POINTS.max}).`);
  if (points < UPGRADE_POINTS.min) errors.push(`Zu schwach: +${points} Punkte – eine Verbesserung muss sich lohnen (mindestens +${UPGRADE_POINTS.min}, z. B. ein Würfel, ein Bonus oder häufigerer Einsatz).`);
  if (errors.length) return { upgrade: null, errors };
  return {
    upgrade: { abilityId: original.id, tier, basedOn: original.name, name, text, beginnerText, uses, scope, mechanics, situational: draft.situational === true, points },
    errors: [],
  };
}

/** Ersatz, falls Claude keine gültige Verbesserung liefert: dieselbe Fähigkeit, Schritt für Schritt maßvoll stärker, bis sie sich lohnt. */
export function fallbackUpgrade(original: Ability, tier: UpgradeTier, rules: Rules): AbilityUpgrade {
  const order = ["einmal_pro_tag", "einmal_pro_rast", "einmal_pro_kampf"];
  const before = abilityCost(original, rules);
  let cur: Ability = { ...original, scope: original.scope ?? "breit", mechanics: clampMechanics(original, rules, []) };
  const notes: string[] = [];
  const steps: { apply: (a: Ability) => Ability | null; note: string }[] = [
    { apply: (a) => { const i = order.indexOf(a.uses); return i >= 0 && i < order.length - 1 ? { ...a, uses: order[i + 1] } : null; }, note: "Häufiger einsetzbar" },
    { apply: (a) => (a.scope === "eng" ? { ...a, scope: "breit" } : null), note: "Wirkt jetzt in viel mehr Lagen" },
    { apply: (a) => (a.mechanics!.bonusDie ? null : { ...a, mechanics: { ...a.mechanics!, bonusDie: "1W4" } }), note: "+1W4 auf den Wurf" },
    { apply: (a) => (a.mechanics!.flatBonus < rules.classBuilder.maxFlatDamageBonus ? { ...a, mechanics: { ...a.mechanics!, flatBonus: a.mechanics!.flatBonus + 1 } } : null), note: "+1 auf die Wirkung" },
  ];
  for (const step of steps) {
    const next = step.apply(cur);
    if (!next) continue;
    const d = abilityCost(next, rules) - before;
    if (d > UPGRADE_POINTS.max) continue;
    cur = next;
    notes.push(step.note);
    if (d >= UPGRADE_POINTS.min) break;
  }
  const more = `${notes.join(", ")}.`;
  return {
    abilityId: original.id, tier, basedOn: original.name, name: `${original.name} (gemeistert)`, text: `${original.text} Gemeistert: ${more}`, beginnerText: `${original.beginnerText} ${more}`,
    uses: cur.uses, scope: cur.scope ?? "breit", mechanics: cur.mechanics!, situational: false,
    points: Math.round((abilityCost(cur, rules) - before) * 10) / 10,
  };
}

/** Kurzfassung für Claude im <spielstand>. */
export function upgradesSummary(w: WorldState, characters: { id: string; name: string }[]): string {
  const parts = characters.flatMap((c) => (w.progress?.[c.id]?.chosen ?? []).map((u) => `${c.name}: „${u.name}“ (verbesserte Fassung von „${u.basedOn}“, ${u.uses}) – ${u.text}`));
  return parts.length ? `Verbesserte Fähigkeiten (gelten ab sofort): ${parts.join(" | ")}` : "";
}

export const actName = (tier: UpgradeTier) => ACTS[UPGRADE_ACT[tier]].name;
