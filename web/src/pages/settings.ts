import { playCrit, playImpact, unlockAudio } from "../dice3d/audio";
import { rollWithOverlay } from "../dice3d/roller";
import { DICE_THEMES } from "../dice3d/textures";
import { enhance } from "../fx/effects";
import { api, loadGameData } from "../lib/api";
import { $$, html, setHTML, uuid, type Raw } from "../lib/dom";
import { characterStore } from "../lib/store";
import { showRecoveryCode } from "../lib/recoveryUi";
import { hasRecovery, newRecoveryCode, setHasRecovery, backupFile, backupNow, listBackups, restoreBackup, type BackupInfo, changePassword, recoverCharacter, recoverList, type RecoverParty, downloadExport, dropLegacy, exportData, legacyData, legacySummary, logout, mergeData, onSyncState, parseExport, session, summaryText, syncState, type SyncState } from "../lib/account";
import { icon } from "../lib/icons";
import type { Page } from "../lib/router";
import { settings, updateSettings, useSimpleDice, type DiceThemeId, type PaletteId, type Settings } from "../lib/settings";

const PALETTES: { id: PaletteId; name: string; text: string; colors: [string, string, string] }[] = [
  { id: "glut", name: "Glut", text: "Schwarz und Rot – das letzte Feuer der Nacht (Standard)", colors: ["#070404", "#e2381f", "#ffb35c"] },
  { id: "amethyst", name: "Amethyst", text: "Das ursprüngliche Lila – kühl und magisch", colors: ["#07050c", "#8b5cf6", "#c4b5fd"] },
];
import { bindSegmented, confirmDialog, segmented, toast, toggleSwitch } from "../lib/ui";

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
            <p class="lead">Wird in deinem Konto gespeichert und gilt auf allen Geräten, auf denen du angemeldet bist.</p>
          </header>

          ${accountSection()}

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
              ${toggleSwitch("music", s.music, "Musik im Abenteuer (passend zur Szene)")}
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
        const key = t.dataset.toggle as "slowmo" | "backgroundFx" | "sound" | "music";
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
      bindAccount(root);
      void renderBackups(root);
      void mountRecover(root);
      enhance(root);
    },
  };
}

/* ── Konto und Spielstände ── */

function accountSection(): Raw {
  const s = session();
  const legacy = legacySummary();
  const state = syncState();
  return html`<section class="card set-section account-section" data-reveal>
    <h2>${icon("user")} Konto &amp; Spielstände</h2>
    <div class="set-row">
      <div><b>Angemeldet als ${s?.username ?? "?"}</b><p class="sync-line" id="sync-line">${SYNC_TEXT[state]}</p></div>
      <button class="btn btn-ghost btn-sm" id="logout">${icon("arrowLeft")} Abmelden</button>
    </div>
    ${legacy ? html`<div class="legacy-card">
      <b>${icon("scroll")} Spielstände von früher gefunden</b>
      <p>In diesem Browser lagen vor den Konten: ${summaryText(legacy)}. Übernimm sie in dein Konto – vorhandene Figuren und Abenteuer bleiben erhalten.</p>
      <div class="legacy-actions">
        <button class="btn btn-sm" id="legacy-import">${icon("download")} In mein Konto übernehmen</button>
        <button class="btn btn-ghost btn-sm" id="legacy-save">${icon("scroll")} Als Datei sichern</button>
        <button class="btn btn-ghost btn-sm" id="legacy-drop">${icon("trash")} Verwerfen</button>
      </div>
    </div>` : ""}
    <div class="set-row">
      <div><b>Spielstände exportieren</b><p>Alle Figuren, eigenen Klassen, Abenteuer mit Geschichte und Gruppen als Datei – zum Sichern oder um sie in ein anderes Konto zu übernehmen.</p></div>
      <button class="btn btn-ghost btn-sm" id="export">${icon("download")} Exportieren</button>
    </div>
    <div class="set-row">
      <div><b>Spielstände importieren</b><p>Eine exportierte Datei in dieses Konto übernehmen. Was schon da ist, bleibt; gleiche Figuren oder Abenteuer werden auf den neueren Stand gebracht.</p></div>
      <label class="btn btn-ghost btn-sm file-btn">${icon("plus")} Datei wählen<input type="file" id="import" accept="application/json,.json" hidden /></label>
    </div>
    <div class="backup-box">
      <div class="set-row">
        <div><b>Sicherungen</b><p>Dein Konto sichert jeden Tag beim ersten Speichern automatisch den bisherigen Stand. Die letzten 14 Tage bleiben erhalten. Vor jeder Wiederherstellung wird der aktuelle Stand ebenfalls gesichert – du kannst also immer zurück.</p></div>
        <button class="btn btn-ghost btn-sm" id="backup-now">${icon("shield")} Jetzt sichern</button>
      </div>
      <div class="backup-list" id="backup-list"><p class="muted small">Lade Sicherungen …</p></div>
    </div>
    <div class="set-row recovery-row ${hasRecovery() === false ? "missing" : ""}">
      <div><b>Wiederherstellungscode</b><p>${hasRecovery() === false ? "Du hast noch keinen. Ohne ihn lässt sich ein vergessenes Passwort nicht zurücksetzen – leg jetzt einen an." : "Damit setzt du auf der Anmeldeseite unter „Passwort vergessen?“ ein neues Passwort. Verloren? Erstelle einfach einen neuen."}</p></div>
      <button class="btn ${hasRecovery() === false ? "" : "btn-ghost"} btn-sm" id="new-recovery">${icon("lock")} ${hasRecovery() === false ? "Code anlegen" : "Neuen Code erstellen"}</button>
    </div>
    <details class="pw-change">
      <summary>${icon("lock")} Passwort ändern</summary>
      <form id="pw-form" class="pw-form">
        <input class="input" type="password" id="pw-old" autocomplete="current-password" placeholder="Bisheriges Passwort" required />
        <input class="input" type="password" id="pw-new" autocomplete="new-password" placeholder="Neues Passwort (mindestens 8 Zeichen)" required />
        <button class="btn btn-sm" type="submit">${icon("check")} Ändern</button>
      </form>
      <p class="hint">Andere Geräte werden danach abgemeldet.</p>
    </details>
  </section>`;
}

