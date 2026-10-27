// Claude als Gutachter für selbst gebaute Klassen. Ausgabe im festen JSON-Schema (Structured Outputs);
// verbindlich ist danach allein die Regelprüfung in shared/classbuilder.ts.
import { createHmac, randomBytes } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { checkClass } from "../../shared/classbuilder";
import { MAX_REVIEW_ROUNDS, type ClaudeAssessment, type ReviewEvent, type ReviewRequest } from "../../shared/classreview";
import type { ClassDef, Rules } from "../../shared/schema";
import type { GameData } from "../rules/loader";
import { apiErrorText, CACHE_1H, requestBase, type LlmClient, type ModelId } from "./narrator";
import { LimitError, type UsageGuard } from "./usage";

const SIGILS = ["shield", "axe", "mask", "candle", "bow", "cauldron"];
const obj = (properties: Record<string, object>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

/**
 * JSON-Schema der Antwort. Bewusst schlank: Lange Auswahllisten (alle Fertigkeiten, Gegenstände …) lassen die
 * Grammatik der API zu groß werden. Die IDs stehen im Systemprompt; `toClassDef` und die Regelprüfung fangen Fehler ab.
 * Leerer Text "" bedeutet „nichts“ (statt null – das hält das Schema klein).
 */
export function reviewSchema(rules: Rules) {
  const cb = rules.classBuilder;
  const id = (what: string) => ({ type: "string", description: `${what}-ID aus der Liste` });
  const ids = (what: string) => ({ type: "array", items: { type: "string" }, description: `${what}-IDs aus der Liste` });
  const dice = { type: "string", description: "Würfelausdruck wie 1W6 oder 1W8+2, leer wenn keiner" };
  return obj({
    zusammenfassung: { type: "string", description: "2–3 Sätze in einfacher Sprache: Was kann die Klasse, wie spielt sie sich?" },
    klasse: obj({
      name: { type: "string" },
      tagline: { type: "string", description: "Ein stimmungsvoller Satz" },
      description: { type: "string" },
      role: { type: "string", description: "Rolle in der Gruppe, z. B. Kämpfer, Heiler" },
      sigil: { type: "string", enum: SIGILS },
      hitDie: { type: "integer", description: `Trefferwürfel: ${cb.hitDie.allowed.join(", ")}` },
      primaryAttributes: ids("Attribut"),
      recommendedAttributes: obj(Object.fromEntries(rules.attributes.map((a) => [a.id, { type: "integer" }]))),
      trainedSkills: ids("Fertigkeit"),
      skillChoices: obj({ count: { type: "integer" }, from: ids("Fertigkeit") }),
      armor: { type: "array", items: { type: "string", enum: ["leicht", "mittel", "schwer", "schild"] } },
      startingEquipment: ids("Gegenstand"),
      equippedWeapon: id("Waffen"),
      equippedArmor: { type: "string", description: "Rüstungs-ID, leer wenn keine" },
      equippedShield: { type: "string", description: "\"schild\" oder leer" },
      startingMoney: obj({ gulden: { type: "integer" }, groschen: { type: "integer" }, pfennig: { type: "integer" } }),
      abilities: {
        type: "array",
        items: obj({
          name: { type: "string" },
          type: { type: "string", enum: cb.abilityTypes },
          uses: { type: "string", enum: cb.abilityUses },
          scope: { type: "string", enum: ["eng", "breit"], description: "eng = nur in einer Nische (z. B. nur im Wald), breit = oft nützlich" },
          text: { type: "string", description: "Genauer Regeltext" },
          beginnerText: { type: "string", description: "Ein Satz für Einsteiger" },
          magic: { type: "boolean" },
          mechanics: obj({
            extraDamage: dice, heal: dice, bonusDie: dice,
            flatBonus: { type: "integer" }, advantage: { type: "boolean" }, imposeDisadvantage: { type: "boolean" },
            armorBonus: { type: "integer" }, attackBonus: { type: "integer" },
          }),
        }),
      },
    }),
    staerke: obj({
      punkte: { type: "number", description: "Geschätzte Punktkosten nach der Kostentabelle" },
      urteil: { type: "string", enum: ["zu_schwach", "ausgewogen", "zu_stark"] },
      begruendung: { type: "string" },
    }),
    probleme: { type: "array", items: obj({ schwere: { type: "string", enum: ["fehler", "warnung", "hinweis"] }, text: { type: "string" } }) },
    vorschlaege: { type: "array", items: { type: "string" } },
    gegenvorschlag: { type: "string", description: "Nur wenn zu stark oder unzulässig: konkreter Vorschlag, der ins Budget passt; sonst leer" },
  });
}

export function reviewSystemPrompt(data: GameData): string {
  const { rules, campaign } = data;
  const cb = rules.classBuilder;
  const items = rules.items.map((i) => `${i.id} (${i.name}${i.type === "weapon" ? `, ${i.damage}` : i.type === "armor" ? `, ${i.category} +${i.armorBonus}` : ""})`).join(", ");
  return `Du bist Regel-Gutachter für ein mittelalterliches Erzähl-Rollenspiel (W20-System, deutsch). Spielerinnen und Spieler beschreiben eigene Klassen; du übersetzt die Beschreibung in Spielwerte und bewertest sie fair.

## Regeln für Klassen (Stufe 1)
- Punktebudget: ${cb.pointBudgetPerLevel[0]} Punkte. ${cb.explanation}
- Kostentabelle (JSON): ${JSON.stringify(cb.costs)}
  Fähigkeitskosten = (Durchschnitt Zusatzschaden × ${cb.costs.extraDamagePerAverage} + Durchschnitt Heilung × ${cb.costs.healPerAverage} + Durchschnitt Bonuswürfel × ${cb.costs.bonusDiePerAverage} + fester Bonus × ${cb.costs.flatBonus} + Vorteil ${cb.costs.advantage} + Nachteil für Gegner ${cb.costs.imposeDisadvantage} + Rüstungsbonus × ${cb.costs.armorBonus} + Angriffsbonus × ${cb.costs.attackBonus}; ohne Zahlenwirkung ${cb.costs.abilityBase}) × Häufigkeit × Reichweite.
  Rüstung kostet nur die schwerste Kategorie plus Schild.
- Grenzen: Trefferwürfel ${cb.hitDie.allowed.map((d) => `W${d}`).join("/")}; höchstens ${cb.maxTrainedSkills} geübte Fertigkeiten (fest + zur Wahl); höchstens ${cb.maxAbilitiesAtLevel1} Fähigkeiten; Schadenswürfel höchstens ${cb.maxDamageDiceCount}W${cb.maxDamageDie}, fester Bonus höchstens +${cb.maxFlatDamageBonus}; Rüstungsbonus ${cb.armorBonus.min}–${cb.armorBonus.max}; Angriffsbonus ${cb.attackBonus.min}–${cb.attackBonus.max}.
- Verboten: unbegrenzte oder spielbrechende Effekte (unendlicher Schaden, Unverwundbarkeit, Sofort-Sieg, Regeln ändern, Wiederbelebung). Schaden, Heilung, Vorteil oder Nachteil dürfen nicht „beliebig oft“ einsetzbar sein.
- Startattribute nach Punktekauf: Basis 10, ${rules.attributeRules.pointBudget} Punkte, bis 13 kostet ein Punkt 1, darüber 2, Werte ${rules.attributeRules.min}–${rules.attributeRules.max}, höchstens zwei Attribute unter 10.
- Welt: Magie „${campaign.magic_level}“. Magische Fähigkeiten markierst du mit magic = true.
- Attribute (IDs): ${rules.attributes.map((a) => `${a.id} (${a.name})`).join(", ")}.
- Fertigkeiten (IDs): ${rules.skills.map((x) => `${x.id} (${x.name})`).join(", ")}.
- Gegenstände (IDs): ${items}.
- Verwende in allen ID-Feldern genau diese IDs. Leere Textfelder bedeuten „nichts“.

## So arbeitest du
1. Übertrage das Konzept treu in die Felder. Schwäche nichts heimlich ab – wenn etwas zu stark ist, übernimm es so und melde es als Problem.
2. Beschreibe jede Fähigkeit messbar in „mechanics“: Was der Text verspricht, muss dort stehen (z. B. „+1W6 Schaden einmal pro Kampf“ → extraDamage "1W6", uses einmal_pro_kampf). Erfinde keine Wirkung, die nicht gemeint ist.
3. Rechne die Punkte mit der Kostentabelle und urteile: zu_schwach (deutlich unter 12), ausgewogen, zu_stark (über ${cb.pointBudgetPerLevel[0]} oder unzulässig).
4. Melde Probleme kurz und verständlich (zu stark, zu schwach, unklar, Widerspruch zu Regeln). Schlage Verbesserungen vor.
5. Ist die Klasse zu stark oder unzulässig, gib einen konkreten Gegenvorschlag, der ins Budget passt, und erkläre die Ablehnung in einem Satz.
6. Fehlt etwas (z. B. Ausrüstung), ergänze Passendes im mittelalterlichen Stil. Schreibe für Einsteiger, ohne Fachjargon.
Die endgültige Prüfung macht danach ein Programm; deine Punkte sind eine Einschätzung.`;
}

const assessmentSchema = z.object({
  zusammenfassung: z.string(),
  staerke: z.object({ punkte: z.number(), urteil: z.enum(["zu_schwach", "ausgewogen", "zu_stark"]), begruendung: z.string() }),
  probleme: z.array(z.object({ schwere: z.enum(["fehler", "warnung", "hinweis"]), text: z.string() })),
  vorschlaege: z.array(z.string()),
  gegenvorschlag: z.string().nullable().transform((v) => (v && v.trim() ? v : null)),
});

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || "klasse";

/** Macht aus Claudes Antwort eine Klassen-Definition (noch ungeprüft). */
export function toClassDef(raw: Record<string, unknown>, draftId: string, summary: string, rules: Rules): ClassDef {
  const k = raw as Record<string, any>;
  // Unbekannte IDs (Tippfehler) still entfernen – über die Stärke entscheidet danach die Regelprüfung.
  const known = (list: { id: string }[]) => new Set(list.map((x) => x.id));
  const attrs = known(rules.attributes), skills = known(rules.skills), items = known(rules.items);
  const weapons = known(rules.items.filter((i) => i.type === "weapon")), armors = known(rules.items.filter((i) => i.type === "armor"));
  const only = (v: unknown, set: Set<string>) => (Array.isArray(v) ? [...new Set(v.map(String).filter((x) => set.has(x)))] : []);
  const orNull = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const equipment = only(k.startingEquipment, items);
  const weapon = weapons.has(k.equippedWeapon) ? k.equippedWeapon : equipment.find((x) => weapons.has(x)) ?? "dolch";
  const abilities = (Array.isArray(k.abilities) ? k.abilities : []).map((a: any, i: number) => ({
    id: `${slug(String(a.name ?? "faehigkeit"))}_${i}`,
    name: String(a.name ?? "Fähigkeit").slice(0, 60),
    type: String(a.type), uses: String(a.uses), level: 1,
    text: String(a.text ?? "").slice(0, 600) || "—",
    beginnerText: String(a.beginnerText ?? "").slice(0, 300) || "—",
    scope: a.scope === "eng" ? "eng" as const : "breit" as const,
    magic: Boolean(a.magic),
    mechanics: a.mechanics ? { ...a.mechanics, extraDamage: orNull(a.mechanics.extraDamage), heal: orNull(a.mechanics.heal), bonusDie: orNull(a.mechanics.bonusDie) } : a.mechanics,
  }));
  return {
    id: `eigen_${slug(String(k.name ?? "klasse"))}_${draftId.replace(/[^a-z0-9]/gi, "").slice(0, 6).toLowerCase()}`,
    name: String(k.name ?? "Unbenannt").slice(0, 40),
    sigil: SIGILS.includes(k.sigil) ? k.sigil : "shield",
    tagline: String(k.tagline ?? "").slice(0, 160),
    description: String(k.description ?? "").slice(0, 800),
    role: String(k.role ?? "Abenteurer").slice(0, 40),
    difficulty: 2,
    beginnerTip: summary.slice(0, 300),
    hitDie: Number(k.hitDie) || 8,
    primaryAttributes: only(k.primaryAttributes, attrs),
    recommendedAttributes: k.recommendedAttributes ?? {},
    trainedSkills: only(k.trainedSkills, skills),
    skillChoices: { count: Number(k.skillChoices?.count) || 0, from: only(k.skillChoices?.from, skills) },
    armor: Array.isArray(k.armor) ? k.armor : [],
    startingEquipment: equipment.includes(weapon) || !items.has(weapon) ? equipment : [weapon, ...equipment],
    equippedWeapon: weapon,
    equippedArmor: armors.has(orNull(k.equippedArmor) ?? "") ? orNull(k.equippedArmor) : null,
    equippedShield: orNull(k.equippedShield) === "schild" ? "schild" : null,
    startingMoney: { gulden: Math.max(0, Number(k.startingMoney?.gulden) || 0), groschen: Math.max(0, Number(k.startingMoney?.groschen) || 0), pfennig: Math.max(0, Number(k.startingMoney?.pfennig) || 0) },
    requiresMagic: abilities.some((a: { magic: boolean }) => a.magic) ? "low" : "none",
    abilities,
    custom: true,
  } as ClassDef;
}

export class ClassReviewer {
  constructor(private o: { data: () => GameData; llm: LlmClient | null; guard: UsageGuard; secret: string; model?: ModelId; effort?: "low" | "medium" | "high" }) {}

  token(draftId: string, round: number) {
    return createHmac("sha256", this.o.secret).update(`review:${draftId}:${round}`).digest("base64url");
  }

  async run(body: unknown, who: string, emit: (ev: ReviewEvent) => void): Promise<void> {
    const ping = setInterval(() => emit({ type: "progress" }), 4000);
    try {
      await this.review(body as ReviewRequest, who, emit);
    } catch (e) {
      if (e instanceof LimitError) emit({ type: "error", message: e.message, code: e.code });
      else if (e instanceof Anthropic.AuthenticationError) emit({ type: "error", message: "Der API-Schlüssel wurde abgelehnt.", code: "no_api_key" });
      else if (e instanceof Anthropic.BadRequestError) { console.error("[Claude] 400 bei der Klassenbewertung:", apiErrorText(e)); emit({ type: "error", message: `Claude hat die Anfrage abgelehnt (400): ${apiErrorText(e)}`, code: "api" }); }
      else if (e instanceof Anthropic.APIError) emit({ type: "error", message: `Verbindung zu Claude fehlgeschlagen (${e.status ?? "Netzwerk"}). Bitte erneut versuchen.`, code: "api" });
      else if (e instanceof Error && e.name === "ReviewError") emit({ type: "error", message: e.message, code: "state" });
      else { console.error(e); emit({ type: "error", message: "Unerwarteter Fehler bei der Bewertung.", code: "api" }); }
    } finally {
      clearInterval(ping);
    }
  }

  private async review(req: ReviewRequest, who: string, emit: (ev: ReviewEvent) => void) {
    const fail = (message: string) => Object.assign(new Error(message), { name: "ReviewError" });
    if (!this.o.llm) { emit({ type: "error", message: "Kein API-Schlüssel hinterlegt (ANTHROPIC_API_KEY).", code: "no_api_key" }); return; }
    const round = Number(req?.round);
    const draftId = String(req?.draftId ?? "");
    if (!/^[A-Za-z0-9-]{8,64}$/.test(draftId) || !Number.isInteger(round) || round < 1) throw fail("Ungültige Anfrage.");
    if (round > MAX_REVIEW_ROUNDS) throw fail(`Höchstens ${MAX_REVIEW_ROUNDS} Bewertungen pro Klasse. Speichere die Klasse oder beginne einen neuen Entwurf.`);
    if (round > 1 && req.token !== this.token(draftId, round - 1)) throw fail("Bewertungsrunde passt nicht – bitte die Seite neu laden.");
    const input = req.input ?? { freitext: "", formular: {} };
    const freitext = String(input.freitext ?? "").slice(0, 3000);
    if (freitext.trim().length < 10 && !input.formular?.name && !input.vorher) throw fail("Beschreibe deine Klasse in ein paar Sätzen.");

    await this.o.guard.check(who);
    const data = this.o.data();
    const userText = `Bewertungsrunde ${round} von ${MAX_REVIEW_ROUNDS}.

<beschreibung>
${freitext || "(kein Freitext)"}
</beschreibung>

<formular>
${JSON.stringify(input.formular ?? {}, null, 1).slice(0, 3000)}
</formular>
${input.vorher ? `
<vorherige_fassung>
${JSON.stringify(input.vorher).slice(0, 6000)}
</vorherige_fassung>
Arbeite an der vorherigen Fassung weiter und übernimm die neuen Wünsche aus Beschreibung und Formular.` : ""}`;

    const schema = reviewSchema(data.rules);
    const ask = (strict: boolean) => this.o.llm!.stream({
      ...requestBase(this.o.model ?? "claude-opus-5-5", this.o.effort ?? "low"),
      output_config: strict ? { effort: this.o.effort ?? "low", format: { type: "json_schema", schema } } : { effort: this.o.effort ?? "low" },
      max_tokens: 16000,
      system: [{ type: "text", text: reviewSystemPrompt(data), cache_control: CACHE_1H }],
      messages: [{ role: "user", content: strict ? userText : `${userText}\n\nAntworte ausschließlich mit einem JSON-Objekt nach diesem Schema, ohne weiteren Text:\n${JSON.stringify(schema)}` }],
    }, () => {});
    let msg: Anthropic.Beta.BetaMessage;
    try {
      msg = await ask(true);
    } catch (e) {
      // Ist das feste Antwortformat der API zu groß, geht es ohne – die Antwort wird danach ohnehin streng geprüft.
      if (!(e instanceof Anthropic.BadRequestError) || !/grammar|schema/i.test(apiErrorText(e))) throw e;
      console.warn(`[Claude] Antwortformat abgelehnt (${apiErrorText(e)}) – Bewertung ohne festes Format.`);
      msg = await ask(false);
    }
    await this.o.guard.record(msg.usage, this.o.model ?? "claude-opus-5-5");
    if (msg.stop_reason === "refusal") throw fail("Diese Klasse kann nicht bewertet werden. Versuch eine andere Beschreibung.");
    if (msg.stop_reason === "max_tokens") throw fail("Die Bewertung war zu lang und wurde abgeschnitten. Bitte kürzer beschreiben.");
    const text = msg.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("");
    let raw: Record<string, unknown>;
    try { raw = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { throw fail("Die Bewertung kam unvollständig an. Bitte erneut versuchen."); }
    const parsed = assessmentSchema.safeParse(raw);
    if (!parsed.success) throw fail("Die Bewertung kam unvollständig an. Bitte erneut versuchen.");
    const assessment: ClaudeAssessment = parsed.data;
    const cls = toClassDef((raw.klasse ?? {}) as Record<string, unknown>, draftId, assessment.zusammenfassung, data.rules);
    const check = checkClass(cls, data.rules, data.campaign.magic_level);
    emit({
      type: "review",
      result: {
        draftId, round, maxRounds: MAX_REVIEW_ROUNDS,
        nextToken: round < MAX_REVIEW_ROUNDS ? this.token(draftId, round) : null,
        assessment, check, budget: await this.o.guard.info(),
      },
    });
  }
}

export const newDraftId = () => randomBytes(9).toString("base64url").replace(/_/g, "-");
