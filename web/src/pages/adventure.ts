import { settings } from "../lib/settings";
import { letterStore, offerLetters } from "../lib/letters";
import { heirloomPicker, syncCharacterGrowth } from "../lib/growthUi";
import { fullName, legendAbility } from "../../../shared/growth";
import { exportSave, importSaveFile } from "../lib/saveTransfer";
import type { ItemAction } from "../../../shared/inventory";
import { setMusic } from "../lib/music";
import { prepareRead, readButton, setVoiceCast } from "../lib/voice";
import { setWeather } from "../lib/weather";
import { noteLegacy } from "../lib/legacy";
import { sceneFigure } from "../lib/sceneImage";
import { openSheet } from "../lib/sheetModal";
import { effectiveCharacter } from "../../../shared/levels";
import { costChip, costText, splitSuggestions, stripMarkers, MAX_ACTION_LENGTH, type CampaignSave, type GmEvent, type Opening, type PendingCheck } from "../../../shared/campaign";
import { characterRoll } from "../../../shared/character";
import { formatModifier, type RollRecord } from "../../../shared/dice";
import type { Character } from "../../../shared/schema";
import { rollWithOverlay } from "../dice3d/roller";
import { enhance } from "../fx/effects";
import { api, loadGameData, type GameData } from "../lib/api";
import { campaignStore } from "../lib/campaigns";
import { dataFor } from "../lib/customClasses";
import { $, fragment, html, raw, setHTML, uuid, type Raw } from "../lib/dom";
import { setAccessCode, streamGm } from "../lib/gm";
import { bindSides, fillSide, itemDoneText, lageSide, lootText, playLayout, setMapData, setSkyPhase, teamSide, type TeamMember } from "../lib/playLayout";
import { endCard } from "../lib/arc";
import { upgradeCard, upgradeState } from "../lib/upgradeUi";
import { bindShop, shopCard } from "../lib/shopUi";
import { bindGamble, gambleCard, showGamble } from "../lib/gambleUi";
import { quickStart } from "../lib/quickstart";
import { announceLevel, bindLevelCard, levelChoiceCard, levelChoiceDue } from "../lib/levelUi";
import { effectiveAbilities } from "../../../shared/upgrades";
import { abilityList } from "../lib/abilities";
import { showTutorial } from "../lib/tutorial";
import { SOLO_TUTORIAL } from "../lib/tutorials";
import { term } from "../lib/glossary";
import { icon, sigil } from "../lib/icons";
import { go, type Page } from "../lib/router";
import { confirmDialog, toast } from "../lib/ui";

const MODE_TEXT = { normal: "", advantage: " mit Vorteil", disadvantage: " mit Nachteil" } as const;

export function paragraphs(text: string): Raw {
  const parts = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return html`${parts.map((p) => html`<p>${p.split("\n").map((l, i) => html`${i ? html`<br/>` : ""}${l}`)}</p>`)}`;
}

/** Wörtliche Rede („…“) hervorheben – nach dem Maskieren, also sicher. */
export function withSpeech(r: Raw): Raw {
  return raw(r.value.replace(/(„[^“]{1,400}“|&quot;[^&]{1,400}&quot;)/g, '<span class="speech">$1</span>'));
}

export function rollSummary(r: RollRecord, auto = false): Raw {
  const verdict = r.success === null ? "" : auto ? (r.success ? "Treffer" : "daneben") : r.success ? "geschafft" : "nicht geschafft";
  return html`<div class="story-roll ${auto ? "auto" : ""} ${r.critical ?? ""} ${r.success === false ? "fail" : r.success ? "ok" : ""}">
    <span class="sr-total">${r.total}</span>
    <span class="sr-text"><b>${r.label.replace(/^[^:]+:\s*/, "")}</b><span>gewürfelt ${r.values.join(" / ")}${r.modifier ? ` ${formatModifier(r.modifier)}` : ""}${r.dc !== null ? ` · SG ${r.dc}` : ""}${verdict ? ` · ${verdict}` : ""}${r.critical === "hit" ? " · kritisch!" : r.critical === "fumble" ? " · Patzer!" : ""}</span></span>
    ${icon(auto ? "sword" : "dice")}
  </div>`;
}

const OPENING_CARDS: { key: string; label: string; icon: string; get: (o: Opening) => string }[] = [
  { key: "ort", label: "Ort", icon: "map", get: (o) => o.ort },
  { key: "zeit", label: "Zeit & Wetter", icon: "sparkles", get: (o) => o.zeit },
  { key: "anlass", label: "Anlass", icon: "scroll", get: (o) => o.anlass },
  { key: "npc", label: "Begegnung", icon: "user", get: (o) => `${o.npc.name}, ${o.npc.rolle} – ${o.npc.eigenschaft}` },
  { key: "konflikt", label: "Konflikt", icon: "zap", get: (o) => o.konflikt },
];