const REASON: Record<BackupInfo["reason"], string> = { tag: "Tägliche Sicherung", manuell: "Von dir gesichert", "vor-wiederherstellung": "Vor einer Wiederherstellung" };

/** Liste der Sicherungen mit Wiederherstellen und Herunterladen. */
async function renderBackups(root: HTMLElement) {
  const el = root.querySelector<HTMLElement>("#backup-list");
  if (!el) return;
  let list: BackupInfo[];
  try { list = await listBackups(); } catch { el.innerHTML = html`<p class="muted small">Sicherungen konnten nicht geladen werden.</p>`.value; return; }
  const draw = () => {
    el.innerHTML = (list.length ? html`${list.map((b) => html`<div class="backup-row">
      <span class="br-text"><b>${new Date(b.createdAt).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}</b><small class="muted">${REASON[b.reason]} · ${summaryText(b.counts)}</small></span>
      <span class="br-actions">
        <button class="btn btn-ghost btn-sm" data-backup-dl="${b.name}" title="Als Datei herunterladen">${icon("download")}</button>
        <button class="btn btn-sm" data-backup-restore="${b.name}">${icon("refresh")} Wiederherstellen</button>
      </span>
    </div>`)}` : html`<p class="muted small">Noch keine Sicherung – die erste entsteht automatisch, sobald du morgen etwas speicherst, oder jetzt mit „Jetzt sichern“.</p>`).value;
  };
  draw();
  root.querySelector("#backup-now")?.addEventListener("click", async () => {
    try { list = await backupNow(); draw(); toast("Gesichert.", "success"); } catch (e) { toast((e as Error).message, "error", 6000); }
  });
  el.addEventListener("click", async (e) => {
    const dl = (e.target as HTMLElement).closest<HTMLElement>("[data-backup-dl]");
    const rs = (e.target as HTMLElement).closest<HTMLElement>("[data-backup-restore]");
    if (dl) { try { downloadExport(await backupFile(dl.dataset.backupDl!), "sicherung"); } catch (err) { toast((err as Error).message, "error"); } }
    if (rs) {
      const b = list.find((x) => x.name === rs.dataset.backupRestore)!;
      if (!(await confirmDialog("Diese Sicherung wiederherstellen?", `Dein Konto bekommt den Stand vom ${new Date(b.createdAt).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })} zurück (${summaryText(b.counts)}). Der jetzige Stand wird vorher gesichert.`, "Wiederherstellen"))) return;
      try { await restoreBackup(b.name); toast("Wiederhergestellt – die Seite lädt neu.", "success"); setTimeout(() => location.reload(), 900); }
      catch (err) { toast((err as Error).message, "error", 6000); }
    }
  });
}

