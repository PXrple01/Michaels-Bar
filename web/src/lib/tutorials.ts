// Inhalte der Einführungen – bewusst in einfacher Sprache, mit Beispielen.
import type { TutorialStep } from "./tutorial";

const PROBE: TutorialStep = {
  icon: "dice", title: "Wenn es spannend wird: würfeln",
  text: "Manchmal ist unklar, ob etwas klappt – zum Beispiel über eine Mauer klettern. Dann erscheint ein Knopf „Würfeln“. Du würfelst einen 20-seitigen Würfel (W20), dazu kommt ein Bonus deiner Figur. Erreichst du die verlangte Zahl, klappt es.",
  example: "Verlangt: 13. Du würfelst 11, Bonus +3 → 14. Geschafft!",
};
const LUCK: TutorialStep = {
  icon: "star", title: "Die 20 und die 1",
  text: "Zeigt der Würfel eine 20, gelingt es immer – und zwar besonders gut. Eine 1 geht immer schief. Gewürfelt wird fair vom Server: Niemand kann das Ergebnis ändern oder neu würfeln, auch Claude nicht.",
};
const FIGHT: TutorialStep = {
  icon: "sword", title: "Kämpfe",
  text: "Kommt es zum Kampf, erscheinen rechts die Gegner mit Lebensbalken und Rüstung (auf dem Handy oben unter „Gegner“). Greifst du an, würfelst du – triffst du, würfelst du danach den Schaden. Greifen Gegner an, würfelt der Server für sie, und du siehst den Wurf in der Geschichte.",
  example: "Du schreibst: „Ich schlage mit dem Schwert nach dem Räuber.“",
};
const HP: TutorialStep = {
  icon: "heart", title: "Lebenspunkte",
  text: "Die Lebenspunkte (TP) zeigen, wie viel deine Figur noch aushält. Wird sie verletzt, sinken sie. Bei 0 TP ist sie bewusstlos – aber nicht tot. Eine Rast, Kräuter oder Heilkunde bringen die Punkte zurück.",
  example: "Du schreibst: „Wir schlagen ein Lager auf und ruhen uns aus.“",
};
const QUESTS: TutorialStep = {
  icon: "scroll", title: "Auftragsbuch",
  text: "Links findest du deine Figur, den Fortschritt der Kampagne und das Auftragsbuch (auf dem Handy oben unter „Deine Figur“). Rechts steht dein Kernauftrag – also worum es gerade geht. Bekommst du eine Aufgabe, trägt der Spielleiter sie ins Auftragsbuch ein. Dort steht auch, was er sich gemerkt hat – Namen, Versprechen, Geheimnisse. So geht in langen Geschichten nichts verloren. Für erledigte Aufträge gibt es Erfahrungspunkte (EP).",
};
const GROWTH: TutorialStep = {
  icon: "star", title: "Erfahrung zahlt sich aus",
  text: "Für abgeschlossene Kapitel, gelöste Aufträge und überstandene Gefahren gibt es Erfahrungspunkte (EP). Damit steigst du bis Stufe 10 auf: Jede Stufe bringt mehr Lebenspunkte, Stufe 4 eine neue Fertigkeit, Stufe 7 stärkere Attribute. Zweimal in der Kampagne – einmal in der Mitte, einmal im Finale – entwickelt sich dadurch eine Fähigkeit deiner Figur weiter. Welche, verrät der Spielleiter erst dann. Du bekommst zwei Möglichkeiten und wählst eine; manchmal passt eine davon genau zu eurer Lage.",
};
const ABILITIES: TutorialStep = {
  icon: "sparkles", title: "Deine Fähigkeiten",
  text: "Ganz unten auf der Seite stehen die besonderen Fähigkeiten deiner Figur – mit einer einfachen Erklärung. Willst du eine benutzen, schreib es einfach in deine Handlung. Manche gehen nur einmal pro Kampf oder Rast, passive wirken immer von selbst.",
  example: "Du schreibst: „Ich setze meinen Schildwall ein und schütze Agnes.“",
};

