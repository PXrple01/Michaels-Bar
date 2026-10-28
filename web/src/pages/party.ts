import { MAX_ACTION_LENGTH, splitSuggestions } from "../../../shared/campaign";
import { characterRoll } from "../../../shared/character";
import { formatModifier, type RollRecord } from "../../../shared/dice";
import { MAX_PARTY_SIZE, type PartyEvent, type PartyStoryEntry, type PartyView } from "../../../shared/party";
import type { Character } from "../../../shared/schema";
import { rollWithOverlay } from "../dice3d/roller";
import { enhance } from "../fx/effects";
import { api, loadGameData, type GameData } from "../lib/api";
import { campaignStore } from "../lib/campaigns";
import { dataFor } from "../lib/customClasses";
import { $, html, setHTML, type Raw } from "../lib/dom";
import { term } from "../lib/glossary";
import { icon, sigil } from "../lib/icons";
import { memberships, partyApi, PartyApiError, type Membership } from "../lib/party";
import { go, type Page } from "../lib/router";
import { toast } from "../lib/ui";
import { openingCards, paragraphs, rollSummary, withSpeech } from "./adventure";
import { worldPanel } from "../lib/worldPanel";
import { endCard } from "../lib/arc";
import { upgradeCard, upgradeState } from "../lib/upgradeUi";
import { announceLevel, bindLevelCard, levelChoiceCard, levelChoiceDue } from "../lib/levelUi";
import { abilityChips, abilityList } from "../lib/abilities";
import { showTutorial } from "../lib/tutorial";
import { PARTY_TUTORIAL } from "../lib/tutorials";

const MODE_TEXT = { normal: "", advantage: " mit Vorteil", disadvantage: " mit Nachteil" } as const;
const inviteLink = (code: string) => `${location.origin}${location.pathname}#/gruppe/${code}`;

function characterPicker(chars: Character[], data: GameData, action: string): Raw {
  if (!chars.length) return html`<div class="card empty"><p>Du brauchst zuerst eine Figur.</p><a class="btn magnetic" href="#/figur/neu">${icon("sparkles")} Figur erschaffen</a></div>`;
  return html`<div class="char-grid">${chars.map((c, i) => {
    const cls = data.classes.find((x) => x.id === c.classId) ?? c.customClass?.cls;
    return html`<button class="card char-card tilt start-card" data-${action}="${c.id}" style="--i:${i}">
      <div class="char-sigil">${sigil(cls?.sigil ?? "shield", "draw")}</div>
      <h3>${c.name}</h3><p class="muted">${cls?.name ?? c.classId}</p>
      <span class="link-arrow">Mit ${c.name} ${action === "create" ? "gründen" : "beitreten"} ${icon("arrowRight")}</span>
    </button>`;
  })}</div>`;
}

/* ───────────── Gruppe gründen oder beitreten ───────────── */

