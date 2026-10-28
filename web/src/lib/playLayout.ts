// Spielansicht für Solo und Gruppe: links das Team mit Fortschritt und Auftragsbuch, rechts Gegner und Kernauftrag,
// in der Mitte die Erzählung. Auf schmalen Bildschirmen werden beide Seiten zu einklappbaren Leisten oben.
import { currentChapter, isArc, type Arc, type WorldState } from "../../../shared/world";
import { PHASE_NAME } from "../../../shared/time";
import { itemText, moneyText, type Inventory, type ItemKind } from "../../../shared/inventory";
import { ATTITUDE_NAME } from "../../../shared/people";
import { mapBlock, openMap } from "./mapUi";
import type { Rules } from "../../../shared/schema";
import { levelTitle, xpProgress } from "../../../shared/levels";
import { html, type Raw } from "./dom";
import { icon, sigil } from "./icons";
import { arcProgress } from "./arc";
import { abilityChips, type AbilityInfo } from "./abilities";

export interface TeamMember {
  /** Figuren-ID (Schlüssel im Spielstand) */
  id: string;
  name: string;
  sigil: string;
  className: string;
  host?: boolean;
  me: boolean;
  /** Gruppe: Status in dieser Runde („hat gehandelt“ …) */
  status?: string;
  abilities: AbilityInfo[];
}

/** Ab dieser Breite stehen Team und Lage als Spalten neben der Erzählung. */
export const WIDE = "(min-width: 1180px)";

/** Gerüst: zwei Seitenleisten (als <details>, damit sie auf dem Handy einklappen) und die Mitte. */
export function playLayout(main: Raw): Raw {
  return html`<div class="play-layout">
    <div class="play-bars">
      <details class="side side-left card" id="side-left" aria-label="Team und Fortschritt"></details>
      <details class="side side-right card" id="side-right" aria-label="Kampf und Kernauftrag"></details>
    </div>
    <div class="play-main">${main}</div>
  </div>`;
}

function bar(cur: number, max: number, cls = ""): Raw {
  const pct = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
  const tone = pct <= 0 ? "down" : pct < 34 ? "low" : pct < 67 ? "mid" : "";
  return html`<span class="hp-bar ${cls} ${tone}" role="meter" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${cur}"><span style="width:${pct}%"></span></span>`;
}

/** Linke Seite: Team (Lebenspunkte, Stufe, Fähigkeiten), Kapitel-Fortschritt, Nebenaufträge und Gedächtnis. */
export function teamSide(w: WorldState | null | undefined, members: TeamMember[], rules: Rules, waiting: TeamMember[] = []): Raw {
  const allDown = !!w && members.every((m) => (w.hp[m.id] ?? 0) <= 0);
  const someDown = !!w && members.some((m) => (w.hp[m.id] ?? 0) <= 0);
  const me = members.find((m) => m.me) ?? members[0];
  const open = w?.quests.filter((q) => q.status === "offen") ?? [];
  const closed = w?.quests.filter((q) => q.status !== "offen") ?? [];
  const kern = w ? coreQuestId(w) : null;
  const side = open.filter((q) => q.id !== kern);
  return html`<summary class="side-pill">${icon("users")}<b>${members.length > 1 ? "Team" : "Deine Figur"}</b>
      ${waiting.length ? html`<span class="pill-badge" title="Warten auf ${waiting.map((m) => m.name).join(", ")}"><span class="wp-dot"></span>${waiting.length}</span>` : ""}
      ${someDown ? html`<span class="pill-alert" title="Jemand ist bewusstlos">!</span>` : ""}
      <span class="pill-caret">${icon("arrowRight")}</span>
    </summary>
    <div class="side-body">
      ${waiting.length ? html`<div class="hud-waiting">Warten auf ${waiting.map((m) => html`<b class="${m.me ? "me" : ""}">${m.me ? "dich" : m.name}</b>`)}</div>` : ""}
      <div class="team-list">${members.map((m) => {
        const hp = w?.hp[m.id] ?? 0, max = w?.maxHp[m.id] ?? 0;
        const lv = w?.levels?.[m.id]?.level ?? 1;
        const down = !!w && hp <= 0;
        return html`<div class="tm ${m.me ? "me" : ""} ${down ? "down" : ""}">
          <span class="tm-sigil">${sigil(m.sigil)}</span>
          <div class="tm-body">
            <div class="tm-line"><b>${m.name}</b>${m.host ? icon("crown") : ""}<span class="tm-lv" title="Stufe ${lv} · ${levelTitle(lv, rules)}">St. ${lv}</span></div>
            <small class="tm-sub">${m.className}${m.status ? ` · ${m.status}` : ""}</small>
            ${w ? html`<div class="tm-hp">${bar(hp, max)}<small>${hp}/${max} TP</small></div>` : ""}
            ${down ? html`<small class="tm-down">${allDown ? "gefallen" : "bewusstlos – kann gerettet werden"}</small>` : ""}
            ${abilityChips(m.abilities, w, m.id)}
          </div>
        </div>`;
      })}</div>
      ${w?.inventory ? inventoryBlock(w, members) : ""}
      ${w && me && rules ? levelBadge(w.levels?.[me.id]?.level ?? 1, w.xp[me.id] ?? 0, rules) : ""}
      ${w?.arc && isArc(w.arc) ? arcBlock(w.arc) : ""}
      ${w && (side.length || closed.length || w.memory.length) ? html`<details class="world-log side-sec" ${side.length ? "open" : ""}>
        <summary>${icon("scroll")} Auftragsbuch${side.length ? ` · ${side.length} offen` : ""}</summary>
        ${side.length ? html`<ul class="quests">${side.map((q) => html`<li><b>${q.title}</b><span>${q.description}</span>${q.notes.length ? html`<small>${q.notes.at(-1)}</small>` : ""}</li>`)}</ul>` : ""}
        ${closed.length ? html`<ul class="quests closed">${closed.map((q) => html`<li class="${q.status}"><b>${q.status === "erledigt" ? "✓" : "✗"} ${q.title}</b></li>`)}</ul>` : ""}
        ${w.memory.length ? html`<div class="memory"><div class="eyebrow">Der Spielleiter merkt sich</div><ul>${w.memory.slice().reverse().map((m) => html`<li>${m}</li>`)}</ul></div>` : ""}
      </details>` : ""}
    </div>`;
}

