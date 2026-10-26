import { armorValue, attackInfo, characterRoll, findItem, modifier, skillBonusForLevel, trainedSkills, type CharacterRollType } from "../../../shared/character";
import { formatModifier, type RollMode } from "../../../shared/dice";
import type { Character, Money } from "../../../shared/schema";
import { rollWithOverlay } from "../dice3d/roller";
import { countUp, enhance } from "../fx/effects";
import { api, loadGameData, type GameData } from "../lib/api";
import { $, $$, html, setHTML, uuid } from "../lib/dom";
import { term } from "../lib/glossary";
import { icon, sigil } from "../lib/icons";
import { go, type Page } from "../lib/router";
import { bindSegmented, confirmDialog, segmented, toast } from "../lib/ui";

function moneyText(m: Money) {
  const parts = [m.gulden && `${m.gulden} Gulden`, m.groschen && `${m.groschen} Groschen`, m.pfennig && `${m.pfennig} Pfennig`].filter(Boolean);
  return parts.length ? parts.join(", ") : "keinen Pfennig";
}

const USES: Record<string, string> = { passiv: "immer aktiv", einmal_pro_kampf: "1× pro Kampf", einmal_pro_rast: "1× pro Rast", einmal_pro_tag: "1× pro Tag", beliebig: "beliebig oft" };

