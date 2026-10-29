// Schnellstart: mit einem Klick eine zufällige, spielbereite Figur (empfohlene Werte der Klasse) und ein neues Solo-Abenteuer.
import type { CampaignSave, Opening } from "../../../shared/campaign";
import { api, loadGameData } from "./api";
import { campaignStore } from "./campaigns";
import { uuid } from "./dom";
import { imagesEnabled, paintPortrait } from "./portraits";
import { go } from "./router";
import { toast } from "./ui";

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];
const shuffle = <T>(list: readonly T[]): T[] => [...list].sort(() => Math.random() - 0.5);

const NAMES_M = ["Konrad", "Ulrich", "Heinrich", "Gottfried", "Berthold", "Ruprecht", "Wendelin", "Dietrich", "Lambert", "Matthias", "Eberhard", "Kaspar"];
const NAMES_F = ["Agnes", "Mechthild", "Adelheid", "Gertrud", "Hildegard", "Kunigunde", "Irmgard", "Liutgard", "Margarete", "Elsbeth", "Walburga", "Richenza"];
const HAIR = ["rotblondem", "pechschwarzem", "aschblondem", "kastanienbraunem", "früh ergrautem", "kurz geschorenem"];
const EYES = ["wachen grauen", "dunklen", "hellblauen", "grünen", "bernsteinfarbenen"];
const MARKS = ["einer alten Narbe über der Braue", "Sommersprossen", "schwieligen Händen", "einem geflickten Umhang", "einem abgegriffenen Amulett um den Hals", "einem schiefen Zahn, der beim Lächeln blitzt"];
const TRAITS = ["Neugierig und vorlaut", "Ruhig, aber unbeugsam", "Misstrauisch gegenüber Fremden", "Großherzig und leicht zu rühren", "Abergläubisch und vorsichtig", "Prahlerisch, aber mutig"];
const IDEALS = ["Jeder verdient eine zweite Chance.", "Treue über alles.", "Wissen ist mächtiger als das Schwert.", "Die Schwachen schützen.", "Freiheit – niemandem gehorchen müssen."];
const FLAWS = ["Kann einem Würfelspiel nie widerstehen.", "Verliert schnell die Geduld.", "Traut niemandem ganz.", "Redet zuerst und denkt später.", "Hat Angst im Dunkeln."];

let running = false;

export async function quickStart() {
  if (running) return;
  running = true;
  try {
    const data = await loadGameData();
    const cls = pick(data.classes);
    const female = Math.random() < 0.5;
    const name = pick(female ? NAMES_F : NAMES_M);
    const created = await api.createCharacter({
      name,
      stand: pick(data.rules.stands).id,
      classId: cls.id,
      attributes: cls.recommendedAttributes,
      chosenSkills: shuffle(cls.skillChoices.from).slice(0, cls.skillChoices.count),
      personality: { trait: pick(TRAITS), ideal: pick(IDEALS), bond: "", flaw: pick(FLAWS) },
      appearance: `${female ? "Eine Frau" : "Ein Mann"} mit ${pick(HAIR)} Haar, ${pick(EYES)} Augen und ${pick(MARKS)}.`,
    });
    // Porträt im Hintergrund (falls Bilder eingerichtet) – es dient später als Vorlage für Szenenbilder
    void imagesEnabled().then(async (on) => { if (on) await paintPortrait(created); }).catch(() => {});
    const now = new Date().toISOString();
    const save: CampaignSave = {
      id: uuid(), characterId: created.id, title: "Eine neue Chronik", opening: null as unknown as Opening, openingSummary: "",
      state: { messages: [], characterHash: "", sig: "" }, pending: null, story: [], started: false, createdAt: now, updatedAt: now,
    };
    campaignStore.save(save);
    toast(`${created.name}, ${cls.name}, zieht los!`, "success", 4000);
    go(`/abenteuer/${save.id}?neu`);
  } catch (e) {
    toast(`Schnellstart hat nicht geklappt: ${(e as Error).message}`, "error", 6000);
  } finally {
    running = false;
  }
}