export function openingCards(o: Opening, animate: boolean): Raw {
  return html`<div class="opening-cards ${animate ? "reveal" : ""}">
    ${OPENING_CARDS.map((c, i) => html`<div class="oc" style="--i:${i}">
      <div class="oc-inner">
        <div class="oc-back">${icon("dice")}</div>
        <div class="oc-front"><span class="oc-label">${icon(c.icon)} ${c.label}</span><span class="oc-text">${c.get(o)}</span></div>
      </div>
    </div>`)}
  </div>`;
}

/* ───────────── Übersicht: Figur wählen, Abenteuer fortsetzen ───────────── */

export function adventuresPage(): Page {
  return {
    async render(root) {
      setHTML(root, html`<div class="container"><div class="spinner"></div></div>`);
      const [chars, data] = await Promise.all([api.characters(), loadGameData()]);
      const saves = campaignStore.list();
      setHTML(root, html`
        <div class="container adventures">
          <header class="page-head" data-reveal>
            <div class="eyebrow">Claude als Spielleiter</div>
            <h1>Abenteuer</h1>
            <p class="lead">Die Würfel bestimmen, wo und wie deine Geschichte beginnt. Jede Geschichte fängt anders an.</p>
          </header>
          <div class="mode-cards">
            <button class="card mode-card tilt selected start-card" data-solo data-reveal="scale" style="--i:0">
              <div class="mode-icon">${icon("user")}</div>
              <h3>Allein spielen</h3>
              <p>Du und der Spielleiter. Spiele in deinem Tempo – dein Spielstand wird in deinem Konto gespeichert.</p>
              <span class="link-arrow">Figur unten wählen ${icon("arrowRight")}</span>
            </button>
            <a class="card mode-card tilt" href="#/gruppe" data-reveal="scale" style="--i:1">
              <div class="mode-icon">${icon("users")}</div>
              <h3>Mit Freunden spielen</h3>
              <p>Bis zu 4 Personen, jede auf ihrem Gerät. Gruppe gründen, Code teilen, gemeinsam losziehen.</p>
              <span class="link-arrow">Gruppe gründen oder beitreten ${icon("arrowRight")}</span>
            </a>
          </div>
          <div class="import-row" data-reveal>
            <button class="btn btn-ghost btn-sm" data-import title="Eine gespeicherte Spielstand-Datei (.ember.json) einlesen">${icon("upload")} Spielstand importieren</button>
            <input type="file" id="import-file" accept=".json,application/json" hidden>
          </div>
          ${saves.length ? html`
            <h2 class="sec-title" data-reveal>${icon("scroll")} Weitererzählen</h2>
            <div class="char-grid">
              ${saves.map((s, i) => {
                const c = chars.find((x) => x.id === s.characterId);
                const cls = data.classes.find((x) => x.id === c?.classId) ?? c?.customClass?.cls;
                return html`<article class="card adv-card tilt" data-reveal="scale" style="--i:${i}">
                  <div class="char-sigil">${sigil(cls?.sigil ?? "shield", "draw")}</div>
                  <h3>${s.title}</h3>
                  <p class="muted">${c?.name ?? "Figur fehlt"} · ${s.story.filter((e) => e.type === "player").length} Züge${s.costUsd ? ` · Claude ${costText(s.costUsd)}` : ""}${s.imageUsd ? ` · Bilder ${costText(s.imageUsd)}` : ""}${s.state.world?.arc?.finished ? html` · <span class="chip good">abgeschlossen</span>` : ""}</p>
                  <div class="adv-actions">
                    ${c ? html`<a class="btn btn-sm" href="#/abenteuer/${s.id}">${icon("play")} ${s.state.world?.arc?.finished ? "Nachlesen" : "Weiter"}</a>` : ""}
                    ${s.started ? html`<a class="btn btn-ghost btn-sm" href="#/chronik/${s.id}" title="Als Buch lesen und als PDF speichern">${icon("book")} Chronik</a>` : ""}
                  </div>
                  <div class="adv-corner">
                    ${c && s.started ? html`<button class="icon-btn" data-export="${s.id}" aria-label="Spielstand als Datei speichern" title="Als Datei speichern (zum Importieren auf einem anderen Gerät)">${icon("download")}</button>` : ""}
                    <button class="icon-btn" data-delete="${s.id}" aria-label="Abenteuer löschen" title="Abenteuer löschen">${icon("trash")}</button>
                  </div>
                </article>`;
              })}
            </div>` : ""}
          <h2 class="sec-title" id="neues-abenteuer" data-reveal style="margin-top:40px">${icon("sparkles")} Neues Solo-Abenteuer</h2>
          ${chars.length ? html`
            <div class="char-grid">
              <button class="card char-card tilt start-card quick-card" data-quick data-reveal="scale">
                <div class="char-sigil">${icon("dice")}</div>
                <h3>Schnellstart</h3>
                <p class="muted">Zufällige Figur, sofort spielbereit</p>
                <span class="link-arrow">Würfeln und losziehen ${icon("arrowRight")}</span>
              </button>
              ${chars.map((c, i) => {
                const cls = data.classes.find((x) => x.id === c.classId) ?? c.customClass?.cls;
                return html`<button class="card char-card tilt start-card" data-start="${c.id}" data-reveal="scale" style="--i:${i}">
                  <div class="char-sigil">${sigil(cls?.sigil ?? "shield", "draw")}</div>
                  <h3>${fullName(c)}</h3>
                  <p class="muted">${cls?.name ?? c.classId}</p>
                  <span class="link-arrow">Mit ${c.name} losziehen ${icon("arrowRight")}</span>
                </button>`;
              })}
            </div>` : html`
            <div class="card empty" data-reveal>
              <p>Für ein Abenteuer brauchst du zuerst eine Figur.</p>
              <a class="btn magnetic" href="#/figur/neu">${icon("sparkles")} Figur erschaffen</a>
              <button class="btn btn-ghost" data-quick>${icon("dice")} Schnellstart mit Zufallsfigur</button>
            </div>`}
        </div>`);
      root.addEventListener("click", async (e) => {
        const t = e.target as HTMLElement;
        if (t.closest("[data-quick]")) { void quickStart(); return; }
        if (t.closest("[data-solo]")) document.getElementById("neues-abenteuer")?.scrollIntoView({ behavior: "smooth", block: "start" });
        const start = t.closest<HTMLElement>("[data-start]");
        if (start) {
          const c = chars.find((x) => x.id === start.dataset.start)!;
          const save: CampaignSave = {
            id: uuid(), characterId: c.id, title: "Eine neue Chronik", opening: null as unknown as Opening, openingSummary: "",
            state: { messages: [], characterHash: "", sig: "" }, pending: null, story: [], started: false,
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          };
          campaignStore.save(save);
          go(`/abenteuer/${save.id}?neu`);
        }
        if (t.closest("[data-import]")) root.querySelector<HTMLInputElement>("#import-file")?.click();
        const exp = t.closest<HTMLElement>("[data-export]");
        if (exp) { const s = campaignStore.get(exp.dataset.export!); if (s) exportSave(s); }
        const del = t.closest<HTMLElement>("[data-delete]");
        if (del && (await confirmDialog("Abenteuer löschen?", "Die Geschichte wird endgültig gelöscht. Die Figur bleibt erhalten.", "Löschen", true))) {
          campaignStore.remove(del.dataset.delete!);
          letterStore.remove(del.dataset.delete!);
          go("/abenteuer");
        }
      });
      root.querySelector<HTMLInputElement>("#import-file")?.addEventListener("change", async (e) => {
        const input = e.target as HTMLInputElement;
        const file = input.files?.[0];
        input.value = "";
        if (!file) return;
        const id = await importSaveFile(file);
        if (id) go(`/abenteuer/${id}`);
      });
      enhance(root);
    },
  };
}