/** Anfang/Mitte/Finale als kleine Klappe; zu sehen ist nur, in welchem Kapitel man steckt. */
function arcBlock(arc: Arc): Raw {
  const ch = currentChapter(arc);
  const inAct = ch ? arc.chapters.filter((c) => c.act === ch.act) : [];
  const label = arc.finished ? "abgeschlossen" : ch && arc.plan ? `Akt ${ch.act + 1} · Kapitel ${inAct.indexOf(ch) + 1}/${inAct.length}` : "beginnt";
  return html`<details class="world-log side-sec arc-block">
    <summary>${icon("scroll")} Kapitel <small class="muted">· ${label}</small></summary>
    ${arcProgress(arc)}
  </details>`;
}

const KIND_ICON: Record<ItemKind, string> = { waffe: "sword", ruestung: "shield", trank: "potion", werkzeug: "bag", schatz: "coins", gegenstand: "star" };

/** Gepäck: eigenes zuerst und aufgeklappt; eigene Gegenstände antippen = „Ich benutze …“ ins Eingabefeld. */
function inventoryBlock(w: WorldState, members: TeamMember[]): Raw {
  const list = [...members].sort((a, b) => Number(b.me) - Number(a.me)).filter((m) => w.inventory![m.id]);
  if (!list.length) return html``;
  const mine = w.inventory![list[0].id];
  const count = mine.items.reduce((n, i) => n + i.qty, 0);
  return html`<details class="world-log side-sec inv-block">
    <summary>${icon("bag")} Gepäck <small class="muted">· ${count} ${count === 1 ? "Ding" : "Dinge"} · ${moneyText(mine.money, true)}</small></summary>
    ${list.map((m) => {
      const inv = w.inventory![m.id];
      return html`<div class="inv ${m.me ? "me" : ""}">
        ${members.length > 1 ? html`<div class="inv-who">${m.me ? "Du" : m.name}</div>` : ""}
        <div class="inv-items">${inv.items.length ? inv.items.map((i) => html`<${m.me ? "button" : "span"} class="inv-item k-${i.kind}" ${m.me ? html`type="button" data-use-item="${i.name}"` : ""} title="${i.note ?? ""}${m.me ? `${i.note ? " – " : ""}Antippen: benutzen` : ""}">${icon(KIND_ICON[i.kind])}<span>${itemText(i)}</span></${m.me ? "button" : "span"}>`) : html`<small class="muted">nichts</small>`}</div>
        <div class="inv-money">${icon("coins")} ${moneyText(inv.money)}</div>
        ${w.gear?.[m.id] ? html`<div class="inv-gear">${icon("fist")} Vom Schmied: ${(["angriff", "schaden", "ruestung"] as const).filter((k) => w.gear![m.id][k]).map((k) => `${({ angriff: "Angriff", schaden: "Schaden", ruestung: "Rüstung" })[k]} +${w.gear![m.id][k]}`).join(", ")}</div>` : ""}
      </div>`;
    })}
  </details>`;
}

