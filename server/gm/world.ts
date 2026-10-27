// Werkzeuge, die der Server sofort ausführt: Kampf, Gegnerangriffe, Heilung, Rast, Aufträge, Gedächtnis, Erfahrung.
// Claude schlägt vor, der Code würfelt und begrenzt – wie bei den Proben bleibt alles fair.
import type Anthropic from "@anthropic-ai/sdk";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { armorValue, modifier } from "../../shared/character";
import { formatModifier, parseNotation, type RollRecord } from "../../shared/dice";
import type { Character } from "../../shared/schema";
import { MAX_MEMORY, MAX_QUESTS, type WorldState } from "../../shared/world";
import type { RollLog } from "../dice/log";
import type { GameData } from "../rules/loader";

export const AUTO_TOOLS = ["kampf_beginnen", "kampf_beenden", "gegner_greift_an", "heilen", "rast", "auftrag", "merken", "erfahrung"] as const;

const LIMITS = { enemies: 6, enemyHp: 80, armorMin: 8, armorMax: 20, attackBonus: 8, dieMax: 12, diceMax: 2, flatMax: 5, healDieMax: 8, xpMax: 300 };

export interface ToolContext {
  data: GameData;
  characters: Character[];
  world: WorldState;
  rolls: RollLog;
  onRoll: (record: RollRecord) => void;
}

const nameProp = (characters: Character[], description: string) =>
  characters.length > 1 ? { type: "string", enum: characters.map((c) => c.name), description } : { type: "string", description };

export function autoToolDefs(characters: Character[]): Anthropic.Beta.BetaTool[] {
  const party = characters.length > 1;
  const dice = (d: string) => ({ type: "string", description: d });
  const tool = (name: string, description: string, properties: Record<string, object>, required: string[]): Anthropic.Beta.BetaTool => ({
    name, description, eager_input_streaming: true, input_schema: { type: "object", properties, required },
  });
  return [
    tool("kampf_beginnen", "Beginnt einen Kampf. Lege die Gegner fest (höchstens 6). Schwache Gegner 4–10 TP, Rüstung 10–12; starke bis 40 TP, Rüstung bis 16.", {
      gegner: { type: "array", items: { type: "object", properties: { name: { type: "string" }, trefferpunkte: { type: "integer" }, ruestung: { type: "integer" } }, required: ["name", "trefferpunkte", "ruestung"] } },
    }, ["gegner"]),
    tool("kampf_beenden", "Beendet den Kampf (Flucht, Aufgabe, Verhandlung). Sind alle Gegner besiegt, endet er von selbst.", { grund: { type: "string" } }, ["grund"]),
    tool("gegner_greift_an", "Ein Gegner greift eine Figur an. Der Server würfelt Angriff (W20 + Bonus gegen die Rüstung der Figur) und bei Treffer den Schaden, und zieht die Trefferpunkte ab.", {
      gegner: { type: "string", description: "Name aus dem laufenden Kampf" },
      ...(party ? { ziel: nameProp(characters, "Wen der Gegner angreift") } : {}),
      angriffsbonus: { type: "integer", description: "0–8; einfache Räuber +2, erfahrene Söldner +4" },
      schaden: dice("Schadenswürfel, z. B. 1W6+1 (höchstens 2W12+5)"),
      modus: { type: "string", enum: ["normal", "advantage", "disadvantage"] },
    }, ["gegner", ...(party ? ["ziel"] : []), "angriffsbonus", "schaden", "modus"]),
    tool("heilen", "Heilt eine Figur (Trank, Heilkunde, Fähigkeit). Der Server würfelt die Heilung.", {
      ...(party ? { ziel: nameProp(characters, "Wer geheilt wird") } : {}),
      wuerfel: dice("Heilwürfel, z. B. 1W8+2 (höchstens 2W8+5)"),
      grund: { type: "string" },
    }, [...(party ? ["ziel"] : []), "wuerfel", "grund"]),
    tool("rast", "Die Gruppe rastet. kurz: jede Figur heilt einen Trefferwürfel + Konstitution. lang (eine Nacht): volle Trefferpunkte.", { art: { type: "string", enum: ["kurz", "lang"] } }, ["art"]),
    tool("auftrag", "Führt das Auftragsbuch: neuen Auftrag anlegen, Notiz ergänzen, als erledigt oder gescheitert markieren.", {
      aktion: { type: "string", enum: ["neu", "notiz", "erledigt", "gescheitert"] },
      titel: { type: "string", description: "Kurzer Titel, bei Folgeaktionen genau wie beim Anlegen" },
      text: { type: "string", description: "Beschreibung bzw. Notiz" },
    }, ["aktion", "titel", "text"]),
    tool("merken", "Merkt sich eine wichtige Tatsache für später (Namen, Versprechen, Geheimnisse, Orte). Ein Satz.", { text: { type: "string" } }, ["text"]),
    tool("erfahrung", "Vergibt Erfahrungspunkte an alle Figuren für einen gelösten Auftrag oder eine besiegte Gefahr (10–300).", { menge: { type: "integer" }, grund: { type: "string" } }, ["menge", "grund"]),
  ];
}

