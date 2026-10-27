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
  return {
    leave() { alive = false; clearTimeout(timer); },
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

      setHTML(root, html`<div class="container play party-play">
        <header class="play-head">
          <a class="icon-btn" href="#/gruppe" aria-label="Zurück">${icon("arrowLeft")}</a>
          <div class="ph-title"><div class="eyebrow">Gruppe <span class="party-code">${code}</span></div><h1 id="party-title">Gemeinsames Abenteuer</h1></div>
          <span class="chip budget" id="budget" hidden></span>
        </header>
        <div class="party-players" id="players"></div>
        <div id="world"></div>
        <div id="opening"></div>
        <div class="story" id="story" aria-live="polite"></div>
        <div id="below"></div>
      </div>`);
      const storyEl = $("#story", root), belowEl = $("#below", root);

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
        } else {
          const last = [...v.story].reverse().find((e) => e.type === "gm");
          const suggestions = last?.type === "gm" ? splitSuggestions(last.text).suggestions : [];
          const waiting = v.players.filter((p) => !p.acted).map((p) => p.name);
          content = html`
            ${suggestions.length ? html`<div class="suggestions"><span class="muted small">Ideen:</span>${suggestions.map((s, i) => html`<button class="chip suggestion" data-suggest="${s}" style="--i:${i}">${s}</button>`)}</div>` : ""}
            ${v.yourAction ? html`<div class="callout slim">${icon("check")}<p>Deine Handlung: „${v.yourAction}“ ${waiting.length ? html`– wartet noch auf <b>${waiting.join(", ")}</b>.` : ""} Du kannst sie bis zum Erzählen noch ändern.</p></div>` : ""}
            <form class="composer card" id="composer">
              <textarea class="textarea" id="action" maxlength="${MAX_ACTION_LENGTH}" rows="2" placeholder="Was tut ${myChar?.name ?? "deine Figur"}?">${draft || v.yourAction || ""}</textarea>
              <button class="btn" type="submit" aria-label="Handlung festlegen">${icon("check")}</button>
            </form>
            <p class="hint center">Alle legen ihre Handlung fest – dann erzählt der Spielleiter die Runde.</p>
            ${amHost && v.players.some((p) => p.acted) && waiting.length ? html`<div class="center"><button class="btn btn-ghost btn-sm" id="now">${icon("play")} Jetzt erzählen (nicht auf ${waiting.join(", ")} warten)</button></div>` : ""}`;
        }
        belowEl.innerHTML = content.value;
        if (v.budget) { const b = $("#budget", root); b.hidden = false; b.textContent = `${v.lastTurnCostUsd !== null ? `Letzter Zug ${(v.lastTurnCostUsd * 100).toFixed(1)} ct · ` : ""}Budget ${v.budget.spentUsd.toFixed(2)} $ / ${v.budget.limitUsd.toFixed(0)} $`; }
        bindBelow();
        enhance(belowEl);
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
        view = v;
        if (!changed && !firstLoad) return;
        renderPlayers();
        $("#world", root).innerHTML = worldPanel(v.world, v.players.map((p) => ({ id: p.characterId, name: p.name })), myChar?.id).value;
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
        belowEl.querySelector("#now")?.addEventListener("click", () => void stream("action", { text: "", now: true }));
        const ta = belowEl.querySelector<HTMLTextAreaElement>("#action");
        ta?.addEventListener("input", () => { draft = ta.value; });
        ta?.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); belowEl.querySelector<HTMLFormElement>("#composer")!.requestSubmit(); } });
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
