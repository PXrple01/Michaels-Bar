// Erfolge: alle Meilensteine mit Fortschritt; freigeschaltete leuchten golden.
import { ACHIEVEMENTS } from "../../../shared/achievements";
import { enhance } from "../fx/effects";
import { achievementStats, checkAchievements, unlockedAchievements } from "../lib/achievements";
import { html, setHTML } from "../lib/dom";
import { icon } from "../lib/icons";
import type { Page } from "../lib/router";

export function achievementsPage(): Page {
  return {
    render(root) {
      checkAchievements();
      const stats = achievementStats(), unlocked = unlockedAchievements();
      const done = ACHIEVEMENTS.filter((a) => unlocked[a.id]).length;
      const pct = Math.round((done / ACHIEVEMENTS.length) * 100);
      const list = [...ACHIEVEMENTS].sort((a, b) => Number(!!unlocked[b.id]) - Number(!!unlocked[a.id]) || (unlocked[b.id] ?? "").localeCompare(unlocked[a.id] ?? ""));
      setHTML(root, html`<div class="container achievements">
        <header class="page-head ach-head" data-reveal>
          <div>
            <div class="eyebrow">Deine Meilensteine</div>
            <h1>Erfolge</h1>
            <p class="lead">Kleine Auszeichnungen für alles, was deine Figuren erleben – allein und in der Gruppe. Sie gehören zu deinem Konto.</p>
          </div>
          <div class="ach-ring" style="--p:${pct}" title="${done} von ${ACHIEVEMENTS.length}"><b>${done}</b><small>von ${ACHIEVEMENTS.length}</small></div>
        </header>
        <div class="ach-grid">${list.map((a, i) => {
          const [cur, max] = a.progress(stats);
          const got = unlocked[a.id];
          return html`<article class="card ach ${got ? "got" : ""}" data-reveal style="--i:${Math.min(i, 12)}">
            <span class="ach-medal">${icon(got ? a.icon : "lock")}</span>
            <div class="ach-body">
              <b>${a.name}</b>
              <span>${a.text}</span>
              ${got ? html`<small class="ach-date">${icon("check")} am ${new Date(got).toLocaleDateString("de-DE")}</small>`
                : max > 1 ? html`<span class="ach-bar" title="${Math.min(cur, max)} von ${max}"><i style="width:${Math.min(100, (cur / max) * 100)}%"></i></span><small class="muted">${Math.min(cur, max)} / ${max}</small>` : ""}
            </div>
          </article>`;
        })}</div>
      </div>`);
      enhance(root);
    },
  };
}