/** Würfelausdruck auf die Grenzen kürzen (z. B. 5W20+30 → 2W12+5). */
export function clampDice(expr: string, dieMax: number, countMax = LIMITS.diceMax, flatMax = LIMITS.flatMax): string {
  let p;
  try { p = parseNotation(expr); } catch { return "1W4"; }
  const t = p.terms[0];
  const sides = [4, 6, 8, 10, 12].filter((d) => d <= dieMax).reduce((best, d) => (d <= t.sides ? d : best), 4);
  const count = Math.max(1, Math.min(t.count, countMax));
  const mod = Math.max(-flatMax, Math.min(flatMax, p.modifier));
  return `${count}W${sides}${mod ? (mod > 0 ? `+${mod}` : String(mod)) : ""}`;
}

const rid = (toolId: string, suffix: string) => `gm-${toolId.replace(/[^A-Za-z0-9-]/g, "-")}`.slice(0, 58) + `-${suffix}`;

function findCharacter(ctx: ToolContext, name: unknown): Character | null {
  if (ctx.characters.length === 1) return ctx.characters[0];
  return ctx.characters.find((c) => c.name.toLowerCase() === String(name ?? "").toLowerCase()) ?? null;
}

function hpLine(ctx: ToolContext, c: Character) {
  const hp = ctx.world.hp[c.id];
  return `${c.name}: ${hp}/${ctx.world.maxHp[c.id]} TP${hp <= 0 ? " – kampfunfähig (bewusstlos, aber nicht tot)" : ""}`;
}

function checkCombatEnd(ctx: ToolContext): string {
  const w = ctx.world;
  if (w.combat && w.combat.enemies.every((e) => e.hp <= 0)) {
    w.combat = null;
    return " Alle Gegner sind besiegt – der Kampf ist vorbei.";
  }
  return "";
}