/** Was ist neu im eigenen Gepäck? (für den kurzen Beute-Hinweis) */
export function lootText(before: Inventory | undefined, after: Inventory | undefined): string | null {
  if (!before || !after) return null;
  const gained = after.items.map((i) => ({ i, d: i.qty - (before.items.find((b) => b.name.toLowerCase() === i.name.toLowerCase())?.qty ?? 0) })).filter((x) => x.d > 0);
  const money = after.money - before.money;
  const parts = [...gained.map(({ i, d }) => itemText({ ...i, qty: d })), ...(money > 0 ? [moneyText(money)] : [])];
  return parts.length ? `Neu im Gepäck: ${parts.join(", ")}` : null;
}

/** Der Kernauftrag aus dem Auftragsbuch (Ersatz, solange Claude keinen eigenen genannt hat): der älteste offene Auftrag. */
function coreQuestId(w: WorldState): string | null {
  if (w.arc?.known?.kern) return null;
  return w.quests.find((q) => q.status === "offen")?.id ?? null;
}

/** Rechte Seite: im Kampf die Gegner, immer der Kernauftrag und die aktuelle Aufgabe (ohne Geheimnisse aus dem Plan). */
export function lageSide(w: WorldState | null | undefined): Raw {
  const combat = w?.combat;
  const standing = combat?.enemies.filter((e) => e.hp > 0).length ?? 0;
  const arc = w?.arc && isArc(w.arc) ? w.arc : null;
  const ch = arc ? currentChapter(arc) : null;
  const fallback = w?.quests.find((q) => q.status === "offen");
  const kern = arc?.known?.kern ?? fallback?.title ?? null;
  const kernText = arc?.known?.kern ? null : fallback?.description ?? null;
  const aufgabe = arc?.known?.aufgabe ?? null;
  return html`<summary class="side-pill ${combat ? "combat" : ""}">${icon(combat ? "sword" : w?.time ? (w.time.phase === "nacht" ? "moon" : w.time.phase === "abend" ? "sunset" : "sun") : "target")}<b>${combat ? `${standing} Gegner` : "Ziel"}</b><span class="pill-caret">${icon("arrowRight")}</span></summary>
    <div class="side-body">
      ${mapBlock(w?.map)}
      ${w?.time ? html`<div class="sky sky-${w.time.phase}" title="Tageszeit und Wetter">
        <span class="sky-icon">${icon(w.time.phase === "nacht" ? "moon" : w.time.phase === "abend" ? "sunset" : "sun")}</span>
        <span class="sky-text"><b>Tag ${w.time.day} · ${PHASE_NAME[w.time.phase]}</b><small>${icon("cloud")} ${w.time.weather}</small></span>
        ${w.time.phase === "nacht" ? html`<span class="sky-stars"><i></i><i></i><i></i><i></i><i></i></span>` : ""}
      </div>` : ""}
      ${combat ? html`<div class="side-combat">
        <div class="wc-head">${icon("sword")} Kampf · Runde ${combat.round}</div>
        <div class="enemy-list">${combat.enemies.map((e) => html`<div class="we ${e.hp <= 0 ? "down" : ""}">
          <span class="we-name">${e.name}</span>${bar(e.hp, e.maxHp, "enemy")}
          <span class="we-num">${e.hp <= 0 ? "besiegt" : `${e.hp}/${e.maxHp} TP`} · ${icon("shield")} Rüstung ${e.armor}</span>
        </div>`)}</div>
        <small class="muted">Rüstung = was ein Angriff mindestens erreichen muss.</small>
      </div>` : ""}
      ${arc?.finished ? html`<div class="core done"><div class="eyebrow">${arc.outcome === "niederlage" ? "Niederlage" : "Abgeschlossen"}</div><p>${arc.outcome === "niederlage" ? "Die Geschichte endet hier." : "Der Auftrag ist erfüllt."}</p></div>` : html`
        <div class="core">
          <div class="eyebrow">${icon("crown")} Kernauftrag</div>
          ${kern ? html`<p class="core-main">${kern}</p>${kernText ? html`<small class="muted">${kernText}</small>` : ""}` : html`<p class="muted">Der Auftrag zeigt sich bald …</p>`}
        </div>
        ${ch || aufgabe ? html`<div class="core">
          <div class="eyebrow">${icon(ch?.detour ? "map" : "scroll")} ${ch?.detour ? "Abzweigung" : "Jetzt"}</div>
          ${ch ? html`<b>${ch.titel}</b>` : ""}
          ${aufgabe ? html`<p>${aufgabe}</p>` : ""}
        </div>` : ""}`}
      ${w?.people?.length ? html`<details class="world-log side-sec people" ${w.people.length <= 6 ? "open" : ""}>
        <summary>${icon("users")} Personen · ${w.people.length}</summary>
        <ul class="people-list">${[...w.people].sort((a, b) => b.seen - a.seen).map((p) => html`<li class="person att-${p.attitude}">
          <span class="att-dot" title="${ATTITUDE_NAME[p.attitude]}"></span>
          <span class="person-text"><b>${p.name}</b><small>${p.role}${p.role ? " · " : ""}${ATTITUDE_NAME[p.attitude]}</small>${p.notes.length ? html`<em>${p.notes.at(-1)}</em>` : ""}</span>
        </li>`)}</ul>
      </details>` : ""}
    </div>`;
}

