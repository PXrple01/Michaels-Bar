// Werkzeuge, die der Server sofort ausführt: Kampf, Gegnerangriffe, Heilung, Rast, Aufträge, Gedächtnis, Erfahrung.
// Claude schlägt vor, der Code würfelt und begrenzt – wie bei den Proben bleibt alles fair.
import type Anthropic from "@anthropic-ai/sdk";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { armorValue, modifier } from "../../shared/character";
import { formatModifier, parseNotation, type RollRecord } from "../../shared/dice";
import type { Character } from "../../shared/schema";
import { resetUses, useAbility } from "../../shared/abilityUses";
import { advanceTime, ensureTime, timeLine, type TimeStep } from "../../shared/time";
import { BONUS_NAME, bonusTotal, type Ware } from "../../shared/shop";
import { GAMBLE_MAX } from "../../shared/gamble";
import { ATTITUDE_NAME, ATTITUDES, upsertPerson } from "../../shared/people";
import { PLACE_KINDS, PLACE_NAME, visitPlace } from "../../shared/map";
import { addItem, cleanStats, ensureInventory, ITEM_KINDS, RARITIES, itemText, kindOf, moneyText, removeItem, statsText, toPfennig } from "../../shared/inventory";
import { ACTS, allDown, currentChapter, DEFEAT_WARNING, initArc, isArc, MAX_MEMORY, MAX_QUESTS, type ActIndex, type Arc, type Chapter, type WorldState } from "../../shared/world";
import type { RollLog } from "../dice/log";
import type { GameData } from "../rules/loader";
import { addFate, addRumor, changeStanding, companionAction, standingName } from "../../shared/standing";

export const AUTO_TOOLS = ["ruf", "schicksal", "begleiter", "geruecht", "kampf_beginnen", "kampf_beenden", "gegner_greift_an", "heilen", "rast", "faehigkeit_einsetzen", "zeit", "gegenstand", "geld", "laden", "gluecksspiel", "person", "ort", "auftrag", "merken", "erfahrung", "kampagne_planen", "kapitel_abschliessen", "abzweigung", "abenteuer_beenden"] as const;

const LIMITS = { enemies: 6, enemyHp: 80, armorMin: 8, armorMax: 20, attackBonus: 8, dieMax: 12, diceMax: 2, flatMax: 5, healDieMax: 8, xpMax: 100 };

export interface ToolContext {
  data: GameData;
  characters: Character[];
  world: WorldState;
  rolls: RollLog;
  onRoll: (record: RollRecord) => void;
}

/** Diese Felder sehen die Spieler in der Seitenleiste – darum ohne Geheimnisse aus dem Plan. */
const SHOWN = "Wird den Spielern angezeigt – ein kurzer Satz ohne Geheimnisse oder Wendungen aus dem Plan: ";

const nameProp = (characters: Character[], description: string) =>
  characters.length > 1 ? { type: "string", enum: characters.map((c) => c.name), description } : { type: "string", description };

