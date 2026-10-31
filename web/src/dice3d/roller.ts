// Ablauf eines Wurfs: Ergebnis vom Server holen → Bahn planen → abspielen → Ergebnis erklären.
import { formatModifier, type RollRecord } from "../../../shared/dice";
import { $, fragment, html, sleep, type Raw } from "../lib/dom";
import { term } from "../lib/glossary";
import { icon } from "../lib/icons";
import { settings, updateSettings, useSimpleDice } from "../lib/settings";
import { toast } from "../lib/ui";
import { countUp } from "../fx/effects";
import { unlockAudio } from "./audio";
import { planPhysicalRoll, planSimpleRoll, type RollPlan } from "./plan";
import { DiceStage, type PlayStats } from "./stage";

let stage: DiceStage | null = null;
export function getStage(): DiceStage {
  stage ??= new DiceStage();
  return stage;
}

let busy = false;
export const isRolling = () => busy;

/** Spielt einen bereits feststehenden Server-Wurf auf der Bühne ab. */
export async function presentOnStage(s: DiceStage, record: RollRecord): Promise<PlayStats> {
  const st = settings();
  const simple = useSimpleDice();
  s.setSimple(simple);
  s.clear(); // erst danach steht die Tischgröße fest, für die die Bahn berechnet wird
  const dice = record.dice.map((d) => ({ kind: d.kind, face: d.face }));
  // Im Hintergrund-Tab laufen keine Animationen – dann direkt das Ergebnis zeigen.
  const instant = st.animation === "off" || document.visibilityState === "hidden";
  let plan: RollPlan;
  let physical = false;
  if (instant || simple) plan = planSimpleRoll(dice, s.arena, Math.random, st.animation === "short" ? 1.0 : 1.6);
  else {
    try {
      plan = planPhysicalRoll(dice, s.arena);
      physical = true;
    } catch {
      plan = planSimpleRoll(dice, s.arena);
    }
  }
  const effect = st.slowmo && !instant ? (record.natural === 20 ? "crit" : record.natural === 1 ? "fumble" : null) : null;
  const stats = await s.play({
    dice, plan, kept: record.dice.map((d) => d.kept), theme: st.diceTheme,
    speed: st.animation === "short" ? 1.9 : 1, slowmoTail: !!effect && st.animation === "full",
    effect, sound: st.sound, instant,
  });
  // Ruckelt es auf diesem Gerät? Dann künftig vereinfachte Animation.
  if (physical && st.quality === "auto" && stats.avgFps < 32 && !st.lowPerfDetected) {
    updateSettings({ lowPerfDetected: true });
    toast("Dein Gerät kam ins Schwitzen – ab jetzt rollen die Würfel mit einer leichteren Animation. Änderbar in den Einstellungen.");
  }
  return stats;
}

function groupLabel(record: RollRecord, g: number): string {
  const kinds = record.dice.filter((d) => d.group === g).map((d) => d.kind);
  if (kinds.includes("d10t")) return "W100";
  return `W${kinds[0].slice(1)}`;
}

