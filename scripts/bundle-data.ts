// Prüft alle Regeldateien und bündelt sie in eine Datei für die Netlify-Funktion.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadGameData } from "../server/rules/loader";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const data = await loadGameData(path.join(root, "data"));
await mkdir(path.join(root, "server/generated"), { recursive: true });
await writeFile(path.join(root, "server/generated/gamedata.json"), JSON.stringify(data));
console.log(`✔ Regeldaten gebündelt: ${data.classes.length} Klassen`);