export function autoToolDefs(characters: Character[]): Anthropic.Beta.BetaTool[] {
  const party = characters.length > 1;
  const chapterList = { type: "array", items: { type: "object", properties: { titel: { type: "string" }, ziel: { type: "string" } }, required: ["titel", "ziel"] } };
  const dice = (d: string) => ({ type: "string", description: d });
  const statProps = {
    angriff: { type: "integer", description: "Optional, Waffen: Bonus 1–3" },
    schaden: { type: "integer", description: "Optional, Waffen: Bonus 1–3" },
    ruestung: { type: "integer", description: "Optional, Rüstung/Schild (art schild): Bonus 1–3" },
    heilung: dice("Optional, Tränke/Kräuter: Heilwürfel, z. B. 2W4+2 (höchstens 2W8+5)"),
    seltenheit: { type: "string", enum: [...RARITIES], description: "Optional, Standard gewoehnlich" },
  };
  const tool = (name: string, description: string, properties: Record<string, object>, required: string[]): Anthropic.Beta.BetaTool => ({
    name, description, eager_input_streaming: true, input_schema: { type: "object", properties, required },
  });
  return [
    tool("kampf_beginnen", "Beginnt einen Kampf. Lege die Gegner fest (höchstens 6). Schwache Gegner 4–10 TP, Rüstung 10–12; starke bis 40 TP, Rüstung bis 16.", {
      gegner: { type: "array", items: { type: "object", properties: { name: { type: "string" }, trefferpunkte: { type: "integer" }, ruestung: { type: "integer" }, aussehen: { type: "string", description: "Nur bei besonderen, benannten Gegnern (Anführer, Bestie, Erzfeind): Aussehen auf Englisch in einem Satz – die Spieler bekommen ein Porträt" } }, required: ["name", "trefferpunkte", "ruestung"] } },
    }, ["gegner"]),
    tool("kampf_beenden", "Beendet den Kampf (Flucht, Aufgabe, Verhandlung). Sind alle Gegner besiegt, endet er von selbst.", { grund: { type: "string" } }, ["grund"]),
    tool("gegner_greift_an", "Ein Gegner greift eine Figur an. Der Server würfelt Angriff (W20 + Bonus gegen die Rüstung der Figur) und bei Treffer den Schaden, und zieht die Trefferpunkte ab.", {
      gegner: { type: "string", description: "Name aus dem laufenden Kampf" },
      ...(party ? { ziel: nameProp(characters, "Wen der Gegner angreift") } : {}),
      angriffsbonus: { type: "integer", description: "0–8; einfache Räuber +2, erfahrene Söldner +4" },
      schaden: dice("Schadenswürfel, z. B. 1W6+1 (höchstens 2W12+5)"),
      modus: { type: "string", enum: ["normal", "advantage", "disadvantage"] },
    }, ["gegner", ...(party ? ["ziel"] : []), "angriffsbonus", "schaden", "modus"]),
    tool("heilen", "Heilt eine Figur (Trank, Heilkunde, Fähigkeit). Der Server würfelt die Heilung.", {
      ...(party ? { ziel: nameProp(characters, "Wer geheilt wird") } : {}),
      wuerfel: dice("Heilwürfel, z. B. 1W8+2 (höchstens 2W8+5)"),
      grund: { type: "string" },
    }, [...(party ? ["ziel"] : []), "wuerfel", "grund"]),
    tool("rast", "Die Gruppe rastet. kurz: jede Figur heilt einen Trefferwürfel + Konstitution. lang (eine Nacht): volle Trefferpunkte.", { art: { type: "string", enum: ["kurz", "lang"] } }, ["art"]),
    tool("faehigkeit_einsetzen", "Eine Figur setzt eine aktive Fähigkeit ihrer Klasse ein (nicht nötig bei passiven). Der Server prüft, ob sie noch verfügbar ist (1× pro Kampf: bis Kampfende; 1× pro Rast: bis zur nächsten Rast; 1× pro Tag: bis zur langen Rast), und verbucht den Einsatz. Ist sie verbraucht, kommt ein Fehler zurück – dann gelingt der Einsatz nicht.", {
      ...(party ? { figur: nameProp(characters, "Wer die Fähigkeit einsetzt") } : {}),
      faehigkeit: { type: "string", description: "Name der Fähigkeit, genau wie auf dem Figurenbogen" },
    }, [...(party ? ["figur"] : []), "faehigkeit"]),
    tool("zeit", "Lässt Zeit vergehen und/oder ändert das Wetter (wird den Spielern angezeigt). kurz: eine Weile, keine neue Tageszeit; stunden: nächste Tageszeit (Morgen → Mittag → Abend → Nacht); bis_abend, bis_nacht, bis_morgen: springt dorthin (bis_morgen = nächster Tag). Eine lange Rast stellt die Zeit von selbst auf den nächsten Morgen.", {
      vergeht: { type: "string", enum: ["kurz", "stunden", "bis_abend", "bis_nacht", "bis_morgen"] },
      wetter: { type: "string", description: "Optional: neues Wetter in wenigen Worten, z. B. „Nieselregen“, „klirrender Frost“" },
    }, ["vergeht"]),
    tool("gegenstand", "Führt das Gepäck einer Figur (wird den Spielern angezeigt): erhalten (Beute, Geschenk, Fund), verbrauchen (Trank getrunken, Fackel abgebrannt), verlieren (gestohlen, zerbrochen), weitergeben (an eine andere Figur). Was nicht im Gepäck ist, kann nicht verbraucht werden. Gib Waffen, Rüstungen, Schilden und Tränken beim Erhalten Werte: seltenheit, Boni (angriff, schaden, ruestung je 1–3) und heilung (z. B. 2W4+2). Boni zählen automatisch bei den Würfen, solange das Stück angelegt ist (je eine Waffe, Rüstung, Schild; die Spieler wechseln selbst). Summe der Boni: gewöhnlich höchstens 1, ungewöhnlich 2, selten 3, sagenhaft mehr – sagenhafte Stücke sind sehr selten und besonders. Wird ein Stück mit heilung verbraucht, würfelt der Server die Heilung selbst – dann kein extra heilen.", {
      ...(party ? { figur: nameProp(characters, "Wessen Gepäck") } : {}),
      aktion: { type: "string", enum: ["erhalten", "verbrauchen", "verlieren", "weitergeben"] },
      name: { type: "string", description: "Kurzer Name, z. B. „Heiltrank“, „Silberner Dolch“" },
      anzahl: { type: "integer", description: "Standard 1" },
      art: { type: "string", enum: [...ITEM_KINDS] },
      notiz: { type: "string", description: "Optional, ein kurzer Satz zur Herkunft oder Besonderheit" },
      ...statProps,
      ...(party ? { an: nameProp(characters, "Bei weitergeben: wer es bekommt. Bei verbrauchen eines Heiltranks: wer geheilt wird (Standard: die Figur selbst)") } : {}),
    }, [...(party ? ["figur"] : []), "aktion", "name"]),
    tool("geld", "Geld erhalten oder ausgeben (1 Gulden = 20 Groschen = 240 Pfennig). Beim Ausgeben prüft der Server, ob es reicht – sonst klappt der Kauf nicht." + (party ? " Beim Erhalten mit figur „alle“ wird gerecht geteilt." : ""), {
      ...(party ? { figur: { type: "string", enum: [...characters.map((c) => c.name), "alle"], description: "Wer bekommt bzw. bezahlt" } } : {}),
      aktion: { type: "string", enum: ["erhalten", "ausgeben"] },
      gulden: { type: "integer" }, groschen: { type: "integer" }, pfennig: { type: "integer" },
      grund: { type: "string" },
    }, [...(party ? ["figur"] : []), "aktion", "grund"]),
    tool("laden", "Öffnet einen Laden (Händler auf dem Markt, Krämer, Schmied …) mit 3–8 Waren und Preisen, passend zur Welt (Brot 1 Pfennig, Heiltrank etwa 2 Groschen, Langschwert 1 Gulden). Ein Schmied bietet zusätzlich Verbesserungen an (art verbesserung, bonus auf angriff, schaden oder ruestung, je +1; je Figur höchstens +2, Preis etwa 1–3 Gulden). Die Spieler kaufen und verkaufen selbst über die Oberfläche; was sie gekauft haben, steht im nächsten <spielstand>. schliessen, sobald die Figuren weitergehen.", {
      aktion: { type: "string", enum: ["oeffnen", "schliessen"] },
      name: { type: "string", description: "Name des Ladens bzw. der Person, z. B. „Krämerin Berta“" },
      art: { type: "string", enum: ["haendler", "schmied"] },
      waren: { type: "array", items: { type: "object", properties: {
        name: { type: "string" }, art: { type: "string", enum: [...ITEM_KINDS, "verbesserung"] },
        gulden: { type: "integer" }, groschen: { type: "integer" }, pfennig: { type: "integer" },
        notiz: { type: "string", description: "Kurz, z. B. Herkunft" }, vorrat: { type: "integer" },
        bonus: { type: "string", enum: ["angriff", "schaden", "ruestung"], description: "Nur bei art verbesserung" },
        ...statProps,
      }, required: ["name", "art"] } },
    }, ["aktion"]),
    tool("gluecksspiel", "Stellt in einer Taverne, auf dem Jahrmarkt oder im Lager einen Würfeltisch auf: Die Spieler würfeln selbst über die Oberfläche gegen eine Person (beide 2W6, der höhere Wurf gewinnt den Einsatz). Der Server würfelt und verbucht das Geld; wie die Spiele ausgingen, steht im nächsten <spielstand>. Biete es an, wenn die Figuren in geselliger Runde sind. schliessen, sobald sie weitergehen.", {
      aktion: { type: "string", enum: ["oeffnen", "schliessen"] },
      gegner: { type: "string", description: "Gegen wen gespielt wird, z. B. „der einäugige Söldner Ruprecht“" },
      hoechsteinsatz: { type: "integer", description: "Höchster Einsatz in Pfennig (1–240), passend zum Ort: Bauernschenke 6, Stadtwirtshaus 24, reiche Runde 120" },
    }, ["aktion"]),
    tool("ort", "Die Figuren kommen an einem Ort an (neu oder schon bekannt) – er erscheint auf der Karte der Spieler, mit einem Weg vom letzten Ort. Für jeden Ort, an den sie reisen: Dorf, Burg, Wald, Gasthaus …", {
      name: { type: "string", description: "Name des Ortes, z. B. „Kloster Sankt Gallus“, „Rabenwald“" },
      art: { type: "string", enum: [...PLACE_KINDS] },
      notiz: { type: "string", description: "Optional, ein kurzer Satz, was die Spieler über den Ort wissen" },
    }, ["name", "art"]),
    tool("person", "Führt das Personenverzeichnis (wird den Spielern angezeigt): neue Nichtspielerfigur anlegen oder ihre Rolle, Haltung zur Gruppe oder eine Notiz aktualisieren. Für jede Person mit Namen, die wichtig werden könnte.", {
      name: { type: "string" },
      rolle: { type: "string", description: "Kurz, z. B. „Marktfrau“, „Abt von Sankt Gallus“" },
      haltung: { type: "string", enum: [...ATTITUDES], description: "Haltung zur Gruppe" },
      notiz: { type: "string", description: "Ein Satz: was die Spieler über sie wissen oder was zuletzt geschah – keine Geheimnisse, die die Figuren nicht kennen" },
      aussehen: { type: "string", description: "Nur bei wichtigen Personen, beim ersten Eintrag: Aussehen auf Englisch in einem Satz (Alter, Gesicht, Haare, Kleidung) – die Spieler bekommen ein Porträt" },
    }, ["name"]),
    tool("begleiter", "Ein Begleiter reist mit der Gruppe (höchstens 3): aufnehmen, wenn sich jemand anschließt; aktualisieren bei Treue-Änderungen; verlassen, wenn er geht oder stirbt. Begleiter haben eine eigene Meinung, helfen mit ihrer Fähigkeit und widersprechen, wenn es gegen ihre Werte geht.", {
      aktion: { type: "string", enum: ["beitreten", "aktualisieren", "verlassen"] },
      name: { type: "string" },
      rolle: { type: "string", description: "Kurz, z. B. „junger Erbe“, „Söldnerin“" },
      faehigkeit: { type: "string", description: "Was der Begleiter gut kann, ein kurzer Satz" },
      treue: { type: "integer", description: "Änderung der Treue −2 bis +2 (bei Entscheidungen, die ihm gefallen oder missfallen)" },
      notiz: { type: "string", description: "Was zuletzt geschah, ein Satz" },
      aussehen: { type: "string", description: "Beim Beitreten: Aussehen auf Englisch in einem Satz – für sein Porträt" },
    }, ["aktion", "name"]),
    tool("geruecht", "Die Figuren hören ein Gerücht (in Tavernen, auf Märkten, von Reisenden). Wird den Spielern angezeigt. Ob es stimmt, entscheidest du – daraus kann ein Nebenauftrag werden.", {
      text: { type: "string", description: "Das Gerücht in einem Satz, so wie es erzählt wird" },
    }, ["text"]),
    tool("auftrag", "Führt das Auftragsbuch: neuen Auftrag anlegen, Notiz ergänzen, als erledigt oder gescheitert markieren.", {
      aktion: { type: "string", enum: ["neu", "notiz", "erledigt", "gescheitert"] },
      titel: { type: "string", description: "Kurzer Titel, bei Folgeaktionen genau wie beim Anlegen" },
      text: { type: "string", description: "Beschreibung bzw. Notiz" },
    }, ["aktion", "titel", "text"]),
    tool("ruf", "Ändert den Ruf der Gruppe bei einer Fraktion (wird den Spielern angezeigt). Wenn eine Tat bei einer Gruppe Eindruck macht: Kirche, Adel, Bürger, Bauern, Händlergilde, Diebesgilde, Stadtwache, ein bestimmtes Haus … Der Ruf öffnet oder versperrt später Türen.", {
      fraktion: { type: "string", description: "Name der Fraktion, kurz und gleichbleibend, z. B. „Kirche“, „Haus Falkenstein“" },
      aenderung: { type: "integer", description: "−3 bis +3: kleine Gefälligkeit ±1, deutliche Tat ±2, Großtat oder Verrat ±3" },
      grund: { type: "string", description: "Ein kurzer Satz: was die Figuren getan haben" },
    }, ["fraktion", "aenderung", "grund"]),
    tool("schicksal", "Hält eine große, moralische Entscheidung der Figuren fest (Leben verschonen oder nehmen, Verrat, ein Versprechen, Partei ergreifen …). Die Spieler sehen sie in ihrer Schicksalsliste; du greifst sie später in der Geschichte wieder auf.", {
      entscheidung: { type: "string", description: "Was die Figuren entschieden haben, ein Satz aus Sicht der Spieler" },
      folge: { type: "string", description: "Nur für dich: welche Folge das später haben könnte" },
    }, ["entscheidung"]),
    tool("merken", "Merkt sich eine wichtige Tatsache für später (Namen, Versprechen, Geheimnisse, Orte). Ein Satz.", { text: { type: "string" } }, ["text"]),
    tool("erfahrung", "Vergibt Erfahrungspunkte an alle Figuren für einen gelösten Auftrag, eine überstandene Gefahr oder eine kluge Idee (10–100; kleine Gefahr 20, großer Auftrag 60–100). Abgeschlossene Kapitel und Akte belohnt der Server selbst.", { menge: { type: "integer" }, grund: { type: "string" } }, ["menge", "grund"]),
    tool("kampagne_planen", `Plant die Kampagne (nur für dich, die Spieler sehen den Plan nicht): großes Ziel, Bedrohung und eine lineare Folge von Kapiteln in drei Akten – Anfang ${ACTS[0].chapters[0]}–${ACTS[0].chapters[1]}, Mitte ${ACTS[1].chapters[0]}–${ACTS[1].chapters[1]}, Finale ${ACTS[2].chapters[0]}–${ACTS[2].chapters[1]} Kapitel. Jedes Kapitel hat einen Titel und ein Ziel, das erreicht sein muss. Erneut aufgerufen, ersetzt es die noch nicht gespielten Kapitel (z. B. wenn die Spieler die Richtung geändert haben).`, {
      ziel: { type: "string", description: "Was die Figuren am Ende erreichen sollen" },
      bedrohung: { type: "string", description: "Gegenspieler oder Gefahr hinter allem" },
      kernauftrag: { type: "string", description: SHOWN + "der große Auftrag, so wie die Figuren ihn gerade kennen." },
      aufgabe: { type: "string", description: SHOWN + "was die Figuren als Nächstes tun wollen oder müssen." },
      anfang: chapterList, mitte: chapterList, finale: chapterList,
    }, ["ziel", "bedrohung", "kernauftrag", "aufgabe", "anfang", "mitte", "finale"]),
    tool("kapitel_abschliessen", "Schließt das laufende Kapitel ab, sobald sein Ziel erreicht ist (auf welchem Weg auch immer die Spieler dorthin gekommen sind). Danach beginnt das nächste Kapitel – ist es das letzte des Akts, beginnt der nächste Akt.", {
      rueckblick: { type: "string", description: "Ein Satz: Was ist in diesem Kapitel passiert?" },
      aufgabe: { type: "string", description: SHOWN + "die Aufgabe im nächsten Kapitel." },
      kernauftrag: { type: "string", description: "Nur wenn sich der große Auftrag aus Sicht der Figuren geändert hat (" + SHOWN.trim() + ")" },
    }, ["rueckblick", "aufgabe"]),
    tool("abzweigung", "Die Spieler verlassen mit einer Entscheidung den geplanten Weg: Schiebt ein Kapitel für diese Abzweigung ein. Das unterbrochene Kapitel folgt danach. Die Zahl der Abzweigungen je Akt ist begrenzt (siehe <spielstand>).", {
      titel: { type: "string" }, ziel: { type: "string", description: "Woran man merkt, dass die Abzweigung abgeschlossen ist" },
      rueckweg: { type: "string", description: "Wie die Geschichte danach zur Hauptlinie zurückfindet" },
      aufgabe: { type: "string", description: SHOWN + "die Aufgabe in dieser Abzweigung." },
    }, ["titel", "ziel", "rueckweg", "aufgabe"]),
    tool("abenteuer_beenden", "Beendet die Kampagne. sieg: im letzten Kapitel des Finales – erzähle vorher die Entscheidung, den Ausgang und einen Epilog. niederlage: nur wenn alle Figuren kampfunfähig sind und niemand sie retten kann – erzähle vorher ein kurzes, würdiges Ende. Danach geht die Geschichte nicht weiter.", {
      epilog: { type: "string", description: "Zwei, drei Sätze: Wie geht es für die Figuren aus?" },
      ausgang: { type: "string", enum: ["sieg", "niederlage"] },
      vermaechtnis: {
        type: "array", description: "Nur bei sieg, für jede Figur: ein Ehrentitel und ein Erbstück aus dieser Geschichte (nur zur Ehre, ohne Spielwerte)",
        items: { type: "object", properties: { figur: { type: "string", enum: characters.map((c) => c.name) }, titel: { type: "string", description: "Ehrentitel, z. B. „Bezwinger des Moores“" }, erbstueck: { type: "string", description: "Ein Andenken mit kurzer Herkunft, z. B. „Der Rabenring von Haus Falkenstein“" } }, required: ["figur", "titel", "erbstueck"] },
      },
    }, ["epilog"]),
  ];
}

