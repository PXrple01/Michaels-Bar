// Kleines Lexikon: Fachbegriffe in einfacher Sprache. Im Text als <span class="term" data-term="...">.
import { html, type Raw } from "./dom";

export interface Term { title: string; short: string; long?: string }

export const GLOSSARY: Record<string, Term> = {
  rollenspiel: { title: "Erzähl-Rollenspiel", short: "Ein Spiel, bei dem ihr gemeinsam eine Geschichte erzählt. Du spielst eine Figur und sagst, was sie tut. Der Spielleiter beschreibt die Welt und was passiert." },
  spielleiter: { title: "Spielleiter", short: "Erzählt die Geschichte, spielt alle anderen Personen und entscheidet, wann gewürfelt wird. Hier übernimmt das Claude." },
  figur: { title: "Figur (Charakter)", short: "Die Person, die du in der Geschichte spielst – mit Namen, Herkunft, Stärken und Schwächen." },
  w20: { title: "W20", short: "Ein Würfel mit 20 Seiten. „W“ steht für Würfel, die Zahl für die Seiten. Der W20 entscheidet fast alle Proben." },
  wuerfel: { title: "W4, W6, W8 …", short: "„2W6“ heißt: zwei sechsseitige Würfel werfen und zusammenzählen. „+2“ dahinter wird noch addiert." },
  w100: { title: "W100 (Prozentwurf)", short: "Zwei Zehnerwürfel: einer zeigt die Zehner (00–90), einer die Einer (0–9). Zusammen ergibt das 1 bis 100. „00“ und „0“ bedeuten 100." },
  probe: { title: "Probe", short: "Wenn etwas schiefgehen kann, wird gewürfelt: W20 + Bonus. Erreichst du den Schwierigkeitsgrad, klappt es." },
  sg: { title: "Schwierigkeitsgrad (SG)", short: "Die Zahl, die du bei einer Probe erreichen musst. 10 ist leicht, 13 mittel, 16 schwer, 19 sehr schwer." },
  bonus: { title: "Bonus (Modifikator)", short: "Eine Zahl, die zum Würfelergebnis addiert wird. Sie kommt von deinen Attributen und deinem Können. Kann auch negativ sein." },
  attribut: { title: "Attribut", short: "Sechs Grundwerte beschreiben deine Figur: Stärke, Geschick, Konstitution, Verstand, Weisheit, Ausstrahlung. 10 ist Durchschnitt. Deine Klasse verschiebt einige davon – ein Söldner ist stärker, aber weniger gebildet." },
  fertigkeit: { title: "Fertigkeit", short: "Etwas, das man lernen kann, z. B. Schleichen oder Heilkunde. Bist du darin geübt, bekommst du den Können-Bonus dazu." },
  koennen: { title: "Können-Bonus", short: "Bekommst du bei Fertigkeiten, in denen du geübt bist, und bei Angriffen mit deiner Waffe. Auf Stufe 1 ist er +2." },
  vorteil: { title: "Vorteil", short: "Die Lage ist günstig: Wirf zwei W20 und nimm das höhere Ergebnis." },
  nachteil: { title: "Nachteil", short: "Die Lage ist ungünstig: Wirf zwei W20 und nimm das niedrigere Ergebnis." },
  krit: { title: "Kritischer Erfolg", short: "Zeigt der W20 eine 20, klappt es immer – und zwar besonders gut. Bei Proben reicht auch ein Ergebnis 10 oder mehr über der Schwierigkeit. Bei Angriffen zählt nur die natürliche 20 – dann gibt es doppelte Schadenswürfel." },
  patzer: { title: "Patzer", short: "Zeigt der W20 eine 1, misslingt es immer – oft mit unangenehmen Folgen. Bei Proben auch, wenn das Ergebnis 10 oder mehr unter der Schwierigkeit liegt." },
  tp: { title: "Trefferpunkte (TP)", short: "Deine Lebenskraft. Wirst du verletzt, sinken sie. Bei 0 TP gehst du zu Boden. Rast und Heilung bringen sie zurück." },
  ruestung: { title: "Rüstungswert", short: "So schwer bist du zu treffen. Ein Angriff muss mindestens diesen Wert erreichen. Grundwert 10 + Rüstung + Geschick." },
  angriff: { title: "Angriffswurf", short: "W20 + Angriffsbonus. Erreicht das Ergebnis den Rüstungswert des Gegners, triffst du – der Schaden wird dann gleich mitgewürfelt." },
  schaden: { title: "Schaden", short: "Wie viele Trefferpunkte ein Treffer abzieht. Hängt von der Waffe ab, z. B. 1W8 beim Langschwert." },
  klasse: { title: "Klasse", short: "Der Beruf oder die Berufung deiner Figur, z. B. Ritter oder Kräuterhexe. Sie bestimmt Fähigkeiten, Ausrüstung und Trefferpunkte." },
  stand: { title: "Stand (Herkunft)", short: "Woher deine Figur stammt: Bauernkind, Bürgerkind, Adel … Das gibt dir eine Fertigkeit und Startgeld." },
  stufe: { title: "Stufe", short: "Wie erfahren deine Figur in dieser Kampagne ist (1 bis 10). Für Kapitel, Aufträge und überstandene Gefahren gibt es Erfahrung; jede Stufe bringt mehr Trefferpunkte, Stufe 4 eine neue Fertigkeit, Stufe 7 stärkere Attribute, Stufe 10 mehr Können. Jede neue Kampagne beginnt bei Stufe 1." },
  trefferwuerfel: { title: "Trefferwürfel", short: "Bestimmt, wie viele Trefferpunkte deine Klasse hat. Ein Ritter (W10) hält mehr aus als eine Kräuterhexe (W6)." },
  rast: { title: "Rast", short: "Eine Pause zum Durchatmen. Eine kurze Rast heilt einen Trefferwürfel plus Konstitution, eine Nacht Schlaf alle Trefferpunkte. Manche Fähigkeiten kannst du danach wieder einsetzen." },
  fair: { title: "Fairer Wurf", short: "Das Ergebnis würfelt der Server mit kryptografischem Zufall, bevor die Animation startet. Weder du noch der Spielleiter können es ändern oder neu würfeln." },
};

export function term(key: string, text?: string): Raw {
  const t = GLOSSARY[key];
  return html`<span class="term" tabindex="0" data-term="${key}">${text ?? t?.title ?? key}</span>`;
}
