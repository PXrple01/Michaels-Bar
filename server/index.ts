import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app";
import { createGameMaster } from "./gm/setup";
import { MemoryCounterStore } from "./gm/usage";
import { MemoryRollStore, RollLog } from "./dice/log";
import { loadGameData, RulesError, type GameData } from "./rules/loader";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Optionale .env-Datei (ANTHROPIC_API_KEY usw.)
try { process.loadEnvFile(path.join(root, ".env")); } catch { /* keine .env vorhanden */ }

/** Geheimnis zum Signieren von Spielständen; lokal einmal erzeugt und gespeichert. */
function localSecret(): string {
  if (process.env.GAME_SECRET) return process.env.GAME_SECRET;
  const file = path.join(root, "saves", ".game-secret");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  const s = randomBytes(32).toString("base64url");
  writeFileSync(file, s, { mode: 0o600 });
  return s;
}

const PORT = Number(process.env.PORT ?? 3001);
// Nur lokal erreichbar – der Server wird nicht ins Netz gestellt.
const HOST = process.env.HOST ?? "127.0.0.1";

let data: GameData;
try {
  data = await loadGameData(path.join(root, "data"));
} catch (e) {
  if (e instanceof RulesError) {
    console.error(`\n✖ Regeldateien fehlerhaft – Server startet nicht.\n\n${e.message}\n`);
    process.exit(1);
  }
  throw e;
}

const rolls = new RollLog(new MemoryRollStore(path.join(root, "saves", "rolls.log")));
const gm = createGameMaster(process.env, () => data, rolls, new MemoryCounterStore(), localSecret());
const app = createApp({
  data: () => data,
  rolls,
  staticDir: path.join(root, "dist", "web"),
  gm: () => gm,
  accessCode: process.env.ACCESS_CODE,
});

app.listen(PORT, HOST, () => {
  console.log(`✔ ${data.rules.name}: ${data.classes.length} Klassen geladen, Magie: ${data.campaign.magic_level}`);
  console.log(`✔ Server läuft auf http://${HOST}:${PORT}`);
  console.log(process.env.ANTHROPIC_API_KEY ? "✔ Spielleiter bereit (Claude)" : "ℹ Kein ANTHROPIC_API_KEY – Abenteuer sind deaktiviert, alles andere läuft.");
});
