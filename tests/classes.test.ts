import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { checkClass, classCost } from "../shared/classbuilder";
import type { ReviewEvent, ReviewResult, SignedClass } from "../shared/classreview";
import type { ClassDef } from "../shared/schema";
import { handleApi } from "../server/api";
import { buildCharacter } from "../server/characters";
import { RollLog } from "../server/dice/log";
import type { LlmClient } from "../server/gm/engine";
import { ClassReviewer } from "../server/gm/review";
import { MemoryCounterStore, UsageGuard } from "../server/gm/usage";
import { loadGameData } from "../server/rules/loader";

const data = await loadGameData(path.resolve(__dirname, "../data"));
const { rules } = data;
const SECRET = "test-secret-0123456789";

function baseCustom(): ClassDef {
  return {
    id: "eigen_schmuggler_abc123", name: "Schmuggler", sigil: "mask", tagline: "Was nicht verzollt ist, ist auch nicht schwer.",
    description: "Kennt Schleichwege und Verstecke.", role: "Trickser", difficulty: 2, beginnerTip: "Für Heimlichkeit.",
    hitDie: 8, primaryAttributes: ["geschick", "ausstrahlung"],
    recommendedAttributes: { staerke: 10, geschick: 15, konstitution: 10, verstand: 10, weisheit: 10, ausstrahlung: 14 },
    trainedSkills: ["heimlichkeit"], skillChoices: { count: 2, from: ["taeuschen", "ueberreden", "fingerfertigkeit"] },
    armor: ["leicht"], startingEquipment: ["kurzschwert", "lederwams", "rucksack"], equippedWeapon: "kurzschwert", equippedArmor: "lederwams", equippedShield: null,
    startingMoney: { gulden: 0, groschen: 10, pfennig: 0 }, requiresMagic: "none", custom: true,
    abilities: [
      { id: "versteck", name: "Geheimfach", type: "wissen", uses: "passiv", level: 1, text: "Findet und baut Verstecke.", beginnerText: "Du weißt, wo man Dinge versteckt.", scope: "eng", magic: false,
        mechanics: { extraDamage: null, heal: null, bonusDie: null, flatBonus: 0, advantage: true, imposeDisadvantage: false, armorBonus: 0, attackBonus: 0 } },
      { id: "hinterhalt", name: "Hinterhalt", type: "angriff", uses: "einmal_pro_kampf", level: 1, text: "Erster Treffer +1W6 Schaden.", beginnerText: "Der erste Stich sitzt.", scope: "breit", magic: false,
        mechanics: { extraDamage: "1W6", heal: null, bonusDie: null, flatBonus: 0, advantage: false, imposeDisadvantage: false, armorBonus: 0, attackBonus: 0 } },
    ],
  };
}

describe("Regelprüfung eigener Klassen (der Richter)", () => {
  it("alle Grundklassen liegen im Budget", () => {
    for (const c of data.classes) {
      const res = checkClass(c, rules, "high");
      expect(res.errors, c.id).toEqual([]);
      expect(res.cost.total).toBeLessThanOrEqual(res.cost.budget);
    }
  });

  it("eine ausgewogene eigene Klasse besteht", () => {
    const res = checkClass(baseCustom(), rules, "low");
    expect(res.ok).toBe(true);
    expect(res.cost.total).toBeGreaterThan(0);
  });

  it("kürzt überzogene Werte automatisch", () => {
    const c = baseCustom();
    c.hitDie = 14;
    c.abilities[1].mechanics!.extraDamage = "4W20+9";
    c.abilities[0].mechanics!.armorBonus = 7;
    const res = checkClass(c, rules, "low");
    expect(res.cls.hitDie).toBe(12);
    expect(res.cls.abilities[1].mechanics!.extraDamage).toBe("2W12+3");
    expect(res.cls.abilities[0].mechanics!.armorBonus).toBe(3);
    expect(res.adjustments.length).toBeGreaterThanOrEqual(3);
  });

  it("lehnt spielbrechende und zu starke Klassen ab – egal, was Claude sagt", () => {
    const godlike = baseCustom();
    godlike.abilities[0].text = "Der Schmuggler ist unverwundbar.";
    expect(checkClass(godlike, rules, "low").errors.join()).toMatch(/Spielbrechend/);

    const spam = baseCustom();
    spam.abilities[1].uses = "beliebig";
    expect(checkClass(spam, rules, "low").ok).toBe(false);

    const tooMany = baseCustom();
    tooMany.abilities.push(...[0, 1].map((i) => ({ ...tooMany.abilities[0], id: `x${i}`, name: `Extra ${i}` })));
    expect(checkClass(tooMany, rules, "low").errors.join()).toMatch(/Zu viele Fähigkeiten/);

    const strong = baseCustom();
    strong.hitDie = 12;
    strong.armor = ["leicht", "mittel", "schwer", "schild"];
    strong.abilities[1].mechanics = { ...strong.abilities[1].mechanics!, extraDamage: "2W12", advantage: true, attackBonus: 2 };
    const res = checkClass(strong, rules, "low");
    expect(res.ok).toBe(false);
    expect(res.errors.join()).toMatch(/Zu stark/);
    expect(classCost(res.cls, rules).total).toBeGreaterThan(rules.classBuilder.pointBudgetPerLevel[0]);
  });

  it("magische Fähigkeiten verlangen mindestens wenig Magie", () => {
    const c = baseCustom();
    c.abilities[0].magic = true;
    const res = checkClass(c, rules, "none");
    expect(res.cls.requiresMagic).toBe("low");
    expect(res.warnings.length).toBe(1);
  });
});