/**
 * Seitenleisten verdrahten: breit immer offen, schmal eingeklappt (antippen öffnet, nur eine zugleich, Tippen daneben schließt).
 * Gibt eine Aufräumfunktion zurück.
 */
export function bindSides(root: HTMLElement): () => void {
  const sides = [...root.querySelectorAll<HTMLDetailsElement>(".side")];
  const mq = matchMedia(WIDE);
  const apply = () => sides.forEach((d) => { d.open = mq.matches; });
  apply();
  mq.addEventListener("change", apply);
  const onToggle = (e: Event) => {
    const d = e.target as HTMLDetailsElement;
    if (mq.matches) { if (!d.open) d.open = true; return; }
    if (d.open) sides.forEach((o) => { if (o !== d) o.open = false; });
  };
  sides.forEach((d) => d.addEventListener("toggle", onToggle));
  // Gegenstand antippen: „Ich benutze …“ ins Eingabefeld
  const onUse = (e: Event) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-use-item]");
    if (!b) return;
    const ta = root.querySelector<HTMLTextAreaElement>("#action");
    if (!ta) return;
    ta.value = `Ich benutze ${b.dataset.useItem}.`;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    if (!mq.matches) sides.forEach((d) => { d.open = false; });
    ta.focus();
  };
  root.addEventListener("click", onUse);
  // Karte groß öffnen (die Daten hängen am Element, siehe fillSide)
  root.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest("[data-map-open]")) return;
    const map = (root as HTMLElement & { _map?: WorldState["map"] })._map;
    if (map) openMap(map);
  });
  const onDoc = (e: Event) => {
    if (mq.matches) return;
    if (!(e.target as HTMLElement).closest(".play-bars")) sides.forEach((d) => { d.open = false; });
  };
  document.addEventListener("click", onDoc);
  return () => { mq.removeEventListener("change", apply); document.removeEventListener("click", onDoc); setSkyPhase(undefined); };
}

/** Inhalt einer Seitenleiste ersetzen, ohne den Auf-/Zu-Zustand der inneren Klappen (Auftragsbuch, Gepäck, Personen) zu verlieren. */
export function fillSide(el: HTMLElement | null, content: Raw) {
  if (!el) return;
  const keyOf = (d: Element) => d.className;
  const open = new Map([...el.querySelectorAll<HTMLDetailsElement>(".side-body details")].map((d) => [keyOf(d), d.open]));
  const scroll = el.querySelector(".side-body")?.scrollTop ?? 0, outer = el.scrollTop;
  el.innerHTML = content.value;
  el.scrollTop = outer;
  el.querySelectorAll<HTMLDetailsElement>(".side-body details").forEach((d) => { const o = open.get(keyOf(d)); if (o !== undefined) d.open = o; });
  const body = el.querySelector(".side-body");
  if (body) body.scrollTop = scroll;
}

/** Tageszeit für den Hintergrund (etwas heller am Tag, dunkler in der Nacht); ohne Angabe zurück zum Normalzustand. */
export function setSkyPhase(phase: string | undefined) {
  if (phase) document.documentElement.dataset.phase = phase;
  else delete document.documentElement.dataset.phase;
}

/** Kartendaten für „groß ansehen“ merken. */
export function setMapData(root: HTMLElement, map: WorldState["map"]) { (root as HTMLElement & { _map?: WorldState["map"] })._map = map; }

/** Stufe, Titel und Balken bis zur nächsten Stufe. */
export function levelBadge(level: number, xp: number, rules: Rules): Raw {
  const { from, to } = xpProgress(xp, level, rules);
  const pct = to === null ? 100 : Math.max(0, Math.min(100, ((xp - from) / (to - from)) * 100));
  return html`<div class="lv-badge" title="${to === null ? `${xp} EP – höchste Stufe` : `${xp} von ${to} EP bis Stufe ${level + 1}`}">
    <span class="lv-num">${level}</span>
    <span class="lv-text"><b>${levelTitle(level, rules)}</b><span class="lv-bar"><i style="width:${pct}%"></i></span><small>${to === null ? `${xp} EP` : `${xp} / ${to} EP`}</small></span>
  </div>`;
}
