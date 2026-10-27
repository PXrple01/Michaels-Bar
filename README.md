# Würfel & Schicksal

Ein Erzähl-Rollenspiel im mittelalterlichen Europa – im Browser, lokal auf deinem Rechner.
Stand: **Etappe 1 bis 3** (Regeln, Würfel-Engine, Charakterbogen, fairer 3D-Würfel, Claude als Spielleiter).

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
| `ACCESS_CODE` | dringend empfohlen | Zugangscode, den Spieler einmal eingeben – sonst kann jeder auf deine Kosten spielen |
| `MONTHLY_BUDGET_USD` | nein (10) | Harte Kostengrenze pro Monat |
| `TURNS_PER_HOUR` | nein (60) | Züge pro Stunde und Besucher |
| `GM_EFFORT` | nein (`low`) | Denktiefe: `low`, `medium`, `high` (höher = langsamer und teurer) |

Netlify Blobs (Wurf-Protokoll, Budgetzähler) ist automatisch dabei.

**Wo liegen die Daten?**
- *Figuren* speichert jeder Besucher in seinem eigenen Browser (localStorage). Sie gehen verloren, wenn die Browserdaten
  gelöscht werden. Bei jeder Probe schickt der Browser die Figur mit; der Server prüft sie gegen die Regeln und rechnet den Bonus selbst.
- *Würfe* entstehen in der Netlify Function. Jede Wurf-ID wird in Netlify Blobs gespeichert, sodass niemand neu würfeln kann.
- *Abenteuer* liegen ebenfalls im Browser. Der Server signiert den Spielverlauf (HMAC); verändert jemand ihn oder tauscht die
  Figur aus, spielt der Server nicht weiter.
- Konten und Cloud-Speicherung (z. B. mit Supabase) folgen später.

## Was schon geht

- **Startseite, Anleitung und Lexikon** für Leute, die noch nie ein Rollenspiel gespielt haben – mit interaktivem
  Probe-Labor (Chancen live ausrechnen), Vorteil/Nachteil-Vergleich und Erklärungen per Tooltip.
- **Figur erschaffen** in sechs Schritten: Herkunft, Klasse, Attribute (Punktekauf), Fertigkeiten, Persönlichkeit, Zusammenfassung.
- **Charakterbogen**: Attribute, Fertigkeiten, Angriff und Schaden antippen = würfeln. Trefferpunkte anpassbar. Figuren liegen im Browser.
- **Würfeltisch**: W4, W6, W8, W10, W12, W20, W100 frei kombinieren, Bonus, Vorteil/Nachteil, Wurf-Protokoll.
- **Einstellungen**: Würfelfarbe, Animation (voll/kurz/aus), Qualität (auto/hoch/leicht), Zeitlupe bei 20 und 1, Ton, Hintergrund-Effekte.

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
| `data/classes/custom/` | Eigene Klassen (ab Etappe 4) |
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
server/gm/ Spielleiter: Startimpuls, Prompt, Tool-Use-Schleife, Signatur, Budget
netlify/  Netlify Functions: api (Regeln, Würfe) und gm (Spielleiter, gestreamt)
scripts/  Regeldaten prüfen und für Netlify bündeln
saves/    Lokales Wurf-Protokoll (nicht im Git)
tests/    Vitest
```

## Nächste Etappen

4. Klassen-Editor mit Claude-Bewertung und Code-Validierung
5. Kampfsystem, Gedächtnis, Quests
6. Oberfläche, Speichern/Laden, Kostenlimit