/** Würfelausdruck auf die Grenzen kürzen (z. B. 5W20+30 → 2W12+5). */
export function clampDice(expr: string, dieMax: number, countMax = LIMITS.diceMax, flatMax = LIMITS.flatMax): string {
  let p;
  try { p = parseNotation(expr); } catch { return "1W4"; }
  const t = p.terms[0];
  const sides = [4, 6, 8, 10, 12].filter((d) => d <= dieMax).reduce((best, d) => (d <= t.sides ? d : best), 4);
  const count = Math.max(1, Math.min(t.count, countMax));
  const mod = Math.max(-flatMax, Math.min(flatMax, p.modifier));
  return `${count}W${sides}${mod ? (mod > 0 ? `+${mod}` : String(mod)) : ""}`;
}

const rid = (toolId: string, suffix: string) => `gm-${toolId.replace(/[^A-Za-z0-9-]/g, "-")}`.slice(0, 58) + `-${suffix}`;

function findCharacter(ctx: ToolContext, name: unknown): Character | null {
  if (ctx.characters.length === 1) return ctx.characters[0];
  return ctx.characters.find((c) => c.name.toLowerCase() === String(name ?? "").toLowerCase()) ?? null;
}

function hpLine(ctx: ToolContext, c: Character) {
  const hp = ctx.world.hp[c.id];
  return `${c.name}: ${hp}/${ctx.world.maxHp[c.id]} TP${hp <= 0 ? " – kampfunfähig (bewusstlos, aber nicht tot)" : ""}`;
}

