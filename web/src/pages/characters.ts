import { fullName, isResting } from "../../../shared/growth";
import { avatar } from "../lib/portraits";
import { ACHIEVEMENTS } from "../../../shared/achievements";
import { unlockedAchievements } from "../lib/achievements";
import { enhance } from "../fx/effects";
import { api, loadGameData } from "../lib/api";
import { campaignStore } from "../lib/campaigns";
import { html, setHTML } from "../lib/dom";
import { icon } from "../lib/icons";
import { go, type Page } from "../lib/router";
import { confirmDialog, toast } from "../lib/ui";

export function charactersPage(): Page {
  return {
    async render(root) {
      setHTML(root, html`<div class="container"><div class="spinner"></div></div>`);
      let list, data;
      try {
        [list, data] = await Promise.all([api.characters(), loadGameData()]);
      } catch (e) {
        setHTML(root, html`<div class="container empty"><h2>Keine Verbindung</h2><p>${(e as Error).message}</p></div>`);
        return;
      }
      const { classes, rules } = data;
      setHTML(root, html`
        <div class="container">
          <header class="page-head" data-reveal>
            <div class="eyebrow">Deine Heldinnen und Helden</div>
            <h1>Figuren</h1>
            <p class="lead">${list.length ? "Wähle eine Figur, um ihren Bogen zu öffnen, oder erschaffe eine neue." : "Noch keine Figur – Zeit, die erste zu erschaffen!"}</p>
            <div class="head-links">
              <a class="ach-link" href="#/heldenhalle">${icon("crown")} Heldenhalle ${icon("arrowRight")}</a>
              <a class="ach-link" href="#/erfolge">${icon("star")} Erfolge <b>${Object.keys(unlockedAchievements()).length} / ${ACHIEVEMENTS.length}</b> ${icon("arrowRight")}</a>
            </div>
          </header>
          <div class="char-grid">
            <a class="card char-card new-card tilt" href="#/figur/neu" data-reveal="scale">
              <div class="new-plus">${icon("plus")}</div>
              <h3>Neue Figur</h3>
              <p>Ein Assistent führt dich in sechs kurzen Schritten.</p>
            </a>
            ${list.map((c, i) => {
              const cls = classes.find((x) => x.id === c.classId) ?? c.customClass?.cls;
              const stand = rules.stands.find((s) => s.id === c.stand);
              const hpPct = Math.round((c.hp.current / c.hp.max) * 100);
              return html`
                <div class="char-wrap ${isResting(c) ? "resting" : ""}" data-reveal="scale" style="--i:${i + 1}">
                <button class="icon-btn char-delete" data-delete="${c.id}" aria-label="${c.name} löschen" title="Figur löschen">${icon("trash")}</button>
                <a class="card char-card tilt" href="#/figur/${c.id}">
                  <div class="char-sigil">${avatar(c.id, cls?.sigil ?? "shield", { draw: true })}</div>
                  <h3>${fullName(c)}</h3>
                  <p class="muted">${cls?.name ?? c.classId} · ${stand?.name ?? c.stand} · Stufe ${c.level}</p>
                  ${isResting(c) ? html`<span class="chip">${icon("candle")} ruht</span>` : ""}
                  <div class="mini-hp" title="${c.hp.current} von ${c.hp.max} Trefferpunkten"><i style="width:${hpPct}%"></i></div>
                  <span class="link-arrow">Bogen öffnen ${icon("arrowRight")}</span>
                </a>
                </div>`;
            })}
          </div>
          <div class="center" style="margin-top:28px"><a class="btn btn-ghost" href="#/klassen">${icon("wand")} Eigene Klassen bauen</a></div>
          <p class="hint center" style="margin-top:18px">Deine Figuren werden in deinem Konto gespeichert – melde dich auf einem anderen Gerät an, und sie sind dort auch.</p>
        </div>`);
      root.addEventListener("click", async (e) => {
        const del = (e.target as HTMLElement).closest<HTMLElement>("[data-delete]");
        if (!del) return;
        e.preventDefault();
        const c = list.find((x) => x.id === del.dataset.delete);
        if (!c) return;
        const adventures = campaignStore.list().filter((s) => s.characterId === c.id);
        const extra = adventures.length ? ` Auch ${adventures.length === 1 ? "ihr Abenteuer wird" : `ihre ${adventures.length} Abenteuer werden`} gelöscht.` : "";
        if (!(await confirmDialog("Figur löschen?", `${c.name} wird endgültig gelöscht.${extra} Das lässt sich nicht rückgängig machen.`, "Löschen", true))) return;
        await api.deleteCharacter(c.id);
        for (const a of adventures) campaignStore.remove(a.id);
        toast(`${c.name} ist in die Legenden eingegangen.`);
        go("/figuren");
      });
      enhance(root);
    },
  };
}
