import { attributeCost, attributeProblems, characterProblems, magicAllowed, maxHpAtLevel, modifier, pointsSpent, findItem } from "../../../shared/character";
import { formatModifier } from "../../../shared/dice";
import type { CharacterInput, ClassDef, Rules } from "../../../shared/schema";
import { countUp, enhance } from "../fx/effects";
import { api, ApiError, loadGameData, type GameData } from "../lib/api";
import { allClasses, classStore } from "../lib/customClasses";
import { $, $$, html, setHTML, type Raw } from "../lib/dom";
import { term } from "../lib/glossary";
import { modsChips } from "../lib/attrMods";
import { icon, sigil } from "../lib/icons";
import { go, type Page } from "../lib/router";
import { toast } from "../lib/ui";

const NAMES = ["Adelheid", "Albrecht", "Agnes", "Berthold", "Brunhild", "Konrad", "Kunigunde", "Dietrich", "Elsbeth", "Eberhard", "Friedrich", "Gisela", "Gottfried", "Hedwig", "Hagen", "Irmgard", "Jakob", "Liutgard", "Lambert", "Mechthild", "Mattes", "Notburga", "Ortwin", "Richza", "Rupert", "Sieglinde", "Ulrich", "Walburga", "Wolfram", "Ysolde", "Gerlind", "Rapunzel von Ach", "Kaspar der Rote", "Gret Wolfsmilch", "Henner Ohnefurcht", "Jutta vom Moor"];
const SUGGEST = {
  trait: ["Lacht in den unpassendsten Momenten.", "Traut niemandem, der zu freundlich ist.", "Sammelt Knochen von Heiligen – angeblich.", "Redet mit Tieren, als würden sie antworten.", "Kann keinem Würfelspiel widerstehen.", "Spricht kaum, beobachtet alles.", "Erzählt jede Geschichte etwas größer, als sie war."],
  ideal: ["Gerechtigkeit – auch gegen den Fürsten.", "Freiheit – kein Herr soll über mich bestimmen.", "Treue – ich verlasse niemanden.", "Wissen – jede Wahrheit ist es wert, gefunden zu werden.", "Gold – wer zahlt, hat recht.", "Barmherzigkeit – den Schwachen helfen."],
  bond: ["Meine kleine Schwester ist im Kloster verschwunden.", "Ich schulde einem Hehler in der Stadt viel Geld.", "Mein alter Lehrmeister wurde ermordet.", "Ich trage den Ring meiner Mutter – er öffnet eine Tür, die ich nicht kenne.", "Mein Dorf wurde von Söldnern niedergebrannt."],
  flaw: ["Ich bin furchtbar abergläubisch.", "Ich kann bei einer Wette nicht Nein sagen.", "Mein Jähzorn hat schon Freundschaften gekostet.", "Ich lüge, auch wenn die Wahrheit leichter wäre.", "Wein macht mich redselig – zu redselig.", "Ich habe panische Angst vor Wasser."],
};
const STEP_TITLES = ["Herkunft", "Klasse", "Attribute", "Fertigkeiten", "Persönlichkeit", "Fertig"];
const DRAFT_KEY = "wus.draft.v1";

interface Draft { step: number; c: Required<Omit<CharacterInput, "personality" | "appearance" | "customClass" | "statsVersion">> & { personality: { trait: string; ideal: string; bond: string; flaw: string }; appearance: string } }

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const DIFF = ["", "Einsteigerfreundlich", "Etwas Übung", "Für Erfahrene"];

