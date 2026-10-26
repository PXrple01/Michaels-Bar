# Würfel & Schicksal

Ein Erzähl-Rollenspiel im mittelalterlichen Europa – im Browser, lokal auf deinem Rechner.
Stand: **Etappe 1 und 2** (Regeln, Würfel-Engine, Charakterbogen, fairer 3D-Würfel).

## Starten

Voraussetzung: [Node.js](https://nodejs.org) ab Version 20.

```bash
npm install
npm run dev
```

Dann **http://localhost:5173** im Browser öffnen.

| Befehl | Zweck |
| --- | --- |
| `npm run dev` | Entwicklung: Server (Port 3001) + Webseite (Port 5173) mit Live-Neuladen |
| `npm start` | Baut die Webseite und startet alles auf **http://localhost:3001** |
| `npm test` | Automatische Tests (Würfel, Regeln, 3D-Geometrie, Animation) |
| `npm run typecheck` | TypeScript-Prüfung |

Der Server lauscht nur auf `127.0.0.1` und ist damit von außen nicht erreichbar.

## Was schon geht

- **Startseite, Anleitung und Lexikon** für Leute, die noch nie ein Rollenspiel gespielt haben – mit interaktivem
  Probe-Labor (Chancen live ausrechnen), Vorteil/Nachteil-Vergleich und Erklärungen per Tooltip.
- **Figur erschaffen** in sechs Schritten: Herkunft, Klasse, Attribute (Punktekauf), Fertigkeiten, Persönlichkeit, Zusammenfassung.
- **Charakterbogen**: Attribute, Fertigkeiten, Angriff und Schaden antippen = würfeln. Trefferpunkte anpassbar.
- **Würfeltisch**: W4, W6, W8, W10, W12, W20, W100 frei kombinieren, Bonus, Vorteil/Nachteil, Wurf-Protokoll.
- **Einstellungen**: Würfelfarbe, Animation (voll/kurz/aus), Qualität (auto/hoch/leicht), Zeitlupe bei 20 und 1, Ton, Hintergrund-Effekte.

## Fairness der Würfel

1. Der **Server** würfelt mit `crypto.getRandomValues` und Rejection Sampling (keine Modulo-Verzerrung).
2. Jeder Wurf hat eine `requestId`. Wird sie erneut gesendet, kommt **derselbe** Wurf zurück – neu würfeln ist nicht möglich.
3. Bei Proben aus dem Charakterbogen rechnet der Server den Bonus aus der **gespeicherten** Figur aus, nicht aus Browser-Angaben.
4. Erst danach startet die Animation: Der Browser simuliert den Wurf unsichtbar mit **cannon-es**. Am Ende wird die Beschriftung
   über eine Symmetriedrehung des Würfelkörpers so ausgerichtet, dass **genau die gewürfelte Zahl oben liegt**. Die Physik bleibt dabei unverändert.
5. Jeder Wurf landet mit ID und Uhrzeit in `saves/rolls.log`.

Die Tests prüfen das für jede Seite jeder Würfelart (`tests/dice3d.test.ts`).

## Dateien zum Anpassen

| Datei | Inhalt |
| --- | --- |
| `data/rules.json` | Attribute, Punktekauf, Stufen, Schwierigkeitsgrade, Fertigkeiten, Stände, Währung, Gegenstände, Grenzen für eigene Klassen |
| `data/campaign.json` | Welt: `magic_level` (`none`/`low`/`medium`/`high`), Ton, Schwierigkeit, Tabus |
| `data/classes/base/*.json` | Die sechs Grundklassen |
| `data/classes/custom/` | Eigene Klassen (ab Etappe 4) |
| `data/openings.json` | Startimpuls-Tabellen (Gerüst, gefüllt in Etappe 3) |

Beim Start prüft der Server alle Dateien gegen ein Schema und auf Widersprüche (z. B. unbekannte Gegenstände, ungültige
Trefferwürfel, Empfehlungen über dem Punkte-Budget). Ist etwas fehlerhaft, startet er nicht und nennt die Stelle.

## Aufbau

```
server/   Express-Server: Regeln laden, Würfel-Engine, Figuren speichern, API
shared/   Gemeinsamer Code: Schemas, Würfelnotation, Regelberechnungen
web/      Webseite (Vite + TypeScript, Three.js, cannon-es)
  src/dice3d/   Geometrie, Physik-Simulation, Texturen, 3D-Bühne, Ton
  src/pages/    Start, Lernen, Figuren, Assistent, Bogen, Würfeltisch, Einstellungen
data/     Regeln und Klassen (JSON)
saves/    Gespeicherte Figuren und Wurf-Protokoll (nicht im Git)
tests/    Vitest
```

## Nächste Etappen

3. Claude als Spielleiter (Streaming, Tool Use), Startimpulse, Kampagnenstart
4. Klassen-Editor mit Claude-Bewertung und Code-Validierung
5. Kampfsystem, Gedächtnis, Quests
6. Oberfläche, Speichern/Laden, Kostenlimit