/** Erklärt ein Ergebnis in einfacher Sprache. */
export function resultPanel(record: RollRecord, opts: { compact?: boolean } = {}): Raw {
  const groups = record.values.map((v, g) => ({ v, g, label: groupLabel(record, g), kept: record.dice.find((d) => d.group === g)!.kept }));
  const crit = record.critical === "hit", fumble = record.critical === "fumble";
  const keptVals = groups.filter((x) => x.kept);

  let verdict: Raw | null = null;
  if (record.success !== null) {
    verdict = record.success
      ? html`<div class="result-verdict good">${crit ? (record.critFrom && record.natural !== 20 ? `Kritisch (Glückskind: ab ${record.critFrom})!` : "Kritischer Erfolg!") : record.brilliant ? "Glanzerfolg!" : "Geschafft!"}</div>`
      : html`<div class="result-verdict bad">${fumble ? "Patzer!" : "Nicht geschafft"}</div>`;
  } else if (crit) verdict = html`<div class="result-verdict good" style="color:var(--gold)">Natürliche 20 – kritisch!</div>`;
  else if (fumble) verdict = html`<div class="result-verdict bad">Natürliche 1 – ein Patzer!</div>`;

  const explain: Raw[] = [];
  if (record.mode !== "normal") {
    const [a, b] = record.values;
    explain.push(html`${term(record.mode === "advantage" ? "vorteil" : "nachteil")}: Zwei W20 zeigten ${a} und ${b} – es zählt die ${record.mode === "advantage" ? "höhere" : "niedrigere"} (${record.natural}). `);
  }
  if (crit) explain.push(html`Eine 20 auf dem W20 gelingt immer und besonders gut. `);
  if (fumble) explain.push(html`Eine 1 auf dem W20 misslingt immer. `);
  if (record.dc !== null && !crit && !fumble) explain.push(html`Ziel war ${term("sg", "SG")} ${record.dc}: ${record.total} ${record.total >= record.dc ? "≥" : "<"} ${record.dc}. `);
  if (record.kind === "check" && record.dc === null && record.natural !== null && !crit && !fumble)
    explain.push(html`Ob ${record.total} reicht, entscheidet der Spielleiter – mittel wäre 13, schwer 16. `);
  if (record.natural === null && record.kind === "check") explain.push(html`So viele ${term("tp", "Trefferpunkte")} verliert das Ziel. `);
  if (groups.some((x) => x.label === "W100")) explain.push(html`${term("w100", "W100")}: Zehner- und Einerwürfel zusammen gelesen. `);

  return html`
    <div class="result-panel ${opts.compact ? "compact" : ""}">
      <div class="eyebrow" style="justify-content:center;margin-bottom:6px">${record.label}</div>
      <div class="result-total ${crit ? "crit" : fumble ? "fumble" : ""}" data-count="${record.total}">${record.total}</div>
      ${verdict}
      <div class="result-math">
        ${groups.map((x, i) => html`${i > 0 && x.kept && keptVals[0] !== x ? html`<span class="op">+</span>` : ""}<span class="die-chip ${x.kept ? "" : "dropped"}" style="--i:${i}" title="${x.kept ? "" : "verworfen"}">${x.v}<small>${x.label}</small></span>`)}
        ${record.modifierParts.map((p) => html`<span class="op">${p.value < 0 ? "−" : "+"}</span><span class="chip" title="${p.label}">${Math.abs(p.value)} ${p.label}</span>`)}
        ${record.modifierParts.length || keptVals.length > 1 ? html`<span class="op">=</span><span class="badge-num">${record.total}</span>` : ""}
      </div>
      ${explain.length ? html`<p class="result-explain">${explain}</p>` : ""}
      <div class="result-meta">${icon("lock")} ${term("fair", "Fair gewürfelt")} · Wurf ${record.id.slice(0, 8)}${record.repeated ? " · bereits gewürfelt (kein neuer Wurf)" : ""}</div>
    </div>`;
}

export function modifierText(record: RollRecord) {
  return record.modifier ? formatModifier(record.modifier) : "";
}

/**
 * Öffnet das Würfel-Overlay, holt das Ergebnis vom Server und spielt es ab.
 * Es gibt keinen „Nochmal“-Knopf: Ein Wurf ist endgültig.
 */
export async function rollWithOverlay(title: string, request: () => Promise<RollRecord>): Promise<RollRecord | null> {
  if (busy) return null;
  busy = true;
  unlockAudio();
  const overlay = $("#dice-overlay");
  overlay.innerHTML = html`
    <div class="overlay-stage">
      <div class="overlay-title">${title}</div>
      <button class="icon-btn overlay-close" aria-label="Schließen" data-close>${icon("x")}</button>
      <div class="stage-host"></div>
    </div>
    <div class="overlay-result"><div class="result-panel waiting"><div class="eyebrow" style="justify-content:center">Die Würfel rollen …</div></div></div>`.value;
  overlay.hidden = false;
  overlay.classList.remove("closing");
  const s = getStage();
  s.mount($(".stage-host", overlay));

  let closed = false;
  let resolveClose: () => void = () => {};
  const closedP = new Promise<void>((r) => (resolveClose = r));
  const close = () => {
    if (closed) return;
    closed = true;
    overlay.classList.add("closing");
    setTimeout(() => { overlay.hidden = true; overlay.classList.remove("closing"); resolveClose(); }, 320);
    removeEventListener("keydown", onKey);
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" || (e.key === "Enter" && overlay.querySelector(".result-panel:not(.waiting)"))) close(); };
  addEventListener("keydown", onKey);
  overlay.querySelector("[data-close]")!.addEventListener("click", close);

  let record: RollRecord | null = null;
  try {
    record = await request();
    await presentOnStage(s, record);
    const panel = fragment(resultPanel(record));
    panel.insertAdjacentHTML("beforeend", html`<div class="result-actions"><button class="btn magnetic" data-close>${icon("check")} Weiter</button></div>`.value);
    $(".overlay-result", overlay).replaceChildren(panel);
    const total = panel.querySelector<HTMLElement>(".result-total")!;
    countUp(total, record.total, settings().animation === "off" ? 0 : 700);
    panel.querySelector<HTMLElement>("[data-close]")!.addEventListener("click", close);
    panel.querySelector<HTMLElement>("[data-close]")!.focus();
  } catch (e) {
    toast((e as Error).message, "error");
    close();
  } finally {
    busy = false;
  }
  await Promise.race([closedP, sleep(10 * 60 * 1000)]);
  return record;
}