export function partyHomePage(): Page {
  return {
    async render(root) {
      const [chars, data] = await Promise.all([api.characters(), loadGameData()]);
      const mine = memberships.list();
      setHTML(root, html`
        <div class="container adventures">
          <header class="page-head" data-reveal>
            <a class="link-arrow back" href="#/abenteuer">${icon("arrowLeft")} Abenteuer</a>
            <div class="eyebrow">Mit Freunden spielen</div>
            <h1>Gruppe</h1>
            <p class="lead">Bis zu ${MAX_PARTY_SIZE} Personen erleben ein Abenteuer gemeinsam – jede auf ihrem eigenen Gerät, mit ihrer eigenen Figur. Ihr handelt reihum, der Spielleiter erzählt die Runde für alle.</p>
          </header>
          ${mine.length ? html`<h2 class="sec-title" data-reveal>${icon("users")} Deine Gruppen</h2>
            <div class="party-list">${mine.map((m) => html`<a class="card party-row tilt" href="#/gruppe/${m.code}" data-reveal><b class="party-code">${m.code}</b><span class="muted">beigetreten ${new Date(m.joinedAt).toLocaleDateString("de-DE")}</span>${icon("arrowRight")}</a>`)}</div>` : ""}
          <div class="party-split">
            <section class="card" data-reveal>
              <h2>${icon("plus")} Neue Gruppe gründen</h2>
              <p>Du bist Gastgeber: Du bekommst einen Code, den du an deine Mitspieler schickst, und startest das Abenteuer, wenn alle da sind.</p>
              ${characterPicker(chars, data, "create")}
            </section>
            <section class="card" data-reveal>
              <h2>${icon("users")} Einer Gruppe beitreten</h2>
              <p>Du hast einen Code oder Link bekommen? Gib den Code ein.</p>
              <form class="input-row" id="join-form"><input class="input input-lg code-input" id="join-code" maxlength="6" placeholder="z. B. K7MPQ2" autocomplete="off" /><button class="btn" type="submit">${icon("arrowRight")}</button></form>
            </section>
          </div>
        </div>`);
      root.addEventListener("click", async (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>("[data-create]");
        if (!b) return;
        b.setAttribute("disabled", "");
        try {
          const c = chars.find((x) => x.id === b.dataset.create)!;
          const res = await partyApi.create(c);
          memberships.save({ code: res.code, playerId: res.playerId, token: res.token, characterId: c.id, joinedAt: new Date().toISOString() });
          go(`/gruppe/${res.code}`);
        } catch (err) { toast((err as Error).message, "error"); b.removeAttribute("disabled"); }
      });
      $("#join-form", root).addEventListener("submit", (e) => {
        e.preventDefault();
        const code = $<HTMLInputElement>("#join-code", root).value.trim().toUpperCase();
        if (/^[A-Z0-9]{6}$/.test(code)) go(`/gruppe/${code}`); else toast("Der Code hat 6 Zeichen.");
      });
      enhance(root);
    },
  };
}

/* ───────────── Lobby und gemeinsames Spiel ───────────── */