/** Nur für den Betreiber: Figuren aus Gruppen auf dem Server zurück ins Konto holen. */
async function mountRecover(root: HTMLElement) {
  const list = await recoverList();
  const anchor = root.querySelector(".account-section");
  if (!list || !anchor?.isConnected) return;
  const mine = new Set(characterStore.list().map((c) => c.id));
  const base = await loadGameData().then((d) => d.classes).catch(() => []);
  const className = (pl: RecoverParty["players"][number]) => base.find((c) => c.id === pl.classId)?.name ?? pl.className;
  const STATUS = { lobby: "Lobby", playing: "läuft", finished: "beendet" } as const;
  const el = document.createElement("section");
  el.className = "card set-section recover-section";
  el.innerHTML = html`<h2>${icon("refresh")} Figuren aus Gruppen zurückholen</h2>
    <p>Nur für dich als Betreiber sichtbar. Hier stehen alle Figuren, die in Gruppen auf dem Server liegen. Hol deine zurück ins Konto – mit eigener Klasse. Läuft die Gruppe noch, kannst du danach direkt weiterspielen.</p>
    ${list.length ? html`<div class="recover-list">${list.map((p) => html`<div class="recover-party">
      <div class="rp-head"><b class="party-code">${p.code}</b><span>${p.title ? p.title.charAt(0).toUpperCase() + p.title.slice(1) : "Gemeinsames Abenteuer"}</span><span class="chip pr-status ${p.status}">${STATUS[p.status]}</span><small class="muted">${new Date(p.updatedAt).toLocaleDateString("de-DE")}</small></div>
      <div class="rp-players">${p.players.map((pl) => html`<div class="rp-player">
        <span><b>${pl.name}</b> <small class="muted">${className(pl)} · Stufe ${pl.level}${pl.host ? " · Gastgeber" : ""}</small></span>
        ${mine.has(pl.characterId) ? html`<span class="chip good">${icon("check")} in deinem Konto</span>` : html`<button class="btn btn-sm" data-recover="${p.code}" data-char="${pl.characterId}">${icon("download")} Ins Konto holen</button>`}
      </div>`)}</div>
    </div>`)}</div>` : html`<p class="muted">Auf dem Server liegen keine Gruppen.</p>`}`.value;
  anchor.after(el);
  el.addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-recover]");
    if (!b) return;
    if (!(await confirmDialog("Figur zurückholen?", "Die Figur kommt in dein Konto, und du bekommst wieder Zugang zu ihrem Platz in der Gruppe. Ein anderes Gerät, das diesen Platz noch hatte, verliert ihn dabei.", "Zurückholen"))) return;
    b.disabled = true;
    try {
      const r = await recoverCharacter(b.dataset.recover!, b.dataset.char!);
      b.outerHTML = html`<span class="chip good">${icon("check")} in deinem Konto</span>`.value;
      toast(`${String(r.character.name)} ist zurück in deinem Konto – die Gruppe ${r.code} findest du unter Abenteuer → Gruppe.`, "success", 8000);
    } catch (err) { toast((err as Error).message, "error", 6000); b.disabled = false; }
  });
}

const SYNC_TEXT: Record<SyncState, string> = { saved: "Alles ist im Konto gespeichert.", saving: "Speichert …", offline: "Gerade keine Verbindung – Änderungen werden gespeichert, sobald sie wieder da ist." };

function bindAccount(root: HTMLElement) {
  const line = root.querySelector("#sync-line");
  const off = onSyncState((st) => { if (line?.isConnected) line.textContent = SYNC_TEXT[st]; else off(); });
  root.querySelector("#logout")?.addEventListener("click", async () => {
    try { await logout(); }
    catch (e) {
      if (!(await confirmDialog("Trotzdem abmelden?", `${(e as Error).message} Meldest du dich trotzdem ab, gehen die letzten Änderungen verloren.`, "Trotzdem abmelden", true))) return;
      await logout(true);
    }
    location.hash = "#/";
    location.reload();
  });
  root.querySelector("#export")?.addEventListener("click", () => downloadExport(exportData()));
  root.querySelector("#new-recovery")?.addEventListener("click", async () => {
    if (hasRecovery() && !(await confirmDialog("Neuen Code erstellen?", "Dein bisheriger Wiederherstellungscode gilt danach nicht mehr.", "Neuen Code erstellen"))) return;
    try {
      const first = hasRecovery() === false;
      const code = await newRecoveryCode();
      setHasRecovery(true);
      await showRecoveryCode(code, first);
      root.querySelector(".recovery-row")?.classList.remove("missing");
    } catch (e) { toast((e as Error).message, "error", 6000); }
  });
  root.querySelector<HTMLInputElement>("#import")?.addEventListener("change", async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      const sum = mergeData(parseExport(await file.text()));
      toast(`Übernommen: ${summaryText(sum)}.`, "success", 6000);
    } catch (err) { toast((err as Error).message, "error", 6000); }
  });
  root.querySelector("#legacy-import")?.addEventListener("click", () => {
    const sum = mergeData(legacyData() ?? {});
    dropLegacy();
    toast(`In dein Konto übernommen: ${summaryText(sum)}.`, "success", 6000);
    root.querySelector(".legacy-card")?.remove();
  });
  root.querySelector("#legacy-save")?.addEventListener("click", () => downloadExport(exportData(legacyData()), "alte-spielstaende"));
  root.querySelector("#legacy-drop")?.addEventListener("click", async () => {
    if (!(await confirmDialog("Alte Spielstände verwerfen?", "Sie werden aus diesem Browser gelöscht. Hast du sie vorher als Datei gesichert, kannst du sie später noch importieren.", "Verwerfen", true))) return;
    dropLegacy();
    root.querySelector(".legacy-card")?.remove();
  });
  root.querySelector<HTMLFormElement>("#pw-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const oldPw = root.querySelector<HTMLInputElement>("#pw-old")!.value, newPw = root.querySelector<HTMLInputElement>("#pw-new")!.value;
    if (newPw.length < 8) return void toast("Das neue Passwort braucht mindestens 8 Zeichen.", "error");
    try { await changePassword(oldPw, newPw); toast("Passwort geändert.", "success"); (e.target as HTMLFormElement).reset(); }
    catch (err) { toast((err as Error).message, "error", 6000); }
  });
}
