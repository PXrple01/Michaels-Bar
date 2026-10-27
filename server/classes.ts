// Eigene Klassen: Signieren, Prüfen und Einbinden in Figuren.
import { createHmac, timingSafeEqual } from "node:crypto";
import { checkClass } from "../shared/classbuilder";
import { classSchema, type ClassDef } from "../shared/schema";
import type { GameData } from "./rules/loader";

import type { SignedClass } from "../shared/classreview";
export type { SignedClass };

const mac = (secret: string, cls: ClassDef) => createHmac("sha256", secret).update("class\n").update(JSON.stringify(cls)).digest("base64url");

export function signClass(secret: string, cls: ClassDef): SignedClass {
  return { cls, sig: mac(secret, cls) };
}

/** Prüft Signatur UND Regeln erneut (falls sich rules.json seitdem geändert hat). */
export function verifySignedClass(secret: string | undefined, raw: unknown, data: GameData): { cls: ClassDef } | { error: string } {
  if (!secret) return { error: "Eigene Klassen brauchen GAME_SECRET auf dem Server." };
  const parsed = classSchema.safeParse((raw as SignedClass | undefined)?.cls);
  const sig = (raw as SignedClass | undefined)?.sig;
  if (!parsed.success || typeof sig !== "string") return { error: "Eigene Klasse ist beschädigt." };
  const expected = Buffer.from(mac(secret, (raw as SignedClass).cls));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { error: "Eigene Klasse wurde verändert oder stammt von einem anderen Server." };
  const check = checkClass(parsed.data, data.rules, data.campaign.magic_level);
  if (!check.ok) return { error: `Eigene Klasse erfüllt die Regeln nicht mehr: ${check.errors.join(" ")}` };
  if (data.classes.some((c) => c.id === parsed.data.id && !c.custom)) return { error: "Eigene Klasse darf keine Grundklasse überschreiben." };
  return { cls: { ...parsed.data, custom: true } };
}

/** Spieldaten inklusive der eigenen Klasse einer Figur (falls vorhanden). */
export function dataWithClass(data: GameData, cls: ClassDef | null): GameData {
  if (!cls) return data;
  return { ...data, classes: [...data.classes.filter((c) => c.id !== cls.id), cls] };
}
