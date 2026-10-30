// Chronik: ein Abenteuer als Buch zum Nachlesen und Teilen – Titelseite, die ganze Geschichte mit Bildern,
// Kapitel im Rückblick und Epilog. „Als PDF speichern“ nutzt das Druckfenster des Browsers (eigene Druck-Gestaltung).
import { splitSuggestions } from "../../../shared/campaign";
import type { RollRecord } from "../../../shared/dice";
import type { WorldState } from "../../../shared/world";
import { enhance } from "../fx/effects";
import { api, loadGameData } from "../lib/api";
import { campaignStore } from "../lib/campaigns";
import { letterStore, type Letter } from "../lib/letters";
import { allClasses } from "../lib/customClasses";
import { html, setHTML, type Raw } from "../lib/dom";
import { icon } from "../lib/icons";
import { memberships, partyApi } from "../lib/party";
import { avatar } from "../lib/portraits";
import type { Page } from "../lib/router";
import { paragraphs, withSpeech } from "./adventure";

type Entry =
  | { type: "text"; text: string }
  | { type: "act"; who: string; text: string }
  | { type: "roll"; who: string; record: RollRecord; auto: boolean }
  | { type: "image"; url: string; caption: string }
  | { type: "info"; text: string };

interface Hero { id: string; name: string; className: string; sigil: string }
interface Book { title: string; heroes: Hero[]; entries: Entry[]; world: WorldState | null; from: string; to: string; group: boolean; back: string; letters: Letter[] }

const date = (iso: string) => new Date(iso).toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" });

function rollLine(e: Extract<Entry, { type: "roll" }>): Raw {
  const r = e.record;
  const what = r.label.replace(/^[^:]+:\s*/, "");
  const verdict = r.success === null ? "" : e.auto ? (r.success ? " – Treffer" : " – daneben") : r.success ? " – geschafft" : " – misslungen";
  return html`<p class="ch-roll ${r.critical ?? ""}">${icon("dice")} ${e.who ? `${e.who}: ` : ""}${what} · ${r.total}${r.dc !== null ? ` gegen ${r.dc}` : ""}${verdict}${r.critical === "hit" ? " (kritisch!)" : r.critical === "fumble" ? " (Patzer!)" : ""}</p>`;
}

function bookHtml(b: Book): Raw {
  const w = b.world, arc = w?.arc;
  const cover = b.entries.find((e): e is Extract<Entry, { type: "image" }> => e.type === "image");
  const played = arc?.chapters?.filter((c) => c.done) ?? [];
  const lost = arc?.outcome === "niederlage";
  let first = true;
  return html`
    <div class="ch-tools no-print">
      <a class="btn btn-ghost btn-sm" href="${b.back}">${icon("arrowLeft")} Zurück</a>
      <button class="btn btn-sm glow-border" id="ch-print">${icon("download")} Als PDF speichern</button>
      <small class="muted">Im Druckfenster bei „Ziel“ <b>„Als PDF speichern“</b> wählen – die Datei kannst du dann verschicken.</small>
    </div>
    <article class="chronicle-book">
      <header class="ch-cover">
        <div class="ch-orn">❦</div>
        <div class="eyebrow">${b.group ? "Eine Sage aus The Last Ember – gemeinsam erlebt" : "Eine Sage aus The Last Ember"}</div>
        <h1>${b.title}</h1>
        <div class="ch-heroes">${b.heroes.map((h) => html`<span class="ch-hero"><span class="ch-portrait">${avatar(h.id, h.sigil, { probe: b.group })}</span><b>${h.name}</b><small>${h.className}</small></span>`)}</div>
        <p class="ch-dates">${date(b.from)}${b.to.slice(0, 10) !== b.from.slice(0, 10) ? ` – ${date(b.to)}` : ""}${arc?.finished ? lost ? " · Die Sage endete in einer Niederlage" : " · Vollendet" : " · Die Sage wird noch erzählt"}</p>
        ${cover ? html`<figure class="ch-plate ch-front"><img src="${cover.url}" alt="${cover.caption}">${cover.caption ? html`<figcaption>${cover.caption}</figcaption>` : ""}</figure>` : ""}
      </header>

      <section class="ch-story">
        ${b.entries.map((e) => {
          if (e.type === "text") { const r = html`<div class="ch-text ${first ? "first" : ""}">${withSpeech(paragraphs(splitSuggestions(e.text).body))}</div>`; first = false; return r; }
          if (e.type === "act") return html`<p class="ch-act"><b>${e.who}</b> ${e.text}</p>`;
          if (e.type === "roll") return rollLine(e);
          if (e.type === "info") return html`<p class="ch-info">${e.text}</p>`;
          return e === cover ? "" : html`<figure class="ch-plate"><img src="${e.url}" alt="${e.caption}" loading="lazy">${e.caption ? html`<figcaption>${e.caption}</figcaption>` : ""}</figure>`;
        })}
      </section>

      ${b.letters.length ? html`<section class="ch-letters">
        <h2><span class="ch-orn">❧</span> Briefe und Tagebuch</h2>
        ${b.letters.map((l) => { const [place, ...rest] = l.text.split("\n"); return html`<article class="ch-letter"><small class="muted">Nach dem Kapitel „${l.title}“</small><p class="letter-place">${place}</p>${rest.join("\n").trim().split(/\n\s*\n|\n/).filter(Boolean).map((p) => html`<p>${p}</p>`)}</article>`; })}
      </section>` : ""}
      ${played.length ? html`<section class="ch-chapters">
        <h2><span class="ch-orn">❧</span> Kapitel im Rückblick</h2>
        <ol>${played.map((c) => html`<li><b>${c.titel}</b>${c.rueckblick ? html` – ${c.rueckblick}` : ""}</li>`)}</ol>
      </section>` : ""}
      ${arc?.epilog ? html`<section class="ch-epilog"><h2><span class="ch-orn">❧</span> Epilog</h2>${paragraphs(arc.epilog)}</section>` : ""}
      ${w ? html`<footer class="ch-facts">
        <span>${b.entries.filter((e) => e.type === "act").length} Züge</span>
        ${w.map?.places.length ? html`<span>${w.map.places.length} Orte: ${w.map.places.map((p) => p.name).join(", ")}</span>` : ""}
        ${w.time ? html`<span>${w.time.day} ${w.time.day === 1 ? "Tag" : "Tage"} unterwegs</span>` : ""}
        ${w.quests.some((q) => q.status === "erledigt") ? html`<span>Erledigte Aufträge: ${w.quests.filter((q) => q.status === "erledigt").map((q) => q.title).join(", ")}</span>` : ""}
        <span class="ch-end">❦</span>
      </footer>` : ""}
    </article>`;
}

