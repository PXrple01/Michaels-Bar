import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { addMoney, characterProblems, maxHpAtLevel } from "../shared/character";
import { characterInputSchema, characterSchema, type Character, type CharacterInput } from "../shared/schema";
import type { GameData } from "./rules/loader";

export class ValidationError extends Error {
  constructor(public problems: string[]) { super(problems.join("; ")); }
}

const ID = /^[0-9a-f-]{36}$/;

export class CharacterStore {
  constructor(private dir: string, private data: () => GameData) {}

  private file(id: string) {
    if (!ID.test(id)) throw new ValidationError(["Ungültige Charakter-ID"]);
    return path.join(this.dir, `${id}.json`);
  }

  async list(): Promise<Character[]> {
    await mkdir(this.dir, { recursive: true });
    const files = (await readdir(this.dir)).filter((f) => f.endsWith(".json"));
    const out: Character[] = [];
    for (const f of files) {
      const res = characterSchema.safeParse(JSON.parse(await readFile(path.join(this.dir, f), "utf8")));
      if (res.success) out.push(res.data);
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<Character | null> {
    try {
      return characterSchema.parse(JSON.parse(await readFile(this.file(id), "utf8")));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  /** Legt eine neue Figur an. Werte werden komplett vom Server berechnet, nicht vom Browser übernommen. */
  async create(raw: unknown): Promise<Character> {
    const parsed = characterInputSchema.safeParse(raw);
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
    const input = parsed.data;
    const { rules, classes, campaign } = this.data();
    const problems = characterProblems(input as CharacterInput, rules, classes, campaign.magic_level);
    if (problems.length) throw new ValidationError(problems);

    const cls = classes.find((c) => c.id === input.classId)!;
    const stand = rules.stands.find((s) => s.id === input.stand)!;
    const hp = maxHpAtLevel(cls, input.attributes.konstitution, 1);
    const now = new Date().toISOString();
    const character: Character = {
      ...input,
      id: randomUUID(),
      level: 1,
      xp: 0,
      hp: { current: hp, max: hp },
      equipment: [...cls.startingEquipment],
      money: addMoney(cls.startingMoney, stand.money),
      createdAt: now,
      updatedAt: now,
    };
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file(character.id), JSON.stringify(character, null, 2), "utf8");
    return character;
  }

  /** Erlaubt in Etappe 1 nur das Ändern von Trefferpunkten und Texten. */
  async patch(id: string, patch: { hpCurrent?: number; personality?: Character["personality"]; appearance?: string }): Promise<Character | null> {
    const c = await this.get(id);
    if (!c) return null;
    if (patch.hpCurrent !== undefined) {
      if (!Number.isInteger(patch.hpCurrent)) throw new ValidationError(["Trefferpunkte müssen ganzzahlig sein"]);
      c.hp.current = Math.max(0, Math.min(c.hp.max, patch.hpCurrent));
    }
    if (patch.personality) c.personality = characterSchema.shape.personality.parse(patch.personality);
    if (patch.appearance !== undefined) c.appearance = characterSchema.shape.appearance.parse(patch.appearance);
    c.updatedAt = new Date().toISOString();
    await writeFile(this.file(id), JSON.stringify(c, null, 2), "utf8");
    return c;
  }

  async remove(id: string): Promise<boolean> {
    try {
      await rm(this.file(id));
      return true;
    } catch {
      return false;
    }
  }
}
