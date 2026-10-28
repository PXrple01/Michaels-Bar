# The Last Ember

Ein Erzähl-Rollenspiel im mittelalterlichen Europa – im Browser, lokal auf deinem Rechner.
Stand: **fertig** – Regeln, Würfel-Engine, Charakterbogen, fairer 3D-Würfel, Claude als Spielleiter, eigene Klassen, Kampf, Gedächtnis und Aufträge, Gruppen, Konten mit Speicherung, zwei Farbthemen.

## Starten

Voraussetzung: [Node.js](https://nodejs.org) ab Version 20.

```bash
npm install
npm run dev
```

Dann **http://localhost:5173** im Browser öffnen.

Für Abenteuer mit Claude als Spielleiter: `.env.example` nach `.env` kopieren und `ANTHROPIC_API_KEY` eintragen.
Ohne Schlüssel läuft alles andere (Figuren, Würfeltisch, Anleitung) ganz normal.

| Befehl | Zweck |
| --- | --- |
| `npm run dev` | Entwicklung: Server (Port 3001) + Webseite (Port 5173) mit Live-Neuladen |
| `npm start` | Baut die Webseite und startet alles auf **http://localhost:3001** |
| `npm run build` | Prüft und bündelt die Regeldaten, baut die Webseite nach `dist/web` (so baut auch Netlify) |
| `npm test` | Automatische Tests (Würfel, Regeln, 3D-Geometrie, Animation) |
| `npm run typecheck` | TypeScript-Prüfung |

Der lokale Server lauscht nur auf `127.0.0.1` und ist damit von außen nicht erreichbar.

## Online stellen mit Netlify

Die Seite ist fertig für [Netlify](https://www.netlify.com): Die Webseite wird statisch ausgeliefert, gewürfelt wird in einer
Netlify Function (`netlify/functions/api.ts`). Einstellungen stehen in `netlify.toml`.

**Variante A – über GitHub (empfohlen):**
1. Projekt in ein GitHub-Repository hochladen.
2. Bei Netlify: *Add new site → Import an existing project →* Repository wählen.
3. Netlify liest `netlify.toml` selbst (Build: `npm run build`, Ordner: `dist/web`). Auf *Deploy* klicken – fertig.

**Variante B – ohne GitHub, per Kommandozeile:**
```bash
npm install
npx netlify-cli login
npx netlify-cli deploy --build --prod
```

**Umgebungsvariablen** (Netlify → *Site configuration → Environment variables*, danach neu veröffentlichen):

| Name | Pflicht | Zweck |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | für Abenteuer | Claude als Spielleiter |
| `GAME_SECRET` | für Abenteuer | Langes Zufallsgeheimnis (≥ 16 Zeichen), signiert die Spielstände |
| `ADMIN_USER` | optional | Dein Benutzername – nur dieses Konto darf Figuren aus Gruppen wiederherstellen |
| `ACCESS_CODE` | dringend empfohlen | Einladungscode: Wer ein Konto erstellen will, braucht ihn einmal – sonst kann jeder ein Konto anlegen und auf deine Kosten spielen. Angemeldete brauchen ihn danach nicht mehr. |
| `MONTHLY_BUDGET_USD` | nein (10) | Harte Kostengrenze pro Monat |
| `TURNS_PER_HOUR` | nein (60) | Züge pro Stunde und Besucher |
| `GM_EFFORT` | nein (`low`) | Denktiefe: `low`, `medium`, `high` (höher = langsamer und teurer) |
| `GM_MODEL` | nein (`claude-opus-5-5`) | Modell des Spielleiters |
| `REVIEW_MODEL` | nein (wie `GM_MODEL`) | Modell für die Klassenbewertung |

Netlify Blobs (Wurf-Protokoll, Budgetzähler) ist automatisch dabei.

**Wo liegen die Daten?**
- *Figuren* speichert jeder Besucher in seinem eigenen Browser (localStorage). Sie gehen verloren, wenn die Browserdaten
  gelöscht werden. Bei jeder Probe schickt der Browser die Figur mit; der Server prüft sie gegen die Regeln und rechnet den Bonus selbst.
- *Würfe* entstehen in der Netlify Function. Jede Wurf-ID wird in Netlify Blobs gespeichert, sodass niemand neu würfeln kann.
- *Abenteuer* liegen ebenfalls im Browser. Der Server signiert den Spielverlauf (HMAC); verändert jemand ihn oder tauscht die
  Figur aus, spielt der Server nicht weiter.

## Konten

- Jede Person meldet sich mit **Benutzername und Passwort** an (keine E-Mail). Ohne Anmeldung zeigt die Seite nur die Anmeldung.
- Figuren, eigene Klassen, Abenteuer mit ihrer Geschichte, Gruppen und Einstellungen werden **im Konto gespeichert**
  und stehen auf jedem Gerät bereit. Online liegen sie in Netlify Blobs (Speicher „accounts“), lokal in `saves/accounts/`.
- Passwörter werden nur als scrypt-Hash gespeichert; nach 10 Fehlversuchen ist ein Name 15 Minuten gesperrt.
- **Export/Import** in den Einstellungen: alle Spielstände als Datei sichern und in ein (anderes) Konto übernehmen.
- **Spielstände von vor den Konten** (im Browser gespeichert) werden nach der ersten Anmeldung erkannt und lassen sich mit einem Klick übernehmen.
- **Figuren aus Gruppen zurückholen** (nur Betreiber): Mit `ADMIN_USER` = eigener Benutzername erscheint in den Einstellungen eine Liste aller Gruppen-Figuren auf dem Server; ein Klick holt eine Figur (mit eigener Klasse) ins Konto und gibt wieder Zugang zu ihrer Gruppe.
- Ein vergessenes Passwort lässt sich nicht zurücksetzen (es gibt keine E-Mail) – daher im Zweifel regelmäßig exportieren.

## Funktionen

- **Startseite, Anleitung und Lexikon** für Leute, die noch nie ein Rollenspiel gespielt haben – mit interaktivem
  Probe-Labor (Chancen live ausrechnen), Vorteil/Nachteil-Vergleich und Erklärungen per Tooltip.
- **Figur erschaffen** in sechs Schritten: Herkunft, Klasse, Attribute (Punktekauf), Fertigkeiten, Persönlichkeit, Zusammenfassung.
- **Charakterbogen**: Attribute, Fertigkeiten, Angriff und Schaden antippen = würfeln. Trefferpunkte ändern sich nur im Abenteuer. Figuren liegen im Browser.
- **Würfeltisch**: W4, W6, W8, W10, W12, W20, W100 frei kombinieren, Bonus, Vorteil/Nachteil, Wurf-Protokoll.
- **Einstellungen**: Würfelfarbe, Animation (voll/kurz/aus), Qualität (auto/hoch/leicht), Zeitlupe bei 20 und 1, Ton, Hintergrund-Effekte.

## Solo und Mehrspieler

- **Solo:** Du und der Spielleiter. Der Spielstand liegt im Browser und ist vom Server signiert.
- **Mehrspieler (Gruppe):** Unter *Abenteuer → Mit Freunden spielen* gründest du eine Gruppe und teilst den 6-stelligen Code
  oder Link. Bis zu 4 Personen treten mit ihrer Figur bei. Der Spielstand liegt auf dem Server (Netlify Blobs, lokal im Speicher).
  - Jede Runde legen alle ihre Handlung fest; dann erzählt der Spielleiter die Runde. Der Gastgeber kann auch früher erzählen lassen.
  - Proben verlangt Claude für eine bestimmte Figur – nur diese Person kann würfeln, alle anderen sehen den Wurf als 3D-Animation.
  - Mitspieler lesen die Erzählung fast live mit (die Seite fragt alle paar Sekunden nach).
  - Hinweis zu Netlify: Das Nachfragen zählt als Funktionsaufruf (kostenloser Tarif: 125 000 pro Monat – reicht für viele Spielabende).

## Kosten

- Der Spielleiter nutzt Claude Opus 5.5 (beste Qualität). Prompt-Caching mit **1 Stunde** Haltezeit: Der bisherige Verlauf kostet
  bei jedem Zug nur ein Zehntel – auch wenn jemand länger überlegt.
- Im Spiel siehst du die Kosten des letzten Zugs; im Netlify-Funktionslog steht die Aufschlüsselung (Eingabe, Cache, Ausgabe).
- Optional: `GM_MODEL` (`claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`) und `REVIEW_MODEL` für die Klassenbewertung.
  Sonnet kostet etwa die Hälfte, Haiku etwa ein Vierzigstel – bei schlichterer Erzählung.

## Claude als Spielleiter

- **Modell:** Claude Opus 5.5, Antworten werden live gestreamt (lokal per Express, online als Netlify-Streaming-Funktion `netlify/functions/gm.ts`, bis 60 s pro Zug).
- **Startimpuls:** Der Code würfelt Ort, Zeit/Wetter, Anlass, Begegnung, Konflikt und ein Detail aus `data/openings.json`.
  Die Kurzfassungen früherer Einstiege gehen mit, damit Claude nichts wiederholt. Solange noch nicht gehandelt wurde,
  lässt sich der Einstieg neu würfeln.
- **Proben:** Claude kann nicht würfeln. Es verlangt eine Probe über das Werkzeug `probe_anfordern` (Art, Attribut/Fertigkeit,
  SG, Vorteil/Nachteil, Grund). Du klickst „Würfeln“, der Server würfelt und gibt Claude das Ergebnis. Die Wurf-ID hängt an
  der Probe – erneutes Senden liefert denselben Wurf.
- **Kosten:** Monatsbudget als harte Grenze, Limit pro Stunde, optionaler Zugangscode, Prompt-Caching für Systemprompt und Verlauf.
  Bei einer Sicherheitsablehnung springt automatisch ein Ersatzmodell ein (`fallbacks: "default"`).

## Kampf, Gedächtnis und Aufträge (Etappe 5)

Claude erzählt, der Server rechnet – wie bei den Proben. Dafür hat der Spielleiter Werkzeuge, die der Server sofort ausführt
(`server/gm/world.ts`):

- **Kampf:** `kampf_beginnen` legt Gegner mit Trefferpunkten und Rüstung fest (gedeckelt: höchstens 6 Gegner, 80 TP, Rüstung 8–20).
  Angriffe der Figuren laufen über `probe_anfordern` mit `ziel` – die Rüstung des Gegners ist der SG, der Schaden wird ihm abgezogen,
  eine natürliche 20 verdoppelt die Schadenswürfel. `gegner_greift_an` würfelt der Server (W20 + Bonus bis +8 gegen den Rüstungswert der Figur,
  Schaden höchstens 2W12+5). Gegnerwürfe erscheinen mitten in der Erzählung.
- **Lebenspunkte:** Bei 0 TP ist eine Figur kampfunfähig, nicht tot. `heilen` (Würfel bis 2W8+5) und `rast` (kurz: Trefferwürfel + Konstitution,
  lang: alles) bringen sie zurück – nie über das Maximum.
- **Auftragsbuch und Gedächtnis:** `auftrag` (neu, Notiz, erledigt, gescheitert) und `merken` (bis zu 30 Tatsachen). Das Auftragsbuch steht
  oben im Spiel. Jede Handlung bekommt einen kurzen `<spielstand>` angehängt, damit Claude nichts vergisst.
- **Erfahrung:** `erfahrung` vergibt 10–300 EP pro Anlass. Stufenaufstiege kommen später.
- **Lange Abenteuer** werden ab etwa 80 000 Eingabe-Tokens serverseitig zusammengefasst (Compaction) – das hält die Kosten pro Zug stabil.
- Der Spielstand (Lebenspunkte, Kampf, Aufträge) ist im Solo-Modus mitsigniert, in der Gruppe liegt er auf dem Server.
  Abenteuer von vor Etappe 5 werden beim nächsten Zug einmalig umgestellt.

## Kampagne in Akten und Kapiteln

Jede Kampagne ist lang wie eine typische DnD-Kampagne – aber sie hat ein Ende (`shared/world.ts`, Werkzeuge in `server/gm/world.ts`).

- **Plan:** Im ersten Zug legt Claude mit `kampagne_planen` ein Ziel, eine Bedrohung und eine lineare Folge von Kapiteln an:
  Anfang 2–4, Mitte 3–6, Finale 2–3 Kapitel. Den Plan sehen die Spieler nicht; Claude bekommt ihn bei jedem Zug im
  `<spielstand>` zurück – auch nach einer automatischen Zusammenfassung.
- **Kapitel statt Züge:** Wie lange ein Kapitel dauert, entscheiden die Spieler. Ist sein Ziel erreicht (egal auf welchem Weg),
  schließt Claude es mit `kapitel_abschliessen` ab; nach dem letzten Kapitel eines Akts beginnt der nächste.
- **Abzweigungen:** Verlassen die Spieler den Plan, schiebt Claude mit `abzweigung` ein Kapitel ein – mit festgelegtem Weg zurück
  zur Hauptlinie; das unterbrochene Kapitel folgt danach. Je Akt sind Abzweigungen begrenzt (Anfang 2, Mitte 3, Finale 1).
  Danach haben Entscheidungen Folgen innerhalb des laufenden Kapitels. Umplanen kann einen Akt nicht über seine Höchstzahl
  verlängern. So zieht sich ein Akt durch Entscheidungen in die Länge, aber nie endlos.
- **Lange Kapitel:** Ab 20 Zügen in einem Kapitel bekommt Claude einen unsichtbaren Hinweis, es auf sein Ziel zuzuführen –
  kein harter Schnitt.
- **Ende:** Im letzten Kapitel des Finales erzählt Claude den Ausgang und einen Epilog (`abenteuer_beenden`). Danach nimmt
  der Server keine Handlungen mehr an; die Seite zeigt eine Abschlusskarte mit allen Kapiteln.
- **Anzeige:** Im Spielstand stehen die drei Akte mit je einem Punkt pro Kapitel (kommende Kapitel ohne Titel – keine Spoiler)
  und das laufende Kapitel.

## Grundwerte der Klassen

Nicht jede Figur startet mit 10 in allem: Jede Klasse hat Grundwerte (`attributeMods`), die nach dem Punktekauf auf die
Attribute kommen – z. B. Söldner Stärke +2, Konstitution +1, Verstand −1, Weisheit −1.

- Der Punktekauf bleibt: 12 Punkte ab 10. Die Endwerte dürfen dadurch bis 18 steigen (bzw. bis 6 sinken).
- Je Attribut −2 bis +2, Zuschläge in Summe höchstens +3 (`rules.json → classBuilder.attributeMods`).
- Im Klassen-Editor zählen sie zum Budget: +1 kostet 1 Punkt, −1 gibt 0,5 zurück. Claude schlägt sie im Gutachten mit vor,
  der Code kürzt auf die Grenzen.
- Figuren von vor den Grundwerten behalten ihre Werte (`statsVersion` fehlt) und bleiben gültig.

## Erfahrung und Stufen (nur innerhalb einer Kampagne)

Jede Kampagne beginnt bei Stufe 1 und kann bis Stufe 10 führen (`shared/levels.ts`, Werte in `rules.json → levels`).

- **Erfahrung:** jedes abgeschlossene Kapitel +50, jeder abgeschlossene Akt +100 (vom Server), dazu Claudes Vergaben
  für Aufträge und Gefahren (höchstens 100 pro Vergabe).
- **Schwellen:** 0 / 60 / 130 / 210 / 300 / 400 / 510 / 630 / 760 / 900 EP. Der Kampagnenbogen deckelt: höchstens Stufe 3
  im Anfang, 6 in der Mitte, 9 im Finale; Stufe 10 erst im letzten Kapitel.
- **Wirkung** – insgesamt so stark wie fünf Stufen, nur feiner verteilt:
  - jede Stufe: etwas mehr Trefferpunkte (zusammen vier volle Aufstiege: Trefferwürfel/2 + 1 + KON), sofort dazu;
  - Stufe 4: eine zusätzliche geübte Fertigkeit nach Wahl;
  - Stufe 7: +2 auf ein Attribut oder +1 auf zwei (höchstens 18);
  - Stufe 10: Können-Bonus +3 statt +2;
  - jede Stufe hat einen Titel (Neuling … Legende).
- Claude sieht die Stufen im `<spielstand>` und stimmt Gegner darauf ab. In Chat-Apps (OpenAI-Schnittstelle) trifft der
  Server die Wahl bei Stufe 4 und 7 selbst.

## Verbesserte Fähigkeiten

Zweimal pro Kampagne entwickelt sich eine Fähigkeit weiter (`shared/upgrades.ts`, Claude-Teil in `server/gm/upgrades.ts`).

- **Wann:** einmal im Akt Mitte (ab 200 EP), einmal im Finale (ab 550 EP). Damit es sicher passiert, spätestens im letzten
  Kapitel des Akts – auch mit weniger Erfahrung.
- **Welche:** Bei der ersten Freischaltung wählt Claude die zwei Fähigkeiten, die sich am besten weiterentwickeln lassen;
  in der Mitte wird die erste verbessert, im Finale die zweite. Vorher erfährt der Spieler nicht, welche es sind.
- **Empfehlung im Finale:** Passt es deutlich besser, dass sich die schon verbesserte Fähigkeit ein zweites Mal entwickelt,
  darf Claude das empfehlen. Dann entscheidet der Spieler: zwei Optionen für die zweite Stufe (gemessen am schon
  verbesserten Stand, gleicher Punkte-Rahmen) oder zwei für die geplante Fähigkeit. Ohne Empfehlung gibt es keine zweite Stufe.
- **Wie:** Erst beim Freischalten erfindet Claude zwei Verbesserungen derselben Fähigkeit – passend zur Figur; eine darf zur
  aktuellen Lage passen (z. B. liegt im Kampf ein Gefährte am Boden: Gefallene wieder auf die Beine bringen). Beide müssen
  auch später immer nützlich sein. Der Spieler wählt eine; die Wahl gilt für den Rest der Kampagne.
- **Fair:** Der Code misst die Stärke mit der Punkte-Tabelle des Klassen-Editors: Jede Verbesserung muss +0,5 bis +3 Punkte
  bringen. Würfelgrenzen und verbotene Effekte gelten wie immer. Ungültige Vorschläge gehen einmal mit Begründung an Claude
  zurück; klappt es dann nicht, springt eine maßvolle Ersatz-Verbesserung ein.
- **Kosten:** ein Claude-Aufruf pro Freischaltung und Figur; die Wahl selbst kostet nichts.
- Der Spielleiter sieht die gewählten Verbesserungen in jedem `<spielstand>`. In der Gruppe schaltet jede Person für ihre
  eigene Figur frei; in der Team-Leiste leuchten verbesserte Fähigkeiten golden. Über die OpenAI-Schnittstelle gibt es
  (noch) keine Verbesserungen.

## OpenAI-kompatible Schnittstelle (für Chat-Apps und Programme)

Der Spielleiter ist auch im OpenAI-Format erreichbar (`server/gm/openai.ts`) – für Chat-Apps mit „OpenAI-kompatibler“ Adresse
oder eigene Skripte mit der OpenAI-Bibliothek.

- **Einschalten:** Umgebungsvariable `OPENAI_COMPAT_KEY` anlegen (beliebiger langer Text, in Netlify als geheim markieren).
  Ohne sie antwortet `/v1/…` mit 404. Der Schlüssel ersetzt hier den `ACCESS_CODE`.
- **Adresse:** `https://<deine-seite>/v1` · **Schlüssel:** `Authorization: Bearer <OPENAI_COMPAT_KEY>`
- **Endpunkte:** `GET /v1/models`, `POST /v1/chat/completions` (mit und ohne `stream`, `stream_options.include_usage`).
- **Modelle:** `michaels-bar` (mit Spielstand) und `michaels-bar-einfach` (ohne).
- **Würfeln:** Es gibt keinen Würfeln-Knopf – der Server würfelt verlangte Proben sofort (fair, wie sonst auch) und schreibt
  den Wurf in die Antwort (🎲, Gegnerangriffe ⚔️).
- **Spielstand:** Lebenspunkte, Kampf, Aufträge und Gedächtnis hängen als signierter HTML-Kommentar am Ende jeder Antwort
  (`<!-- michaels-bar:… -->`). Die App schickt ihn mit dem Verlauf zurück; verändert jemand ihn, wird er ignoriert.
  Zeigt eine App den Kommentar sichtbar an, das Modell `michaels-bar-einfach` nehmen (dann beginnt jeder Zug ohne Kampfstand).
- **Figur:** Ohne Angabe spielt der Söldner „Wanderer“. Eigene Figur: Feld `character` (auf dem Charakterbogen
  „Für Chat-Apps kopieren“). Systemnachrichten der App gehen als Hinweise an den Spielleiter (z. B. „Antworte auf Englisch“).
- **Startimpuls:** ergibt sich fest aus der ersten Nachricht – derselbe Anfang, derselbe Einstieg (gut für den Prompt-Cache).
- **Grenzen:** etwa 75 000 Tokens pro Gespräch (dann neu beginnen; die automatische Zusammenfassung gibt es hier nicht),
  höchstens 4 Proben pro Antwort. Monatsbudget und Stundenlimit gelten wie im Spiel.

```bash
curl https://<deine-seite>/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_COMPAT_KEY" -H "content-type: application/json" \
  -d '{"model":"michaels-bar","messages":[{"role":"user","content":"Lass uns ein Abenteuer beginnen!"}]}'
```

## Eigene Klassen (Claude ist Gutachter, der Code ist Richter)

1. Du beschreibst eine Klasse frei und/oder per Formular (Seite *Figuren → Eigene Klassen*).
2. Claude antwortet im festen JSON-Schema (Structured Outputs): Spielwerte, Fähigkeiten mit Regeltext und messbarer Wirkung,
   Stärkeeinschätzung, Probleme, Vorschläge und – falls nötig – einen Gegenvorschlag.
3. `shared/classbuilder.ts` prüft hart gegen `rules.json → classBuilder`: Punktebudget (Stufe 1: 18 Punkte), Trefferwürfel,
   Schadens-/Rüstungs-/Angriffsgrenzen, Fähigkeitstypen, verbotene Effekte. Zu große Werte werden gekürzt, Unzulässiges
   wird abgelehnt – egal, was Claude sagt. Dieselbe Prüfung müssen auch die Grundklassen bestehen.
4. Bis zu 5 Bewertungsrunden pro Entwurf (serverseitig erzwungen).
5. Erst nach deiner Bestätigung signiert der Server die Klasse. Lokal wird sie zusätzlich in `data/classes/custom/` gespeichert,
   online im Browser. Figuren tragen eine signierte Kopie ihrer Klasse – Fälschungen werden abgelehnt.
6. Klassen lassen sich bearbeiten, kopieren, löschen sowie als Datei exportieren und importieren.

## Fairness der Würfel

1. Der **Server** würfelt mit `crypto.getRandomValues` und Rejection Sampling (keine Modulo-Verzerrung).
2. Jeder Wurf hat eine `requestId`. Wird sie erneut gesendet, kommt **derselbe** Wurf zurück – neu würfeln ist nicht möglich.
3. Bei Proben aus dem Charakterbogen prüft der Server die mitgeschickte Figur gegen die Regeln und rechnet den Bonus **selbst** aus – erfundene Boni werden abgelehnt.
4. Erst danach startet die Animation: Der Browser simuliert den Wurf unsichtbar mit **cannon-es**. Am Ende wird die Beschriftung
   über eine Symmetriedrehung des Würfelkörpers so ausgerichtet, dass **genau die gewürfelte Zahl oben liegt**. Die Physik bleibt dabei unverändert.
5. Jeder Wurf wird mit ID gespeichert – lokal in `saves/rolls.log`, online in Netlify Blobs.

Die Tests prüfen das für jede Seite jeder Würfelart (`tests/dice3d.test.ts`).

## Dateien zum Anpassen

| Datei | Inhalt |
| --- | --- |
| `data/rules.json` | Attribute, Punktekauf, Stufen, Schwierigkeitsgrade, Fertigkeiten, Stände, Währung, Gegenstände, Grenzen für eigene Klassen |
| `data/campaign.json` | Welt: `magic_level` (`none`/`low`/`medium`/`high`), Ton, Schwierigkeit, Tabus |
| `data/classes/base/*.json` | Die sechs Grundklassen |
| `data/classes/custom/` | Eigene Klassen (lokal gespeichert, werden beim Start geprüft) |
| `data/openings.json` | Startimpuls-Tabellen (Orte, Zeiten, Anlässe, Personen, Konflikte, Details) |

Beim Start prüft der Server alle Dateien gegen ein Schema und auf Widersprüche (z. B. unbekannte Gegenstände, ungültige
Trefferwürfel, Empfehlungen über dem Punkte-Budget). Ist etwas fehlerhaft, startet er nicht und nennt die Stelle.

## Aufbau

```
server/   Express-Server: Regeln laden, Würfel-Engine, Figuren prüfen, API
shared/   Gemeinsamer Code: Schemas, Würfelnotation, Regelberechnungen
web/      Webseite (Vite + TypeScript, Three.js, cannon-es)
  src/dice3d/   Geometrie, Physik-Simulation, Texturen, 3D-Bühne, Ton
  src/pages/    Start, Lernen, Figuren, Assistent, Bogen, Würfeltisch, Einstellungen
data/     Regeln und Klassen (JSON)
server/gm/ Spielleiter: narrator (Kern), world (Kampf, Aufträge), engine (Solo), party (Gruppe), review (Klassen), Budget
netlify/  Netlify Functions: api (Regeln, Würfe) und gm (Spielleiter, Gruppen, Klassenbewertung, OpenAI-Schnittstelle – gestreamt)
scripts/  Regeldaten prüfen und für Netlify bündeln
saves/    Lokales Wurf-Protokoll (nicht im Git)
tests/    Vitest
```

## Farbthemen

„Glut“ (schwarz-rot, Standard) und „Amethyst“ (das ursprüngliche Lila) – umschaltbar in den Einstellungen. Alle Farben laufen über Palettenwerte in `web/src/styles/base.css`.