export const SOLO_TUTORIAL: TutorialStep[] = [
  { icon: "feather", title: "Willkommen im Abenteuer!", text: "Du spielst eine Figur in einer Geschichte. Claude ist der Spielleiter: Er erzählt, was passiert, und spricht für alle anderen Personen. Du entscheidest, was deine Figur tut. Es gibt kein Falsch – nur eine Geschichte, die ihr zusammen erzählt." },
  { icon: "play", title: "So läuft ein Zug", text: "1. Lies, was der Spielleiter erzählt. 2. Schreib unten in das Feld, was deine Figur tut oder sagt – in ganz normalen Worten. 3. Drück Enter. Dann erzählt der Spielleiter, was daraufhin passiert.", example: "Du schreibst: „Ich frage den Wirt, ob er den Fremden gesehen hat.“" },
  { icon: "sparkles", title: "Du darfst alles versuchen", text: "Unter der Geschichte stehen manchmal Ideen zum Antippen. Das sind nur Hilfen für den Anfang – du kannst jederzeit etwas ganz anderes tun: reden, schleichen, verhandeln, weglaufen …" },
  PROBE, LUCK, FIGHT, HP, QUESTS, GROWTH, ABILITIES,
  { icon: "check", title: "Fertig – los geht's!", text: "Dein Spielstand wird automatisch gespeichert. Du kannst jederzeit aufhören und später weiterspielen. Diese Einführung öffnest du wieder über das „?“ oben." },
];

export const PARTY_TUTORIAL: TutorialStep[] = [
  { icon: "users", title: "Willkommen in der Gruppe!", text: "Ihr spielt zusammen eine Geschichte – jede Person mit ihrer eigenen Figur, auf ihrem eigenen Gerät. Claude ist der Spielleiter: Er erzählt, was passiert, und spricht für alle anderen Personen." },
  { icon: "play", title: "So läuft eine Runde", text: "1. Alle lesen, was der Spielleiter erzählt. 2. Jede Person schreibt unten, was ihre Figur tut – in ganz normalen Worten. 3. Sobald alle abgegeben haben, erzählt der Spielleiter, was passiert – für alle zusammen.", example: "Du schreibst: „Ich lenke die Wache ab, während Agnes durch das Tor schlüpft.“" },
  { icon: "lock", title: "Abgegeben ist abgegeben", text: "Hast du deine Handlung abgeschickt, kannst du sie nicht mehr ändern. Überleg also kurz – ihr könnt euch auch vorher absprechen. Wer gerade noch tippt, wird dabei nicht gestört." },
  { icon: "users", title: "Links: euer Team", text: "Dort siehst du, auf wen noch gewartet wird, wie viele Lebenspunkte jede Figur hat und kleine Symbole für ihre Fähigkeiten. Tippe auf ein Symbol, um zu sehen, was deine Mitspieler können. Rechts stehen Gegner und euer Kernauftrag. Auf dem Handy tippst du oben auf „Team“ bzw. „Ziel“, um die Leisten zu öffnen." },
  { icon: "crown", title: "Der Gastgeber", text: "Wer die Gruppe gegründet hat, ist Gastgeber (Krone). Er kann die Runde auch früher erzählen lassen, wenn jemand gerade nicht da ist." },
  { ...PROBE, text: PROBE.text + " Der Spielleiter sagt dabei, wer würfeln muss – nur diese Person sieht den Knopf, alle anderen schauen beim Wurf zu." },
  LUCK, FIGHT, HP, QUESTS, GROWTH, ABILITIES,
  { icon: "check", title: "Fertig – los geht's!", text: "Der Spielstand liegt auf dem Server – ihr könnt jederzeit über den Gruppen-Link zurückkommen. Diese Einführung öffnest du wieder über das „?“ oben." },
];
