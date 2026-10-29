// Figurenstimmen beim Vorlesen: Der Erzähltext wird in Erzählung und wörtliche Rede („…“) zerlegt. Jede Rede bekommt
// die Stimme der Person, deren Name direkt davor oder danach steht – dieselbe Person klingt immer gleich.

/** `female` unbekannt (z. B. Spielfiguren): Stimme aus allen Stimmen. */
export interface CastMember { name: string; female?: boolean }
export interface VoiceSegment { text: string; voice: string }

/** ElevenLabs-Stimmen (sprechen mit language_code „de“ Deutsch). Erzähler: tiefe, ruhige Männerstimme. */
export const NARRATOR = "Daniel";
export const MALE = ["George", "Roger", "Callum", "Liam", "Will", "Eric", "Chris", "Bill", "Charlie"];
export const FEMALE = ["Sarah", "Aria", "Laura", "Charlotte", "Alice", "Matilda", "Jessica", "Lily"];
export const UNKNOWN = "River";

/** Weibliche Rollen erkennen (Hebamme, Magd, Äbtissin, Händlerin …) – für die Wahl einer passenden Stimme. */
export function looksFemale(role: string): boolean {
  const r = role.toLowerCase();
  const words = r.split(/[\s,;()–-]+/).filter(Boolean);
  return words.some((w) => /^(frau|hebamme|magd|äbtissin|nonne|witwe|mutter|tochter|königin|gräfin|fürstin|herzogin|schwester|hexe|dame|jungfer|amme|base|tante|großmutter)$/.test(w) || (w.length > 5 && w.endsWith("in") && !/(paladin|medizin|kaplan|termin)$/.test(w)));
}

const hash = (s: string) => { let h = 0; for (const ch of s.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
export const voiceFor = (m: CastMember) => { const pool = m.female === undefined ? [...MALE, ...FEMALE] : m.female ? FEMALE : MALE; return pool[hash(m.name) % pool.length]; };

/** Text in Abschnitte mit Stimmen zerlegen. Ohne wörtliche Rede: ein einziger Abschnitt mit der Erzählerstimme. */
export function segmentVoices(text: string, cast: CastMember[]): VoiceSegment[] {
  const parts = text.split(/(„[^“]{1,600}“)/);
  const out: VoiceSegment[] = [];
  const nameIn = (s: string) => {
    let best: { m: CastMember; i: number } | null = null;
    for (const m of cast) {
      const first = m.name.split(/\s+/)[0];
      const re = new RegExp(`\\b(${m.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\b`, "gi");
      let match: RegExpExecArray | null;
      while ((match = re.exec(s))) if (!best || match.index > best.i) best = { m, i: match.index };
    }
    return best?.m ?? null;
  };
  parts.forEach((p, i) => {
    if (!p.trim()) return;
    if (p.startsWith("„")) {
      // Sprecher: zuerst im Satz davor (letzter genannter Name), sonst im Satz danach
      const before = (parts[i - 1] ?? "").split(/[.!?](?:\s|$)/).map((s) => s.trim()).filter(Boolean).pop() ?? "";
      const after = (parts[i + 1] ?? "").split(/[.!?](?:\s|$)/).map((s) => s.trim()).filter(Boolean)[0] ?? "";
      const who = nameIn(before) ?? nameIn(after);
      out.push({ text: p.slice(1, -1), voice: who ? voiceFor(who) : UNKNOWN });
    } else out.push({ text: p, voice: NARRATOR });
  });
  // Benachbarte Abschnitte mit gleicher Stimme zusammenfassen
  return out.reduce<VoiceSegment[]>((acc, s) => {
    const last = acc.at(-1);
    if (last && last.voice === s.voice) last.text += ` ${s.text}`;
    else acc.push({ ...s });
    return acc;
  }, []);
}