/** Führt ein automatisches Werkzeug aus und liefert den Text für Claude. Fehler kommen als is_error zurück. */
export async function runAutoTool(block: { id: string; name: string; input: unknown }, ctx: ToolContext): Promise<{ content: string; is_error?: boolean }> {
  const w = ctx.world;
  const err = (content: string) => ({ content: `FEHLER: ${content}`, is_error: true });
  const input = (block.input ?? {}) as Record<string, unknown>;

  switch (block.name) {
    case "kampf_beginnen": {
      const parsed = z.array(z.object({ name: z.string().min(1).max(40), trefferpunkte: z.number(), ruestung: z.number() })).min(1).safeParse(input.gegner);
      if (!parsed.success) return err("gegner muss eine Liste mit name, trefferpunkte, ruestung sein.");
      const enemies = parsed.data.slice(0, LIMITS.enemies).map((g, i) => {
        const hp = Math.max(1, Math.min(LIMITS.enemyHp, Math.round(g.trefferpunkte)));
        return { id: `${i}-${randomBytes(3).toString("hex")}`, name: g.name, hp, maxHp: hp, armor: Math.max(LIMITS.armorMin, Math.min(LIMITS.armorMax, Math.round(g.ruestung))) };
      });
      // gleiche Namen unterscheidbar machen
      const total: Record<string, number> = {};
      for (const e of enemies) total[e.name] = (total[e.name] ?? 0) + 1;
      const seen: Record<string, number> = {};
      for (const e of enemies) if (total[e.name] > 1) { seen[e.name] = (seen[e.name] ?? 0) + 1; e.name = `${e.name} ${seen[e.name]}`; }
      w.combat = { round: 1, enemies };
      return { content: `Kampf beginnt (Runde 1). Gegner: ${enemies.map((e) => `${e.name} (${e.hp} TP, Rüstung ${e.armor})`).join(", ")}. Die Figuren handeln zuerst; Angriffe der Figuren verlangst du mit probe_anfordern (art attack, ziel = Gegnername), Gegnerangriffe mit gegner_greift_an.` };
    }
    case "kampf_beenden": {
      if (!w.combat) return { content: "Es lief kein Kampf." };
      w.combat = null;
      return { content: "Der Kampf ist beendet." };
    }
    case "gegner_greift_an": {
      if (!w.combat) return err("Es läuft kein Kampf – starte ihn zuerst mit kampf_beginnen.");
      const enemy = w.combat.enemies.find((e) => e.name.toLowerCase() === String(input.gegner ?? "").toLowerCase());
      if (!enemy) return err(`Unbekannter Gegner. Im Kampf: ${w.combat.enemies.map((e) => e.name).join(", ")}.`);
      if (enemy.hp <= 0) return err(`${enemy.name} ist schon besiegt.`);
      const target = findCharacter(ctx, input.ziel);
      if (!target) return err("Unbekanntes Ziel.");
      if (w.hp[target.id] <= 0) return err(`${target.name} ist bereits kampfunfähig.`);
      const cls = ctx.data.classes.find((c) => c.id === target.classId)!;
      const ac = armorValue(target, ctx.data.rules, cls).total;
      const bonus = Math.max(0, Math.min(LIMITS.attackBonus, Math.round(Number(input.angriffsbonus) || 0)));
      const mode = input.modus === "advantage" || input.modus === "disadvantage" ? input.modus : "normal";
      const atk = await ctx.rolls.roll({ requestId: rid(block.id, "a"), kind: "check", label: `${enemy.name} greift ${target.name} an`, notation: "1W20", mode, modifierParts: bonus ? [{ label: "Angriff", value: bonus }] : [], dc: ac });
      ctx.onRoll(atk);
      if (!atk.success) return { content: `${enemy.name} greift ${target.name} an: ${atk.natural}${bonus ? formatModifier(bonus) : ""} = ${atk.total} gegen Rüstung ${ac} – daneben${atk.critical === "fumble" ? " (Patzer!)" : ""}. ${hpLine(ctx, target)}` };
      let dmgExpr = clampDice(String(input.schaden ?? "1W6"), LIMITS.dieMax);
      if (atk.critical === "hit") { const p = parseNotation(dmgExpr); dmgExpr = `${p.terms[0].count * 2}W${p.terms[0].sides}${p.modifier ? formatModifier(p.modifier).replace("−", "-") : ""}`; }
      const dmg = await ctx.rolls.roll({ requestId: rid(block.id, "d"), kind: "check", label: `Schaden von ${enemy.name}`, notation: dmgExpr });
      ctx.onRoll(dmg);
      const amount = Math.max(1, dmg.total);
      w.hp[target.id] = Math.max(0, w.hp[target.id] - amount);
      return { content: `${enemy.name} trifft ${target.name}${atk.critical === "hit" ? " kritisch (doppelte Schadenswürfel)" : ""}: ${atk.total} gegen Rüstung ${ac}, Schaden ${dmgExpr} = ${amount}. ${hpLine(ctx, target)}` };
    }
    case "heilen": {
      const target = findCharacter(ctx, input.ziel);
      if (!target) return err("Unbekanntes Ziel.");
      const expr = clampDice(String(input.wuerfel ?? "1W4"), LIMITS.healDieMax);
      const r = await ctx.rolls.roll({ requestId: rid(block.id, "h"), kind: "check", label: `Heilung für ${target.name}`, notation: expr });
      ctx.onRoll(r);
      const before = w.hp[target.id];
      w.hp[target.id] = Math.min(w.maxHp[target.id], before + Math.max(1, r.total));
      return { content: `Heilung ${expr} = ${r.total}. ${target.name} heilt ${w.hp[target.id] - before} TP. ${hpLine(ctx, target)}` };
    }
    case "rast": {
      if (w.combat) return err("Mitten im Kampf kann niemand rasten.");
      if (input.art === "lang") {
        for (const c of ctx.characters) w.hp[c.id] = w.maxHp[c.id];
        return { content: `Lange Rast: Alle sind wieder bei vollen Kräften. ${ctx.characters.map((c) => hpLine(ctx, c)).join("; ")}` };
      }
      const parts: string[] = [];
      for (const c of ctx.characters) {
        const cls = ctx.data.classes.find((x) => x.id === c.classId)!;
        const kon = modifier(c.attributes.konstitution);
        const r = await ctx.rolls.roll({ requestId: rid(block.id, `r${c.id.slice(0, 4)}`), kind: "check", label: `Kurze Rast: ${c.name}`, notation: `1W${cls.hitDie}${kon ? formatModifier(kon).replace("−", "-") : ""}` });
        ctx.onRoll(r);
        w.hp[c.id] = Math.min(w.maxHp[c.id], w.hp[c.id] + Math.max(1, r.total));
        parts.push(hpLine(ctx, c));
      }
      return { content: `Kurze Rast. ${parts.join("; ")}` };
    }
    case "auftrag": {
      const title = String(input.titel ?? "").trim().slice(0, 80);
      const text = String(input.text ?? "").trim().slice(0, 300);
      if (!title) return err("titel fehlt.");
      const q = w.quests.find((x) => x.title.toLowerCase() === title.toLowerCase());
      if (input.aktion === "neu") {
        if (q) return { content: `Auftrag „${title}“ gibt es schon.` };
        if (w.quests.length >= MAX_QUESTS) w.quests.splice(w.quests.findIndex((x) => x.status !== "offen"), 1);
        w.quests.push({ id: randomBytes(4).toString("hex"), title, description: text, status: "offen", notes: [] });
        return { content: `Neuer Auftrag: ${title}.` };
      }
      if (!q) return err(`Kein Auftrag „${title}“. Offen: ${w.quests.filter((x) => x.status === "offen").map((x) => x.title).join(", ") || "keine"}.`);
      if (input.aktion === "notiz") { if (text) q.notes = [...q.notes, text].slice(-8); return { content: `Notiz zu „${q.title}“ gespeichert.` }; }
      q.status = input.aktion === "erledigt" ? "erledigt" : "gescheitert";
      if (text) q.notes = [...q.notes, text].slice(-8);
      return { content: `Auftrag „${q.title}“: ${q.status}.` };
    }
    case "merken": {
      const text = String(input.text ?? "").trim().slice(0, 300);
      if (!text) return err("text fehlt.");
      if (!w.memory.includes(text)) w.memory = [...w.memory, text].slice(-MAX_MEMORY);
      return { content: "Gemerkt." };
    }
    case "erfahrung": {
      const amount = Math.max(0, Math.min(LIMITS.xpMax, Math.round(Number(input.menge) || 0)));
      for (const c of ctx.characters) w.xp[c.id] = (w.xp[c.id] ?? 0) + amount;
      return { content: `Alle erhalten ${amount} Erfahrungspunkte.` };
    }
  }
  return err("Unbekanntes Werkzeug.");
}

