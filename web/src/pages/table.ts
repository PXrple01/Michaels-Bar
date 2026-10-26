import { formatNotation, NotationError, parseNotation, type DieSides, type RollMode, type RollRecord } from "../../../shared/dice";
import { unlockAudio } from "../dice3d/audio";
import { getStage, presentOnStage, resultPanel } from "../dice3d/roller";
import { countUp, enhance } from "../fx/effects";
import { api } from "../lib/api";
import { $, $$, fragment, html, setHTML, uuid } from "../lib/dom";
import { term } from "../lib/glossary";
import { diceShape, icon } from "../lib/icons";
import type { Page } from "../lib/router";
import { settings } from "../lib/settings";
import { bindSegmented, segmented, setSegmented, toast } from "../lib/ui";

const SIDES: DieSides[] = [20, 4, 6, 8, 10, 12, 100];
const PRESETS = [
  { label: "Probe", notation: "1W20", mode: "normal" as RollMode },
  { label: "Vorteil", notation: "1W20", mode: "advantage" as RollMode },
  { label: "Nachteil", notation: "1W20", mode: "disadvantage" as RollMode },
  { label: "Langschwert", notation: "1W8+2", mode: "normal" as RollMode },
  { label: "2W6", notation: "2W6", mode: "normal" as RollMode },
  { label: "Prozent", notation: "1W100", mode: "normal" as RollMode },
];

