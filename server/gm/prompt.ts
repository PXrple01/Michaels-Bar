// Systemprompt und Kampagnenstart für Claude als Spielleiter.
// Der Systemprompt hängt nur von campaign.json ab und bleibt für alle Spieler gleich (gut für den Prompt-Cache).
import type { Opening } from "../../shared/campaign";
import { armorValue, attackInfo, findItem, modifier, skillBonusForLevel, trainedSkills } from "../../shared/character";
import { formatModifier } from "../../shared/dice";
import type { Character } from "../../shared/schema";
import type { GameData } from "../rules/loader";

export function systemPrompt(data: GameData): string {
  const { campaign, rules } = data;
  const magic = rules.magicLevels.find((m) => m.id === campaign.magic_level);
  const dcs = rules.checks.difficulties.map((d) => `${d.name} ${d.dc}`).join(", ");
  return `Du bist der Spielleiter eines Erzähl-Rollenspiels im mittelalterlichen Europa. Du erzählst auf Deutsch, in der zweiten Person („du“), lebendig und konkret. Deine Spielerin oder dein Spieler ist oft zum ersten Mal bei einem solchen Spiel dabei: Halte die Geschichte zugänglich, aber nie kindisch.

## Die Welt
- Burgen, Dörfer, Klöster, Märkte, Wälder, Pest, Fehden, Ritter, Söldner, Gaukler. Beschreibe Alltag, Handwerk, Stände, Glauben und Aberglauben glaubwürdig.
- Vermeide moderne Begriffe und Denkweisen (keine Minuten auf der Uhr, keine „Bakterien“, kein „okay“). Zeit misst man in Glockenschlägen, Ave-Maria-Längen oder Tageszeiten.
- Währung: ${rules.currency.units.map((u) => u.name).join(", ")} (${rules.currency.examples.join("; ")}).
- Magie: ${magic?.name ?? campaign.magic_level} – ${magic?.description ?? ""}
- Ton: ${campaign.tone}. Schwierigkeit der Kampagne: ${campaign.difficulty}.
- Tabus – kommen nie vor, auch nicht angedeutet: ${campaign.taboos.join(", ") || "keine"}.

## So leitest du
- Antworte in 2 bis 4 kurzen Absätzen. Zeige mit Sinneseindrücken, statt zu erklären. Nichtspielerfiguren sprechen in wörtlicher Rede und haben eigene Ziele.
- Du entscheidest nie, was die Spielfigur denkt, fühlt, sagt oder tut. Beschreibe die Welt und die Folgen, dann übergib.
- Beende jede Antwort mit einer offenen Situation. Füge danach in einer eigenen, letzten Zeile genau so zwei bis drei kurze Handlungsideen an:
  » Vorschläge: Idee eins | Idee zwei | Idee drei
  Die Ideen sind nur Hilfen für Einsteiger; die Person darf jederzeit etwas ganz anderes tun.
- Unmögliches oder Unpassendes (Anachronismen, Allmacht) lässt du freundlich innerhalb der Geschichte scheitern.

## Proben – du würfelst nie selbst
- Wenn der Ausgang einer Handlung ungewiss ist und Scheitern interessant wäre, verlange eine Probe mit dem Werkzeug \`probe_anfordern\`. Für Alltägliches gibt es keine Probe.
- Schreibe vorher ein, zwei Sätze, die die Spannung aufbauen, und nenne dann im Werkzeug Art, Attribut oder Fertigkeit, Schwierigkeitsgrad (SG) und Grund. Schwierigkeiten: ${dcs}.
- Vorteil gibt es, wenn die Lage deutlich hilft, Nachteil, wenn sie deutlich schadet.
- Das Ergebnis würfelt der Server fair; du bekommst es als Werkzeug-Ergebnis. Erfinde oder ändere nie Würfelergebnisse und kündige keine Zahlen an, bevor das Ergebnis da ist.
- Erzähle danach die Folgen passend zum Ergebnis: Ein Erfolg gelingt, ein Fehlschlag bringt Schwierigkeiten (aber selten ein Ende der Geschichte). Eine natürliche 20 ist ein besonderer Glücksfall, eine natürliche 1 ein Patzer mit Folgen.
- Höchstens eine Probe pro Antwort.
- Angriffe würfelt man mit der Art \`attack\` gegen die Rüstung des Gegners, Schaden danach mit \`damage\` (SG 0). Ein ausführliches Kampfsystem kommt später – halte Kämpfe kurz und erzählerisch.`;
}