describe("Gutachten durch Claude (Schein-Modell)", () => {
  const assessment = {
    zusammenfassung: "Ein flinker Schmuggler.",
    staerke: { punkte: 12, urteil: "ausgewogen", begruendung: "Passt." },
    probleme: [{ schwere: "hinweis", text: "Wenig Kampfkraft." }],
    vorschlaege: ["Mehr Ausrüstung"],
    gegenvorschlag: null,
  };
  const klasse = { ...baseCustom(), abilities: baseCustom().abilities.map(({ id: _i, level: _l, ...a }) => a) };
  const llm: LlmClient = {
    async stream() {
      return { id: "m", type: "message", role: "assistant", model: "fake", stop_reason: "end_turn", usage: { input_tokens: 2000, output_tokens: 900 },
        content: [{ type: "text", text: JSON.stringify({ ...assessment, klasse }), citations: null }] } as unknown as Anthropic.Beta.BetaMessage;
    },
  };
  const reviewer = new ClassReviewer({ data: () => data, llm, guard: new UsageGuard(new MemoryCounterStore(), 10, 100), secret: SECRET });
  const run = async (body: unknown) => {
    const evs: ReviewEvent[] = [];
    await reviewer.run(body, "tester", (e) => evs.push(e));
    return evs.at(-1)!;
  };
  const input = { freitext: "Ein Schmuggler, der Schleichwege kennt und aus dem Hinterhalt zusticht.", formular: {} };

  it("liefert Gutachten plus harte Regelprüfung", async () => {
    const ev = await run({ draftId: "draft-12345678", round: 1, token: null, input });
    expect(ev.type).toBe("review");
    const r = (ev as Extract<ReviewEvent, { type: "review" }>).result;
    expect(r.assessment.staerke.urteil).toBe("ausgewogen");
    expect(r.check.ok).toBe(true);
    expect(r.check.cls.id).toMatch(/^eigen_schmuggler_/);
  });

  it("höchstens fünf Runden pro Klasse, jede Runde braucht den Nachweis der vorigen", async () => {
    let token: string | null = null;
    for (let round = 1; round <= 5; round++) {
      const ev = await run({ draftId: "draft-rounds-1", round, token, input });
      expect(ev.type, `Runde ${round}`).toBe("review");
      token = (ev as { result: ReviewResult }).result.nextToken;
    }
    expect(token).toBeNull();
    expect(await run({ draftId: "draft-rounds-1", round: 6, token: "x", input })).toMatchObject({ type: "error" });
    expect(await run({ draftId: "draft-rounds-2", round: 3, token: "gefaelscht", input })).toMatchObject({ type: "error" });
  });
});

describe("Speichern, Signieren, Spielen", () => {
  const deps = { data: () => data, rolls: new RollLog(), secret: SECRET };

  it("speichert nur regelkonforme Klassen und signiert sie", async () => {
    const bad = baseCustom();
    bad.abilities[0].text = "unsterblich";
    expect((await handleApi("POST", "/api/classes/confirm", { cls: bad }, deps)).status).toBe(422);
    const ok = await handleApi("POST", "/api/classes/confirm", { cls: baseCustom() }, deps);
    expect(ok.status).toBe(201);
    const signed = ok.body as SignedClass;
    expect((await handleApi("POST", "/api/classes/verify", { signed }, deps)).status).toBe(200);
    const forged = { ...signed, cls: { ...signed.cls, hitDie: 12 } };
    expect((await handleApi("POST", "/api/classes/verify", { signed: forged }, deps)).status).toBe(422);
  });

  it("Figuren mit eigener Klasse würfeln mit den Werten der Klasse; Fälschungen fliegen auf", async () => {
    const signed = (await handleApi("POST", "/api/classes/confirm", { cls: baseCustom() }, deps)).body as SignedClass;
    const input = { name: "Mira", stand: "fahrend", classId: signed.cls.id, attributes: signed.cls.recommendedAttributes, chosenSkills: ["taeuschen", "ueberreden"], customClass: signed };
    const c = buildCharacter(input, data, SECRET);
    expect(c.hp.max).toBe(8);
    const roll = await handleApi("POST", "/api/rolls/check", { requestId: "custom-roll-1", character: c, check: { type: "skill", id: "heimlichkeit" } }, deps);
    expect(roll.status).toBe(201);
    expect((roll.body as { modifierParts: { label: string; value: number }[] }).modifierParts.map((p) => p.label)).toContain("Können");
    const tampered = { ...c, customClass: { ...signed, cls: { ...signed.cls, hitDie: 12 } } };
    expect((await handleApi("POST", "/api/rolls/check", { requestId: "custom-roll-2", character: tampered, check: { type: "skill", id: "heimlichkeit" } }, deps)).status).toBe(400);
    expect(() => buildCharacter(input, data, undefined)).toThrow();
  });
});
