// Namen für Nebenfiguren: großer Vorrat aus dem Spätmittelalter (Heiliges Römisches Reich um 1400), damit sich Namen
// zwischen Kampagnen nicht ständig wiederholen. Claude bekommt je Abenteuer frische Vorschläge und die Namen früherer
// Abenteuer als „schon vergeben“.

const WOMEN = [
  "Adelgunde", "Agathe", "Alheit", "Amalberga", "Anna", "Beatrix", "Bertrada", "Brigida", "Christina", "Cunegundis", "Diemut", "Dorothea",
  "Ebba", "Elsbeth", "Engelburg", "Ermentrud", "Eufemia", "Fridrun", "Gerburg", "Gerhild", "Gertrud", "Gunda", "Hadwig", "Heilka",
  "Hildegund", "Hiltrud", "Ida", "Ilsabe", "Imma", "Irmentrud", "Jutta", "Katharina", "Kriemhild", "Kunelin", "Lukarde", "Margarete",
  "Mathilde", "Mechtild", "Metze", "Minna", "Odila", "Osanna", "Ottilie", "Petrissa", "Radegund", "Reinhild", "Richardis", "Rotraut",
  "Salome", "Sophia", "Swanhild", "Tiburg", "Udalhild", "Ursel", "Uta", "Veronika", "Waltraud", "Wendelgard", "Wiborada", "Wilburg",
  "Yrmel", "Zita", "Gela", "Grete", "Hille", "Benigna", "Clementia", "Engel", "Fygen", "Lene", "Neesgin", "Styne", "Bele", "Trude",
];
const MEN = [
  "Adalbero", "Albero", "Arbogast", "Arnold", "Baldewin", "Benno", "Bernward", "Bruno", "Burkhard", "Dankwart", "Diepold", "Ditmar",
  "Ekkehard", "Egino", "Emmerich", "Engelbert", "Erchanger", "Folkmar", "Friedemann", "Gebhard", "Gerlach", "Giselher", "Godehard", "Gunzelin",
  "Hartmut", "Hartwig", "Heimo", "Henning", "Heribert", "Hesso", "Hildebrand", "Hugo", "Ilsung", "Isenbart", "Jobst", "Kilian",
  "Kuno", "Lamprecht", "Leutold", "Lorenz", "Ludolf", "Mangold", "Marquard", "Meinhard", "Nithard", "Odo", "Oswald", "Otmar",
  "Pankraz", "Poppo", "Rainald", "Ratold", "Reimar", "Rudolf", "Rumold", "Ruprecht", "Sebald", "Siboto", "Siegbert", "Tankred",
  "Thiemo", "Tilman", "Udo", "Ulf", "Vinzenz", "Volkold", "Walram", "Wernher", "Wigand", "Wilbrand", "Wolfhelm", "Zacharias",
  "Hensel", "Kunz", "Heinz", "Lutz", "Utz", "Fritz", "Klaus", "Jörg", "Veit", "Gerke", "Matthes", "Bastian", "Jost", "Endres",
];
const BYNAMES = [
  "Rotbart", "Eisenhut", "Krummfinger", "vom Lindenhof", "Schwarzmüller", "Hasenfuß", "der Lange", "die Rote", "Habenichts", "Silberzunge",
  "vom Moorbach", "Bärenklau", "Wolfsbein", "Kesselflicker", "Pfennigfuchs", "Einaug", "Ohnesorg", "von der Furt", "Gänsehirt", "Sauerbier",
  "Lindwurm", "Kupferschmied", "Distelfink", "Hagedorn", "Bleichgesicht", "Steinbeißer", "Nebelkrähe", "vom Galgenberg", "Fischbein", "Grauwolf",
  "Mausezahn", "Brennessel", "Zwiebelhans", "Schlüsselmeister", "Pechvogel", "Rabenstein", "vom Salzweg", "Hufnagel", "Weidenkorb", "Mondkalb",
];
/** Häufige Namen, die Claude ohnehin gern nimmt – im Vorrat ausgelassen, damit es nicht immer dieselben werden. */
const OVERUSED = ["Anselm", "Konrad", "Agnes", "Mechthild", "Berthold", "Ulrich", "Gottfried", "Heinrich", "Johann", "Elisabeth", "Hedwig", "Wolfram", "Dietrich", "Gisela", "Matthias", "Martha"];

/** Zufällig, aber deterministisch mit eigener Zufallsquelle (z. B. Math.random oder die Würfel-RNG). */
export function freshNames(n: number, avoid: string[] = [], rng: (max: number) => number = (m) => Math.floor(Math.random() * m)): string[] {
  const used = new Set([...avoid, ...OVERUSED].map((x) => x.split(/\s+/)[0].toLowerCase()));
  const pool = [...WOMEN, ...MEN].filter((x) => !used.has(x.toLowerCase()));
  const out: string[] = [];
  while (out.length < n && pool.length) {
    const name = pool.splice(rng(pool.length), 1)[0];
    // Jeder dritte Name mit Beinamen – klingt lebendiger und unterscheidet Gleichnamige
    out.push(out.length % 3 === 2 ? `${name} ${BYNAMES[rng(BYNAMES.length)]}` : name);
  }
  return out;
}

/** Text für Claude: Namen früherer Abenteuer meiden, frische Vorschläge nutzen. */
export function namesBlock(previous: string[], suggestions: string[]): string {
  const prev = [...new Set(previous.map((x) => x.trim()).filter(Boolean))].slice(-80);
  return `<namen>
${prev.length ? `Schon vergeben (aus früheren Abenteuern dieses Spielers – NICHT wiederverwenden, auch nicht leicht abgewandelt): ${prev.join(", ")}\n` : ""}Namensvorrat für dieses Abenteuer: ${suggestions.join(", ")}
Nimm für neue Nebenfiguren bevorzugt Namen aus dem Vorrat oder erfinde ähnlich ausgefallene, zeittypische Namen (mit Beinamen, Herkunft oder Beruf). Vermeide Allerweltsnamen wie ${OVERUSED.slice(0, 6).join(", ")}. Jede Figur einer Kampagne bekommt einen eigenen, unverwechselbaren Namen.
</namen>`;
}

/** Namensliste aus der Anfrage (vom Browser) – nur kurze Texte, höchstens 80. */
export const cleanNames = (raw: unknown): string[] => (Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, 40)).filter(Boolean).slice(-80) : []);