/* ───────────── Spielansicht ───────────── */

export function playPage(): Page {
  let alive = true;
  let unbindSides = () => {};
  return {
    leave() { alive = false; unbindSides(); },
    async render(root, params) {
      const [id, query] = params.id.split("?");
      const save = campaignStore.get(id);
      if (!save) { setHTML(root, html`<div class="container empty"><h2>Abenteuer nicht gefunden</h2><a class="btn" href="#/abenteuer">Zur Übersicht</a></div>`); return; }
      let character: Character, data: GameData;
      try { [character, data] = await Promise.all([api.character(save.characterId), loadGameData()]); }
      catch (e) { setHTML(root, html`<div class="container empty"><h2>Figur fehlt</h2><p>${(e as Error).message}</p></div>`); return; }

      let busy = false;
      let forging = false;
      let liveText = "";
      let liveEl: HTMLElement | null = null;
      let lastError: Extract<GmEvent, { type: "error" }> | null = null;
      let budget: { spentUsd: number; limitUsd: number } | null = null;
      let lastCost: number | null = null;
      let lastImageCost: number | null = null;
      /** Länge der Geschichte vor dem laufenden Zug – bei Fehlern wird bis hierher zurückgesetzt. */
      let turnMark = 0;

      setHTML(root, html`
        <div class="container play">
          <header class="play-head">
            <a class="icon-btn" href="#/abenteuer" aria-label="Zurück">${icon("arrowLeft")}</a>
            <div class="ph-title"><div class="eyebrow">${character.name}</div><h1 id="play-title">${save.title}</h1></div>
            <span class="chip budget" id="budget" hidden></span>
            <button class="icon-btn" id="help" aria-label="Einführung öffnen" title="Wie funktioniert das?">?</button>
          </header>
          ${playLayout(html`
            <div id="opening"></div>
            <div class="story" id="story" aria-live="polite"></div>
            <div id="below"></div>
            <div id="my-abilities"></div>`)}
        </div>`);
      unbindSides = bindSides(root, () => openSheet(async () => effectiveCharacter(character, save!.state.world), data, () => save!.state.world), (action, name) => void doItem(action, name));
      const storyEl = $("#story", root);
      $("#help", root).addEventListener("click", () => showTutorial(`solo-${save.id}`, SOLO_TUTORIAL, true));
      const belowEl = $("#below", root);

      const persist = () => campaignStore.save(save);
      const renderWorld = () => {
        const w = save!.state.world;
        const cls = myClassDef();
        const me: TeamMember = { id: character.id, name: fullName(character), sigil: cls?.sigil ?? "shield", className: cls?.name ?? character.classId, me: true, abilities: effectiveAbilities(cls?.abilities ?? [], w?.progress?.[character.id]) };
        fillSide(root.querySelector("#side-left"), teamSide(w, [me], data.rules));
        fillSide(root.querySelector("#side-right"), lageSide(w));
        setMapData(root, w?.map);
        setSkyPhase(w?.time?.phase);
        setWeather(w?.time?.weather);
        setMusic(w ?? null);
        setVoiceCast(w, [character.name]);
        noteLegacy(w, save!.id, save!.title);
        renderAbilities();
      };

      function renderOpening(animate: boolean) {
        const el = $("#opening", root);
        if (!save!.opening) { el.innerHTML = ""; return; }
        el.innerHTML = html`<details class="opening card" ${animate || !save!.started ? "open" : ""}>
          <summary>${icon("dice")} Startimpuls – vom Zufall gewürfelt</summary>
          ${openingCards(save!.opening, animate)}
        </details>`.value;
      }

      function storyEntry(e: CampaignSave["story"][number], first: boolean): Raw {
        if (e.type === "player") return html`<div class="story-player"><span>${e.text}</span></div>`;
        if (e.type === "roll") return rollSummary(e.record, e.auto);
        if (e.type === "image") return sceneFigure(e);
        return html`<div class="story-gm ${first ? "first" : ""}">${withSpeech(paragraphs(splitSuggestions(e.text).body))}${readButton()}</div>`;
      }

      function renderStory() {
        let firstGm = true;
        storyEl.innerHTML = save!.story.map((e) => {
          const r = storyEntry(e, e.type === "gm" && firstGm);
          if (e.type === "gm") firstGm = false;
          return r.value;
        }).join("");
      }

      function appendEntry(e: CampaignSave["story"][number]) {
        const isFirstGm = e.type === "gm" && !save!.story.slice(0, -1).some((x) => x.type === "gm");
        storyEl.append(fragment(storyEntry(e, isFirstGm)));
      }

      function startLive() {
        liveText = "";
        liveEl = fragment(html`<div class="story-gm live ${save!.story.some((x) => x.type === "gm") ? "" : "first"}"><span class="quill">${icon("feather")}</span></div>`);
        storyEl.append(liveEl);
        scrollDown();
      }
      function pushLive(text: string) {
        if (!liveEl) startLive();
        liveText += text;
        const visible = stripMarkers(liveText);
        liveEl!.innerHTML = withSpeech(paragraphs(visible)).value + `<span class="quill">${icon("feather").value}</span>`;
        scrollDown(true);
      }
      function endLive() {
        liveEl?.remove();
        liveEl = null;
        if (liveText.trim()) {
          const entry = { type: "gm" as const, text: liveText.trim() };
          save!.story.push(entry);
          appendEntry(entry);
        }
        liveText = "";
      }

      function scrollDown(soft = false) {
        const nearBottom = innerHeight + scrollY > document.body.scrollHeight - 400;
        if (!soft || nearBottom) window.scrollTo({ top: document.body.scrollHeight, behavior: soft ? "auto" : "smooth" });
      }

      function pendingCard(p: PendingCheck): Raw {
        const d = dataFor(data, character);
        const spec = characterRoll(character, d.rules, d.classes, p.art, p.id);
        const mod = spec.parts.reduce((s, x) => s + x.value, 0);
        return html`<div class="pending card glow-border">
          <div class="pd-die">${icon("dice")}</div>
          <div class="pd-text">
            <div class="eyebrow">Der Spielleiter verlangt eine ${term("probe")}</div>
            <h3>${p.label}${MODE_TEXT[p.modus]}${p.sg !== null ? html` · ${term("sg", "SG")} ${p.sg}` : ""}</h3>
            <p>${p.grund}</p>
            <p class="hint">Du würfelst ${spec.notation}${p.modus !== "normal" ? ` (zwei Würfel, ${p.modus === "advantage" ? "der höhere" : "der niedrigere"} zählt)` : ""} ${spec.parts.map((x) => `${formatModifier(x.value)} ${x.label}`).join(" ")}${p.sg !== null ? ` – du brauchst insgesamt ${p.sg} (also mindestens ${Math.max(2, Math.min(20, p.sg - mod))} auf dem Würfel).` : "."}</p>
          </div>
          <button class="btn btn-lg magnetic" id="roll-now">${icon("dice")} Würfeln</button>
        </div>`;
      }

      function renderBelow() {
        const last = [...save!.story].reverse().find((e) => e.type === "gm");
        const suggestions = last && last.type === "gm" && !save!.pending ? splitSuggestions(last.text).suggestions : [];
        let content: Raw;
        if (lastError) content = errorCard(lastError);
        else if (busy) content = html`<div class="thinking">${icon("feather")} Der Spielleiter erzählt …</div>`;
        else if (!save!.opening) content = html``;
        else if (save!.pending) content = pendingCard(save!.pending);
        else if (save!.state.world?.arc?.finished) content = html`${endCard(save!.state.world, [character], { href: "#/abenteuer#neues-abenteuer", label: "Neue Kampagne beginnen" }, `#/chronik/${save!.id}`)}${heirloomPicker(save!.state.world, character)}`;
        else content = html`
          ${suggestions.length ? html`<div class="suggestions"><span class="muted small">Ideen:</span>${suggestions.map((s, i) => html`<button class="chip suggestion" data-suggest="${s}" style="--i:${i}">${s}</button>`)}</div>` : ""}
          <form class="composer card" id="composer">
            <textarea class="textarea" id="action" maxlength="${MAX_ACTION_LENGTH}" rows="2" placeholder="Was tust du? Beschreibe es in eigenen Worten …"></textarea>
            <button class="btn" type="submit" aria-label="Handlung senden">${icon("arrowRight")}</button>
          </form>
          <p class="hint center">Enter sendet, Umschalt+Enter macht eine neue Zeile. Du kannst alles versuchen – nicht nur die Ideen.</p>`;
        const world = save!.state.world;
        if (!lastError && !busy && !save!.pending && world?.shop && !world.arc?.finished) content = html`${shopCard(world, character.id)}${content}`;
        if (!lastError && !busy && !save!.pending && world?.gamble && !world.combat && !world.arc?.finished) content = html`${gambleCard(world, character.id)}${content}`;
        const showUpgrade = !lastError && !busy && !world?.arc?.finished && (forging || upgradeState(world, character.id) !== "none");
        if (showUpgrade) content = html`${upgradeCard(world!, character.id, abilityType, forging)}${content}`;
        if (!lastError && !busy && !world?.arc?.finished && levelChoiceDue(world, character.id, data.rules)) content = html`${levelChoiceCard(world, character, myClassDef(), data.rules)}${content}`;
        belowEl.innerHTML = html`${content}
          ${!save!.started && save!.opening && !busy ? html`<div class="center"><button class="btn btn-ghost btn-sm" id="reroll">${icon("refresh")} Neuen Einstieg würfeln</button></div>` : ""}
          ${undo && !busy && !lastError ? html`<div class="center"><button class="btn btn-ghost btn-sm" id="undo" title="Vertippt? Die letzte Runde zurücknehmen und neu schreiben">${icon("refresh")} Letzten Zug zurücknehmen</button></div>` : ""}`.value;
        const b = $("#budget", root);
        if (budget || save!.costUsd) { const chip = costChip({ claudeUsd: save!.costUsd ?? 0, imageUsd: save!.imageUsd ?? 0, lastUsd: lastCost, lastImageUsd: lastImageCost }, budget); b.hidden = false; b.textContent = chip.text; b.title = chip.title; }
        bindBelow();
        enhance(belowEl);
      }

      function errorCard(err: Extract<GmEvent, { type: "error" }>): Raw {
        if (err.code === "no_api_key") {
          return html`<div class="card setup-card">
            <h3>${icon("info")} Der Spielleiter ist noch nicht eingerichtet</h3>
            <p>${err.message}</p>
            <ol>
              <li><b>Lokal:</b> Kopiere <code>.env.example</code> nach <code>.env</code>, trage deinen Schlüssel bei <code>ANTHROPIC_API_KEY</code> ein und starte <code>npm run dev</code> neu.</li>
              <li><b>Netlify:</b> Unter <em>Site configuration → Environment variables</em> <code>ANTHROPIC_API_KEY</code>, <code>GAME_SECRET</code> und <code>ACCESS_CODE</code> anlegen und neu veröffentlichen.</li>
            </ol>
            <button class="btn btn-ghost btn-sm" id="retry">${icon("refresh")} Erneut versuchen</button>
          </div>`;
        }
        if (err.code === "access") {
          return html`<form class="card setup-card" id="access-form">
            <h3>${icon("lock")} Zugangscode</h3>
            <p>Diese Seite ist geschützt, damit die Kosten im Rahmen bleiben. Bitte gib den Zugangscode ein.</p>
            <div class="input-row"><input class="input" id="access-code" type="password" autocomplete="current-password" placeholder="Zugangscode" /><button class="btn" type="submit">Weiter</button></div>
          </form>`;
        }
        return html`<div class="card setup-card error">
          <h3>${icon("info")} ${err.code === "budget" ? "Budget erreicht" : err.code === "rate" ? "Kurze Pause" : "Das hat nicht geklappt"}</h3>
          <p>${err.message}</p>
          ${err.code === "budget" ? "" : html`<button class="btn btn-ghost btn-sm" id="retry">${icon("refresh")} Erneut versuchen</button>`}
        </div>`;
      }

      let retry: (() => void) | null = null;
      /** Letzte Runde zum Zurücknehmen (vertippt?). Nur ohne Würfelwurf – sonst ließe sich ein schlechter Wurf wegklicken. */
      let undo: { state: CampaignSave["state"]; pending: CampaignSave["pending"]; storyLen: number; action: string } | null = null;

      const myClassDef = () => dataFor(data, character).classes.find((x) => x.id === character.classId);
      const abilityType = (id: string) => myClassDef()?.abilities.find((a) => a.id === id)?.type ?? "unterstuetzung";
      function renderAbilities() {
        const legend = legendAbility(character);
        const abilities = [...effectiveAbilities(myClassDef()?.abilities ?? [], save!.state.world?.progress?.[character.id]), ...(legend ? [legend] : [])];
        $("#my-abilities", root).innerHTML = abilityList(character.name, abilities, save!.state.world, character.id, character).value;
      }

      /** Ohne Auswahl: Verbesserungen erstellen lassen (Claude). Mit Auswahl: eine davon übernehmen (ohne Claude). */
      async function doUpgrade(option?: number) {
        if (busy || forging) return;
        undo = null;
        forging = option === undefined;
        renderBelow();
        await streamGm(option === undefined ? "upgrade" : "choose", { character, state: save!.state, option }, (ev) => {
          if (!alive) return;
          if (ev.type === "upgrade") {
            save!.state = ev.state;
            budget = ev.budget;
            if (ev.turnCostUsd !== undefined) { lastCost = ev.turnCostUsd; lastImageCost = null; save!.costUsd = (save!.costUsd ?? 0) + ev.turnCostUsd; }
            persist();
            if (option !== undefined) {
              const chosen = ev.state.world?.progress?.[character.id]?.chosen.at(-1);
              if (chosen) toast(`${chosen.name} – deine Fähigkeit hat sich weiterentwickelt!`, "success", 5000);
            }
          } else if (ev.type === "error") toast(ev.message, "error", 6000);
        });
        forging = false;
        renderWorld();
        renderAbilities();
        renderBelow();
      }

      /** Wahl beim Stufenaufstieg übernehmen (ohne Claude). */
      async function doLevel(choice: { skill?: string; attrs?: Record<string, number> }) {
        if (busy) return;
        undo = null;
        await streamGm("level", { character, state: save!.state, ...choice }, (ev) => {
          if (!alive) return;
          if (ev.type === "upgrade") { save!.state = ev.state; persist(); toast(choice.skill ? "Neue Fertigkeit gelernt!" : "Attribute gesteigert!", "success", 4000); }
          else if (ev.type === "error") toast(ev.message, "error", 6000);
        });
        renderWorld();
        renderBelow();
      }
      /** Kaufen/verkaufen im offenen Laden (ohne Claude). */
      async function doShop(action: "kaufen" | "verkaufen", ref: string) {
        if (busy) return;
        undo = null;
        await streamGm("shop", { character, state: save!.state, action, ref }, (ev) => {
          if (!alive) return;
          if (ev.type === "upgrade") {
            const before = save!.state.world?.inventory?.[character.id];
            save!.state = ev.state; persist();
            const loot = lootText(before, ev.state.world?.inventory?.[character.id]);
            toast(action === "kaufen" ? (loot ?? "Gekauft – deine Ausrüstung ist jetzt besser.") : "Verkauft.", "success", 4000);
          } else if (ev.type === "error") toast(ev.message, "error", 6000);
        });
        renderWorld();
        renderBelow();
      }
      /** Trank trinken oder Ausrüstung an-/ablegen (ohne Claude). */
      async function doItem(action: ItemAction, name: string) {
        if (busy) { toast("Einen Moment – der Spielleiter erzählt gerade.", "info", 3000); return; }
        undo = null;
        const before = save!.state.world?.hp[character.id];
        await streamGm("shop", { character, state: save!.state, action, ref: name }, (ev) => {
          if (!alive) return;
          if (ev.type === "upgrade") { save!.state = ev.state; persist(); toast(itemDoneText(action, name, before, ev.state.world?.hp[character.id]), "success", 3500); }
          else if (ev.type === "error") toast(ev.message, "error", 6000);
        });
        renderWorld();
        renderBelow();
      }
      /** Würfelspiel am offenen Würfeltisch (ohne Claude). */
      async function doGamble(bet: number) {
        if (busy) return;
        undo = null;
        const opponent = save!.state.world?.gamble?.opponent ?? "Dein Gegner";
        let failed = false;
        const game = streamGm("shop", { character, state: save!.state, action: "spielen", ref: bet }, (ev) => {
          if (!alive) return;
          if (ev.type === "upgrade") { save!.state = ev.state; persist(); }
          else if (ev.type === "error") { failed = true; toast(ev.message, "error", 6000); }
        }).then(() => (failed ? null : save!.state.world?.gamble?.last ?? null));
        await showGamble(game, opponent);
        renderWorld();
        renderBelow();
      }
      const levelOf = () => save!.state.world?.levels?.[character.id]?.level ?? 1;

      function bindBelow() {
        belowEl.querySelector("#composer")?.addEventListener("submit", (e) => { e.preventDefault(); void sendAction(); });
        const ta = belowEl.querySelector<HTMLTextAreaElement>("#action");
        ta?.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendAction(); } });
        ta?.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = `${Math.min(220, ta.scrollHeight)}px`; });
        belowEl.querySelectorAll<HTMLElement>("[data-suggest]").forEach((b) => b.addEventListener("click", () => {
          const t = belowEl.querySelector<HTMLTextAreaElement>("#action")!;
          t.value = b.dataset.suggest!;
          t.focus();
        }));
        belowEl.querySelector("#roll-now")?.addEventListener("click", () => void doRoll());
        belowEl.querySelector("[data-upgrade]")?.addEventListener("click", () => void doUpgrade());
        bindLevelCard(belowEl, (choice) => void doLevel(choice));
        bindShop(belowEl, (action, ref) => void doShop(action, ref));
        bindGamble(belowEl, (bet) => void doGamble(bet));
        belowEl.querySelectorAll<HTMLElement>("[data-choose]").forEach((b) => b.addEventListener("click", () => void doUpgrade(Number(b.dataset.choose))));
        belowEl.querySelector("#reroll")?.addEventListener("click", () => void begin(true));
        belowEl.querySelector("#undo")?.addEventListener("click", () => void undoTurn());
        belowEl.querySelector("#retry")?.addEventListener("click", () => { lastError = null; retry ? retry() : renderBelow(); });
        belowEl.querySelector("#access-form")?.addEventListener("submit", (e) => {
          e.preventDefault();
          setAccessCode(belowEl.querySelector<HTMLInputElement>("#access-code")!.value.trim());
          lastError = null;
          retry ? retry() : renderBelow();
        });
      }

      /** Gemeinsame Ereignisbehandlung für alle Anfragen. */
      function handle(ev: GmEvent) {
        if (!alive) return;
        if (ev.type === "text") pushLive(ev.text);
        else if (ev.type === "image") {
          endLive();
          const entry = { type: "image" as const, url: ev.url, caption: ev.caption };
          save!.story.push(entry); appendEntry(entry);
          scrollDown(true);
        } else if (ev.type === "autoroll") {
          // Gegnerangriff, Heilung, Rast: Erzählung bis hier abschließen, Wurf zeigen, danach weitererzählen
          endLive();
          const entry = { type: "roll" as const, record: ev.record, auto: true };
          save!.story.push(entry); appendEntry(entry);
          scrollDown(true);
        } else if (ev.type === "done") {
          endLive();
          const worldBefore = save!.state.world;
          const before = levelOf();
          const invBefore = save!.state.world?.inventory?.[character.id];
          save!.state = ev.state;
          const loot = lootText(invBefore, ev.state.world?.inventory?.[character.id]);
          if (loot) toast(loot, "success", 5000);
          save!.pending = ev.pending;
          announceLevel(before, levelOf(), data.rules);
          budget = ev.budget;
          lastCost = ev.turnCostUsd ?? null;
          lastImageCost = ev.turnImageUsd ?? null;
          save!.costUsd = (save!.costUsd ?? 0) + (ev.turnCostUsd ?? 0);
          save!.imageUsd = (save!.imageUsd ?? 0) + (ev.turnImageUsd ?? 0);
          persist();
          // Entwicklung über Abenteuer hinweg (Meisterschaft, Narben, Ruhm am Ende) an die Figur übernehmen
          character = syncCharacterGrowth(character.id, ev.state.world) ?? character;
          renderWorld();
          renderAbilities();
          prepareRead(storyEl); // Vorlesen schon vorbereiten – ▶ spielt dann sofort
          void offerLetters(save!.id, character.name, worldBefore, ev.state.world, async (chapter) => {
            let got: { title: string; text: string } | null = null;
            await streamGm("letter", { character, state: save!.state, chapter }, (e) => { if (e.type === "letter") got = { title: e.title, text: e.text }; });
            return got;
          });
        } else if (ev.type === "error") {
          liveEl?.remove(); liveEl = null; liveText = "";
          lastError = ev;
          if (save!.story.length > turnMark) { save!.story.length = turnMark; renderStory(); }
        }
      }

      async function begin(reroll: boolean) {
        if (busy) return;
        if (reroll && !(await confirmDialog("Neuen Einstieg würfeln?", "Der jetzige Anfang wird verworfen und ein neuer gewürfelt.", "Neu würfeln"))) return;
        busy = true; lastError = null;
        save!.story = []; save!.pending = null; save!.opening = null as unknown as Opening;
        save!.state = { messages: [], characterHash: "", sig: "" }; turnMark = 0;
        renderWorld();
        renderStory(); renderOpening(false); renderBelow();
        retry = () => void begin(false);
        await streamGm("start", { character, previousOpenings: campaignStore.previousOpenings(), power: settings().powerScaling }, (ev) => {
          if (ev.type === "opening") {
            save!.opening = ev.opening;
            save!.openingSummary = ev.summary;
            save!.title = ev.opening.ort.charAt(0).toUpperCase() + ev.opening.ort.slice(1);
            $("#play-title", root).textContent = save!.title;
            campaignStore.rememberOpening(ev.summary);
            renderOpening(true);
          } else handle(ev);
        });
        busy = false;
        if (!lastError) retry = null;
        renderBelow();
      }

      async function sendAction(text?: string) {
        const ta = belowEl.querySelector<HTMLTextAreaElement>("#action");
        const action = (text ?? ta?.value ?? "").trim();
        if (!action || busy) return;
        busy = true; lastError = null; undo = null;
        const entry = { type: "player" as const, text: action };
        const storyLen = save!.story.length, pendingBefore = save!.pending;
        save!.story.push(entry); appendEntry(entry);
        turnMark = save!.story.length;
        renderBelow(); scrollDown();
        const before = save!.state;
        retry = () => { save!.story.pop(); renderStory(); void sendAction(action); };
        await streamGm("turn", { character, state: before, action, power: settings().powerScaling }, handle);
        busy = false;
        if (!lastError) {
          save!.started = true; retry = null; persist();
          const rolled = save!.story.slice(storyLen).some((e) => e.type === "roll");
          if (!rolled && !save!.state.world?.arc?.finished) undo = { state: before, pending: pendingBefore, storyLen, action };
        }
        renderBelow();
      }

      /** Letzte Runde zurücknehmen: alter Spielstand, Handlung wieder im Eingabefeld. */
      async function undoTurn() {
        const u = undo;
        if (!u || busy) return;
        if (!(await confirmDialog("Letzten Zug zurücknehmen?", "Die letzte Runde wird zurückgenommen, deine Handlung steht wieder im Eingabefeld. Bereits angefallene Kosten bleiben bestehen.", "Zurücknehmen"))) return;
        undo = null;
        save!.state = u.state; save!.pending = u.pending; save!.story.length = u.storyLen;
        persist();
        renderStory(); renderWorld(); renderAbilities(); renderBelow();
        const ta = belowEl.querySelector<HTMLTextAreaElement>("#action");
        if (ta) { ta.value = u.action; ta.focus(); }
      }

      async function doRoll() {
        if (busy || !save!.pending) return;
        undo = null;
        busy = true; lastError = null;
        const p = save!.pending;
        turnMark = save!.story.length;
        let resolveRoll!: (r: RollRecord) => void, rejectRoll!: (e: Error) => void;
        const rollP = new Promise<RollRecord>((res, rej) => { resolveRoll = res; rejectRoll = rej; });
        // Während das Würfel-Overlay offen ist, wird die Erzählung zurückgehalten und danach gezeigt.
        const queued: GmEvent[] = [];
        let overlayOpen = true;
        let damage: RollRecord | null = null;
        const overlay = rollWithOverlay(`${p.label}${MODE_TEXT[p.modus]}${p.sg !== null ? ` · SG ${p.sg}` : ""}`, () => rollP);
        renderBelow();
        retry = () => void doRoll();
        const streaming = streamGm("roll", { character, state: save!.state, power: settings().powerScaling }, (ev) => {
          if (ev.type === "roll") {
            const entry = { type: "roll" as const, record: ev.record };
            save!.story.push(entry); appendEntry(entry); persist();
            if (ev.record.label.includes("Schaden")) damage = ev.record; // Treffer: Schaden wurde gleich mitgewürfelt
            else resolveRoll(ev.record);
          } else {
            if (ev.type === "error") rejectRoll(new Error(ev.message));
            if (overlayOpen) queued.push(ev); else handle(ev);
          }
        });
        await overlay;
        // Eigener Schadenswurf mit eigener Animation – kostet keinen Modellaufruf
        if (!damage) await new Promise((r) => setTimeout(r, 400)); // kommt der Schaden etwas später, kurz warten
        const dmg = damage as RollRecord | null; // im Ereignis-Handler gesetzt
        if (dmg) await rollWithOverlay(`Treffer! ${dmg.label.split(": ").pop()}`, () => Promise.resolve(dmg));
        overlayOpen = false;
        queued.splice(0).forEach(handle);
        await streaming;
        busy = false;
        if (!lastError) { save!.started = true; retry = null; }
        renderBelow();
        scrollDown();
      }

      renderWorld();
      renderOpening(false);
      renderStory();
      renderBelow();
      renderAbilities();
      showTutorial(`solo-${save.id}`, SOLO_TUTORIAL);
      if (!save.opening) void begin(false);
      else if (query !== "neu") scrollDown();
    },
  };
}

