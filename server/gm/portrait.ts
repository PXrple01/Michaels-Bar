// Porträt-Beschreibung: Claude macht aus Klasse, Herkunft und der (oft knappen, deutschen) Aussehens-Beschreibung
// eine genaue englische Bildbeschreibung – das Bildmodell trifft die Figur so deutlich besser.
import type { Character } from "../../shared/schema";
import type { GameData } from "../rules/loader";
import { portraitMotif } from "../images";
import { requestBase, type LlmClient, type ModelId } from "./narrator";
import { costUsd, type UsageGuard } from "./usage";

/** Kleines, günstiges Modell reicht für eine Bildbeschreibung (Bruchteil eines Cents). */
const PORTRAIT_MODEL: ModelId = "claude-haiku-5-5";

const SYSTEM = `You write prompts for an image model that paints head-and-shoulders portraits of characters in a medieval role-playing game (Holy Roman Empire, around 1400, low fantasy).
Turn the character facts into ONE vivid English prompt of 3–5 sentences:
- Follow the player's appearance description exactly (it may be German – translate it). Fill in missing details sensibly and consistently with class and origin: approximate age, face, hair, clothing, armour or tools, one telling detail.
- The facial expression and posture should reflect the personality.
- Head-and-shoulders, facing the viewer, plain dark background.
- No names, no text, no style instructions (the style is added separately).
Answer with the prompt only.`;

export async function portraitPrompt(o: { llm: LlmClient | null; guard: UsageGuard }, c: Character, data: GameData): Promise<{ prompt: string; claudeUsd: number }> {
  const fallback = portraitMotif(c, data);
  if (!o.llm) return { prompt: fallback, claudeUsd: 0 };
  const cls = data.classes.find((x) => x.id === c.classId);
  const stand = data.rules.stands.find((s) => s.id === c.stand);
  const gear = c.equipment.map((id) => data.rules.items.find((i) => i.id === id)?.name).filter(Boolean).join(", ");
  const facts = [
    `Class: ${cls ? `${cls.name} – ${cls.tagline}` : c.classId}`,
    stand ? `Origin: ${stand.name} – ${stand.description}` : "",
    `Appearance (by the player): ${c.appearance.trim() || "(none given – invent something fitting)"}`,
    c.personality.trait ? `Personality trait: ${c.personality.trait}` : "",
    c.personality.flaw ? `Flaw: ${c.personality.flaw}` : "",
    gear ? `Equipment: ${gear}` : "",
  ].filter(Boolean).join("\n");
  try {
    const msg = await o.llm.stream({
      ...requestBase(PORTRAIT_MODEL, "low"),
      max_tokens: 600,
      system: [{ type: "text", text: SYSTEM }],
      messages: [{ role: "user", content: facts }],
    }, () => {}, AbortSignal.timeout(20_000));
    await o.guard.record(msg.usage, PORTRAIT_MODEL);
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    return { prompt: text.length >= 40 ? text.slice(0, 1200) : fallback, claudeUsd: costUsd(msg.usage, PORTRAIT_MODEL) };
  } catch (e) {
    console.error("[Porträt] Claude konnte die Beschreibung nicht schreiben:", (e as Error).message);
    return { prompt: fallback, claudeUsd: 0 };
  }
}
