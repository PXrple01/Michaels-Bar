// Stufenaufstieg in der Oberfläche: Wahl bei Stufe 4 (Fertigkeit) und 7 (Attribute), Hinweis beim Aufstieg.
import { effectiveCharacter, levelChoiceDue, levelTitle } from "../../../shared/levels";
import type { Character, ClassDef, Rules } from "../../../shared/schema";
import type { WorldState } from "../../../shared/world";
import { html, type Raw } from "./dom";
import { icon } from "./icons";
import { toast } from "./ui";

export { levelChoiceDue };

/** Karte für die anstehende Wahl – oder nichts. */
export function levelChoiceCard(w: WorldState | null | undefined, c: Character, cls: ClassDef | undefined, rules: Rules): Raw {
  const due = levelChoiceDue(w, c.id, rules);
  if (!w || !due) return html``;
  const level = w.levels![c.id].level;
  const eff = effectiveCharacter(c, w);
  if (due === "skill") {
    const stand = rules.stands.find((s) => s.id === c.stand);
    const trained = new Set([...(cls?.trainedSkills ?? []), ...(stand ? [stand.skill] : []), ...eff.chosenSkills]);
    const options = rules.skills.filter((s) => !trained.has(s.id));
    return html`<div class="card level-card glow-border">
      <div class="lc-head"><span class="lc-num">${level}</span><div><div class="eyebrow">Stufe ${level} · ${levelTitle(level, rules)}</div><h3>Lerne eine neue Fertigkeit</h3><p class="muted">Bei Proben in dieser Fertigkeit bekommst du ab jetzt deinen Können-Bonus.</p></div></div>
      <div class="lc-skills">${options.map((s) => {
        const attr = rules.attributes.find((a) => a.id === s.attribute);
        return html`<button class="lc-skill" data-level-skill="${s.id}" title="${s.description ?? ""}"><b>${s.name}</b><small>${attr?.short ?? ""}</small></button>`;
      })}</div>
    </div>`;
  }
  return html`<div class="card level-card glow-border" data-level-attrs>
    <div class="lc-head"><span class="lc-num">${level}</span><div><div class="eyebrow">Stufe ${level} · ${levelTitle(level, rules)}</div><h3>Steigere deine Attribute</h3><p class="muted">+2 auf ein Attribut oder je +1 auf zwei (höchstens ${rules.classBuilder.attributeMods.finalMax}).</p></div></div>
    <div class="lc-attrs">${rules.attributes.map((a) => {
      const v = eff.attributes[a.id] ?? 10;
      const max = rules.classBuilder.attributeMods.finalMax;
      return html`<div class="lc-attr">
        <span><b>${a.name}</b><small>${v}</small></span>
        <button class="btn btn-sm" data-level-attr2="${a.id}" ${v + 2 > max ? "disabled" : ""}>+2</button>
        <button class="btn btn-ghost btn-sm" data-level-attr1="${a.id}" aria-pressed="false" ${v + 1 > max ? "disabled" : ""}>+1</button>
      </div>`;
    })}</div>
    <div class="center"><button class="btn" data-level-confirm disabled>${icon("check")} Je +1 übernehmen</button></div>
  </div>`;
}

/** Klicks der Karte verdrahten. `send` schickt die Wahl an den Server. */
export function bindLevelCard(root: HTMLElement, send: (choice: { skill?: string; attrs?: Record<string, number> }) => void) {
  root.querySelectorAll<HTMLElement>("[data-level-skill]").forEach((b) => b.addEventListener("click", () => send({ skill: b.dataset.levelSkill })));
  root.querySelectorAll<HTMLElement>("[data-level-attr2]").forEach((b) => b.addEventListener("click", () => send({ attrs: { [b.dataset.levelAttr2!]: 2 } })));
  const card = root.querySelector<HTMLElement>("[data-level-attrs]");
  if (!card) return;
  const confirm = card.querySelector<HTMLButtonElement>("[data-level-confirm]")!;
  const picked = () => [...card.querySelectorAll<HTMLElement>('[data-level-attr1][aria-pressed="true"]')].map((b) => b.dataset.levelAttr1!);
  card.querySelectorAll<HTMLElement>("[data-level-attr1]").forEach((b) => b.addEventListener("click", () => {
    const on = b.getAttribute("aria-pressed") !== "true";
    if (on && picked().length >= 2) return;
    b.setAttribute("aria-pressed", String(on));
    confirm.disabled = picked().length !== 2;
  }));
  confirm.addEventListener("click", () => { const [a, b] = picked(); send({ attrs: { [a]: 1, [b]: 1 } }); });
}

/** Hinweis, wenn die Stufe gestiegen ist. */
export function announceLevel(before: number, after: number, rules: Rules) {
  if (after <= before) return;
  const extra = after >= rules.levels.extraSkillAt && before < rules.levels.extraSkillAt ? " Du darfst eine neue Fertigkeit lernen."
    : after >= rules.levels.attributeIncreaseAt && before < rules.levels.attributeIncreaseAt ? " Du darfst deine Attribute steigern."
    : after === rules.levels.max ? " Dein Können steigt auf +3." : " Deine Trefferpunkte steigen.";
  toast(`⭐ Stufe ${after} erreicht – ${levelTitle(after, rules)}!${extra}`, "success", 6000);
}