export function createPage(): Page {
  let data: GameData;
  let d: Draft;
  let root: HTMLElement;
  let direction = 1;

  const save = () => { try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* egal */ } };
  const classes = () => allClasses(data);
  const cls = () => classes().find((c) => c.id === d.c.classId);

  function freshDraft(rules: Rules): Draft {
    return {
      step: 0,
      c: {
        name: "", stand: "", classId: "",
        attributes: Object.fromEntries(rules.attributes.map((a) => [a.id, rules.attributeRules.base])),
        chosenSkills: [], personality: { trait: "", ideal: "", bond: "", flaw: "" }, appearance: "",
      },
    };
  }

  /** Was fehlt noch, um weiterzukommen? */
  function blocker(step: number): string | null {
    const { rules } = data;
    const c = d.c;
    if (step === 0) {
      if (!c.name.trim()) return "Gib deiner Figur einen Namen.";
      if (!c.stand) return "Wähle eine Herkunft.";
    }
    if (step === 1 && !c.classId) return "Wähle eine Klasse.";
    if (step === 2) {
      const left = rules.attributeRules.pointBudget - pointsSpent(c.attributes, rules);
      const probs = attributeProblems(c.attributes, rules);
      if (probs.length) return probs[0];
      if (left > 0) return `Du hast noch ${left} Punkt${left === 1 ? "" : "e"} übrig.`;
    }
    if (step === 3) {
      const need = cls()?.skillChoices.count ?? 0;
      if (c.chosenSkills.length !== need) return `Wähle noch ${need - c.chosenSkills.length} Fertigkeit${need - c.chosenSkills.length === 1 ? "" : "en"}.`;
    }
    return null;
  }

  function stepper(): Raw {
    return html`<div class="steps">
      ${STEP_TITLES.map((t, i) => html`
        ${i > 0 ? html`<div class="step-line" style="--fill:${i <= d.step ? 1 : 0}"></div>` : ""}
        <button class="step-dot ${i < d.step ? "done" : ""} ${i === d.step ? "current" : ""}" ${i < d.step ? "" : "disabled"} data-goto="${i}" aria-label="Schritt ${i + 1}: ${t}">
          ${i < d.step ? icon("check") : i + 1}<span class="step-label">${t}</span>
        </button>`)}
    </div>`;
  }

  function stepHerkunft(): Raw {
    const { rules } = data;
    return html`
      <h2>Wer bist du?</h2>
      <p class="lead">Jede Geschichte beginnt mit einem Namen. Und mit der Frage, woher du kommst.</p>
      <div class="field name-field">
        <label for="c-name">Name deiner Figur</label>
        <div class="input-row">
          <input class="input input-lg" id="c-name" maxlength="40" placeholder="z. B. Hedwig vom Moor" value="${d.c.name}" autocomplete="off" />
          <button class="btn btn-ghost" data-action="random-name" title="Zufälliger Name">${icon("dice")}<span class="hide-sm">Zufall</span></button>
        </div>
      </div>
      <h3 class="sub">Dein ${term("stand")}</h3>
      <div class="option-grid">
        ${rules.stands.map((s, i) => html`
          <button class="card option-card tilt ${d.c.stand === s.id ? "selected" : ""}" data-action="stand" data-id="${s.id}" style="--i:${i}">
            <h3>${s.name}</h3>
            <p>${s.description}</p>
            <div class="option-meta"><span class="chip">${icon("star")} ${rules.skills.find((k) => k.id === s.skill)?.name}</span></div>
            <p class="feature">${s.feature}</p>
            <span class="check-badge">${icon("check")}</span>
          </button>`)}
      </div>`;
  }

  function stepKlasse(): Raw {
    const { campaign, rules } = data;
    const list = classes();
    const sel = cls();
    return html`
      <h2>Was kannst du?</h2>
      <p class="lead">Deine ${term("klasse")} bestimmt, wie du Probleme löst: mit dem Schwert, mit Worten oder mit Kräutern.</p>
      <div class="class-grid">
        ${[...list].sort((a, b) => Number(!!a.custom) - Number(!!b.custom) || a.difficulty - b.difficulty || a.name.localeCompare(b.name, "de")).map((c, i) => {
          const allowed = magicAllowed(c, campaign.magic_level);
          return html`
            <button class="card class-card tilt ${d.c.classId === c.id ? "selected" : ""} ${allowed ? "" : "locked"}" data-action="class" data-id="${c.id}" ${allowed ? "" : "disabled"} style="--i:${i}">
              <div class="class-sigil">${sigil(c.sigil, "draw")}</div>
              <h3>${c.name}</h3>
              <div class="class-role">${c.role}</div>
              ${c.custom ? html`<span class="chip gold">${icon("wand")} Eigene Klasse</span>` : ""}
              <p class="tagline">„${c.tagline}“</p>
              <div class="diff" title="${DIFF[c.difficulty]}">${[1, 2, 3].map((n) => html`<i class="${n <= c.difficulty ? "on" : ""}"></i>`)}<span>${DIFF[c.difficulty]}</span></div>
              ${allowed ? "" : html`<div class="lock-note">${icon("lock")} Braucht mehr Magie in der Welt</div>`}
              <span class="check-badge">${icon("check")}</span>
            </button>`;
        })}
        <a class="card class-card new-card tilt" href="#/klassen/neu">
          <div class="new-plus">${icon("plus")}</div>
          <h3>Eigene Klasse bauen</h3>
          <p class="tagline">Beschreibe sie – Claude bewertet, das Regelprogramm prüft.</p>
        </a>
      </div>
      ${sel ? html`
        <div class="card class-detail glow-border" id="class-detail">
          <div class="cd-head">
            <div class="cd-sigil">${sigil(sel.sigil, "draw")}</div>
            <div>
              <h3>${sel.name}</h3>
              <p>${sel.description}</p>
              <div class="callout slim">${icon("info")}<p>${sel.beginnerTip}</p></div>
            </div>
          </div>
          <div class="cd-stats">
            <div><span>${term("trefferwuerfel")}</span><b>W${sel.hitDie}</b></div>
            <div><span>Wichtig</span><b>${sel.primaryAttributes.map((a) => rules.attributes.find((x) => x.id === a)?.name).join(" & ")}</b></div>
            <div><span>Grundwerte</span><b>${modsChips(sel.attributeMods, rules)}</b></div>
            <div><span>Rüstung</span><b>${sel.armor.join(", ")}</b></div>
            <div><span>Waffe</span><b>${findItem(rules, sel.equippedWeapon)?.name}</b></div>
          </div>
          <h4>Fähigkeiten</h4>
          <div class="abilities">
            ${sel.abilities.map((a) => html`
              <details class="ability">
                <summary><b>${a.name}</b><span class="chip">${usesLabel(a.uses)}</span><span>${a.beginnerText}</span></summary>
                <p class="rule-text">${icon("scroll")} Regel: ${a.text}</p>
              </details>`)}
          </div>
        </div>` : ""}`;
  }

  function stepAttribute(): Raw {
    const { rules } = data;
    const r = rules.attributeRules;
    const spent = pointsSpent(d.c.attributes, rules);
    const left = r.pointBudget - spent;
    const c = cls();
    return html`
      <h2>Wie bist du?</h2>
      <p class="lead">Verteile ${r.pointBudget} Punkte auf deine sechs ${term("attribut", "Attribute")}. Jedes startet bei 10 (Durchschnitt). Danach kommen die Grundwerte deiner Klasse dazu${c && Object.keys(c.attributeMods ?? {}).length ? html` – bei ${c.name}: ${modsChips(c.attributeMods, rules)}` : ""}. Höhere Werte geben einen ${term("bonus")} auf Würfe.</p>
      <div class="pool card glow-border">
        <div class="pool-gems">${Array.from({ length: r.pointBudget }, (_, i) => html`<i class="${i < left ? "on" : ""}" style="--i:${i}"></i>`)}</div>
        <div class="pool-text"><b id="pool-left">${left}</b> von ${r.pointBudget} Punkten übrig</div>
        <div class="pool-actions">
          ${c ? html`<button class="btn btn-sm" data-action="recommend">${icon("sparkles")} Empfehlung für ${c.name}</button>` : ""}
          <button class="btn btn-ghost btn-sm" data-action="reset-attrs">${icon("refresh")} Zurücksetzen</button>
        </div>
      </div>
      <p class="hint">Bis 13 kostet jeder Punkt 1, darüber 2. Senkst du ein Attribut unter 10, bekommst du Punkte zurück (höchstens zwei Attribute).</p>
      <div class="attr-rows">
        ${rules.attributes.map((a, i) => {
          const v = d.c.attributes[a.id];
          const mod = c?.attributeMods?.[a.id] ?? 0;
          const fin = v + mod;
          const important = c?.primaryAttributes.includes(a.id);
          const nextCost = attributeCost(v + 1, rules) - attributeCost(v, rules);
          return html`
            <div class="attr-row card ${important ? "important" : ""}" style="--i:${i}" data-attr="${a.id}">
              <div class="ar-icon">${icon(a.icon)}</div>
              <div class="ar-text">
                <h3>${a.name} ${important ? html`<span class="chip gold">${icon("star")} wichtig für ${c!.name}</span>` : ""}</h3>
                <p>${a.description}</p>
              </div>
              <div class="ar-ctrl">
                <button class="round-btn" data-action="dec" data-id="${a.id}" aria-label="${a.name} senken" ${canDec(a.id) ? "" : "disabled"}>${icon("minus")}</button>
                <div class="ar-val"><b>${fin}</b>${mod ? html`<small class="ar-mod-note ${mod > 0 ? "pos" : "neg"}" title="${v} gekauft, ${mod > 0 ? "+" : "−"}${Math.abs(mod)} durch ${c!.name}">${v} ${mod > 0 ? "+" : "−"} ${Math.abs(mod)}</small>` : ""}<span class="ar-bar"><i style="width:${Math.max(0, Math.min(100, ((fin - r.min) / (r.max + 2 - r.min)) * 100))}%"></i></span></div>
                <button class="round-btn" data-action="inc" data-id="${a.id}" aria-label="${a.name} erhöhen" ${canInc(a.id) ? "" : "disabled"} title="Nächster Punkt kostet ${nextCost}">${icon("plus")}</button>
                <div class="ar-mod ${modifier(fin) > 0 ? "pos" : modifier(fin) < 0 ? "neg" : ""}" title="Bonus auf Würfe">${formatModifier(modifier(fin))}</div>
              </div>
            </div>`;
        })}
      </div>`;
  }

  function canInc(id: string) {
    const { rules } = data;
    const v = d.c.attributes[id];
    if (v >= rules.attributeRules.max) return false;
    const delta = attributeCost(v + 1, rules) - attributeCost(v, rules);
    return pointsSpent(d.c.attributes, rules) + delta <= rules.attributeRules.pointBudget;
  }
  function canDec(id: string) {
    const { rules } = data;
    const r = rules.attributeRules;
    const v = d.c.attributes[id];
    if (v <= r.min) return false;
    if (v - 1 >= r.base) return true;
    const lowered = Object.entries(d.c.attributes).filter(([k, x]) => x < r.base && k !== id).length;
    return lowered < r.maxLoweredAttributes;
  }

  function stepSkills(): Raw {
    const { rules } = data;
    const c = cls()!;
    const stand = rules.stands.find((s) => s.id === d.c.stand);
    const fixed = new Set([...c.trainedSkills, ...(stand ? [stand.skill] : [])]);
    const skillName = (id: string) => rules.skills.find((s) => s.id === id);
    const need = c.skillChoices.count;
    return html`
      <h2>Worin bist du geübt?</h2>
      <p class="lead">${term("fertigkeit", "Fertigkeiten")}, in denen du geübt bist, bekommen zusätzlich deinen ${term("koennen")} (+2).</p>
      <h3 class="sub">Schon geübt durch Klasse und Herkunft</h3>
      <div class="skill-chips">
        ${[...fixed].map((id) => html`<span class="skill-chip fixed">${icon("lock")} ${skillName(id)?.name}</span>`)}
      </div>
      <h3 class="sub">Wähle ${need} weitere <span class="badge-num" id="skill-count">${d.c.chosenSkills.length}/${need}</span></h3>
      <div class="skill-pick">
        ${c.skillChoices.from.map((id, i) => {
          const s = skillName(id)!;
          const on = d.c.chosenSkills.includes(id);
          const attr = rules.attributes.find((a) => a.id === s.attribute)!;
          return html`<button class="card skill-option ${on ? "selected" : ""}" data-action="skill" data-id="${id}" ${fixed.has(id) ? "disabled" : ""} style="--i:${i}">
            <b>${s.name}</b><span class="chip">${attr.short}</span>
            <p>${s.description}</p>
            ${fixed.has(id) ? html`<span class="muted small">bereits geübt</span>` : ""}
            <span class="check-badge">${icon("check")}</span>
          </button>`;
        })}
      </div>`;
  }

  function stepPersonality(): Raw {
    const field = (key: keyof Draft["c"]["personality"], label: string, ph: string) => html`
      <div class="field">
        <label for="p-${key}">${label}</label>
        <div class="input-row">
          <input class="input" id="p-${key}" data-p="${key}" maxlength="200" placeholder="${ph}" value="${d.c.personality[key]}" />
          <button class="btn btn-ghost" data-action="suggest" data-key="${key}" title="Vorschlag würfeln">${icon("dice")}</button>
        </div>
      </div>`;
    return html`
      <h2>Wer steckt dahinter?</h2>
      <p class="lead">Alles hier ist freiwillig – aber es hilft dem Spielleiter, eine Geschichte nur für dich zu erzählen. Kein Einfall? Lass den Würfel einen Vorschlag machen.</p>
      <div class="persona-grid">
        ${field("trait", "Eine Eigenart", "Was fällt anderen sofort auf?")}
        ${field("ideal", "Woran du glaubst", "Was ist dir wichtig?")}
        ${field("bond", "Was dich bindet", "Eine Person, ein Ort, ein Geheimnis")}
        ${field("flaw", "Deine Schwäche", "Was bringt dich in Schwierigkeiten?")}
      </div>
      <div class="field">
        <label for="p-look">Aussehen</label>
        <textarea class="textarea" id="p-look" maxlength="400" placeholder="Narbe über dem Auge, zerschlissener Mantel, ein Lächeln, dem man nicht traut …">${d.c.appearance}</textarea>
      </div>`;
  }

  function stepSummary(): Raw {
    const { rules } = data;
    const c = cls()!;
    const stand = rules.stands.find((s) => s.id === d.c.stand)!;
    const hp = maxHpAtLevel(c, d.c.attributes.konstitution, 1);
    return html`
      <h2>Bereit für das Abenteuer?</h2>
      <p class="lead">So sieht deine Figur aus. Passt alles? Dann erwecke sie zum Leben.</p>
      <div class="card summary glow-border">
        <div class="sum-head">
          <div class="sum-sigil">${sigil(c.sigil, "draw")}</div>
          <div>
            <h2 class="sum-name">${d.c.name}</h2>
            <p>${c.name} · ${stand.name} · Stufe 1</p>
          </div>
          <div class="sum-hp"><span>${term("tp", "TP")}</span><b>${hp}</b></div>
        </div>
        <div class="sum-attrs">
          ${rules.attributes.map((a) => { const v = d.c.attributes[a.id] + (c.attributeMods?.[a.id] ?? 0); return html`<div><span>${a.short}</span><b>${v}</b><em>${formatModifier(modifier(v))}</em></div>`; })}
        </div>
        <div class="sum-cols">
          <div><h4>Fertigkeiten</h4><p>${[...new Set([...c.trainedSkills, stand.skill, ...d.c.chosenSkills])].map((id) => rules.skills.find((s) => s.id === id)?.name).join(", ")}</p></div>
          <div><h4>Ausrüstung</h4><p>${c.startingEquipment.map((id) => findItem(rules, id)?.name).join(", ")}</p></div>
        </div>
        ${d.c.personality.trait || d.c.personality.flaw ? html`<p class="muted"><em>${[d.c.personality.trait, d.c.personality.flaw].filter(Boolean).join(" · ")}</em></p>` : ""}
      </div>`;
  }

  function usesLabel(u: string) {
    return ({ passiv: "immer aktiv", einmal_pro_kampf: "1× pro Kampf", einmal_pro_rast: "1× pro Rast", einmal_pro_tag: "1× pro Tag", beliebig: "beliebig oft" } as Record<string, string>)[u] ?? u;
  }

  function render(animate = true) {
    const steps = [stepHerkunft, stepKlasse, stepAttribute, stepSkills, stepPersonality, stepSummary];
    const block = blocker(d.step);
    setHTML(root, html`
      <div class="container wizard">
        <header class="page-head center" ${animate ? html`data-reveal` : ""}>
          <div class="eyebrow">Figur erschaffen · Schritt ${d.step + 1} von ${STEP_TITLES.length}</div>
        </header>
        ${stepper()}
        <div class="wizard-body ${animate ? (direction > 0 ? "slide-in-right" : "slide-in-left") : ""}">${steps[d.step]()}</div>
        <div class="wizard-foot">
          <button class="btn btn-ghost" data-action="back" ${d.step === 0 ? "disabled" : ""}>${icon("arrowLeft")} Zurück</button>
          <div class="wf-hint ${block ? "" : "ok"}">${block ? html`${icon("info")} ${block}` : html`${icon("check")} Alles bereit`}</div>
          ${d.step < STEP_TITLES.length - 1
            ? html`<button class="btn magnetic" data-action="next" ${block ? "disabled" : ""}>Weiter ${icon("arrowRight")}</button>`
            : html`<button class="btn btn-lg magnetic glow-border" data-action="create">${icon("sparkles")} Figur erschaffen</button>`}
        </div>
      </div>`);
    enhance(root);
    bindInputs();
  }

  /** Teil-Update ohne Neuaufbau der Seite (für flüssige Eingaben). */
  function refreshFoot() {
    const block = blocker(d.step);
    const hint = root.querySelector(".wf-hint");
    if (hint) { hint.className = `wf-hint ${block ? "" : "ok"}`; hint.innerHTML = (block ? html`${icon("info")} ${block}` : html`${icon("check")} Alles bereit`).value; }
    const next = root.querySelector<HTMLButtonElement>('[data-action="next"]');
    if (next) next.disabled = !!block;
  }

  function bindInputs() {
    root.querySelector<HTMLInputElement>("#c-name")?.addEventListener("input", (e) => { d.c.name = (e.target as HTMLInputElement).value; save(); refreshFoot(); });
    $$<HTMLInputElement>("[data-p]", root).forEach((el) => el.addEventListener("input", () => { d.c.personality[el.dataset.p as "trait"] = el.value; save(); }));
    root.querySelector<HTMLTextAreaElement>("#p-look")?.addEventListener("input", (e) => { d.c.appearance = (e.target as HTMLTextAreaElement).value; save(); });
    root.querySelector<HTMLInputElement>("#c-name")?.addEventListener("keydown", (e) => { if (e.key === "Enter" && !blocker(0)) { direction = 1; d.step = 1; save(); render(); } });
  }

  function rerenderAttrs() {
    const body = $(".wizard-body", root);
    body.innerHTML = stepAttribute().value;
    body.className = "wizard-body";
    refreshFoot();
    const left = data.rules.attributeRules.pointBudget - pointsSpent(d.c.attributes, data.rules);
    countUp($("#pool-left", root), left, 0);
  }

  return {
    async render(el) {
      root = el;
      data = await loadGameData();
      try { const raw = sessionStorage.getItem(DRAFT_KEY); d = raw ? JSON.parse(raw) : freshDraft(data.rules); } catch { d = freshDraft(data.rules); }
      if (!d?.c?.attributes) d = freshDraft(data.rules);
      render();

      root.addEventListener("click", async (ev) => {
        const t = ev.target as HTMLElement;
        const goto = t.closest<HTMLElement>("[data-goto]");
        if (goto && !goto.hasAttribute("disabled")) { const n = Number(goto.dataset.goto); direction = n > d.step ? 1 : -1; d.step = n; save(); render(); return; }
        const a = t.closest<HTMLElement>("[data-action]");
        if (!a || a.hasAttribute("disabled")) return;
        const id = a.dataset.id!;
        switch (a.dataset.action) {
          case "random-name": {
            d.c.name = pick(NAMES);
            const inp = $<HTMLInputElement>("#c-name", root);
            inp.value = d.c.name;
            inp.classList.remove("flash"); void inp.offsetWidth; inp.classList.add("flash");
            save(); refreshFoot();
            break;
          }
          case "stand":
            d.c.stand = id; save();
            $$(".option-card", root).forEach((x) => x.classList.toggle("selected", x.dataset.id === id));
            refreshFoot();
            break;
          case "class":
            if (d.c.classId !== id) d.c.chosenSkills = [];
            d.c.classId = id; save(); render(false);
            document.getElementById("class-detail")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
            break;
          case "inc": if (canInc(id)) { d.c.attributes[id]++; save(); rerenderAttrs(); } break;
          case "dec": if (canDec(id)) { d.c.attributes[id]--; save(); rerenderAttrs(); } break;
          case "recommend": d.c.attributes = { ...cls()!.recommendedAttributes }; save(); rerenderAttrs(); toast(`Werte für ${cls()!.name} übernommen.`, "success", 2500); break;
          case "reset-attrs": d.c.attributes = freshDraft(data.rules).c.attributes; save(); rerenderAttrs(); break;
          case "skill": {
            const need = cls()!.skillChoices.count;
            const has = d.c.chosenSkills.includes(id);
            if (has) d.c.chosenSkills = d.c.chosenSkills.filter((s) => s !== id);
            else if (d.c.chosenSkills.length < need) d.c.chosenSkills.push(id);
            else { toast(`Du kannst nur ${need} wählen. Tippe eine gewählte an, um sie abzuwählen.`); break; }
            save();
            a.classList.toggle("selected", !has);
            $("#skill-count", root).textContent = `${d.c.chosenSkills.length}/${need}`;
            refreshFoot();
            break;
          }
          case "suggest": {
            const key = a.dataset.key as keyof typeof SUGGEST;
            d.c.personality[key] = pick(SUGGEST[key]);
            const inp = $<HTMLInputElement>(`#p-${key}`, root);
            inp.value = d.c.personality[key];
            inp.classList.remove("flash"); void inp.offsetWidth; inp.classList.add("flash");
            save();
            break;
          }
          case "back": if (d.step > 0) { direction = -1; d.step--; save(); render(); } break;
          case "next": if (!blocker(d.step)) { direction = 1; d.step++; save(); render(); } break;
          case "create": {
            const probs = characterProblems(d.c, data.rules, classes() as ClassDef[], data.campaign.magic_level);
            if (probs.length) { toast(probs[0], "error"); break; }
            (a as HTMLButtonElement).disabled = true;
            try {
              const own = classStore.get(d.c.classId);
              const created = await api.createCharacter(own ? { ...d.c, customClass: own } : d.c);
              try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* egal */ }
              toast(`${created.name} ist bereit für das Abenteuer!`, "success");
              go(`/figur/${created.id}?neu`);
            } catch (e) {
              const msg = e instanceof ApiError && e.problems.length ? e.problems.join(" · ") : (e as Error).message;
              toast(msg, "error", 7000);
              (a as HTMLButtonElement).disabled = false;
            }
            break;
          }
        }
      });
    },
  };
}