function checkCombatEnd(ctx: ToolContext): string {
  const w = ctx.world;
  if (w.combat && w.combat.enemies.every((e) => e.hp <= 0)) {
    w.combat = null;
    resetUses(w, "kampf");
    return " Alle Gegner sind besiegt – der Kampf ist vorbei.";
  }
  return "";
}

/** Führt ein automatisches Werkzeug aus und liefert den Text für Claude. Fehler kommen als is_error zurück. */
export async function runAutoTool(block: { id: string; name: string; input: unknown }, ctx: ToolContext): Promise<{ content: string; is_error?: boolean }> {
  const w = ctx.world;
  const err = (content: string) => ({ content: `FEHLER: ${content}`, is_error: true });
  const input = (block.input ?? {}) as Record<string, unknown>;

  switch (block.name) {
    case "kampf_beginnen": {
      const parsed = z.array(z.object({ name: z.string().min(1).max(40), trefferpunkte: z.number(), ruestung: z.number(), aussehen: z.string().optional() })).min(1).safeParse(input.gegner);
      if (!parsed.success) return err("gegner muss eine Liste mit name, trefferpunkte, ruestung sein.");
      const enemies = parsed.data.slice(0, LIMITS.enemies).map((g, i) => {
        const hp = Math.max(1, Math.min(LIMITS.enemyHp, Math.round(g.trefferpunkte)));
        return { id: `${i}-${randomBytes(3).toString("hex")}`, name: g.name, hp, maxHp: hp, armor: Math.max(LIMITS.armorMin, Math.min(LIMITS.armorMax, Math.round(g.ruestung))), ...(g.aussehen?.trim() ? { look: g.aussehen.trim().slice(0, 300) } : {}) };
      });
      // gleiche Namen unterscheidbar machen
      const total: Record<string, number> = {};
      for (const e of enemies) total[e.name] = (total[e.name] ?? 0) + 1;
      const seen: Record<string, number> = {};
      for (const e of enemies) if (total[e.name] > 1) { seen[e.name] = (seen[e.name] ?? 0) + 1; e.name = `${e.name} ${seen[e.name]}`; }
      w.combat = { round: 1, enemies };
      w.shop = null; // im Kampf wird nicht gehandelt
      resetUses(w, "kampf"); // neuer Kampf: „1× pro Kampf“ ist wieder frei
      return { content: `Kampf beginnt (Runde 1). Gegner: ${enemies.map((e) => `${e.name} (${e.hp} TP, Rüstung ${e.armor})`).join(", ")}. Die Figuren handeln zuerst; Angriffe der Figuren verlangst du mit probe_anfordern (art attack, ziel = Gegnername – den Schaden würfelt der Server bei einem Treffer gleich mit), Gegnerangriffe mit gegner_greift_an in derselben Antwort.` };
    }
    case "kampf_beenden": {
      if (!w.combat) return { content: "Es lief kein Kampf." };
      w.combat = null;
      resetUses(w, "kampf");
      return { content: "Der Kampf ist beendet." };
    }
    case "gegner_greift_an": {
      if (!w.combat) return err("Es läuft kein Kampf – starte ihn zuerst mit kampf_beginnen.");
      const enemy = w.combat.enemies.find((e) => e.name.toLowerCase() === String(input.gegner ?? "").toLowerCase());
      if (!enemy) return err(`Unbekannter Gegner. Im Kampf: ${w.combat.enemies.map((e) => e.name).join(", ")}.`);
      if (enemy.hp <= 0) return err(`${enemy.name} ist schon besiegt.`);
      const target = findCharacter(ctx, input.ziel);
      if (!target) return err("Unbekanntes Ziel.");
      if (w.hp[target.id] <= 0) return err(`${target.name} ist bereits kampfunfähig.`);
      const cls = ctx.data.classes.find((c) => c.id === target.classId)!;
      const ac = armorValue(target, ctx.data.rules, cls).total + bonusTotal(w, target.id, "ruestung");
      const bonus = Math.max(0, Math.min(LIMITS.attackBonus, Math.round(Number(input.angriffsbonus) || 0)));
      const mode = input.modus === "advantage" || input.modus === "disadvantage" ? input.modus : "normal";
      const atk = await ctx.rolls.roll({ requestId: rid(block.id, "a"), kind: "check", label: `${enemy.name} greift ${target.name} an`, notation: "1W20", mode, modifierParts: bonus ? [{ label: "Angriff", value: bonus }] : [], dc: ac });
      ctx.onRoll(atk);
      if (!atk.success) return { content: `${enemy.name} greift ${target.name} an: ${atk.natural}${bonus ? formatModifier(bonus) : ""} = ${atk.total} gegen Rüstung ${ac} – daneben${atk.critical === "fumble" ? " (Patzer!)" : ""}. ${hpLine(ctx, target)}` };
      let dmgExpr = clampDice(String(input.schaden ?? "1W6"), LIMITS.dieMax);
      if (atk.critical === "hit") { const p = parseNotation(dmgExpr); dmgExpr = `${p.terms[0].count * 2}W${p.terms[0].sides}${p.modifier ? formatModifier(p.modifier).replace("−", "-") : ""}`; }
      const dmg = await ctx.rolls.roll({ requestId: rid(block.id, "d"), kind: "check", label: `Schaden von ${enemy.name}`, notation: dmgExpr });
      ctx.onRoll(dmg);
      const amount = Math.max(1, dmg.total);
      w.hp[target.id] = Math.max(0, w.hp[target.id] - amount);
      return { content: `${enemy.name} trifft ${target.name}${atk.critical === "hit" ? " kritisch (doppelte Schadenswürfel)" : ""}: ${atk.total} gegen Rüstung ${ac}, Schaden ${dmgExpr} = ${amount}. ${hpLine(ctx, target)}${allDown(w, ctx.characters) ? ` ${DEFEAT_WARNING}` : ""}` };
    }
    case "heilen": {
      const target = findCharacter(ctx, input.ziel);
      if (!target) return err("Unbekanntes Ziel.");
      const expr = clampDice(String(input.wuerfel ?? "1W4"), LIMITS.healDieMax);
      const r = await ctx.rolls.roll({ requestId: rid(block.id, "h"), kind: "check", label: `Heilung für ${target.name}`, notation: expr });
      ctx.onRoll(r);
      const before = w.hp[target.id];
      w.hp[target.id] = Math.min(w.maxHp[target.id], before + Math.max(1, r.total));
      return { content: `Heilung ${expr} = ${r.total}. ${target.name} heilt ${w.hp[target.id] - before} TP. ${hpLine(ctx, target)}` };
    }
    case "rast": {
      if (w.combat) return err("Mitten im Kampf kann niemand rasten.");
      resetUses(w, input.art === "lang" ? "lang" : "kurz");
      if (input.art === "lang") {
        for (const c of ctx.characters) w.hp[c.id] = w.maxHp[c.id];
        // Die Nacht ist vorbei: ein neuer Tag beginnt
        const t = ensureTime(w);
        advanceTime(t, "bis_morgen");
        return { content: `Lange Rast: Alle sind wieder bei vollen Kräften. ${ctx.characters.map((c) => hpLine(ctx, c)).join("; ")}. Ein neuer Tag beginnt: ${timeLine(t)}.` };
      }
      const parts: string[] = [];
      for (const c of ctx.characters) {
        const cls = ctx.data.classes.find((x) => x.id === c.classId)!;
        const kon = modifier(c.attributes.konstitution);
        const r = await ctx.rolls.roll({ requestId: rid(block.id, `r${c.id.slice(0, 4)}`), kind: "check", label: `Kurze Rast: ${c.name}`, notation: `1W${cls.hitDie}${kon ? formatModifier(kon).replace("−", "-") : ""}` });
        ctx.onRoll(r);
        w.hp[c.id] = Math.min(w.maxHp[c.id], w.hp[c.id] + Math.max(1, r.total));
        parts.push(hpLine(ctx, c));
      }
      return { content: `Kurze Rast. ${parts.join("; ")}` };
    }
    case "zeit": {
      const step = String(input.vergeht ?? "kurz") as TimeStep;
      if (!["kurz", "stunden", "bis_abend", "bis_nacht", "bis_morgen"].includes(step)) return err("vergeht muss kurz, stunden, bis_abend, bis_nacht oder bis_morgen sein.");
      const t = ensureTime(w);
      const newDay = advanceTime(t, step);
      const wetter = text(input.wetter, 60);
      if (wetter) t.weather = wetter;
      return { content: `${newDay ? "Ein neuer Tag beginnt. " : ""}Jetzt: ${timeLine(t)}.${newDay ? " (Fähigkeiten „1× pro Tag“ werden erst durch eine lange Rast wieder frei.)" : ""}` };
    }
    case "ort": {
      const name = text(input.name, 60);
      if (!name) return err("name fehlt.");
      const { place, created } = visitPlace(w, { name, kind: String(input.art ?? ""), note: text(input.notiz, 160) });
      return { content: `${created ? "Neu auf der Karte" : "Wieder in"}: ${place.name} (${PLACE_NAME[place.kind]}).` };
    }
    case "person": {
      const name = text(input.name, 60);
      if (!name) return err("name fehlt.");
      const { person, created } = upsertPerson(w, { name, role: text(input.rolle, 80), attitude: String(input.haltung ?? ""), note: text(input.notiz, 200), look: text(input.aussehen, 300) });
      return { content: `${created ? "Neu im Verzeichnis" : "Aktualisiert"}: ${person.name}${person.role ? ` (${person.role})` : ""}, ${ATTITUDE_NAME[person.attitude]}.` };
    }
    case "laden": {
      if (input.aktion === "schliessen") { w.shop = null; return { content: "Der Laden ist geschlossen." }; }
      if (w.combat) return err("Mitten im Kampf wird nicht gehandelt.");
      const list = Array.isArray(input.waren) ? input.waren.slice(0, 10) : [];
      const wares: Ware[] = [];
      list.forEach((r: Record<string, unknown>, i: number) => {
        const name = text(r?.name, 50);
        if (!name) return;
        const kind = r.art === "verbesserung" ? "verbesserung" : kindOf(r.art);
        const price = Math.max(1, Math.min(240 * 100, toPfennig({ gulden: Number(r.gulden) || 0, groschen: Number(r.groschen) || 0, pfennig: Number(r.pfennig) || 0 })));
        const bonus = kind === "verbesserung" && ["angriff", "schaden", "ruestung"].includes(String(r.bonus)) ? { target: r.bonus as "angriff", value: 1 } : undefined;
        if (kind === "verbesserung" && !bonus) return;
        const stats = kind === "verbesserung" ? undefined : cleanStats(r);
        wares.push({ id: `w${i}`, name, kind, price, ...(text(r.notiz, 100) ? { note: text(r.notiz, 100) } : {}), ...(Number(r.vorrat) > 0 ? { stock: Math.min(20, Math.round(Number(r.vorrat))) } : {}), ...(bonus ? { bonus } : {}), ...(stats ? { stats } : {}) });
      });
      if (!wares.length) return err("waren fehlt (Name, Art und Preis je Ware).");
      w.shop = { name: text(input.name, 60) || "Händler", kind: input.art === "schmied" ? "schmied" : "haendler", wares, log: [] };
      return { content: `Laden „${w.shop.name}“ geöffnet: ${wares.map((x) => `${x.name} (${moneyText(x.price, true)}${x.bonus ? `, ${BONUS_NAME[x.bonus.target]} +1` : ""}${x.stats ? `, ${statsText(x.stats)}` : ""})`).join(", ")}. Die Spieler kaufen über die Oberfläche.` };
    }
    case "gluecksspiel": {
      if (input.aktion === "schliessen") { w.gamble = null; return { content: "Der Würfeltisch ist abgeräumt." }; }
      if (w.combat) return err("Mitten im Kampf wird nicht gespielt.");
      const opponent = text(input.gegner, 60) || "ein Fremder";
      const maxBet = Math.max(1, Math.min(GAMBLE_MAX, Math.round(Number(input.hoechsteinsatz) || 12)));
      w.gamble = { opponent, maxBet, log: [] };
      return { content: `Würfeltisch offen: gegen ${opponent}, höchstens ${moneyText(maxBet)}. Die Spieler würfeln über die Oberfläche.` };
    }
    case "gegenstand": {
      ensureInventory(w, ctx.characters, ctx.data.rules);
      const c = findCharacter(ctx, input.figur);
      if (!c) return err("Unbekannte Figur.");
      const inv = w.inventory![c.id];
      const name = text(input.name, 60);
      const qty = Math.max(1, Math.min(99, Math.round(Number(input.anzahl) || 1)));
      if (!name) return err("name fehlt.");
      if (input.aktion === "erhalten") {
        const stats = cleanStats(input);
        const e = addItem(inv, { name, qty, kind: kindOf(input.art), ...(text(input.notiz, 120) ? { note: text(input.notiz, 120) } : {}), ...(stats ? { stats } : {}) });
        return e ? err(e) : { content: `${c.name} erhält ${qty > 1 ? `${qty}× ` : ""}${name}${stats ? ` (${statsText(stats)})` : ""}.` };
      }
      const r = removeItem(inv, name, qty);
      if ("error" in r) return err(`${c.name}: ${r.error}`);
      const heal = input.aktion === "verbrauchen" ? r.item.stats?.heilung : undefined;
      if (heal) {
        // Trank getrunken: Der Server würfelt die Heilung je Stück (bei weitergeben an jemand anderen nicht)
        const target = (input.an !== undefined && findCharacter(ctx, input.an)) || c;
        const before = w.hp[target.id];
        const fixed = /^\d$/.test(heal);
        let total = fixed ? Number(heal) * qty : 0;
        for (let n = 0; !fixed && n < qty; n++) {
          const roll = await ctx.rolls.roll({ requestId: rid(block.id, `h${n}`), kind: "check", label: `${r.item.name}: Heilung für ${target.name}`, notation: clampDice(heal, LIMITS.healDieMax) });
          ctx.onRoll(roll);
          total += Math.max(1, roll.total);
        }
        w.hp[target.id] = Math.min(w.maxHp[target.id], before + total);
        return { content: `${c.name}: ${itemText({ ...r.item, qty })} verbraucht. Heilung ${heal} = ${total}, ${target.name} heilt ${w.hp[target.id] - before} TP. ${hpLine(ctx, target)}` };
      }
      if (input.aktion === "weitergeben") {
        const to = findCharacter(ctx, input.an);
        if (!to || to.id === c.id) { addItem(inv, { ...r.item, qty }); return err("Unbekannter Empfänger."); }
        addItem(w.inventory![to.id], { ...r.item, qty });
        return { content: `${c.name} gibt ${itemText({ ...r.item, qty })} an ${to.name}.` };
      }
      return { content: `${c.name}: ${itemText({ ...r.item, qty })} ${input.aktion === "verbrauchen" ? "verbraucht" : "verloren"}.` };
    }
    case "geld": {
      ensureInventory(w, ctx.characters, ctx.data.rules);
      const pf = toPfennig({ gulden: Number(input.gulden) || 0, groschen: Number(input.groschen) || 0, pfennig: Number(input.pfennig) || 0 });
      if (pf <= 0) return err("Betrag fehlt (gulden, groschen, pfennig).");
      if (pf > 240 * 500) return err("So viel Geld auf einmal ist unglaubwürdig (höchstens 500 Gulden).");
      if (input.aktion === "erhalten" && (ctx.characters.length === 1 || input.figur === "alle")) {
        const share = Math.floor(pf / ctx.characters.length);
        ctx.characters.forEach((c, i) => { w.inventory![c.id].money += share + (i === 0 ? pf - share * ctx.characters.length : 0); });
        return { content: `${ctx.characters.length > 1 ? `Geteilt: je etwa ${moneyText(share)}` : `Erhalten: ${moneyText(pf)}`}. ${ctx.characters.map((c) => `${c.name} hat ${moneyText(w.inventory![c.id].money)}`).join("; ")}.` };
      }
      const c = findCharacter(ctx, input.figur);
      if (!c) return err("Unbekannte Figur (oder „alle“ beim Erhalten).");
      const inv = w.inventory![c.id];
      if (input.aktion === "erhalten") { inv.money += pf; return { content: `${c.name} erhält ${moneyText(pf)} und hat jetzt ${moneyText(inv.money)}.` }; }
      if (inv.money < pf) return err(`${c.name} hat nur ${moneyText(inv.money)} – ${moneyText(pf)} reichen nicht. Der Kauf klappt nicht (oder jemand anderes zahlt).`);
      inv.money -= pf;
      return { content: `${c.name} bezahlt ${moneyText(pf)} und hat noch ${moneyText(inv.money)}.` };
    }
    case "faehigkeit_einsetzen": {
      const c = findCharacter(ctx, input.figur);
      if (!c) return err("Unbekannte Figur.");
      const r = useAbility(w, c, ctx.data.classes, String(input.faehigkeit ?? ""));
      return r.error ? err(r.text) : { content: r.text };
    }
    case "auftrag": {
      const title = String(input.titel ?? "").trim().slice(0, 80);
      const text = String(input.text ?? "").trim().slice(0, 300);
      if (!title) return err("titel fehlt.");
      const q = w.quests.find((x) => x.title.toLowerCase() === title.toLowerCase());
      if (input.aktion === "neu") {
        if (q) return { content: `Auftrag „${title}“ gibt es schon.` };
        if (w.quests.length >= MAX_QUESTS) w.quests.splice(w.quests.findIndex((x) => x.status !== "offen"), 1);
        w.quests.push({ id: randomBytes(4).toString("hex"), title, description: text, status: "offen", notes: [] });
        return { content: `Neuer Auftrag: ${title}.` };
      }
      if (!q) return err(`Kein Auftrag „${title}“. Offen: ${w.quests.filter((x) => x.status === "offen").map((x) => x.title).join(", ") || "keine"}.`);
      if (input.aktion === "notiz") { if (text) q.notes = [...q.notes, text].slice(-8); return { content: `Notiz zu „${q.title}“ gespeichert.` }; }
      q.status = input.aktion === "erledigt" ? "erledigt" : "gescheitert";
      if (text) q.notes = [...q.notes, text].slice(-8);
      return { content: `Auftrag „${q.title}“: ${q.status}.` };
    }
    case "ruf": {
      const fraktion = text(input.fraktion, 40);
      if (!fraktion) return err("fraktion fehlt.");
      const delta = Math.max(-3, Math.min(3, Math.round(Number(input.aenderung) || 0)));
      if (!delta) return err("aenderung muss zwischen −3 und +3 liegen (nicht 0).");
      const r = changeStanding(w, fraktion, delta, text(input.grund, 140));
      return { content: `Ruf bei ${r.name}: ${r.score > 0 ? "+" : ""}${r.score} (${standingName(r.score)}).` };
    }
    case "begleiter": {
      const name = text(input.name, 60);
      if (!name) return err("name fehlt.");
      const r = companionAction(w, { action: String(input.aktion ?? ""), name, role: text(input.rolle, 60), skill: text(input.faehigkeit, 120), loyalty: Number(input.treue) || 0, note: text(input.notiz, 160), look: text(input.aussehen, 300) });
      return r.ok ? { content: r.text } : err(r.text);
    }
    case "geruecht": {
      const t = text(input.text, 200);
      if (!t) return err("text fehlt.");
      addRumor(w, t);
      return { content: "Gerücht notiert." };
    }
    case "schicksal": {
      const entscheidung = text(input.entscheidung, 200);
      if (!entscheidung) return err("entscheidung fehlt.");
      addFate(w, entscheidung, text(input.folge, 200));
      return { content: "Im Schicksal festgehalten." };
    }
    case "merken": {
      const text = String(input.text ?? "").trim().slice(0, 300);
      if (!text) return err("text fehlt.");
      if (!w.memory.includes(text)) w.memory = [...w.memory, text].slice(-MAX_MEMORY);
      return { content: "Gemerkt." };
    }
    case "erfahrung": {
      const amount = Math.max(0, Math.min(LIMITS.xpMax, Math.round(Number(input.menge) || 0)));
      for (const c of ctx.characters) w.xp[c.id] = (w.xp[c.id] ?? 0) + amount;
      return { content: `Alle erhalten ${amount} Erfahrungspunkte.` };
    }
    case "kampagne_planen": {
      const arc = arcOf(w);
      const ziel = text(input.ziel, 300), bedrohung = text(input.bedrohung, 300);
      if (!ziel || !bedrohung) return err("ziel und bedrohung fehlen.");
      const lists = [input.anfang, input.mitte, input.finale].map((l) => (Array.isArray(l) ? l : []).map((c) => ({ titel: text((c as Chapter)?.titel, 80), ziel: text((c as Chapter)?.ziel, 240) })).filter((c) => c.titel && c.ziel));
      const replan = arc.chapters.length > 0;
      const actNow: ActIndex = replan ? currentChapter(arc)!.act : 0;
      // Erledigte Kapitel und das laufende bleiben; ersetzt werden nur die noch kommenden.
      const kept = replan ? arc.chapters.slice(0, arc.current + 1) : [];
      const next: Chapter[] = [];
      for (const act of [0, 1, 2] as ActIndex[]) {
        if (act < actNow) continue;
        const already = kept.filter((c) => c.act === act && !c.detour).length;
        const [min, max] = ACTS[act].chapters;
        // Ein Akt darf durch Umplanen nicht wachsen, über die Höchstzahl hinaus schon gar nicht – kein endloser Anfang.
        const room = Math.max(0, max - already);
        const items = lists[act].slice(0, room);
        if (!replan && items.length < min) return err(`${ACTS[act].name}: mindestens ${min} Kapitel planen (höchstens ${max}).`);
        if (!items.length && act > actNow) return err(`${ACTS[act].name}: mindestens ein Kapitel planen.`);
        next.push(...items.map((c) => ({ ...c, act, detour: false, rueckweg: null, done: false, rueckblick: null })));
      }
      arc.plan = { ziel, bedrohung };
      setKnown(arc, input.kernauftrag, input.aufgabe);
      arc.chapters = [...kept, ...next];
      if (!replan) { arc.current = 0; arc.turnsInChapter = 0; }
      const cut = lists.filter((_, act) => act >= actNow).reduce((n, l) => n + l.length, 0) - next.length;
      return { content: `${replan ? "Plan angepasst" : "Plan gespeichert"}: ${ACTS.map((a, i) => `${a.name} ${arc.chapters.filter((c) => c.act === i).length} Kapitel`).join(", ")}.${cut > 0 ? " Einige Kapitel wurden gestrichen – ein Akt kann durch Umplanen nicht länger werden." : ""} Laufendes Kapitel: „${currentChapter(arc)!.titel}“.` };
    }
    case "kapitel_abschliessen": {
      const arc = arcOf(w);
      const ch = currentChapter(arc);
      if (!arc.plan || !ch) return err("Es gibt noch keinen Plan – lege ihn mit kampagne_planen an.");
      if (arc.finished) return err("Die Kampagne ist schon zu Ende.");
      if (arc.current === arc.chapters.length - 1) return err("Das ist das letzte Kapitel – beende die Kampagne mit abenteuer_beenden (nach Ausgang und Epilog).");
      ch.done = true;
      ch.rueckblick = text(input.rueckblick, 240) || null;
      arc.current++;
      setKnown(arc, input.kernauftrag, input.aufgabe ?? null);
      arc.turnsInChapter = 0;
      const nx = currentChapter(arc)!;
      // Feste Erfahrung für jedes Kapitel und jeden Akt – Fortschritt hängt nicht nur von erfahrung ab
      const lv = ctx.data.rules.levels;
      const xp = lv.chapterXp + (nx.act !== ch.act ? lv.actXp : 0);
      for (const c of ctx.characters) w.xp[c.id] = (w.xp[c.id] ?? 0) + xp;
      return { content: (nx.act !== ch.act
        ? `Kapitel „${ch.titel}“ und damit der Akt „${ACTS[ch.act].name}“ sind abgeschlossen. Jetzt beginnt Akt ${nx.act + 1} „${ACTS[nx.act].name}“ mit dem Kapitel „${nx.titel}“: ${nx.ziel}`
        : `Kapitel „${ch.titel}“ ist abgeschlossen. Nächstes Kapitel: „${nx.titel}“: ${nx.ziel}`) + ` Alle erhalten ${xp} Erfahrungspunkte.` };
    }
    case "abzweigung": {
      const arc = arcOf(w);
      const ch = currentChapter(arc);
      if (!arc.plan || !ch) return err("Es gibt noch keinen Plan – lege ihn mit kampagne_planen an.");
      if (ch.detour) return err("Ihr seid schon in einer Abzweigung – lass die Entscheidung innerhalb dieses Kapitels Folgen haben.");
      const act = ch.act;
      if (arc.detoursUsed[act] >= ACTS[act].detours) return err(`Im Akt „${ACTS[act].name}“ sind keine Abzweigungen mehr möglich. Lass die Entscheidung innerhalb des laufenden Kapitels Folgen haben und lenke zurück zur Hauptlinie.`);
      const titel = text(input.titel, 80), ziel = text(input.ziel, 240);
      if (!titel || !ziel) return err("titel und ziel fehlen.");
      arc.chapters.splice(arc.current, 0, { titel, ziel, act, detour: true, rueckweg: text(input.rueckweg, 240) || null, done: false, rueckblick: null });
      arc.detoursUsed[act]++;
      setKnown(arc, undefined, input.aufgabe ?? ziel);
      arc.turnsInChapter = 0;
      return { content: `Abzweigung „${titel}“ beginnt (${arc.detoursUsed[act]} von ${ACTS[act].detours} in diesem Akt). Danach geht es weiter mit „${arc.chapters[arc.current + 1].titel}“.` };
    }
    case "abenteuer_beenden": {
      const arc = arcOf(w);
      if (arc.finished) return { content: "Die Kampagne ist bereits beendet." };
      if (input.ausgang === "niederlage") {
        if (!allDown(w, ctx.characters)) return err("Eine Niederlage gibt es nur, wenn alle Figuren kampfunfähig sind. Solange jemand steht, geht die Geschichte weiter.");
        finishDefeat(w, text(input.epilog, 600) || null);
        return { content: "Die Kampagne endet mit einer Niederlage. Schreib keine weiteren Vorschläge – die Geschichte endet hier." };
      }
      const ch = currentChapter(arc);
      if (!ch || arc.current !== arc.chapters.length - 1 || ch.act !== 2) return err(`Noch nicht: Das Ende kommt im letzten Kapitel des Finales. Jetzt läuft „${ch?.titel ?? "noch kein Kapitel"}“.`);
      ch.done = true;
      arc.finished = true;
      arc.outcome = "sieg";
      arc.epilog = text(input.epilog, 600) || null;
      w.combat = null;
      // Vermächtnis: Titel und Erbstück je Figur – fehlt etwas, gibt es einen schlichten Ehrentitel
      const given = Array.isArray(input.vermaechtnis) ? input.vermaechtnis as Record<string, unknown>[] : [];
      w.legacy = ctx.characters.map((c) => {
        const g = given.find((x) => String(x?.figur ?? "").toLowerCase() === c.name.toLowerCase());
        return { characterId: c.id, title: text(g?.titel, 60) || `Held von ${w.map?.current ?? "einst"}`, heirloom: text(g?.erbstueck, 120) || "Eine Erinnerung an diese Sage" };
      });
      return { content: "Die Kampagne ist abgeschlossen. Schreib keine weiteren Vorschläge – die Geschichte endet hier." };
    }
  }
  return err("Unbekanntes Werkzeug.");
}

