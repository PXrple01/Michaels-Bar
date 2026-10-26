import { enhance } from "../fx/effects";
import { api, loadGameData } from "../lib/api";
import { html, setHTML } from "../lib/dom";
import { icon, sigil } from "../lib/icons";
import type { Page } from "../lib/router";

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
          </header>
          <div class="char-grid">
            <a class="card char-card new-card tilt" href="#/figur/neu" data-reveal="scale">
              <div class="new-plus">${icon("plus")}</div>
              <h3>Neue Figur</h3>
              <p>Ein Assistent führt dich in sechs kurzen Schritten.</p>
            </a>
            ${list.map((c, i) => {
              const cls = classes.find((x) => x.id === c.classId);
              const stand = rules.stands.find((s) => s.id === c.stand);
              const hpPct = Math.round((c.hp.current / c.hp.max) * 100);
              return html`
                <a class="card char-card tilt" href="#/figur/${c.id}" data-reveal="scale" style="--i:${i + 1}">
                  <div class="char-sigil">${sigil(cls?.sigil ?? "shield", "draw")}</div>
                  <h3>${c.name}</h3>
                  <p class="muted">${cls?.name ?? c.classId} · ${stand?.name ?? c.stand} · Stufe ${c.level}</p>
                  <div class="mini-hp" title="${c.hp.current} von ${c.hp.max} Trefferpunkten"><i style="width:${hpPct}%"></i></div>
                  <span class="link-arrow">Bogen öffnen ${icon("arrowRight")}</span>
                </a>`;
            })}
          </div>
        </div>`);
      enhance(root);
    },
  };
}
