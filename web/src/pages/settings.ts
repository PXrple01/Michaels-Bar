import { playCrit, playImpact, unlockAudio } from "../dice3d/audio";
import { rollWithOverlay } from "../dice3d/roller";
import { DICE_THEMES } from "../dice3d/textures";
import { enhance } from "../fx/effects";
import { api, loadGameData } from "../lib/api";
import { $$, html, setHTML, uuid } from "../lib/dom";
import { icon } from "../lib/icons";
import type { Page } from "../lib/router";
import { settings, updateSettings, useSimpleDice, type DiceThemeId, type PaletteId, type Settings } from "../lib/settings";

const PALETTES: { id: PaletteId; name: string; text: string; colors: [string, string, string] }[] = [
  { id: "glut", name: "Glut", text: "Schwarz und Rot – das letzte Feuer der Nacht (Standard)", colors: ["#070404", "#e2381f", "#ffb35c"] },
  { id: "amethyst", name: "Amethyst", text: "Das ursprüngliche Lila – kühl und magisch", colors: ["#07050c", "#8b5cf6", "#c4b5fd"] },
];
import { bindSegmented, segmented, toast, toggleSwitch } from "../lib/ui";

export function settingsPage(): Page {
  return {
    async render(root) {
      const s = settings();
      const { campaign, rules } = await loadGameData().catch(() => ({ campaign: null, rules: null }));
      const magic = rules?.magicLevels.find((m) => m.id === campaign?.magic_level);
      setHTML(root, html`
        <div class="container settings">
          <header class="page-head" data-reveal>
            <div class="eyebrow">Ganz nach deinem Geschmack</div>
            <h1>Einstellungen</h1>
            <p class="lead">Wird nur in diesem Browser gespeichert.</p>
          </header>

          <section class="card set-section" data-reveal>
            <h2>${icon("sparkles")} Farbthema</h2>
            <div class="palette-grid">
              ${PALETTES.map((p) => html`<button class="palette-card ${s.palette === p.id ? "selected" : ""}" data-palette="${p.id}">
                <span class="palette-swatch" style="--a:${p.colors[0]};--b:${p.colors[1]};--c:${p.colors[2]}"><i></i><i></i><i></i></span>
                <b>${p.name}</b><small>${p.text}</small>
              </button>`)}
            </div>
          </section>

          <section class="card set-section" data-reveal>
            <h2>${icon("dice")} Würfelfarbe</h2>
            <div class="theme-grid">
              ${(Object.entries(DICE_THEMES) as [DiceThemeId, (typeof DICE_THEMES)[DiceThemeId]][]).map(([id, t]) => html`
                <button class="theme-card ${s.diceTheme === id ? "selected" : ""}" data-theme="${id}" style="--body:${t.body};--body2:${t.body2};--ink:${t.ink};--edge:${t.edge}">
                  <span class="theme-gem"><span>20</span></span>
                  <b>${t.name}</b>
                  ${id === "glut" ? html`<small>Standard</small>` : ""}
                </button>`)}
            </div>
            <button class="btn btn-ghost btn-sm" id="test-roll">${icon("play")} Probewurf</button>
          </section>

          <section class="card set-section" data-reveal>
            <h2>${icon("sparkles")} Animation</h2>
            <div class="set-row">
              <div><b>Würfel-Animation</b><p>„Kurz“ rollt schneller, „Aus“ zeigt sofort das Ergebnis.</p></div>
              ${segmented<Settings["animation"]>("animation", [{ value: "full", label: "Voll" }, { value: "short", label: "Kurz" }, { value: "off", label: "Aus" }], s.animation)}
            </div>
            <div class="set-row">
              <div><b>Qualität</b><p>„Auto“ wechselt auf schwachen Geräten zur leichten Animation ohne Physik und Schatten. Gerade aktiv: <em>${useSimpleDice() ? "leicht" : "volle Physik"}</em>.</p></div>
              ${segmented<Settings["quality"]>("quality", [{ value: "auto", label: "Auto" }, { value: "high", label: "Hoch" }, { value: "simple", label: "Leicht" }], s.quality)}
            </div>
            <div class="set-row">
              <div><b>Zeitlupe bei 20 und 1</b><p>Kritische Treffer und Patzer bekommen Zeitlupe und einen kleinen Effekt.</p></div>
              ${toggleSwitch("slowmo", s.slowmo, "Zeitlupe")}
            </div>
            <div class="set-row">
              <div><b>Hintergrund-Effekte</b><p>Glut, Nebel und Körnung im Hintergrund.</p></div>
              ${toggleSwitch("backgroundFx", s.backgroundFx, "Hintergrund-Effekte")}
            </div>
            ${s.lowPerfDetected ? html`<div class="set-row"><div><b>Leistungsmessung</b><p>Dieses Gerät wurde als langsam erkannt.</p></div><button class="btn btn-ghost btn-sm" id="reset-perf">${icon("refresh")} Zurücksetzen</button></div>` : ""}
          </section>

          <section class="card set-section" data-reveal>
            <h2>${icon("sound")} Ton</h2>
            <div class="set-row">
              <div><b>Würfelgeräusche</b><p>Klackern auf dem Tisch, Fanfare bei der 20.</p></div>
              ${toggleSwitch("sound", s.sound, "Würfelgeräusche")}
            </div>
            <button class="btn btn-ghost btn-sm" id="test-sound">${icon("play")} Anhören</button>
          </section>

          ${campaign ? html`
          <section class="card set-section" data-reveal>
            <h2>${icon("map")} Welt (campaign.json)</h2>
            <p>Diese Werte stehen in <code>data/campaign.json</code> und gelten für alle Spieler. Ändere die Datei und starte den Server neu.</p>
            <div class="world-grid">
              <div><span>Magie</span><b>${magic?.name ?? campaign.magic_level}</b><small>${magic?.description ?? ""}</small></div>
              <div><span>Ton</span><b>${campaign.tone}</b></div>
              <div><span>Schwierigkeit</span><b>${campaign.difficulty}</b></div>
              <div><span>Tabus</span><b>${campaign.taboos.join(", ") || "keine"}</b></div>
            </div>
          </section>` : ""}

          <section class="card set-section" data-reveal>
            <h2>${icon("zap")} Für Chat-Apps und Programme</h2>
            <p>Den Spielleiter kannst du auch aus anderen Programmen ansprechen, die das OpenAI-Format verstehen – etwa Chat-Apps, in denen man eine eigene „OpenAI-kompatible“ Adresse eintragen kann, oder eigene Skripte mit der OpenAI-Bibliothek.</p>
            <div class="api-grid">
              <div><span>Adresse (Base URL)</span><code id="api-base">${location.origin}/v1</code><button class="btn btn-ghost btn-sm" data-copy="api-base">${icon("scroll")} Kopieren</button></div>
              <div><span>API-Schlüssel</span><b>Der Wert von <code>OPENAI_COMPAT_KEY</code></b><small>Lege ihn in den Netlify-Umgebungsvariablen an (beliebiger langer Text). Ohne ihn ist die Schnittstelle aus.</small></div>
              <div><span>Modell</span><b><code>the-last-ember</code></b><small>Mit Lebenspunkten, Kampf und Aufträgen. Zeigt deine App seltsamen Text wie <code>&lt;!-- the-last-ember:… --&gt;</code>, nimm <code>the-last-ember-einfach</code>. Die alten Namen <code>michaels-bar</code> funktionieren weiter.</small></div>
            </div>
            <p class="hint">Proben würfelt der Server dort sofort selbst – fair wie hier. Gespielt wird mit dem Söldner „Wanderer“; eine eigene Figur schickst du mit dem Feld <code>character</code> mit (auf dem Charakterbogen: „Für Chat-Apps kopieren“). Jeder Zug zählt zum selben Monatsbudget.</p>
          </section>
        </div>`);

      $$<HTMLElement>("[data-palette]", root).forEach((b) => b.addEventListener("click", () => {
        updateSettings({ palette: b.dataset.palette as PaletteId });
        $$("[data-palette]", root).forEach((x) => x.classList.toggle("selected", x === b));
      }));
      $$<HTMLElement>("[data-theme]", root).forEach((b) => b.addEventListener("click", () => {
        updateSettings({ diceTheme: b.dataset.theme as DiceThemeId });
        $$("[data-theme]", root).forEach((x) => x.classList.toggle("selected", x === b));
      }));
      bindSegmented<Settings["animation"]>(root, "animation", (v) => updateSettings({ animation: v }));
      bindSegmented<Settings["quality"]>(root, "quality", (v) => updateSettings({ quality: v }));
      $$<HTMLElement>("[data-toggle]", root).forEach((t) => t.addEventListener("click", () => {
        const key = t.dataset.toggle as "slowmo" | "backgroundFx" | "sound";
        const on = t.getAttribute("aria-checked") !== "true";
        t.setAttribute("aria-checked", String(on));
        updateSettings({ [key]: on } as Partial<Settings>);
      }));
      $$<HTMLElement>("[data-copy]", root).forEach((b) => b.addEventListener("click", async () => {
        const value = root.querySelector(`#${b.dataset.copy}`)?.textContent ?? "";
        try { await navigator.clipboard.writeText(value); toast("Kopiert.", "success"); } catch { toast(value); }
      }));
      root.querySelector("#reset-perf")?.addEventListener("click", () => { updateSettings({ lowPerfDetected: false }); toast("Messung zurückgesetzt."); });
      root.querySelector("#test-sound")?.addEventListener("click", () => {
        unlockAudio();
        [0, 140, 260, 420].forEach((ms, i) => setTimeout(() => playImpact(i % 2 ? "die" : "table", 14 - i * 3), ms));
        setTimeout(playCrit, 800);
      });
      root.querySelector("#test-roll")?.addEventListener("click", () => {
        void rollWithOverlay("Probewurf", () => api.roll({ requestId: uuid(), notation: "1W20", label: "Probewurf" }));
      });
      enhance(root);
    },
  };
}