/** Spieler-Angriff oder -Schaden gegen einen Gegner verrechnen (nach dem Wurf der Probe). */
export function applyPlayerRoll(ctx: Omit<ToolContext, "onRoll" | "rolls">, characterId: string, art: string, ziel: string | null, record: RollRecord): string {
  const w = ctx.world;
  if (!w.combat || !ziel) return "";
  const enemy = w.combat.enemies.find((e) => e.name.toLowerCase() === ziel.toLowerCase());
  if (!enemy) return "";
  if (art === "attack") {
    w.critPending[characterId] = record.critical === "hit";
    return record.success ? ` Treffer gegen ${enemy.name}${record.critical === "hit" ? " – kritisch, der Schaden zählt doppelt" : ""}! Verlange jetzt den Schadenswurf (art damage, ziel ${enemy.name}).` : ` Verfehlt – ${enemy.name} weicht aus.`;
  }
  if (art === "damage") {
    delete w.critPending[characterId];
    const amount = Math.max(1, record.total);
    enemy.hp = Math.max(0, enemy.hp - amount);
    return ` ${enemy.name} verliert ${amount} TP und hat noch ${enemy.hp}/${enemy.maxHp}${enemy.hp <= 0 ? " – besiegt!" : "."}${checkCombatEnd({ ...ctx, rolls: null as never, onRoll: () => {} })}`;
  }
  return "";
}
