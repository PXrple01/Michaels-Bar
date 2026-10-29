// Stufenaufstieg in der Oberfläche: Wahl bei Stufe 4 (Fertigkeit) und 3, 6, 9 (Attribute), Hinweis beim Aufstieg.
import { attrPointsNext, effectiveCharacter, levelChoiceDue, levelTitle } from "../../../shared/levels";
import type { Character, ClassDef, Rules } from "../../../shared/schema";
import type { WorldState } from "../../../shared/world";
import { html, raw, type Raw } from "./dom";
import { icon } from "./icons";
import { toast } from "./ui";
import { settings } from "./settings";

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
  const points = attrPointsNext(w.levels![c.id], rules);
  return html`<div class="card level-card glow-border" data-level-attrs data-points="${points}">
    <div class="lc-head"><span class="lc-num">${level}</span><div><div class="eyebrow">Stufe ${level} · ${levelTitle(level, rules)}</div><h3>Steigere deine Attribute</h3><p class="muted">${points === 1 ? "+1 auf ein Attribut" : "+2 auf ein Attribut oder je +1 auf zwei"} (höchstens ${rules.classBuilder.attributeMods.finalMax}).</p></div></div>
    <div class="lc-attrs">${rules.attributes.map((a) => {
      const v = eff.attributes[a.id] ?? 10;
      const max = rules.classBuilder.attributeMods.finalMax;
      return html`<div class="lc-attr">
        <span><b>${a.name}</b><small>${v}</small></span>
        ${points === 2 ? html`<button class="btn btn-sm" data-level-attr2="${a.id}" ${v + 2 > max ? "disabled" : ""}>+2</button>` : ""}
        <button class="btn btn-ghost btn-sm" data-level-attr1="${a.id}" aria-pressed="false" ${v + 1 > max ? "disabled" : ""}>+1</button>
      </div>`;
    })}</div>
    ${points === 2 ? html`<div class="center"><button class="btn" data-level-confirm disabled>${icon("check")} Je +1 übernehmen</button></div>` : ""}
  </div>`;
}

/** Klicks der Karte verdrahten. `send` schickt die Wahl an den Server. */
export function bindLevelCard(root: HTMLElement, send: (choice: { skill?: string; attrs?: Record<string, number> }) => void) {
  root.querySelectorAll<HTMLElement>("[data-level-skill]").forEach((b) => b.addEventListener("click", () => send({ skill: b.dataset.levelSkill })));
  root.querySelectorAll<HTMLElement>("[data-level-attr2]").forEach((b) => b.addEventListener("click", () => send({ attrs: { [b.dataset.levelAttr2!]: 2 } })));
  const card = root.querySelector<HTMLElement>("[data-level-attrs]");
  if (!card) return;
  // Nur +1 (Stufe 9): ein Klick genügt
  if (card.dataset.points === "1") {
    card.querySelectorAll<HTMLElement>("[data-level-attr1]").forEach((b) => b.addEventListener("click", () => send({ attrs: { [b.dataset.levelAttr1!]: 1 } })));
    return;
  }
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
    : rules.levels.attributeIncreaseAt.some((l) => after >= l && before < l) ? " Du darfst deine Attribute steigern."
    : after === rules.levels.max ? " Dein Können steigt auf +3." : " Deine Trefferpunkte steigen.";
  toast(`⭐ Stufe ${after} erreicht – ${levelTitle(after, rules)}!${extra}`, "success", 6000);
  celebrateLevel(after, levelTitle(after, rules));
}

/**
 * Kurzer Auftritt in Lila und Gold: aufsteigende Funken und die große Stufenzahl.
 * Bei „Animation aus“ oder reduzierter Bewegung nur ein ruhiges Einblenden ohne Funken.
 */
export function celebrateLevel(level: number, title: string) {
  document.querySelector(".level-up")?.remove();
  const calm = settings().animation === "off" || matchMedia("(prefers-reduced-motion: reduce)").matches;
  const el = document.createElement("div");
  el.className = `level-up ${calm ? "calm" : ""}`;
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  const sparks = calm ? "" : Array.from({ length: 26 }, (_, i) => {
    const x = Math.round(Math.random() * 100), d = (Math.random() * 0.9).toFixed(2), s = (0.6 + Math.random() * 0.9).toFixed(2), gold = i % 3 !== 0;
    return `<i style="--x:${x}%;--d:${d}s;--s:${s};--c:${gold ? "var(--gold)" : "var(--purple-2)"}"></i>`;
  }).join("");
  el.innerHTML = html`<div class="lu-glow"></div>${raw(sparks)}<div class="lu-card"><span class="lu-label">Stufe</span><span class="lu-num">${level}</span><span class="lu-title">${title}</span></div>`.value;
  const close = () => { el.classList.add("out"); setTimeout(() => el.remove(), 400); };
  el.addEventListener("click", close);
  document.body.append(el);
  setTimeout(close, calm ? 1800 : 2600);
}
