// Heldenhalle: alle Figuren mit ihren Sagen – Kampagnen allein und in der Gruppe, Ausgang, Epilog, erstes Szenenbild –
// dazu Ruhmeszahlen und die freigeschalteten Erfolge.
import { ACHIEVEMENTS } from "../../../shared/achievements";
import type { CampaignSave } from "../../../shared/campaign";
import { levelTitle } from "../../../shared/levels";
import { enhance } from "../fx/effects";
import { partyRuns, unlockedAchievements } from "../lib/achievements";
import { api, loadGameData } from "../lib/api";
import { campaignStore } from "../lib/campaigns";
import { allClasses } from "../lib/customClasses";
import { html, setHTML, type Raw } from "../lib/dom";
import { icon } from "../lib/icons";
import { memberships } from "../lib/party";
import { avatar } from "../lib/portraits";
import type { Page } from "../lib/router";

interface Saga { kind: "solo" | "gruppe"; title: string; href: string | null; chronicle: string | null; finished: boolean; defeat: boolean; level: number; places: number; day: number; turns: number; crits: number; chapters: number; epilog: string | null; image: string | null; when: string }

function soloSaga(s: CampaignSave): Saga {
  const w = s.state.world;
  const arc = w?.arc;
  return {
    kind: "solo", title: s.title, href: `#/abenteuer/${s.id}`, chronicle: s.started ? `#/chronik/${s.id}` : null,
    finished: !!arc?.finished && arc.outcome !== "niederlage", defeat: arc?.outcome === "niederlage",
    level: w?.levels?.[s.characterId]?.level ?? 1, places: w?.map?.places.length ?? 0, day: w?.time?.day ?? 1,
    turns: s.story.filter((e) => e.type === "player").length,
    crits: s.story.filter((e) => e.type === "roll" && !e.auto && e.record.critical === "hit").length,
    chapters: arc?.chapters?.filter((c) => c.done).length ?? 0,
    epilog: arc?.epilog ?? null,
    image: s.story.find((e): e is Extract<typeof e, { type: "image" }> => e.type === "image")?.url ?? null,
    when: s.updatedAt,
  };
}

const date = (iso: string) => new Date(iso).toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" });

function sagaCard(s: Saga, i: number): Raw {
  const status = s.defeat ? html`<span class="chip bad">${icon("moon")} Gefallen</span>` : s.finished ? html`<span class="chip good">${icon("crown")} Vollendet</span>` : html`<span class="chip">${icon("feather")} Wird erzählt</span>`;
  const body = html`
    ${s.image ? html`<span class="saga-img"><img src="${s.image}" alt="" loading="lazy" onerror="this.parentElement.remove()"></span>` : ""}
    <span class="saga-body">
      <span class="saga-top"><b>${s.title}</b>${status}</span>
      <small class="muted">${s.kind === "gruppe" ? "In der Gruppe · " : ""}Stufe ${s.level}${s.chapters ? ` · ${s.chapters} Kapitel` : ""}${s.places ? ` · ${s.places} Orte` : ""}${s.day > 1 ? ` · ${s.day} Tage` : ""}${s.turns ? ` · ${s.turns} Züge` : ""} · ${date(s.when)}</small>
      ${s.epilog ? html`<q class="saga-epilog">${s.epilog.length > 260 ? `${s.epilog.slice(0, 259)}…` : s.epilog}</q>` : ""}
      <span class="saga-links">
        ${s.href ? html`<a href="${s.href}">${icon("play")} ${s.finished || s.defeat ? "Nachlesen" : "Weiterspielen"}</a>` : ""}
        ${s.chronicle ? html`<a href="${s.chronicle}">${icon("book")} Chronik</a>` : ""}
      </span>
    </span>`;
  return html`<div class="saga ${s.defeat ? "lost" : s.finished ? "won" : ""}" style="--i:${i}">${body}</div>`;
}