function timeText(iso: string) {
  return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function tablePage(): Page {
  const pool = new Map<DieSides, number>([[20, 1]]);
  let mod = 0;
  let mode: RollMode = "normal";
  let rolling = false;
  let onKey: ((e: KeyboardEvent) => void) | null = null;

  return {
    async render(root) {
      setHTML(root, html`
        <div class="container table-page">
          <header class="page-head" data-reveal>
            <div class="eyebrow">Freies Würfeln</div>
            <h1>Würfeltisch</h1>
            <p class="lead">Stell dir einen Wurf zusammen und wirf. Jedes Ergebnis kommt ${term("fair", "fair vom Server")} – der Würfel rollt dann genau dorthin.</p>
          </header>
          <div class="table-layout">
            <div class="table-stage card" data-reveal="scale">
              <div class="stage-host" id="table-host"></div>
              <div class="stage-hint" id="stage-hint">${icon("dice")}<span>Wähle rechts deine Würfel und wirf!</span></div>
            </div>
            <aside class="table-controls card" data-reveal>
              <h3>Würfel wählen</h3>
              <div class="die-picker">
                ${SIDES.map((s) => html`<button class="die-pick" data-add="${s}" aria-label="W${s} hinzufügen">${diceShape(s)}<b>W${s}</b><span class="dp-count" data-count="${s}"></span></button>`)}
              </div>
              <div class="pool-list" id="pool-list"></div>
              <div class="mod-row">
                <span>${term("bonus", "Bonus")}</span>
                <div class="stepper">
                  <button class="round-btn" data-mod="-1" aria-label="Bonus senken">${icon("minus")}</button>
                  <b id="mod-val">+0</b>
                  <button class="round-btn" data-mod="1" aria-label="Bonus erhöhen">${icon("plus")}</button>
                </div>
              </div>
              <div class="mode-row">
                ${segmented<RollMode>("tmode", [{ value: "normal", label: "Normal" }, { value: "advantage", label: "Vorteil" }, { value: "disadvantage", label: "Nachteil" }], mode)}
                <p class="hint" id="mode-hint"></p>
              </div>
              <button class="btn btn-lg roll-btn magnetic glow-border" id="roll-btn">${icon("dice")} <span>Würfeln</span> <code id="notation">1W20</code></button>
              <p class="hint center">Tipp: Leertaste würfelt.</p>
              <div class="presets">
                ${PRESETS.map((p, i) => html`<button class="chip preset" data-preset="${i}">${p.label}</button>`)}
              </div>
            </aside>
          </div>
          <div class="table-result" id="table-result"></div>
          <section class="history card" data-reveal>
            <h3>${icon("scroll")} Wurf-Protokoll</h3>
            <p class="hint">Jeder Wurf wird mit ID und Uhrzeit protokolliert und kann nicht neu gewürfelt werden.</p>
            <ol class="history-list" id="history"></ol>
          </section>
        </div>`);

      const stage = getStage();
      stage.mount($("#table-host", root));
      stage.clear();

      const isSingleD20 = () => pool.size === 1 && pool.get(20) === 1;
      const notation = () => {
        const terms = [...pool.entries()].filter(([, n]) => n > 0).map(([sides, count]) => ({ sides, count }));
        return terms.length ? formatNotation(terms, mod) : "";
      };

      const sync = () => {
        $$<HTMLElement>("[data-count]", root).forEach((el) => {
          const n = pool.get(Number(el.dataset.count) as DieSides) ?? 0;
          el.textContent = n ? String(n) : "";
          el.parentElement!.classList.toggle("active", n > 0);
        });
        $("#pool-list", root).innerHTML = html`${[...pool.entries()].map(([s, n]) => html`<button class="chip pool-chip" data-remove="${s}" title="Einen entfernen">${n}× W${s} ${icon("x")}</button>`)}`.value || '<span class="muted small">Noch keine Würfel gewählt</span>';
        $("#mod-val", root).textContent = mod >= 0 ? `+${mod}` : `−${Math.abs(mod)}`;
        const single = isSingleD20();
        if (!single && mode !== "normal") { mode = "normal"; setSegmented(root, "tmode", "normal"); }
        $$<HTMLButtonElement>('[data-seg="tmode"] button', root).forEach((b) => { if (b.dataset.value !== "normal") b.disabled = !single; });
        $("#mode-hint", root).innerHTML = (single
          ? mode === "advantage" ? html`${term("vorteil")}: zwei W20, der höhere zählt.` : mode === "disadvantage" ? html`${term("nachteil")}: zwei W20, der niedrigere zählt.` : html`Ein W20 mit Bonus – eine klassische ${term("probe")}.`
          : html`Vorteil/Nachteil gibt es nur für einen einzelnen W20.`).value;
        const n = notation();
        $("#notation", root).textContent = n || "—";
        $<HTMLButtonElement>("#roll-btn", root).disabled = !n || rolling;
      };

      const total = () => [...pool.values()].reduce((a, b) => a + b, 0);

      root.addEventListener("click", (e) => {
        const t = e.target as HTMLElement;
        const add = t.closest<HTMLElement>("[data-add]");
        if (add) {
          const s = Number(add.dataset.add) as DieSides;
          if (total() >= 12) { toast("Höchstens 12 Würfel auf einmal auf dem Tisch."); return; }
          pool.set(s, (pool.get(s) ?? 0) + 1);
          add.classList.remove("bump"); void add.offsetWidth; add.classList.add("bump");
          sync();
          return;
        }
        const rem = t.closest<HTMLElement>("[data-remove]");
        if (rem) {
          const s = Number(rem.dataset.remove) as DieSides;
          const n = (pool.get(s) ?? 0) - 1;
          if (n > 0) pool.set(s, n); else pool.delete(s);
          sync();
          return;
        }
        const m = t.closest<HTMLElement>("[data-mod]");
        if (m) { mod = Math.max(-20, Math.min(20, mod + Number(m.dataset.mod))); sync(); return; }
        const p = t.closest<HTMLElement>("[data-preset]");
        if (p) {
          const preset = PRESETS[Number(p.dataset.preset)];
          const parsed = parseNotation(preset.notation);
          pool.clear();
          for (const term of parsed.terms) pool.set(term.sides, term.count);
          mod = parsed.modifier;
          mode = preset.mode;
          setSegmented(root, "tmode", mode);
          sync();
          void doRoll();
        }
      });
      bindSegmented<RollMode>(root, "tmode", (v) => { mode = v; sync(); });

      const history = $("#history", root);
      const addHistory = (r: RollRecord, animate: boolean) => {
        const li = fragment(html`<li class="${animate ? "new" : ""}">
          <span class="h-total ${r.critical === "hit" ? "crit" : r.critical === "fumble" ? "fumble" : ""}">${r.total}</span>
          <span class="h-main"><b>${r.label}</b><span>${r.notation}${r.mode !== "normal" ? ` · ${r.mode === "advantage" ? "Vorteil" : "Nachteil"}` : ""} · gewürfelt: ${r.values.join(", ")}</span></span>
          <span class="h-meta">${timeText(r.createdAt)}<code>${r.id.slice(0, 8)}</code></span>
        </li>`);
        history.prepend(li);
        while (history.children.length > 25) history.lastElementChild!.remove();
      };
      api.rolls(25).then((list) => list.reverse().forEach((r) => addHistory(r, false))).catch(() => {});

      const doRoll = async () => {
        const n = notation();
        if (!n || rolling) return;
        rolling = true;
        sync();
        unlockAudio();
        $("#stage-hint", root).classList.add("gone");
        if (innerWidth < 960) $(".table-stage", root).scrollIntoView({ behavior: "smooth", block: "start" });
        const resultEl = $("#table-result", root);
        resultEl.innerHTML = "";
        try {
          const record = await api.roll({ requestId: uuid(), notation: n, mode: isSingleD20() ? mode : "normal", label: "Freier Wurf" });
          await presentOnStage(stage, record);
          resultEl.replaceChildren(fragment(resultPanel(record, { compact: true })));
          countUp(resultEl.querySelector<HTMLElement>(".result-total")!, record.total, settings().animation === "off" ? 0 : 600);
          addHistory(record, true);
        } catch (e) {
          toast(e instanceof NotationError ? e.message : (e as Error).message, "error");
        } finally {
          rolling = false;
          sync();
        }
      };
      $("#roll-btn", root).addEventListener("click", () => void doRoll());
      onKey = (e) => {
        if (e.code !== "Space" || (e.target as HTMLElement).closest("input, textarea, select, button")) return;
        e.preventDefault();
        void doRoll();
      };
      addEventListener("keydown", onKey);

      sync();
      enhance(root);
    },
    leave() { if (onKey) removeEventListener("keydown", onKey); },
  };
}
