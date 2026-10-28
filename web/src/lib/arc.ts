// Kampagne in der Oberfläche: Akte mit Kapiteln (kommende Kapitel ohne Titel – keine Spoiler) und Abschlusskarte.
import { ACTS, currentChapter, isArc, type Arc, type WorldState } from "../../../shared/world";
import { html, type Raw } from "./dom";
import { icon } from "./icons";

/** Drei Akte; je Kapitel ein Punkt. Titel sieht man nur bei gespielten und beim laufenden Kapitel. */
export function arcProgress(arc: Arc): Raw {
  if (!isArc(arc)) return html``;
  const ch = currentChapter(arc);
  if (!arc.plan || !ch) return html`<div class="arc-line">${icon("scroll")} Die Geschichte beginnt …</div>`;
  const inAct = arc.chapters.filter((c) => c.act === ch.act);
  return html`<div class="arc ${arc.finished ? "finished" : ""}" aria-label="Fortschritt der Kampagne">
    <div class="arc-acts">
      ${ACTS.map((a, i) => {
        const chapters = arc.chapters.filter((c) => c.act === i);
        const state = arc.finished || i < ch.act ? "done" : i === ch.act ? "now" : "next";
        return html`<div class="arc-act ${state}" title="${a.goal}">
          <span class="arc-label">${state === "done" ? icon("check") : html`<b>${i + 1}</b>`} ${a.name}</span>
          <span class="arc-dots">${chapters.map((c) => html`<i class="${c.done ? "done" : c === ch && !arc.finished ? "now" : ""} ${c.detour ? "detour" : ""}" title="${c.done || c === ch ? c.titel : "Kommendes Kapitel"}${c.detour ? " (Abzweigung)" : ""}"></i>`)}</span>
        </div>`;
      })}
    </div>
    ${arc.finished ? "" : html`<div class="arc-line">${icon(ch.detour ? "map" : "scroll")} <span>Akt ${ch.act + 1} · Kapitel ${inAct.indexOf(ch) + 1} von ${inAct.length}${ch.detour ? " · Abzweigung" : ""}:</span> <b>${ch.titel}</b></div>`}
  </div>`;
}

/** Am Ende: Epilog, Kapitel mit Rückblick, Aufträge, Erfahrung. */
export function endCard(w: WorldState, names: { id: string; name: string }[], again: { href: string; label: string }): Raw {
  const arc = w.arc!;
  const played = arc.chapters.filter((c) => c.done);
  const lost = arc.outcome === "niederlage";
  const solo = names.length === 1;
  return html`<div class="card end-card glow-border ${lost ? "defeat" : ""}">
    <div class="end-icon">${icon(lost ? "candle" : "crown")}</div>
    <div class="eyebrow">${lost ? (solo ? "Du bist gefallen" : "Die ganze Gruppe ist gefallen") : "Die Kampagne ist abgeschlossen"}</div>
    <h2>${lost ? "Niederlage" : "Ende"}</h2>
    ${lost ? html`<p class="muted">${solo ? "Niemand konnte dich mehr retten" : "Niemand konnte euch mehr retten"} – so endet diese Geschichte. Eine neue wartet schon.</p>` : ""}
    ${arc.epilog ? html`<p class="end-epilog">${arc.epilog}</p>` : ""}
    <div class="end-grid">
      <div><span>Kapitel</span><b>${played.length}</b></div>
      <div><span>Abzweigungen</span><b>${played.filter((c) => c.detour).length}</b></div>
      <div><span>Aufträge erledigt</span><b>${w.quests.filter((q) => q.status === "erledigt").length}</b></div>
      <div><span>Erfahrung</span><b>${names.map((n) => `${n.name}: ${w.xp[n.id] ?? 0} EP`).join(" · ")}</b></div>
    </div>
    ${played.length ? html`<ol class="end-chapters">${played.map((c) => html`<li><b>${c.titel}</b>${c.detour ? html` <span class="chip">Abzweigung</span>` : ""}${c.rueckblick ? html` – ${c.rueckblick}` : ""}</li>`)}</ol>` : ""}
    <a class="btn btn-lg magnetic" href="${again.href}">${icon("sparkles")} ${again.label}</a>
  </div>`;
}