export function partyPage(): Page {
  let timer = 0;
  let alive = true;
  // Hängt direkt am <body>: im animierten Seitenbereich würde „position: fixed“ nicht am Bildschirm kleben.
  const hud = document.createElement("details");
  hud.className = "team-hud card";
  hud.hidden = true;
  // Auf breiten Bildschirmen offen, auf schmalen eingeklappt (antippen zum Öffnen)
  hud.open = matchMedia("(min-width: 1180px)").matches;
  return {
    leave() { alive = false; clearTimeout(timer); hud.remove(); },
    async render(root, params) {
      const [rawCode, query] = params.code.split("?");
      const code = rawCode.toUpperCase();
      const [chars, data] = await Promise.all([api.characters(), loadGameData()]);
      let m = memberships.get(code);

      // Noch nicht dabei: Figur wählen und beitreten
      if (!m) {
        setHTML(root, html`<div class="container adventures">
          <header class="page-head" data-reveal>
            <div class="eyebrow">Einladung</div>
            <h1>Gruppe <span class="party-code">${code}</span> beitreten</h1>
            <p class="lead">Wähle die Figur, mit der du mitspielen möchtest.</p>
          </header>
          ${characterPicker(chars, data, "join")}
        </div>`);
        root.addEventListener("click", async (e) => {
          const b = (e.target as HTMLElement).closest<HTMLElement>("[data-join]");
          if (!b) return;
          b.setAttribute("disabled", "");
          try {
            const c = chars.find((x) => x.id === b.dataset.join)!;
            const res = await partyApi.join(code, c);
            memberships.save({ code, playerId: res.playerId, token: res.token, characterId: c.id, joinedAt: new Date().toISOString() });
            go(`/gruppe/${code}?da`);
          } catch (err) { toast((err as Error).message, "error"); b.removeAttribute("disabled"); }
        });
        enhance(root);
        return;
      }

      const me: Membership = m;
      const myChar = chars.find((c) => c.id === me.characterId) ?? null;
      let view: PartyView | null = null;
      let busyLocal = false;
      let liveLocal = "";
      const seenRolls = new Set<string>();
      let firstLoad = true;
      let draft = "";
      let forging = false;

      setHTML(root, html`<div class="container play party-play">
        <header class="play-head">
          <a class="icon-btn" href="#/gruppe" aria-label="Zurück">${icon("arrowLeft")}</a>
          <div class="ph-title"><div class="eyebrow">Gruppe <span class="party-code">${code}</span></div><h1 id="party-title">Gemeinsames Abenteuer</h1></div>
          <span class="chip budget" id="budget" hidden></span>
          <button class="icon-btn" id="help" aria-label="Einführung öffnen" title="Wie funktioniert das?">?</button>
        </header>
        <div class="party-players" id="players"></div>
        <div id="world"></div>
        <div id="opening"></div>
        <div class="story" id="story" aria-live="polite"></div>
        <div id="below"></div>
        <div id="my-abilities"></div>
      </div>`);
      const storyEl = $("#story", root), belowEl = $("#below", root);
      $("#help", root).addEventListener("click", () => showTutorial(`gruppe-${code}`, PARTY_TUTORIAL, true));

      const playerName = (id: string) => view?.players.find((p) => p.id === id)?.name ?? "?";

      function entry(e: PartyStoryEntry, firstGm: boolean): Raw {
        if (e.type === "gm") return html`<div class="story-gm ${firstGm ? "first" : ""}">${withSpeech(paragraphs(splitSuggestions(e.text).body))}</div>`;
        if (e.type === "roll") return rollSummary(e.record, e.auto);
        if (e.type === "info") return html`<div class="story-info">${e.text}</div>`;
        return html`<div class="story-actions">${e.items.map((i) => html`<div class="story-player ${i.playerId === me.playerId ? "mine" : ""}"><span><b>${i.name}</b>${i.text}</span></div>`)}</div>`;
      }

      function renderPlayers() {
        if (!view) return;
        const v = view;
        $("#players", root).innerHTML = html`${v.players.map((p) => {
          const rolling = v.pending?.playerId === p.id;
          const status = v.status === "lobby" ? (p.host ? "Gastgeber" : "bereit") : rolling ? "muss würfeln" : p.acted ? "hat gehandelt" : "überlegt …";
          return html`<div class="pp ${p.id === me.playerId ? "me" : ""} ${p.acted ? "acted" : ""} ${rolling ? "rolling" : ""}">
            <span class="pp-sigil">${sigil(p.sigil)}</span>
            <span class="pp-text"><b>${p.name}${p.host ? html` ${icon("crown")}` : ""}</b><small>${p.className} · ${status}</small></span>
          </div>`;
        })}`.value;
      }

      function renderStory() {
        if (!view) return;
        let firstGm = true;
        const parts = view.story.map((e) => { const r = entry(e, e.type === "gm" && firstGm); if (e.type === "gm") firstGm = false; return r.value; });
        const live = busyLocal ? liveLocal.split("»")[0] : view.busy ? view.live : "";
        if (view.busy || busyLocal) parts.push(html`<div class="story-gm live ${firstGm ? "first" : ""}">${live ? withSpeech(paragraphs(live)) : ""}<span class="quill">${icon("feather")}</span></div>`.value);
        const nearBottom = innerHeight + scrollY > document.body.scrollHeight - 400;
        storyEl.innerHTML = parts.join("");
        if (nearBottom || firstLoad) window.scrollTo({ top: document.body.scrollHeight });
      }

      function pendingCard(): Raw {
        const p = view!.pending!;
        if (p.playerId !== me.playerId || !myChar) return html`<div class="card waiting-card">${icon("dice")} <b>${p.characterName}</b> muss eine ${p.label}${MODE_TEXT[p.modus]}${p.sg !== null ? ` (SG ${p.sg})` : ""} würfeln …</div>`;
        const d = dataFor(data, myChar);
        const spec = characterRoll(myChar, d.rules, d.classes, p.art, p.id);
        const mod = spec.parts.reduce((s, x) => s + x.value, 0);
        return html`<div class="pending card glow-border">
          <div class="pd-die">${icon("dice")}</div>
          <div class="pd-text">
            <div class="eyebrow">Der Spielleiter verlangt eine ${term("probe")} von dir</div>
            <h3>${p.label}${MODE_TEXT[p.modus]}${p.sg !== null ? html` · ${term("sg", "SG")} ${p.sg}` : ""}</h3>
            <p>${p.grund}</p>
            <p class="hint">Du würfelst ${spec.notation} ${spec.parts.map((x) => `${formatModifier(x.value)} ${x.label}`).join(" ")}${p.sg !== null ? ` – mindestens ${Math.max(2, Math.min(20, p.sg - mod))} auf dem Würfel.` : "."}</p>
          </div>
          <button class="btn btn-lg magnetic" id="roll-now">${icon("dice")} Würfeln</button>
        </div>`;
      }

      function renderBelow() {
        if (!view) return;
        const v = view;
        const amHost = v.players.find((p) => p.id === me.playerId)?.host;
        let content: Raw;
        if (v.status === "lobby") {
          content = html`<div class="card lobby glow-border">
            <h2>Wartet auf Mitspieler</h2>
            <p>Schick deinen Freunden diesen Code oder Link. Sie brauchen eine eigene Figur.</p>
            <div class="invite"><span class="party-code big">${code}</span><button class="btn btn-ghost btn-sm" id="copy">${icon("scroll")} Link kopieren</button></div>
            <p class="muted small">${v.players.length} von ${MAX_PARTY_SIZE} Plätzen belegt</p>
            ${amHost
              ? html`<button class="btn btn-lg magnetic glow-border" id="start" ${busyLocal || v.busy ? "disabled" : ""}>${icon("sparkles")} Abenteuer starten</button>${v.players.length === 1 ? html`<p class="hint">Du kannst auch allein starten – aber zu zweit macht es mehr Spaß.</p>` : ""}`
              : html`<p class="thinking">${icon("feather")} Warte, bis der Gastgeber das Abenteuer startet …</p>`}
            ${!amHost ? html`<button class="btn btn-ghost btn-sm" id="leave">${icon("x")} Gruppe verlassen</button>` : ""}
          </div>`;
        } else if (v.busy || busyLocal) {
          content = html`<div class="thinking">${icon("feather")} Der Spielleiter erzählt …</div>`;
        } else if (v.pending) {
          content = pendingCard();
        } else if (v.world?.arc?.finished) {
          content = endCard(v.world, v.players.map((p) => ({ id: p.characterId, name: p.name })), { href: "#/gruppe", label: "Neue Gruppe gründen" });
        } else {
          const last = [...v.story].reverse().find((e) => e.type === "gm");
          const suggestions = last?.type === "gm" ? splitSuggestions(last.text).suggestions : [];
          const waiting = v.players.filter((p) => !p.acted).map((p) => p.name);
          content = html`
            ${suggestions.length && !v.yourAction ? html`<div class="suggestions"><span class="muted small">Ideen:</span>${suggestions.map((s, i) => html`<button class="chip suggestion" data-suggest="${s}" style="--i:${i}">${s}</button>`)}</div>` : ""}
            ${v.yourAction
              ? html`<div class="card locked-action">${icon("lock")}<div><div class="eyebrow">Deine Handlung ist abgegeben</div><p>„${v.yourAction}“</p><small class="muted">${waiting.length ? html`Der Spielleiter erzählt, sobald ${waiting.join(", ")} ${waiting.length > 1 ? "abgegeben haben" : "abgegeben hat"}.` : "Gleich geht es weiter."}</small></div></div>`
              : html`<form class="composer card" id="composer">
                  <textarea class="textarea" id="action" maxlength="${MAX_ACTION_LENGTH}" rows="2" placeholder="Was tut ${myChar?.name ?? "deine Figur"}?">${draft}</textarea>
                  <button class="btn" type="submit" aria-label="Handlung abgeben">${icon("check")}</button>
                </form>
                <p class="hint center">Alle geben ihre Handlung ab – dann erzählt der Spielleiter die Runde. Abgegeben ist abgegeben: Danach lässt sie sich nicht mehr ändern.</p>`}
            ${amHost && v.players.some((p) => p.acted) && waiting.length ? html`<div class="center"><button class="btn btn-ghost btn-sm" id="now">${icon("play")} Jetzt erzählen (nicht auf ${waiting.join(", ")} warten)</button></div>` : ""}`;
        }
        // Das Eingabefeld bleibt dasselbe Element: Sonst verlöre, wer gerade tippt, Fokus und Cursor,
        // sobald eine andere Person ihre Handlung abgibt (die Ansicht wird dann neu gezeichnet).
        const oldTa = belowEl.querySelector<HTMLTextAreaElement>("#action");
        const typing = !!oldTa && document.activeElement === oldTa;
        const sel = oldTa ? [oldTa.selectionStart, oldTa.selectionEnd] as const : null;
        // Freigeschaltete Verbesserung (nur die eigene Figur) – über dem Eingabefeld
        const myCharId = v.players.find((p) => p.id === me.playerId)?.characterId ?? "";
        if (v.status === "playing" && !v.busy && !busyLocal && !v.world?.arc?.finished && (forging || upgradeState(v.world, myCharId) !== "none")) {
          content = html`${upgradeCard(v.world!, myCharId, abilityType, forging)}${content}`;
        }
        // Wahl beim Stufenaufstieg (eigene Figur)
        if (myChar && v.status === "playing" && !v.busy && !busyLocal && !v.world?.arc?.finished && levelChoiceDue(v.world, myChar.id, data.rules)) {
          content = html`${levelChoiceCard(v.world, myChar, dataFor(data, myChar).classes.find((x) => x.id === myChar.classId), data.rules)}${content}`;
        }
        belowEl.innerHTML = content.value;
        const newTa = belowEl.querySelector<HTMLTextAreaElement>("#action");
        if (oldTa && newTa && (typing || (draft && oldTa.value === draft))) {
          newTa.replaceWith(oldTa);
          if (typing) { oldTa.focus({ preventScroll: true }); oldTa.setSelectionRange(sel![0], sel![1]); }
        }
        renderHud();
        if (v.budget) { const b = $("#budget", root); b.hidden = false; b.textContent = `${v.lastTurnCostUsd !== null ? `Letzter Zug ${(v.lastTurnCostUsd * 100).toFixed(1)} ct · ` : ""}Budget ${v.budget.spentUsd.toFixed(2)} $ / ${v.budget.limitUsd.toFixed(0)} $`; }
        bindBelow();
        enhance(belowEl);
      }

      /** Oben links: das ganze Team mit Lebenspunkten und Fähigkeiten, dazu wer noch handeln muss. */
      function renderHud() {
        const v = view!;
        hud.hidden = v.status !== "playing";
        if (hud.hidden) return;
        if (!hud.isConnected) document.body.append(hud);
        const open = !v.busy && !busyLocal && !v.pending && !v.world?.arc?.finished;
        const waiting = open ? v.players.filter((p) => !p.acted) : [];
        const w = v.world;
        const hpOf = (p: PartyView["players"][number]) => ({ hp: w?.hp[p.characterId] ?? 0, max: w?.maxHp[p.characterId] ?? 0 });
        const total = v.players.reduce((s, p) => s + hpOf(p).hp, 0), totalMax = v.players.reduce((s, p) => s + hpOf(p).max, 0);
        hud.innerHTML = html`
          <summary>
            ${icon("users")}<b>Team</b><span class="hud-total">${icon("heart")} ${total}/${totalMax}</span>
            ${waiting.length ? html`<span class="hud-wait"><span class="wp-dot"></span>${waiting.length}</span>` : ""}
          </summary>
          ${waiting.length ? html`<div class="hud-waiting">Warten auf ${waiting.map((p) => html`<b class="${p.id === me.playerId ? "me" : ""}">${p.id === me.playerId ? "dich" : p.name}</b>`)}</div>` : ""}
          <div class="hud-members">${v.players.map((p) => {
            const { hp, max } = hpOf(p);
            const pct = max ? Math.max(0, Math.min(100, (hp / max) * 100)) : 0;
            return html`<div class="hud-m ${p.id === me.playerId ? "me" : ""} ${hp <= 0 ? "down" : ""}">
              <span class="hud-sigil">${sigil(p.sigil)}</span>
              <div class="hud-body">
                <div class="hud-line"><b>${p.name}</b>${p.host ? icon("crown") : ""}${w?.levels?.[p.characterId] ? html`<span class="hud-lv">St. ${w.levels[p.characterId].level}</span>` : ""}<small>${hp}/${max}</small></div>
                <span class="hp-bar ${pct <= 0 ? "down" : pct < 34 ? "low" : pct < 67 ? "mid" : ""}"><span style="width:${pct}%"></span></span>
                ${abilityChips(p.abilities)}
              </div>
            </div>`;
          })}</div>`.value;
      }

      /** Unten: die eigenen Fähigkeiten mit Erklärung. */
      function renderAbilities() {
        const el = $("#my-abilities", root);
        const mine = view?.players.find((p) => p.id === me.playerId);
        if (!mine) return;
        const key = JSON.stringify(mine.abilities.map((a) => a.name));
        if (el.dataset.key === key) return; // nur neu zeichnen, wenn sich etwas geändert hat (z. B. nach einer Verbesserung)
        el.dataset.key = key;
        el.innerHTML = abilityList(mine.name, mine.abilities).value;
      }

      const abilityType = (id: string) => (myChar ? dataFor(data, myChar).classes.find((x) => x.id === myChar.classId)?.abilities.find((a) => a.id === id)?.type : undefined) ?? "unterstuetzung";

      /** Verbesserungen erstellen lassen (Claude) bzw. eine wählen (ohne Claude). */
      async function doUpgrade(option?: number) {
        if (forging) return;
        if (option !== undefined) {
          try {
            const v = await partyApi.choose(me, option);
            const mine = v.players.find((p) => p.id === me.playerId);
            const up = mine?.abilities.find((a) => a.upgraded);
            apply(v);
            renderBelow();
            if (up) toast(`${up.name} – deine Fähigkeit hat sich weiterentwickelt!`, "success", 5000);
          } catch (e) { toast((e as Error).message, "error", 6000); }
          return;
        }
        forging = true;
        renderBelow();
        await partyApi.stream("upgrade", me, {}, (ev) => {
          if (ev.type === "view") apply(ev.view);
          else if (ev.type === "error") toast(ev.message, "error", 6000);
        });
        forging = false;
        renderBelow();
      }

      function renderOpening() {
        const el = $("#opening", root);
        if (!view?.opening) { el.innerHTML = ""; return; }
        if (el.dataset.done) return;
        el.dataset.done = "1";
        el.innerHTML = html`<details class="opening card" ${view.story.length <= 1 ? "open" : ""}><summary>${icon("dice")} Startimpuls – vom Zufall gewürfelt</summary>${openingCards(view.opening, view.story.length <= 1)}</details>`.value;
        $("#party-title", root).textContent = view.opening.ort.charAt(0).toUpperCase() + view.opening.ort.slice(1);
      }

      /** Würfe anderer Spieler für alle als 3D-Wurf zeigen. */
      async function showNewRolls() {
        if (!view) return;
        const rolls = view.story.filter((e): e is Extract<PartyStoryEntry, { type: "roll" }> => e.type === "roll");
        const fresh = rolls.filter((r) => !seenRolls.has(r.record.id));
        for (const r of rolls) seenRolls.add(r.record.id);
        if (firstLoad) return;
        for (const r of fresh) if (r.playerId && r.playerId !== me.playerId) await rollWithOverlay(`${playerName(r.playerId)} würfelt`, () => Promise.resolve(r.record));
      }

      function apply(v: PartyView) {
        const changed = !view || v.version !== view.version || v.live !== view.live;
        const levelBefore = myChar ? view?.world?.levels?.[myChar.id]?.level : undefined;
        view = v;
        if (myChar && levelBefore !== undefined) announceLevel(levelBefore, v.world?.levels?.[myChar.id]?.level ?? levelBefore, data.rules);
        if (!changed && !firstLoad) return;
        renderPlayers();
        renderAbilities();
        if (v.status === "playing") showTutorial(`gruppe-${code}`, PARTY_TUTORIAL);
        $("#world", root).innerHTML = worldPanel(v.world, v.players.map((p) => ({ id: p.characterId, name: p.name })), myChar?.id, data.rules).value;
        renderOpening();
        renderStory();
        renderBelow();
        void showNewRolls();
        firstLoad = false;
      }

      async function poll() {
        if (!alive) return;
        try { if (!busyLocal) apply(await partyApi.state(me)); }
        catch (e) {
          if (e instanceof PartyApiError && (e.status === 403 || e.status === 400)) { toast(e.message, "error"); memberships.remove(code); go("/gruppe"); return; }
        }
        timer = window.setTimeout(poll, view?.busy ? 1500 : document.hidden ? 8000 : 3500);
      }

      function handle(ev: PartyEvent) {
        if (!alive) return;
        if (ev.type === "text") { liveLocal += ev.text; renderStory(); }
        else if (ev.type === "roll") seenRolls.add(ev.record.id);
        else if (ev.type === "autoroll") { seenRolls.add(ev.record.id); liveLocal += `\n\n⚔ ${ev.record.label}: ${ev.record.total}\n\n`; renderStory(); }
        else if (ev.type === "view") { busyLocal = false; liveLocal = ""; apply(ev.view); }
        else if (ev.type === "error") { busyLocal = false; liveLocal = ""; toast(ev.message, "error", 6000); }
      }

      async function stream(op: "start" | "action" | "roll", extra: Record<string, unknown> = {}) {
        busyLocal = true; liveLocal = "";
        renderBelow();
        await partyApi.stream(op, me, extra, handle);
        busyLocal = false;
        try { apply(await partyApi.state(me)); } catch { /* nächster Poll */ }
        renderBelow();
      }

      async function doRoll() {
        if (!view?.pending) return;
        const p = view.pending;
        let resolveRoll!: (r: RollRecord) => void, rejectRoll!: (e: Error) => void;
        const rollP = new Promise<RollRecord>((res, rej) => { resolveRoll = res; rejectRoll = rej; });
        const overlay = rollWithOverlay(`${p.label}${MODE_TEXT[p.modus]}${p.sg !== null ? ` · SG ${p.sg}` : ""}`, () => rollP);
        busyLocal = true; liveLocal = "";
        renderBelow();
        const queued: PartyEvent[] = [];
        let open = true;
        const s = partyApi.stream("roll", me, {}, (ev) => {
          if (ev.type === "roll") { seenRolls.add(ev.record.id); resolveRoll(ev.record); return; }
          if (ev.type === "error") rejectRoll(new Error(ev.message));
          if (open) queued.push(ev); else handle(ev);
        });
        await overlay;
        open = false;
        queued.splice(0).forEach(handle);
        await s;
        busyLocal = false;
        try { apply(await partyApi.state(me)); } catch { /* nächster Poll */ }
      }

      function bindBelow() {
        belowEl.querySelector("#copy")?.addEventListener("click", async () => {
          try { await navigator.clipboard.writeText(inviteLink(code)); toast("Link kopiert – schick ihn deinen Mitspielern.", "success"); }
          catch { toast(inviteLink(code)); }
        });
        belowEl.querySelector("#start")?.addEventListener("click", () => void stream("start", { previousOpenings: campaignStore.previousOpenings() }));
        belowEl.querySelector("#leave")?.addEventListener("click", async () => { try { await partyApi.leave(me); } catch { /* egal */ } memberships.remove(code); go("/gruppe"); });
        belowEl.querySelector("#roll-now")?.addEventListener("click", () => void doRoll());
        belowEl.querySelector("[data-upgrade]")?.addEventListener("click", () => void doUpgrade());
        bindLevelCard(belowEl, async (choice) => {
          try { apply(await partyApi.level(me, choice)); renderBelow(); toast(choice.skill ? "Neue Fertigkeit gelernt!" : "Attribute gesteigert!", "success", 4000); }
          catch (e) { toast((e as Error).message, "error", 6000); }
        });
        belowEl.querySelectorAll<HTMLElement>("[data-choose]").forEach((b) => b.addEventListener("click", () => void doUpgrade(Number(b.dataset.choose))));
        belowEl.querySelector("#now")?.addEventListener("click", () => void stream("action", { text: "", now: true }));
        const ta = belowEl.querySelector<HTMLTextAreaElement>("#action");
        if (ta && !ta.dataset.bound) {
          ta.dataset.bound = "1";
          ta.addEventListener("input", () => { draft = ta.value; });
          ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); belowEl.querySelector<HTMLFormElement>("#composer")!.requestSubmit(); } });
        }
        belowEl.querySelector("#composer")?.addEventListener("submit", (e) => {
          e.preventDefault();
          const text = ta!.value.trim();
          if (!text) return;
          draft = "";
          void stream("action", { text });
        });
        belowEl.querySelectorAll<HTMLElement>("[data-suggest]").forEach((b) => b.addEventListener("click", () => { ta!.value = b.dataset.suggest!; draft = ta!.value; ta!.focus(); }));
      }

      void poll();
      if (query === "da") toast("Du bist dabei! Warte, bis der Gastgeber startet.", "success");
      if (!myChar) toast("Deine Figur aus dieser Gruppe liegt nicht in diesem Browser – du kannst zuschauen, aber nicht würfeln.");
    },
  };
}
