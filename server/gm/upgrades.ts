// Claude erfindet verbesserte Fähigkeiten im Moment der Freischaltung – passend zur Figur und teils zur Lage.
// Ob eine Verbesserung erlaubt ist, entscheidet danach allein shared/upgrades.ts (Punkte, Grenzen, verbotene Effekte).
import { withLegends } from "../../shared/growth";
import type Anthropic from "@anthropic-ai/sdk";
import { abilityCost } from "../../shared/classbuilder";
import type { Ability, Character } from "../../shared/schema";
import { checkUpgrade, effectiveAbilities, emptyProgression, fallbackUpgrade, UPGRADE_POINTS, type AbilityUpgrade, type UpgradeDraft, type UpgradeOffer, type UpgradeTier } from "../../shared/upgrades";
import { ACTS, currentChapter, isArc, type WorldState } from "../../shared/world";
import type { GameData } from "../rules/loader";
import { CACHE_1H, requestBase, type LlmClient, type MessageParam, type ModelId } from "./narrator";
import { characterSheetText } from "./prompt";
import { costUsd, type UsageGuard } from "./usage";

const obj = (properties: Record<string, object>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

/** Bewusst kleines Antwortformat – große Auswahllisten machen die Grammatik der API zu groß. */
function schema(rules: GameData["rules"]) {
  const cb = rules.classBuilder;
  const dice = { type: "string", description: "Würfelausdruck wie 1W6 oder 1W4+1, leer wenn keiner" };
  const option = obj({
    name: { type: "string" },
    text: { type: "string", description: "Genauer Regeltext der verbesserten Fähigkeit (die alte Wirkung bleibt erhalten)" },
    beginnerText: { type: "string", description: "Ein Satz für Einsteiger" },
    uses: { type: "string", enum: cb.abilityUses },
    scope: { type: "string", enum: ["eng", "breit"] },
    passtZurLage: { type: "boolean" },
    extraDamage: dice, heal: dice, bonusDie: dice,
    flatBonus: { type: "integer" }, advantage: { type: "boolean" }, imposeDisadvantage: { type: "boolean" },
    armorBonus: { type: "integer" }, attackBonus: { type: "integer" },
  });
  return obj({
    auswahl: obj({ erste: { type: "string", description: "ID der Fähigkeit, die jetzt verbessert wird" }, zweite: { type: "string", description: "ID der Fähigkeit für die spätere Verbesserung" } }),
    optionen: { type: "array", items: option, description: "Genau zwei Verbesserungen derselben Fähigkeit" },
    empfehlung: { type: "string", enum: ["geplant", "bereits_verbessert"], description: "Nur im Finale: Welche Fähigkeit sollte sich jetzt entwickeln?" },
    optionenZweiteStufe: { type: "array", items: option, description: "Nur bei empfehlung = bereits_verbessert: zwei Verbesserungen für die schon verbesserte Fähigkeit, sonst leer" },
  });
}

function systemText(data: GameData): string {
  const cb = data.rules.classBuilder;
  return `Du entwirfst verbesserte Fähigkeiten für ein mittelalterliches Erzähl-Rollenspiel (W20-System, deutsch). Eine Figur hat genug Erfahrung gesammelt – eine ihrer Fähigkeiten entwickelt sich weiter.

## Was eine Verbesserung ist
- Die verbesserte Fähigkeit behält ihren Kern und ihre bisherige Wirkung und bekommt etwas dazu. Beispiel: „Giftresistenz“ → „Giftblut“: weiterhin widerstandsfähig gegen Gift, und wer die Figur im Nahkampf trifft, erleidet 1W4 Giftschaden (einmal pro Kampf).
- Sie muss sich lohnen, darf aber nicht übermächtig sein: Nach der Kostentabelle unten wird sie zwischen +${UPGRADE_POINTS.min} und +${UPGRADE_POINTS.max} Punkte stärker als vorher. Das prüft ein Programm – zu starke oder zu schwache Vorschläge werden abgelehnt.
- Beschreibe jede Wirkung messbar in den Feldern (extraDamage, heal, bonusDie, flatBonus, advantage, imposeDisadvantage, armorBonus, attackBonus). Felder der alten Fähigkeit, die erhalten bleiben, trägst du wieder ein.

## Zwei Optionen, gleich stark
- Liefere genau zwei Verbesserungen derselben Fähigkeit mit ähnlicher Punktzahl.
- Eine Option darf zur aktuellen Lage passen (passtZurLage = true), wenn die Lage einen sinnvollen Anlass bietet – z. B. liegt im Kampf ein Gefährte am Boden, kann eine Heilfähigkeit lernen, Gefallene wieder auf die Beine zu bringen. Bietet die Lage nichts Passendes, passen beide Optionen einfach zur Fähigkeit.
- Beide Optionen müssen auch später immer nützlich sein – keine Fähigkeit, die nur in genau dieser einen Szene wirkt.
- Wird die Verbesserung mitten im Kampf freigeschaltet, darf sie den Kampf nicht kippen: keine sofortige volle Heilung der ganzen Gruppe, kein sofortiger Sieg, nichts Stärkeres als der Rahmen erlaubt.

## Regeln
- Kostentabelle (JSON): ${JSON.stringify(cb.costs)}. Fähigkeitskosten = (Durchschnitt Zusatzschaden × ${cb.costs.extraDamagePerAverage} + Durchschnitt Heilung × ${cb.costs.healPerAverage} + Durchschnitt Bonuswürfel × ${cb.costs.bonusDiePerAverage} + fester Bonus × ${cb.costs.flatBonus} + Vorteil ${cb.costs.advantage} + Nachteil für Gegner ${cb.costs.imposeDisadvantage} + Rüstungsbonus × ${cb.costs.armorBonus} + Angriffsbonus × ${cb.costs.attackBonus}; ohne Zahlenwirkung ${cb.costs.abilityBase}) × Häufigkeit × Reichweite.
- Grenzen: Schadens- und Heilwürfel höchstens ${cb.maxDamageDiceCount}W${cb.maxDamageDie}, fester Bonus höchstens +${cb.maxFlatDamageBonus}, Rüstungsbonus ${cb.armorBonus.min}–${cb.armorBonus.max}, Angriffsbonus ${cb.attackBonus.min}–${cb.attackBonus.max}.
- Schaden, Heilung, Vorteil oder Nachteil sind höchstens einmal pro Kampf einsetzbar, nie „beliebig“.
- Verboten: unbegrenzte Wirkung, Unverwundbarkeit, Unsterblichkeit, Sofort-Sieg, Wiederbelebung von Toten, Regeln ändern. (Bewusstlose Gefährten auf die Beine zu bringen ist erlaubt – sie sind nicht tot.)
- Magie in dieser Welt: „${data.campaign.magic_level}“ – passe den Ton daran an.
- Schreibe für Einsteiger, ohne Fachjargon. Namen klingen mittelalterlich.`;
}

type Answer = { auswahl?: { erste?: string; zweite?: string }; optionen?: Record<string, unknown>[]; empfehlung?: string; optionenZweiteStufe?: Record<string, unknown>[] };

export interface ForgeResult { abilities: [string, string]; offer: UpgradeOffer; costUsd: number }

export class UpgradeForge {
  constructor(private o: { llm: LlmClient | null; guard: UsageGuard; model?: ModelId; effort?: "low" | "medium" | "high" }) {}

  private get model(): ModelId { return this.o.model ?? "claude-opus-5-5"; }

  /** Lage beim Freischalten in Worten – damit eine Option zur Situation passen kann. */
  private situation(world: WorldState, characters: Character[], recent: string): string {
    const lines: string[] = [];
    const arc = world.arc;
    const ch = isArc(arc) ? currentChapter(arc) : null;
    if (ch) lines.push(`Kampagne: Akt „${ACTS[ch.act].name}“, Kapitel „${ch.titel}“ (${ch.ziel}).`);
    lines.push(`Lebenspunkte: ${characters.map((c) => `${c.name} ${world.hp[c.id] ?? 0}/${world.maxHp[c.id] ?? 0}${(world.hp[c.id] ?? 0) <= 0 ? " – am Boden, bewusstlos" : ""}`).join(", ")}.`);
    lines.push(world.combat ? `Gerade läuft ein Kampf (Runde ${world.combat.round}) gegen ${world.combat.enemies.filter((e) => e.hp > 0).map((e) => `${e.name} (${e.hp}/${e.maxHp} TP)`).join(", ") || "letzte Gegner"}.` : "Gerade läuft kein Kampf.");
    if (recent) lines.push(`Letzte Szene:\n${recent.slice(-1500)}`);
    return lines.join("\n");
  }

  async generate(args: { data: GameData; character: Character; characters: Character[]; world: WorldState; tier: UpgradeTier; recent: string; who: string }): Promise<ForgeResult> {
    if (!this.o.llm) throw new Error("Kein API-Schlüssel hinterlegt (ANTHROPIC_API_KEY).");
    const { data, character, world, tier } = args;
    const cls = data.classes.find((x) => x.id === character.classId)!;
    const prog = world.progress?.[character.id] ?? emptyProgression();
    // Auch legendäre Fähigkeiten (nach dem Limit Break) können verbessert werden
    const abilities = withLegends(cls.abilities, character) as Ability[];
    const byId = new Map(abilities.map((a) => [a.id, a]));
    const fixedTarget = tier === 2 && prog.abilities ? prog.abilities[1] : null;
    const effective = effectiveAbilities(abilities, prog);
    const list = effective.map((a) => `- ${a.id}: „${a.name}“ (${a.type}, ${a.uses}, Reichweite ${a.scope ?? "breit"}, ${abilityCost(a as Ability, data.rules)} Punkte) – ${a.text} | Mechanik: ${JSON.stringify(a.mechanics ?? {})}${a.upgraded ? " [bereits verbessert]" : ""}`).join("\n");
    const task = tier === 1
      ? "Wähle zuerst die zwei Fähigkeiten dieser Figur, die sich am besten weiterentwickeln lassen und am meisten Spaß machen (auswahl.erste wird jetzt verbessert, auswahl.zweite später im Finale). Liefere dann zwei Verbesserungen für auswahl.erste."
      : `Geplant ist, jetzt die Fähigkeit „${fixedTarget}“ zu verbessern (trage sie in auswahl.erste ein, auswahl.zweite darf gleich sein). Liefere in „optionen“ zwei Verbesserungen für sie; keine davon darf die bereits verbesserte Fähigkeit zusätzlich stärken.
Passt es zur Figur und zur Geschichte deutlich besser, dass sich stattdessen die bereits verbesserte Fähigkeit ein zweites Mal weiterentwickelt, setze empfehlung = "bereits_verbessert" und liefere in „optionenZweiteStufe“ zwei Verbesserungen für sie – gemessen an ihrem jetzigen, schon verbesserten Stand und im selben Punkte-Rahmen. Der Spieler entscheidet dann selbst. Sonst setze empfehlung = "geplant" und lass „optionenZweiteStufe“ leer.`;
    const user = `<figur>\n${characterSheetText(character, data)}\n</figur>\n\n<faehigkeiten>\n${list}\n</faehigkeiten>\n\n<lage>\n${this.situation(world, args.characters, args.recent)}\n</lage>\n\nFreischaltung ${tier} von 2 (${tier === 1 ? "Mitte" : "Finale"} der Kampagne). ${task}`;

    let cost = 0;
    const ask = async (messages: MessageParam[]) => {
      await this.o.guard.check(args.who);
      const msg = await this.o.llm!.stream({
        ...requestBase(this.model, this.o.effort ?? "low"),
        output_config: { effort: this.o.effort ?? "low", format: { type: "json_schema", schema: schema(data.rules) } },
        max_tokens: 8000,
        system: [{ type: "text", text: systemText(data), cache_control: CACHE_1H }],
        messages,
      }, () => {});
      await this.o.guard.record(msg.usage, this.model);
      cost += costUsd(msg.usage, this.model);
      if (msg.stop_reason === "refusal") return null;
      const text = msg.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("");
      try { return { raw: JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as Answer, text }; } catch { return null; }
    };

    // Welche Fähigkeit? Stufe 1: Claudes Wahl (gültig und verschieden), Stufe 2: die bei Stufe 1 festgelegte zweite
    const pickPair = (raw: { auswahl?: { erste?: string; zweite?: string } } | null): [string, string] => {
      if (prog.abilities) return prog.abilities;
      const first = byId.has(raw?.auswahl?.erste ?? "") ? raw!.auswahl!.erste! : abilities[0].id;
      const second = byId.has(raw?.auswahl?.zweite ?? "") && raw!.auswahl!.zweite !== first ? raw!.auswahl!.zweite! : abilities.find((a) => a.id !== first && a.uses !== "passiv")?.id ?? abilities.find((a) => a.id !== first)?.id ?? first;
      return [first, second];
    };
    const validate = (list: Record<string, unknown>[] | undefined, target: Ability, secondStage = false) => {
      const ok: AbilityUpgrade[] = [];
      const errors: string[] = [];
      for (const [i, o] of (list ?? []).slice(0, 2).entries()) {
        const draft: UpgradeDraft = {
          name: String(o.name ?? ""), text: String(o.text ?? ""), beginnerText: String(o.beginnerText ?? ""), uses: String(o.uses ?? ""), scope: String(o.scope ?? ""), situational: o.passtZurLage === true,
          mechanics: { extraDamage: o.extraDamage, heal: o.heal, bonusDie: o.bonusDie, flatBonus: o.flatBonus, advantage: o.advantage, imposeDisadvantage: o.imposeDisadvantage, armorBonus: o.armorBonus, attackBonus: o.attackBonus },
        };
        const r = checkUpgrade(target, draft, tier, data.rules);
        if (r.upgrade) ok.push(secondStage ? { ...r.upgrade, secondStage: true } : r.upgrade); else errors.push(`${secondStage ? "Zweite Stufe, " : ""}Option ${i + 1} („${draft.name}“): ${r.errors.join(" ")}`);
      }
      return { ok, errors };
    };

    const first = await ask([{ role: "user", content: user }]);
    const pair = pickPair(first?.raw ?? null);
    const target = byId.get(tier === 1 ? pair[0] : pair[1])!;
    let { ok, errors } = validate(first?.raw?.optionen, target);

    // Finale: Empfiehlt Claude die schon verbesserte Fähigkeit, bekommt der Spieler beide Wege zur Wahl
    const upgradedBase = tier === 2 ? effective.find((a) => a.id === pair[0] && a.upgraded) : undefined;
    const wantsStage2 = !!upgradedBase && pair[0] !== pair[1] && first?.raw?.empfehlung === "bereits_verbessert";
    let stage2: AbilityUpgrade[] = [];
    if (wantsStage2) {
      const r = validate(first!.raw!.optionenZweiteStufe, upgradedBase as Ability, true);
      stage2 = r.ok;
      errors = [...errors, ...r.errors];
    }

    const range = (a: Ability) => `${Math.round((abilityCost(a, data.rules) + UPGRADE_POINTS.min) * 10) / 10} und ${Math.round((abilityCost(a, data.rules) + UPGRADE_POINTS.max) * 10) / 10}`;
    if ((ok.length < 2 || (wantsStage2 && stage2.length < 2)) && first) {
      // Ein zweiter Versuch mit den Gründen der Ablehnung
      const retry = await ask([
        { role: "user", content: user },
        { role: "assistant", content: first.text },
        { role: "user", content: `Das Programm hat abgelehnt:\n${errors.join("\n") || "Es fehlten Optionen."}\nLiefere zwei neue Verbesserungen für „${target.name}“ (${target.id}), die die Regeln einhalten. Die Fähigkeit kostet bisher ${abilityCost(target, data.rules)} Punkte; jede Verbesserung muss danach zwischen ${range(target)} Punkte kosten.${wantsStage2 ? ` Für die zweite Stufe von „${upgradedBase!.name}“ (bisher ${abilityCost(upgradedBase as Ability, data.rules)} Punkte) gilt: zwischen ${range(upgradedBase as Ability)} Punkte.` : ""}` },
      ]);
      const second = validate(retry?.raw?.optionen, target);
      ok = [...ok, ...second.ok].filter((u, i, all) => all.findIndex((x) => x.name === u.name) === i).slice(0, 2);
      if (wantsStage2) {
        const s2 = validate(retry?.raw?.optionenZweiteStufe, upgradedBase as Ability, true);
        stage2 = [...stage2, ...s2.ok].filter((u, i, all) => all.findIndex((x) => x.name === u.name) === i).slice(0, 2);
      }
    }
    if (!ok.length) ok.push(fallbackUpgrade(target, tier, data.rules));
    if (ok.length < 2) {
      const fb = fallbackUpgrade(target, tier, data.rules);
      if (fb.name !== ok[0].name) ok.push(fb);
    }
    // Die Empfehlung gilt nur mit zwei gültigen Optionen – sonst bleibt es beim geplanten Weg
    const recommended = wantsStage2 && stage2.length === 2 ? pair[0] : undefined;
    return { abilities: pair, offer: { tier, abilityId: target.id, options: recommended ? [...ok, ...stage2] : ok, ...(recommended ? { recommended } : {}) }, costUsd: cost };
  }
}
