import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app";
import { MemoryRollStore, RollLog } from "./dice/log";
import { loadGameData, RulesError, type GameData } from "./rules/loader";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

const app = createApp({
  data: () => data,
  rolls: new RollLog(new MemoryRollStore(path.join(root, "saves", "rolls.log"))),
  staticDir: path.join(root, "dist", "web"),
});

app.listen(PORT, HOST, () => {
  console.log(`✔ ${data.rules.name}: ${data.classes.length} Klassen geladen, Magie: ${data.campaign.magic_level}`);
  console.log(`✔ Server läuft auf http://${HOST}:${PORT}`);
});