export function hallPage(): Page {
  return {
    async render(root) {
      setHTML(root, html`<div class="container"><div class="spinner"></div></div>`);
      let chars, data;
      try { [chars, data] = await Promise.all([api.characters(), loadGameData()]); }
      catch (e) { setHTML(root, html`<div class="container empty"><h2>Keine Verbindung</h2><p>${(e as Error).message}</p></div>`); return; }
      const classes = allClasses(data);
      const runs = partyRuns();
      const unlocked = unlockedAchievements();

      const heroes = chars.map((c) => {
        const sagas: Saga[] = [
          ...campaignStore.list(c.id).map(soloSaga),
          ...memberships.list().filter((m) => m.characterId === c.id).map((m): Saga => {
            const r = runs[m.code];
            return { kind: "gruppe", title: `Gruppe ${m.code}`, href: `#/gruppe/${m.code}`, chronicle: r ? `#/chronik/gruppe/${m.code}` : null, finished: !!r?.finished, defeat: !!r?.defeat, level: r?.level ?? 1, places: r?.places ?? 0, day: r?.day ?? 1, turns: r?.turns ?? 0, crits: r?.crits ?? 0, chapters: 0, epilog: null, image: null, when: m.joinedAt };
          }),
        ].sort((a, b) => b.when.localeCompare(a.when));
        const won = sagas.filter((s) => s.finished).length, lost = sagas.filter((s) => s.defeat).length;
        const level = Math.max(1, ...sagas.map((s) => s.level));
        const fame = won * 100 + (level - 1) * 10 + sagas.reduce((n, s) => n + s.turns, 0);
        return { c, sagas, won, lost, level, fame, places: sagas.reduce((n, s) => n + s.places, 0), days: sagas.reduce((n, s) => n + Math.max(0, s.day - 1), 0), crits: sagas.reduce((n, s) => n + s.crits, 0) };
      }).sort((a, b) => b.fame - a.fame);

      const total = { sagas: heroes.reduce((n, h) => n + h.sagas.length, 0), won: heroes.reduce((n, h) => n + h.won, 0), places: heroes.reduce((n, h) => n + h.places, 0) };
      const medals = ACHIEVEMENTS.filter((a) => unlocked[a.id]);

      setHTML(root, html`<div class="container hall">
        <header class="page-head hall-head" data-reveal>
          <div class="eyebrow">Ruhm und Legenden</div>
          <h1>Heldenhalle</h1>
          <p class="lead">Hier hängen die Bildnisse deiner Figuren – und daneben die Sagen, die sie erlebt haben.</p>
          <div class="hall-stats">
            <div><b>${heroes.length}</b><span>${heroes.length === 1 ? "Figur" : "Figuren"}</span></div>
            <div><b>${total.sagas}</b><span>Sagen</span></div>
            <div><b>${total.won}</b><span>vollendet</span></div>
            <div><b>${total.places}</b><span>Orte bereist</span></div>
          </div>
        </header>

        ${medals.length ? html`<a class="hall-medals card" href="#/erfolge" data-reveal>
          <span class="hm-label">${icon("crown")} Erfolge <b>${medals.length} / ${ACHIEVEMENTS.length}</b></span>
          <span class="hm-row">${medals.slice(0, 14).map((a) => html`<span class="hm-medal" title="${a.name} – ${a.text}">${icon(a.icon)}</span>`)}${medals.length > 14 ? html`<span class="hm-more">+${medals.length - 14}</span>` : ""}</span>
          <span class="hm-go">${icon("arrowRight")}</span>
        </a>` : ""}

        ${heroes.length ? html`<div class="hall-list">${heroes.map((h, i) => {
          const cls = classes.find((x) => x.id === h.c.classId) ?? h.c.customClass?.cls;
          const stand = data.rules.stands.find((s) => s.id === h.c.stand);
          return html`<section class="card hero-plaque ${i === 0 && h.fame > 0 && heroes.length > 1 ? "first" : ""}" data-reveal style="--i:${Math.min(i, 6)}">
            <div class="hp-head">
              <a class="hp-portrait" href="#/figur/${h.c.id}" title="Figurenbogen öffnen">${avatar(h.c.id, cls?.sigil ?? "shield", { draw: true })}</a>
              <div class="hp-id">
                ${i === 0 && h.fame > 0 && heroes.length > 1 ? html`<span class="hp-rank">${icon("crown")} Ruhmreichste Figur</span>` : ""}
                <h2>${h.c.name}</h2>
                <small class="muted">${cls?.name ?? h.c.classId}${stand ? ` · ${stand.name}` : ""} · ${levelTitle(h.level, data.rules)} (Stufe ${h.level})</small>
                ${h.c.appearance ? html`<p class="hp-look">${h.c.appearance}</p>` : ""}
                <div class="hp-fame">
                  <span title="Vollendete Kampagnen">${icon("crown")} ${h.won}</span>
                  <span title="Niederlagen">${icon("moon")} ${h.lost}</span>
                  <span title="Bereiste Orte">${icon("map")} ${h.places}</span>
                  <span title="Tage unterwegs">${icon("sun")} ${h.days}</span>
                  <span title="Kritische Erfolge">${icon("dice")} ${h.crits}</span>
                </div>
              </div>
            </div>
            ${h.sagas.length ? html`<div class="sagas">${h.sagas.map(sagaCard)}</div>`
              : html`<p class="muted hp-empty">Noch keine Sage – <a href="#/abenteuer">das erste Abenteuer wartet</a>.</p>`}
          </section>`;
        })}</div>` : html`<div class="card empty-hall" data-reveal>
          <p>Die Halle ist noch leer. Erschaffe eine Figur, und ihr Bildnis bekommt hier einen Ehrenplatz.</p>
          <a class="btn glow-border" href="#/figur/neu">${icon("sparkles")} Figur erschaffen</a>
        </div>`}
      </div>`);
      enhance(root);
    },
  };
}
