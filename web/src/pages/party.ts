import { offerLetters } from "../lib/letters";
import { heirloomPicker, syncCharacterGrowth } from "../lib/growthUi";
import { setMusic } from "../lib/music";
import { prepareRead, readButton, setVoiceCast } from "../lib/voice";
import { setWeather } from "../lib/weather";
import { noteLegacy } from "../lib/legacy";
import { sceneFigure } from "../lib/sceneImage";
import { costChip } from "../../../shared/campaign";
import { openSheet } from "../lib/sheetModal";
import { MAX_ACTION_LENGTH, splitSuggestions, stripMarkers } from "../../../shared/campaign";
import { characterRoll } from "../../../shared/character";
import { formatModifier, type RollRecord } from "../../../shared/dice";
import { MAX_PARTY_SIZE, type PartyEvent, type PartyOverview, type PartyStoryEntry, type PartyView } from "../../../shared/party";
import type { Character } from "../../../shared/schema";
import { getStage, rollWithOverlay } from "../dice3d/roller";
import { enhance } from "../fx/effects";
import { api, loadGameData, type GameData } from "../lib/api";
import { campaignStore } from "../lib/campaigns";
import { dataFor } from "../lib/customClasses";
import { $, fragment, html, raw, setHTML, type Raw } from "../lib/dom";
import { term } from "../lib/glossary";
import { icon, sigil } from "../lib/icons";
import { memberships, partyApi, PartyApiError, type Membership } from "../lib/party";
import { go, type Page } from "../lib/router";
import { confirmDialog, toast } from "../lib/ui";
import { openingCards, paragraphs, rollSummary, withSpeech } from "./adventure";
import { noteParty } from "../lib/achievements";
import { bindVote, voteCard } from "../lib/voteUi";
import { bindSides, fillSide, itemDoneText, lageSide, lootText, playLayout, setMapData, setSkyPhase, teamSide, type TeamMember } from "../lib/playLayout";
import { endCard } from "../lib/arc";
import { upgradeCard, upgradeState } from "../lib/upgradeUi";
import { bindShop, shopCard } from "../lib/shopUi";
import { bindGamble, gambleCard, showGamble } from "../lib/gambleUi";
import { announceLevel, bindLevelCard, levelChoiceCard, levelChoiceDue } from "../lib/levelUi";
import { abilityList } from "../lib/abilities";
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
            <div class="party-list" id="party-list">${mine.map((m) => partyRow(m, null))}</div>` : ""}
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
      // Status der Gruppen nachladen (läuft / Lobby / beendet)
      const overview = new Map<string, PartyOverview>();
      if (mine.length) partyApi.overview(mine).then((r) => {
        for (const it of r.items) overview.set(it.code, it);
        const list = root.querySelector("#party-list");
        if (list) list.innerHTML = mine.filter((m) => memberships.get(m.code)).map((m) => partyRow(m, overview.get(m.code) ?? null).value).join("");
      }).catch(() => { /* ohne Status weiter */ });
      root.addEventListener("click", async (e) => {
        const del = (e.target as HTMLElement).closest<HTMLElement>("[data-del]");
        if (del) { e.preventDefault(); await removeParty(del.dataset.del!, overview.get(del.dataset.del!) ?? null, root); return; }
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

const STATUS: Record<PartyOverview["status"], string> = { lobby: "Lobby", playing: "läuft", finished: "beendet", gone: "nicht mehr vorhanden" };

/** Eine Zeile in „Deine Gruppen“ – mit Status (sobald vom Server geladen) und Löschen-Knopf. */
function partyRow(m: Membership, info: PartyOverview | null): Raw {
  const status = info ? (info.status === "finished" && info.outcome === "niederlage" ? "beendet · Niederlage" : STATUS[info.status]) : "";
  return html`<div class="party-row-wrap" data-row="${m.code}">
    <a class="card party-row" href="#/gruppe/${m.code}">
      <b class="party-code">${m.code}</b>
      <span class="pr-text"><b>${info?.title ? info.title.charAt(0).toUpperCase() + info.title.slice(1) : "Gemeinsames Abenteuer"}</b>
        <small class="muted">${info?.players?.length ? `${info.players.join(", ")} · ` : ""}beigetreten ${new Date(m.joinedAt).toLocaleDateString("de-DE")}</small></span>
      ${status ? html`<span class="chip pr-status ${info!.status}">${status}</span>` : ""}
      ${icon("arrowRight")}
    </a>
    <button class="icon-btn party-del" data-del="${m.code}" aria-label="Gruppe ${m.code} löschen" title="Gruppe löschen">${icon("trash")}</button>
  </div>`;
}

/** Löschen mit Rückfrage. Was auf dem Server passiert, entscheidet der Server (laufende Abenteuer anderer bleiben). */
async function removeParty(code: string, info: PartyOverview | null, root: HTMLElement) {
  const m = memberships.get(code);
  if (!m) return;
  const others = (info?.players?.length ?? 1) > 1;
  const gone = info?.status === "gone";
  const full = gone || !others || info?.status === "lobby" || (info?.host && info.status === "finished");
  const text = gone ? "Diese Gruppe gibt es auf dem Server nicht mehr. Sie wird aus deiner Liste entfernt."
    : !others ? "Die Gruppe und ihr Spielstand werden endgültig gelöscht."
    : info?.status === "lobby" ? "Du verlässt die Gruppe und sie verschwindet aus deiner Liste. Die anderen können weiter warten und starten."
    : info?.host && info.status === "finished" ? "Das Abenteuer ist beendet. Die Gruppe wird für alle endgültig gelöscht."
    : "Die anderen spielen weiter – die Gruppe verschwindet nur aus deiner Liste. Zurück kommst du danach nicht mehr.";
  if (!(await confirmDialog(`Gruppe ${code} löschen?`, text, full ? "Löschen" : "Entfernen", true))) return;
  let deleted = false;
  try { deleted = (await partyApi.remove(m)).deleted; }
  catch (e) { if (!(e instanceof PartyApiError) || e.status === 0) { toast("Keine Verbindung – bitte später nochmal versuchen.", "error"); return; } }
  memberships.remove(code);
  root.querySelector(`[data-row="${code}"]`)?.remove();
  if (!memberships.list().length) root.querySelector("#party-list")?.previousElementSibling?.remove();
  toast(deleted ? "Gruppe gelöscht." : "Gruppe aus deiner Liste entfernt.", "success");
}

/* ───────────── Lobby und gemeinsames Spiel ───────────── */

export function partyPage(): Page {
  let timer = 0;
  let alive = true;
  let unbindSides = () => {};
  let offVisible = () => {};
  return {
    leave() { alive = false; clearTimeout(timer); unbindSides(); offVisible(); },
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
        ${playLayout(html`
          <div id="opening"></div>
          <div class="story" id="story" aria-live="polite"></div>
          <div id="below"></div>
          <div id="my-abilities"></div>`)}
      </div>`);
      unbindSides = bindSides(root, (charId) => {
        const p = view?.players.find((x) => x.characterId === charId);
        if (p) openSheet(async () => (await partyApi.sheet(me, p.id)).character, data, () => view?.world);
      }, async (action, name, target) => {
        const who = target?.id ?? me.characterId;
        const before = view?.world?.hp[who];
        try {
          apply(await partyApi.shop(me, action, name, target?.id));
          renderBelow();
          toast(itemDoneText(action, name, before, view?.world?.hp[who], target?.name), "success", 3500);
        } catch (e) { toast((e as Error).message, "error", 6000); }
      });
      const storyEl = $("#story", root), belowEl = $("#below", root);
      $("#help", root).addEventListener("click", () => showTutorial(`gruppe-${code}`, PARTY_TUTORIAL, true));

      const playerName = (id: string) => view?.players.find((p) => p.id === id)?.name ?? "?";

      function entry(e: PartyStoryEntry, firstGm: boolean): Raw {
        if (e.type === "gm") return html`<div class="story-gm ${firstGm ? "first" : ""}">${withSpeech(paragraphs(splitSuggestions(e.text).body))}${readButton()}</div>`;
        if (e.type === "roll") return rollSummary(e.record, e.auto);
        if (e.type === "info") return html`<div class="story-info">${e.text}</div>`;
        if (e.type === "image") return sceneFigure(e);
        return html`<div class="story-actions">${e.items.map((i) => html`<div class="story-player ${i.playerId === me.playerId ? "mine" : ""}"><span><b>${i.name}</b>${i.text}</span></div>`)}</div>`;
      }

      function renderPlayers() {
        if (!view) return;
        const v = view;
        // Im Spiel stehen alle links im Team – die Zeile oben braucht es nur in der Lobby
        root.querySelector(".play-layout")!.classList.toggle("lobby-mode", v.status !== "playing");
        $("#players", root).hidden = v.status === "playing";
        $("#players", root).innerHTML = html`${v.players.map((p) => {
          const rolling = v.pendings.some((c) => c.playerId === p.id);
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
        const live = busyLocal ? stripMarkers(liveLocal) : view.busy ? view.live : "";
        if (view.busy || busyLocal) parts.push(html`<div class="story-gm live ${firstGm ? "first" : ""}">${live ? withSpeech(paragraphs(live)) : ""}<span class="quill">${icon("feather")}</span></div>`.value);
        const nearBottom = innerHeight + scrollY > document.body.scrollHeight - 400;
        // Nur geänderte Einträge neu zeichnen: Sonst spielen bei jeder Aktion alle Einblend-Animationen erneut
        // und Bilder laden neu – die Seite wirkt, als würde sie neu geladen.
        const nodes = [...storyEl.children] as (HTMLElement & { _html?: string })[];
        parts.forEach((h, i) => {
          const old = nodes[i];
          if (old?._html === h) return;
          const isLive = h.startsWith('<div class="story-gm live');
          if (old && isLive && old.classList.contains("live")) { old.innerHTML = fragment(raw(h)).innerHTML; old._html = h; return; }
          const el = fragment(raw(h)) as HTMLElement & { _html?: string };
          el._html = h;
          if (old) old.replaceWith(el); else storyEl.append(el);
        });
        nodes.slice(parts.length).forEach((n) => n.remove());
        if (nearBottom || firstLoad) window.scrollTo({ top: document.body.scrollHeight });
      }

      /** Offene Probe: die eigene mit Würfeln-Knopf, sonst wer gerade würfelt. */
      function pendingCard(): Raw {
        const all = view!.pendings;
        const p = all.find((c) => c.playerId === me.playerId);
        const others = all.filter((c) => c !== p);
        const waiting = others.length ? html`<div class="card waiting-card">${icon("dice")} <span>${others.map((o, i) => html`${i ? (i === others.length - 1 ? " und " : ", ") : ""}<b>${o.characterName}</b>`)} ${others.length > 1 ? "würfeln" : "würfelt"} noch${others.length === 1 ? html` (${others[0].label}${MODE_TEXT[others[0].modus]}${others[0].sg !== null ? `, SG ${others[0].sg}` : ""})` : ""} …${p ? "" : html`<br><small class="muted">Danach erzählt der Spielleiter weiter.</small>`}</span></div>` : html``;
        if (!p || !myChar) return waiting;
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
        </div>${waiting}`;
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
            ${v.failed ? html`<p class="hint">${icon("info")} Der letzte Start hat nicht geklappt: ${v.failed}</p>` : ""}
            ${amHost
              ? html`<button class="btn btn-lg magnetic glow-border" id="start" ${busyLocal || v.busy ? "disabled" : ""}>${icon("sparkles")} Abenteuer starten</button>${v.players.length === 1 ? html`<p class="hint">Du kannst auch allein starten – aber zu zweit macht es mehr Spaß.</p>` : ""}`
              : html`<p class="thinking">${icon("feather")} Warte, bis der Gastgeber das Abenteuer startet …</p>`}
            ${!amHost ? html`<button class="btn btn-ghost btn-sm" id="leave">${icon("x")} Gruppe verlassen</button>` : ""}
          </div>`;
        } else if (v.busy || busyLocal) {
          content = html`<div class="thinking">${icon("feather")} Der Spielleiter erzählt …</div>`;
        } else if (v.pendings.length) {
          // Gescheiterter Wurf-Zug: Probe ist wieder offen, erneutes Würfeln ergibt denselben Wurf
          const again = v.pendings.find((c) => c.playerId === me.playerId);
          content = html`${v.failed ? html`<div class="card failed-card"><h3>${icon("info")} Das hat nicht geklappt</h3><p>${v.failed}</p><small class="muted">${again ? "Würfle einfach noch einmal – das Ergebnis bleibt dasselbe." : `${v.pendings.map((c) => c.characterName).join(", ")} würfelt noch einmal – das Ergebnis bleibt dasselbe.`}</small></div>` : ""}${pendingCard()}`;
        } else if (v.world?.arc?.finished) {
          content = html`${endCard(v.world, v.players.map((p) => ({ id: p.characterId, name: p.name })), { href: "#/gruppe", label: "Neue Gruppe gründen" }, `#/chronik/gruppe/${v.code}`)}${myChar ? heirloomPicker(v.world, myChar) : ""}`;
        } else {
          const last = [...v.story].reverse().find((e) => e.type === "gm");
          const suggestions = last?.type === "gm" ? splitSuggestions(last.text).suggestions : [];
          const waiting = v.players.filter((p) => !p.acted).map((p) => p.name);
          // Letzter Zug gescheitert: Die Handlungen sind noch da – jeder kann die Runde neu erzählen lassen
          const failed = v.failed && v.players.some((p) => p.acted)
            ? html`<div class="card failed-card"><h3>${icon("info")} Das hat nicht geklappt</h3><p>${v.failed}</p><small class="muted">Eure Handlungen sind gespeichert.</small><button class="btn btn-sm" id="retry">${icon("refresh")} Erneut versuchen</button></div>` : "";
          content = html`${failed}
            ${suggestions.length && !v.yourAction ? html`<div class="suggestions"><span class="muted small">Ideen:</span>${suggestions.map((s, i) => html`<button class="chip suggestion" data-suggest="${s}" style="--i:${i}">${s}</button>`)}</div>` : ""}
            ${v.yourAction
              ? html`<div class="card locked-action">${icon("lock")}<div><div class="eyebrow">Deine Handlung ist abgegeben</div><p>„${v.yourAction}“</p><small class="muted">${waiting.length ? html`Der Spielleiter erzählt, sobald ${waiting.join(", ")} ${waiting.length > 1 ? "abgegeben haben" : "abgegeben hat"}.` : "Gleich geht es weiter."}</small></div>${waiting.length ? html`<button class="btn btn-ghost btn-sm" id="withdraw" title="Vertippt? Handlung zurückholen und neu schreiben">${icon("refresh")} Zurückziehen</button>` : ""}</div>`
              : html`<form class="composer card" id="composer">
                  <textarea class="textarea" id="action" maxlength="${MAX_ACTION_LENGTH}" rows="2" placeholder="Was tut ${myChar?.name ?? "deine Figur"}?">${draft}</textarea>
                  <button class="btn" type="submit" aria-label="Handlung abgeben">${icon("check")}</button>
                </form>
                <p class="hint center">Alle geben ihre Handlung ab – dann erzählt der Spielleiter die Runde. Bis dahin kannst du deine Handlung noch zurückziehen.</p>`}
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
        // Offener Laden: jede Person kauft für ihre eigene Figur
        if (v.status === "playing" && !v.busy && !busyLocal && !v.pendings.length && v.world?.shop && !v.world.arc?.finished && myCharId) {
          content = html`${shopCard(v.world, myCharId)}${content}`;
        }
        // Würfeltisch: jede Person spielt mit ihrem eigenen Geld
        if (v.status === "playing" && !v.busy && !busyLocal && !v.pendings.length && v.world?.gamble && !v.world.combat && !v.world.arc?.finished && myCharId) {
          content = html`${gambleCard(v.world, myCharId)}${content}`;
        }
        // Abstimmung: Frage des Spielleiters, alle stimmen per Knopf ab
        if (v.status === "playing" && !v.busy && !busyLocal && !v.pendings.length && v.world?.vote && !v.world.vote.result && myCharId) {
          content = html`${voteCard(v.world, myCharId, Object.fromEntries(v.players.map((p) => [p.characterId, p.name])), v.players.length)}${content}`;
        }
        // Wahl beim Stufenaufstieg (eigene Figur)
        if (myChar && v.status === "playing" && !v.busy && !busyLocal && !v.world?.arc?.finished && levelChoiceDue(v.world, myChar.id, data.rules)) {
          content = html`${levelChoiceCard(v.world, myChar, dataFor(data, myChar).classes.find((x) => x.id === myChar.classId), data.rules)}${content}`;
        }
        // Gleicher Inhalt (z. B. jemand anderes hat gehandelt, hier ändert sich nichts): nicht neu aufbauen
        const below = belowEl as HTMLElement & { _html?: string };
        if (below._html === content.value) { renderHud(); renderCost(); return; }
        below._html = content.value;
        belowEl.innerHTML = content.value;
        const newTa = belowEl.querySelector<HTMLTextAreaElement>("#action");
        if (oldTa && newTa && (typing || (draft && oldTa.value === draft))) {
          newTa.replaceWith(oldTa);
          if (typing) { oldTa.focus({ preventScroll: true }); oldTa.setSelectionRange(sel![0], sel![1]); }
        }
        renderHud();
        renderCost();
        bindBelow();
        enhance(belowEl);
      }

      function renderCost() {
        const v = view!;
        if (v.budget || v.costUsd) { const b = $("#budget", root), chip = costChip({ claudeUsd: v.costUsd ?? 0, imageUsd: v.imageUsd ?? 0, lastUsd: v.lastTurnCostUsd, lastImageUsd: v.lastTurnImageUsd ?? null }, v.budget); b.hidden = false; b.textContent = chip.text; b.title = chip.title; }
      }

      /** Seitenleisten: links das Team (wer noch handeln muss, Lebenspunkte, Fähigkeiten), rechts Kampf und Kernauftrag. */
      function renderHud() {
        const v = view!;
        if (v.status !== "playing") return;
        const open = !v.busy && !busyLocal && !v.pendings.length && !v.world?.arc?.finished;
        const members: TeamMember[] = v.players.map((p) => ({
          id: p.characterId, name: p.name, sigil: p.sigil, className: p.className, host: p.host, me: p.id === me.playerId, abilities: p.abilities,
          status: v.pendings.some((c) => c.playerId === p.id) ? "muss würfeln" : open ? (p.acted ? "hat gehandelt" : "überlegt …") : undefined,
        }));
        const waiting = open ? members.filter((m, i) => !v.players[i].acted) : [];
        fillSide(root.querySelector("#side-left"), teamSide(v.world, members, data.rules, waiting));
        fillSide(root.querySelector("#side-right"), lageSide(v.world));
        setMapData(root, v.world?.map);
        setSkyPhase(v.world?.time?.phase);
        setWeather(v.world?.time?.weather);
        setMusic(v.status === "playing" ? v.world : null);
        setVoiceCast(v.world, v.players.map((p) => p.name));
        noteParty(v);
        noteLegacy(v.world, `gruppe-${v.code}`, v.opening ? v.opening.ort.charAt(0).toUpperCase() + v.opening.ort.slice(1) : `Gruppe ${v.code}`);
      }

      /** Unten: die eigenen Fähigkeiten mit Erklärung. */
      function renderAbilities() {
        const el = $("#my-abilities", root);
        const mine = view?.players.find((p) => p.id === me.playerId);
        if (!mine) return;
        const used = view?.world?.used?.[mine.characterId] ?? {};
        const key = JSON.stringify([mine.abilities.map((a) => a.name), used, view?.world?.abilityUses?.[mine.characterId] ?? {}]);
        if (el.dataset.key === key) return; // nur neu zeichnen, wenn sich etwas geändert hat (Verbesserung, Einsatz, Rast)
        el.dataset.key = key;
        el.innerHTML = abilityList(mine.name, mine.abilities, view?.world, mine.characterId, myChar && myChar.id === mine.characterId ? myChar : undefined).value;
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
        const invBefore = myChar ? view?.world?.inventory?.[myChar.id] : undefined;
        const worldBefore = view?.world;
        view = v;
        if (myChar) syncCharacterGrowth(myChar.id, v.world);
        if (myChar && worldBefore) void offerLetters(`gruppe-${code}`, myChar.name, worldBefore, v.world, (chapter) => partyApi.letter(me, chapter));
        if (myChar) { const loot = lootText(invBefore, v.world?.inventory?.[myChar.id]); if (loot) toast(loot, "success", 5000); }
        if (myChar && levelBefore !== undefined) announceLevel(levelBefore, v.world?.levels?.[myChar.id]?.level ?? levelBefore, data.rules);
        if (!changed && !firstLoad) return;
        renderPlayers();
        renderAbilities();
        if (v.status === "playing") showTutorial(`gruppe-${code}`, PARTY_TUTORIAL);
        // Würfe der anderen zuerst zeigen – die Animation soll nicht erst nach dem Neuaufbau der Erzählung starten
        void showNewRolls();
        renderOpening();
        renderStory();
        renderBelow();
        firstLoad = false;
      }

      let polling = false;
      async function poll() {
        if (!alive || polling) return;
        polling = true;
        try {
          if (!busyLocal) {
            const r = await partyApi.poll(me, view);
            if (!busyLocal) {
              if (!("unchanged" in r) && !("partial" in r)) apply(r);
              else if ("partial" in r && view) apply({ ...view, version: r.version, live: r.live, busy: r.busy });
            }
          }
        }
        catch (e) {
          if (e instanceof PartyApiError && (e.status === 403 || e.status === 400)) { toast(e.message, "error"); memberships.remove(code); go("/gruppe"); return; }
        }
        // Wartet die Gruppe auf den Wurf eines anderen, öfter nachsehen – sonst kommt dessen Würfelanimation spät an
        const othersRoll = !!view?.pendings.some((c) => c.playerId !== me.playerId);
        if (othersRoll) getStage(); // 3D-Würfelbühne schon vorbereiten
        polling = false;
        // Im Hintergrund selten nachsehen – beim Zurückkehren sofort (siehe unten)
        clearTimeout(timer);
        timer = window.setTimeout(poll, document.hidden ? 60000 : othersRoll ? 1000 : view?.busy ? 1500 : 3500);
      }
      const onVisible = () => { if (!document.hidden && alive) { clearTimeout(timer); void poll(); } };
      document.addEventListener("visibilitychange", onVisible);
      offVisible = () => document.removeEventListener("visibilitychange", onVisible);

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
        // Wer den Zug ausgelöst hat, bereitet das Vorlesen vor (gespeichert für alle – die anderen spielen dann sofort ab)
        prepareRead(storyEl);
      }

      async function doRoll() {
        const p = view?.pendings.find((c) => c.playerId === me.playerId);
        if (!p) return;
        let resolveRoll!: (r: RollRecord) => void, rejectRoll!: (e: Error) => void;
        const rollP = new Promise<RollRecord>((res, rej) => { resolveRoll = res; rejectRoll = rej; });
        const queued: PartyEvent[] = [];
        let open = true;
        let damage: RollRecord | null = null;
        // Erst den Wurf abschicken, dann die 3D-Bühne aufbauen – so erfahren die anderen sofort davon
        const s = partyApi.stream("roll", me, {}, (ev) => {
          if (ev.type === "roll") { seenRolls.add(ev.record.id); if (ev.record.label.includes("Schaden")) damage = ev.record; else resolveRoll(ev.record); return; }
          if (ev.type === "error") rejectRoll(new Error(ev.message));
          if (open) queued.push(ev); else handle(ev);
        });
        const overlay = rollWithOverlay(`${p.label}${MODE_TEXT[p.modus]}${p.sg !== null ? ` · SG ${p.sg}` : ""}`, () => rollP);
        busyLocal = true; liveLocal = "";
        renderBelow();
        await overlay;
        // Eigener Schadenswurf mit eigener Animation
        if (!damage) await new Promise((r) => setTimeout(r, 400)); // kommt der Schaden etwas später, kurz warten
        const dmg = damage as RollRecord | null; // im Ereignis-Handler gesetzt
        if (dmg) await rollWithOverlay(`Treffer! ${dmg.label.split(": ").pop()}`, () => Promise.resolve(dmg));
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
        bindShop(belowEl, async (action, ref) => {
          try { apply(await partyApi.shop(me, action, ref)); renderBelow(); if (action === "verkaufen") toast("Verkauft.", "success", 3000); }
          catch (e) { toast((e as Error).message, "error", 6000); renderBelow(); }
        });
        bindGamble(belowEl, async (bet) => {
          const opponent = view?.world?.gamble?.opponent ?? "Dein Gegner";
          const game = partyApi.shop(me, "spielen", String(bet)).then((v) => { apply(v); return v.world?.gamble?.last ?? null; }).catch((e) => { toast((e as Error).message, "error", 6000); return null; });
          await showGamble(game, opponent);
          renderBelow();
        });
        bindLevelCard(belowEl, async (choice) => {
          try { apply(await partyApi.level(me, choice)); renderBelow(); toast(choice.skill ? "Neue Fertigkeit gelernt!" : "Attribute gesteigert!", "success", 4000); }
          catch (e) { toast((e as Error).message, "error", 6000); }
        });
        belowEl.querySelectorAll<HTMLElement>("[data-choose]").forEach((b) => b.addEventListener("click", () => void doUpgrade(Number(b.dataset.choose))));
        belowEl.querySelector("#withdraw")?.addEventListener("click", async () => {
          const text = view?.yourAction ?? "";
          try { draft = text; apply(await partyApi.withdraw(me)); renderBelow(); belowEl.querySelector<HTMLTextAreaElement>("#action")?.focus(); }
          catch (e) { toast((e as Error).message, "error", 6000); }
        });
        bindVote(belowEl, (option) => void stream("action", { text: "", vote: option }));
        belowEl.querySelector("#now")?.addEventListener("click", () => void stream("action", { text: "", now: true }));
        belowEl.querySelector("#retry")?.addEventListener("click", () => void stream("action", { text: "", retry: true }));
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
      if (!myChar) toast("Deine Figur aus dieser Gruppe ist nicht in deinem Konto – du kannst zuschauen, aber nicht würfeln.");
    },
  };
}