/* ── Kampagnenbogen ── */

const text = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

function arcOf(w: WorldState): Arc {
  if (!isArc(w.arc)) w.arc = initArc();
  return w.arc;
}

/** Für die Spieler sichtbarer Kernauftrag und aktuelle Aufgabe. `undefined` lässt den Wert, wie er ist. */
function setKnown(arc: Arc, kern: unknown, aufgabe: unknown) {
  const known = arc.known ?? { kern: null, aufgabe: null };
  if (kern !== undefined && text(kern, 200)) known.kern = text(kern, 200);
  if (aufgabe !== undefined) known.aufgabe = text(aufgabe, 200) || null;
  arc.known = known;
}

function finishDefeat(w: WorldState, epilog: string | null) {
  const arc = arcOf(w);
  arc.finished = true;
  arc.outcome = "niederlage";
  arc.epilog = epilog;
  w.combat = null;
}

export const defaultDefeatEpilog = (solo: boolean) => solo
  ? "Du bist gefallen. Deine Geschichte erzählt man sich noch lange – als Warnung, und als Lied von Mut gegen eine Übermacht."
  : "Die Gruppe ist gefallen. Ihre Geschichte erzählt man sich noch lange – als Warnung, und als Lied von Mut gegen eine Übermacht.";

/**
 * Nach jedem Zug: Liegen alle Figuren mitten im Kampf am Boden und hat niemand sie gerettet, endet die Kampagne als Niederlage –
 * auch wenn Claude es nicht selbst beendet hat. Gibt true zurück, wenn der Server das Ende erzwungen hat.
 */