function mount(root: HTMLElement, b: Book) {
  document.title = `${b.title} – Chronik · The Last Ember`;
  setHTML(root, html`<div class="container chronicle">${bookHtml(b)}</div>`);
  root.querySelector("#ch-print")?.addEventListener("click", () => print());
  enhance(root);
}

/** Chronik eines Solo-Abenteuers (#/chronik/:id) oder einer Gruppe (#/chronik/gruppe/:code). */
export function chroniclePage(): Page {
  return {
    async render(root, params) {
      setHTML(root, html`<div class="container"><div class="spinner"></div></div>`);
      const data = await loadGameData();
      const classes = allClasses(data);
      const fail = (msg: string) => setHTML(root, html`<div class="container empty"><h2>Chronik nicht gefunden</h2><p>${msg}</p><a class="btn" href="#/heldenhalle">Zur Heldenhalle</a></div>`);
      if (params.code) {
        const m = memberships.get(params.code);
        if (!m) return fail("Du gehörst nicht (mehr) zu dieser Gruppe.");
        let v;
        try { v = await partyApi.state(m); } catch (e) { return fail((e as Error).message); }
        const name = (id: string) => v.players.find((p) => p.id === id)?.name ?? "";
        const entries: Entry[] = v.story.flatMap((e): Entry[] => e.type === "gm" ? [{ type: "text", text: e.text }]
          : e.type === "actions" ? e.items.map((i) => ({ type: "act" as const, who: i.name, text: i.text }))
          : e.type === "roll" ? [{ type: "roll", who: e.auto ? "" : name(e.playerId), record: e.record, auto: !!e.auto }]
          : e.type === "image" ? [{ type: "image", url: e.url, caption: e.caption }]
          : [{ type: "info", text: e.text }]);
        const ort = v.opening?.ort ?? `Gruppe ${v.code}`;
        return mount(root, { title: ort.charAt(0).toUpperCase() + ort.slice(1), heroes: v.players.map((p) => ({ id: p.characterId, name: p.name, className: p.className, sigil: p.sigil })), entries, world: v.world, from: m.joinedAt, to: new Date().toISOString(), group: true, back: `#/gruppe/${v.code}`, letters: letterStore.list(`gruppe-${v.code}`) });
      }
      const save = campaignStore.get(params.id);
      if (!save) return fail("Dieses Abenteuer gibt es in deinem Konto nicht.");
      const c = await api.character(save.characterId).catch(() => null);
      const cls = c ? classes.find((x) => x.id === c.classId) ?? c.customClass?.cls : null;
      const who = c?.name ?? "Du";
      const entries: Entry[] = save.story.map((e): Entry => e.type === "gm" ? { type: "text", text: e.text }
        : e.type === "player" ? { type: "act", who, text: e.text }
        : e.type === "roll" ? { type: "roll", who: e.auto ? "" : who, record: e.record, auto: !!e.auto }
        : { type: "image", url: e.url, caption: e.caption });
      mount(root, { title: save.title, heroes: c ? [{ id: c.id, name: c.name, className: cls?.name ?? c.classId, sigil: cls?.sigil ?? "shield" }] : [], entries, world: save.state.world ?? null, from: save.createdAt, to: save.updatedAt, group: false, back: `#/abenteuer/${save.id}`, letters: letterStore.list(save.id) });
    },
    leave() { document.title = "The Last Ember"; },
  };
}