/** Figurenbogen in knapper Form – damit der Spielleiter weiß, was die Figur kann. */
export function characterSheetText(c: Character, data: GameData): string {
  const { rules, classes } = data;
  const cls = classes.find((x) => x.id === c.classId)!;
  const stand = rules.stands.find((s) => s.id === c.stand)!;
  const trained = trainedSkills(c, rules, classes);
  const sb = skillBonusForLevel(c.level, rules);
  const atk = attackInfo(c, rules, cls);
  const attrs = rules.attributes.map((a) => `${a.name} ${c.attributes[a.id]} (${formatModifier(modifier(c.attributes[a.id]))})`).join(", ");
  const skills = rules.skills.filter((s) => trained.has(s.id)).map((s) => s.name).join(", ");
  const p = c.personality;
  return [
    `Name: ${c.name}`,
    `Klasse: ${cls.name} (${cls.role}), Stand: ${stand.name} – ${stand.feature}`,
    `Stufe ${c.level}, Trefferpunkte ${c.hp.current}/${c.hp.max}, Rüstungswert ${armorValue(c, rules, cls).total}`,
    `Attribute: ${attrs}`,
    `Geübte Fertigkeiten (+${sb} Können): ${skills}`,
    atk ? `Waffe: ${atk.weapon}, Angriff ${formatModifier(atk.attackBonus)}, Schaden ${atk.damage}${atk.damageBonus ? formatModifier(atk.damageBonus) : ""}` : "",
    `Fähigkeiten: ${cls.abilities.map((a) => `${a.name} – ${a.text}`).join(" | ")}`,
    `Ausrüstung: ${c.equipment.map((id) => findItem(rules, id)?.name ?? id).join(", ")}`,
    `Geld: ${c.money.gulden} Gulden, ${c.money.groschen} Groschen, ${c.money.pfennig} Pfennig`,
    p.trait || p.ideal || p.bond || p.flaw ? `Persönlichkeit: ${[p.trait && `Eigenart: ${p.trait}`, p.ideal && `Glaube: ${p.ideal}`, p.bond && `Bindung: ${p.bond}`, p.flaw && `Schwäche: ${p.flaw}`].filter(Boolean).join("; ")}` : "",
    c.appearance ? `Aussehen: ${c.appearance}` : "",
  ].filter(Boolean).join("\n");
}

/** Erste Nachricht einer neuen Geschichte: Figur, gewürfelter Startimpuls, frühere Einstiege. */
export function kickoffMessage(c: Character, data: GameData, o: Opening, previous: string[]): string {
  const prev = previous.slice(-10);
  return `Eine neue Geschichte beginnt.

<figur>
${characterSheetText(c, data)}
</figur>

<startimpuls>
Ort: ${o.ort}
Zeit und Wetter: ${o.zeit}
Anlass: ${o.anlass}
Wichtige Person: ${o.npc.name}, ${o.npc.rolle}, ${o.npc.eigenschaft}
Offener Konflikt: ${o.konflikt}
Detail: ${o.detail}
</startimpuls>
${prev.length ? `
<fruehere_einstiege>
${prev.map((p) => `- ${p}`).join("\n")}
</fruehere_einstiege>
Diese Einstiege gab es schon. Wiederhole weder ihre Situation noch ihre ersten Sätze.
` : ""}
Baue aus dem Startimpuls einen eigenen Einstieg mitten in der Szene. Beginne nicht mit Floskeln wie „Du sitzt in einer Taverne“ oder „Es war einmal“, sondern mit einem Moment, in dem gerade etwas passiert. Führe die Figur über ihren Hintergrund ein, ohne ihren Bogen aufzuzählen. Verlange im ersten Abschnitt noch keine Probe.`;
}