export function sheetPage(): Page {
  let mode: RollMode = "normal";
  let dc: number | null = null;
  return {
    async render(root, params) {
      const [id, query] = params.id.split("?");
      setHTML(root, html`<div class="container"><div class="spinner"></div></div>`);
      let c: Character, data: GameData;
      try {
        [c, data] = await Promise.all([api.character(id), loadGameData()]);
      } catch (e) {
        setHTML(root, html`<div class="container empty"><h2>Figur nicht gefunden</h2><p>${(e as Error).message}</p><a class="btn" href="#/figuren">Zur Übersicht</a></div>`);
        return;
      }
      const { rules, classes } = data;
      const cls = classes.find((x) => x.id === c.classId)!;
      const stand = rules.stands.find((s) => s.id === c.stand)!;
      const trained = trainedSkills(c, rules, classes);
      const armor = armorValue(c, rules, cls);
      const atk = attackInfo(c, rules, cls);
      const sb = skillBonusForLevel(c.level, rules);
      const isNew = query === "neu";

      setHTML(root, html`
        <div class="container sheet">
          ${isNew ? html`<div class="welcome card glow-border" data-reveal="scale">
            <div class="sparkle-burst" aria-hidden="true">${Array.from({ length: 14 }, (_, i) => html`<i style="--i:${i}"></i>`)}</div>
            <h2>Willkommen, ${c.name}!</h2>
            <p>Deine Figur ist bereit. Probier gleich eine ${term("probe")} aus: Tippe unten auf ein Attribut, z. B. <b>${rules.attributes.find((a) => a.id === cls.primaryAttributes[0])?.name}</b>.</p>
          </div>` : ""}

          <section class="sheet-head card" data-reveal>
            <div class="sh-sigil">${sigil(cls.sigil, "draw")}</div>
            <div class="sh-id">
              <div class="eyebrow">${cls.name} · ${stand.name}</div>
              <h1>${c.name}</h1>
              <div class="sh-chips">
                <span class="chip">${term("stufe", `Stufe ${c.level}`)}</span>
                <span class="chip">${c.xp} EP</span>
                <span class="chip">${term("trefferwuerfel", `W${cls.hitDie}`)}</span>
                <span class="chip">${term("koennen", `Können ${formatModifier(sb)}`)}</span>
              </div>
            </div>
            <div class="sh-vitals">
              <div class="vital hp">
                <div class="vital-label">${icon("heart")} ${term("tp", "Trefferpunkte")}</div>
                <div class="hp-bar"><i id="hp-fill" style="width:${(c.hp.current / c.hp.max) * 100}%"></i><span class="hp-wave"></span></div>
                <div class="hp-ctrl">
                  <button class="round-btn" data-hp="-1" aria-label="Einen Trefferpunkt abziehen">${icon("minus")}</button>
                  <b><span id="hp-cur">${c.hp.current}</span> / ${c.hp.max}</b>
                  <button class="round-btn" data-hp="1" aria-label="Einen Trefferpunkt heilen">${icon("plus")}</button>
                </div>
              </div>
              <div class="vital shield-v" title="${armor.parts.map((p) => `${p.label} ${formatModifier(p.value)}`).join(", ")}">
                <div class="shield-badge">${icon("shield")}<b>${armor.total}</b></div>
                <div class="vital-label">${term("ruestung")}</div>
              </div>
            </div>
          </section>

          <section class="roll-bar card" data-reveal>
            <div class="rb-group">
              <span class="rb-label">Würfelmodus</span>
              ${segmented<RollMode>("mode", [{ value: "normal", label: "Normal" }, { value: "advantage", label: "Vorteil" }, { value: "disadvantage", label: "Nachteil" }], mode)}
            </div>
            <div class="rb-group">
              <label class="rb-label" for="dc-select">Übungs-${term("sg", "SG")}</label>
              <select class="select select-sm" id="dc-select">
                <option value="">keiner</option>
                ${rules.checks.difficulties.map((d) => html`<option value="${d.dc}" ${dc === d.dc ? "selected" : ""}>${d.name} (${d.dc})</option>`)}
              </select>
            </div>
            <p class="rb-hint">${icon("info")} Tippe auf ein Attribut, eine Fertigkeit oder deine Waffe, um zu würfeln.</p>
          </section>

          <section class="sheet-section" data-reveal>
            <h2 class="sec-title">${icon("star")} ${term("attribut", "Attribute")}</h2>
            <div class="medallions">
              ${rules.attributes.map((a, i) => html`
                <button class="medallion ${cls.primaryAttributes.includes(a.id) ? "primary" : ""}" data-roll="attribute" data-id="${a.id}" style="--i:${i}" title="${a.description}">
                  <span class="med-ring"></span>
                  <span class="med-icon">${icon(a.icon)}</span>
                  <span class="med-name">${a.name}</span>
                  <span class="med-mod">${formatModifier(modifier(c.attributes[a.id]))}</span>
                  <span class="med-val">Wert ${c.attributes[a.id]}</span>
                </button>`)}
            </div>
          </section>

          ${atk ? html`
          <section class="sheet-section" data-reveal>
            <h2 class="sec-title">${icon("sword")} Kampf</h2>
            <div class="combat-row">
              <button class="card combat-card tilt" data-roll="attack" data-id="weapon">
                <div class="cc-icon">${icon("target")}</div>
                <div><h3>${term("angriff", "Angriff")}</h3><p>${atk.weapon}: W20 ${formatModifier(atk.attackBonus)}</p></div>
                <span class="badge-num">${formatModifier(atk.attackBonus)}</span>
              </button>
              <button class="card combat-card tilt" data-roll="damage" data-id="weapon">
                <div class="cc-icon">${icon("zap")}</div>
                <div><h3>${term("schaden")}</h3><p>${atk.weapon}: ${atk.damage}${atk.damageBonus ? formatModifier(atk.damageBonus) : ""}</p></div>
                <span class="badge-num">${atk.damage}</span>
              </button>
            </div>
          </section>` : ""}

          <section class="sheet-section" data-reveal>
            <h2 class="sec-title">${icon("feather")} ${term("fertigkeit", "Fertigkeiten")}</h2>
            <div class="skill-list">
              ${rules.skills.map((s, i) => {
                const a = rules.attributes.find((x) => x.id === s.attribute)!;
                const isT = trained.has(s.id);
                const total = modifier(c.attributes[a.id]) + (isT ? sb : 0);
                return html`<button class="skill-row ${isT ? "trained" : ""}" data-roll="skill" data-id="${s.id}" style="--i:${i}" title="${s.description}">
                  <span class="sk-dot" title="${isT ? "geübt" : "nicht geübt"}"></span>
                  <span class="sk-name">${s.name}</span>
                  <span class="sk-attr">${a.short}</span>
                  <span class="sk-mod">${formatModifier(total)}</span>
                  <span class="sk-roll">${icon("dice")}</span>
                </button>`;
              })}
            </div>
            <p class="hint"><span class="sk-dot inline"></span> = geübt: Bonus des Attributs + ${term("koennen")} (${formatModifier(sb)})</p>
          </section>

          <section class="sheet-section" data-reveal>
            <h2 class="sec-title">${icon("sparkles")} Fähigkeiten</h2>
            <div class="ability-cards">
              ${cls.abilities.map((ab, i) => html`
                <article class="card ability-card tilt" style="--i:${i}">
                  <div class="ab-head"><h3>${ab.name}</h3><span class="chip">${USES[ab.uses] ?? ab.uses}</span></div>
                  <p>${ab.beginnerText}</p>
                  <details><summary>Genaue Regel</summary><p class="rule-text">${ab.text}</p></details>
                </article>`)}
              <article class="card ability-card tilt">
                <div class="ab-head"><h3>${stand.name}</h3><span class="chip">Herkunft</span></div>
                <p>${stand.feature}</p>
              </article>
            </div>
          </section>

          <div class="sheet-cols">
            <section class="sheet-section card" data-reveal>
              <h2 class="sec-title">${icon("bag")} Ausrüstung</h2>
              <ul class="gear">
                ${c.equipment.map((id) => {
                  const it = findItem(rules, id);
                  if (!it) return "";
                  const eq = id === cls.equippedWeapon || id === cls.equippedArmor || id === cls.equippedShield;
                  const meta = it.type === "weapon" ? `${it.damage} · ${it.properties.join(", ") || "—"}` : it.type === "armor" ? `Rüstung +${it.armorBonus} (${it.category})` : it.type === "shield" ? `Rüstung +${it.armorBonus}` : it.type === "consumable" ? it.effect : "";
                  return html`<li class="${eq ? "equipped" : ""}"><b>${it.name}</b>${meta ? html`<span>${meta}</span>` : ""}${eq ? html`<em>angelegt</em>` : ""}</li>`;
                })}
              </ul>
              <div class="money">${icon("coins")} ${moneyText(c.money)}</div>
            </section>
            <section class="sheet-section card" data-reveal>
              <h2 class="sec-title">${icon("user")} Persönlichkeit</h2>
              <dl class="persona">
                ${([["Eigenart", c.personality.trait], ["Glaube", c.personality.ideal], ["Bindung", c.personality.bond], ["Schwäche", c.personality.flaw], ["Aussehen", c.appearance]] as const)
                  .map(([k, v]) => html`<div><dt>${k}</dt><dd>${v || html`<span class="muted">—</span>`}</dd></div>`)}
              </dl>
            </section>
          </div>

          <div class="sheet-foot" data-reveal>
            <a class="btn btn-ghost" href="#/figuren">${icon("arrowLeft")} Alle Figuren</a>
            <button class="btn btn-danger btn-sm" id="delete-char">${icon("trash")} Figur löschen</button>
          </div>
        </div>`);

      bindSegmented<RollMode>(root, "mode", (v) => { mode = v; });
      $<HTMLSelectElement>("#dc-select", root).addEventListener("change", (e) => { const v = (e.target as HTMLSelectElement).value; dc = v ? Number(v) : null; });

      $$<HTMLElement>("[data-roll]", root).forEach((el) => el.addEventListener("click", () => {
        const type = el.dataset.roll as CharacterRollType;
        const spec = characterRoll(c, rules, classes, type, el.dataset.id!);
        const m = spec.d20 ? mode : "normal";
        const title = `${spec.label}${m === "advantage" ? " · mit Vorteil" : m === "disadvantage" ? " · mit Nachteil" : ""}${spec.d20 && dc ? ` · SG ${dc}` : ""}`;
        void rollWithOverlay(title, () => api.check({ requestId: uuid(), characterId: c.id, check: { type, id: el.dataset.id! }, mode: m, dc: spec.d20 && dc ? dc : undefined }));
      }));

      let hpTimer = 0;
      $$<HTMLElement>("[data-hp]", root).forEach((b) => b.addEventListener("click", () => {
        const before = c.hp.current;
        c.hp.current = Math.max(0, Math.min(c.hp.max, c.hp.current + Number(b.dataset.hp)));
        countUp($("#hp-cur", root), c.hp.current, 300, before);
        const fill = $("#hp-fill", root);
        fill.style.width = `${(c.hp.current / c.hp.max) * 100}%`;
        fill.classList.toggle("low", c.hp.current / c.hp.max <= 0.3);
        clearTimeout(hpTimer);
        hpTimer = window.setTimeout(() => { api.patchCharacter(c.id, { hpCurrent: c.hp.current }).catch((e) => toast((e as Error).message, "error")); }, 400);
      }));
      $("#hp-fill", root).classList.toggle("low", c.hp.current / c.hp.max <= 0.3);

      $("#delete-char", root).addEventListener("click", async () => {
        if (!(await confirmDialog("Figur löschen?", `${c.name} wird endgültig gelöscht. Das lässt sich nicht rückgängig machen.`, "Löschen", true))) return;
        await api.deleteCharacter(c.id);
        toast(`${c.name} ist in die Legenden eingegangen.`);
        go("/figuren");
      });

      enhance(root);
    },
  };
}