export function enforceDefeat(w: WorldState, characters: Pick<Character, "id">[]): boolean {
  if (arcOf(w).finished || !w.combat || !allDown(w, characters)) return false;
  finishDefeat(w, defaultDefeatEpilog(characters.length === 1));
  return true;
}

/** Vor jeder Spieler-Handlung: Züge im Kapitel zählen – nur für den Hinweis bei sehr langen Kapiteln, kein harter Schnitt. */
export function countChapterTurn(w: WorldState): void {
  const arc = arcOf(w);
  if (!arc.finished) arc.turnsInChapter++;
}

/** Spieler-Angriff oder -Schaden gegen einen Gegner verrechnen (nach dem Wurf der Probe). */
export function applyPlayerRoll(ctx: Omit<ToolContext, "onRoll" | "rolls">, characterId: string, art: string, ziel: string | null, record: RollRecord): string {
  const w = ctx.world;
  if (!w.combat || !ziel) return "";
  const enemy = w.combat.enemies.find((e) => e.name.toLowerCase() === ziel.toLowerCase());
  if (!enemy) return "";
  if (art === "attack") {
    w.critPending[characterId] = record.critical === "hit";
    return record.success ? ` Treffer gegen ${enemy.name}${record.critical === "hit" ? " – kritisch, der Schaden zählt doppelt" : ""}!` : ` Verfehlt – ${enemy.name} weicht aus.`;
  }
  if (art === "damage") {
    delete w.critPending[characterId];
    const amount = Math.max(1, record.total);
    enemy.hp = Math.max(0, enemy.hp - amount);
    return ` ${enemy.name} verliert ${amount} TP und hat noch ${enemy.hp}/${enemy.maxHp}${enemy.hp <= 0 ? " – besiegt!" : "."}${checkCombatEnd({ ...ctx, rolls: null as never, onRoll: () => {} })}`;
  }
  return "";
}
