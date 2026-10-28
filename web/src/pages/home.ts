import { ACHIEVEMENTS } from "../../../shared/achievements";
import { unlockedAchievements } from "../lib/achievements";
import { legacySummary, summaryText } from "../lib/account";
import { mountHeroDie } from "../dice3d/heroDie";
import { enhance, splitLetters } from "../fx/effects";
import { loadGameData } from "../lib/api";
import { $, html, setHTML } from "../lib/dom";
import { term } from "../lib/glossary";
import { diceShape, icon } from "../lib/icons";
import type { Page } from "../lib/router";

const DICE_INFO = [
  { sides: 20, name: "W20", use: "Der wichtigste Würfel: entscheidet Proben und Angriffe." },
  { sides: 4, name: "W4", use: "Kleiner Schaden, z. B. mit dem Dolch." },
  { sides: 6, name: "W6", use: "Schaden von Kurzschwert, Speer oder Bogen." },
  { sides: 8, name: "W8", use: "Schaden von Langschwert oder Streitaxt." },
  { sides: 10, name: "W10", use: "Schaden von Armbrust oder Hellebarde." },
  { sides: 12, name: "W12", use: "Für besonders heftige Treffer." },
  { sides: 100, name: "W100", use: "Prozentwurf: Zufallstabellen und Glück." },
];

export function homePage(): Page {
  let disposeDie: (() => void) | null = null;
  return {
    async render(root) {
      setHTML(root, html`
        ${legacySummary() ? html`<div class="container"><div class="legacy-banner">${icon("scroll")}<p><b>Spielstände von früher gefunden:</b> ${summaryText(legacySummary()!)}. Übernimm sie mit einem Klick in dein Konto.</p><a class="btn btn-sm" href="#/einstellungen">${icon("arrowRight")} Zur Übernahme</a></div></div>` : ""}
        <section class="hero container">
          <div class="hero-text">
            <div class="eyebrow">Ein Erzähl-Abenteuer im Mittelalter</div>
            <h1 class="hero-title"><span class="ht-word ht-small" data-split>The Last</span> <span class="ht-word ht-ember" data-split>Ember</span></h1>
            <p class="hero-sub" data-reveal style="--i:6">Du erschaffst eine Figur. Ein Spielleiter erzählt die Geschichte. Und die Würfel entscheiden, ob dein Plan gelingt. <strong>Keine Vorkenntnisse nötig</strong> – wir erklären dir alles unterwegs.</p>
            <div class="hero-cta" data-reveal style="--i:8">
              <a class="btn btn-lg magnetic glow-border" href="#/figur/neu">${icon("sparkles")} Figur erschaffen</a>
              <a class="btn btn-ghost btn-lg" href="#/lernen">${icon("book")} So funktioniert's</a>
            </div>
            ${Object.keys(unlockedAchievements()).length ? html`<a class="ach-link" href="#/erfolge" data-reveal style="--i:9">${icon("crown")} Erfolge <b>${Object.keys(unlockedAchievements()).length} / ${ACHIEVEMENTS.length}</b> ${icon("arrowRight")}</a>` : ""}
            <div class="hero-stats" data-reveal style="--i:10">
              <div><b data-stat="classes">6</b><span>Klassen</span></div>
              <div><b data-stat="skills">16</b><span>Fertigkeiten</span></div>
              <div><b>7</b><span>Würfelarten</span></div>
            </div>
          </div>
          <div class="hero-die" data-reveal="scale" style="--i:3">
            <div class="hero-orbit"><i></i><i></i><i></i></div>
            <div class="hero-die-host" title="Klick mich!"></div>
            <span class="hero-die-hint">${icon("sparkles")} Klick mich</span>
          </div>
          <a class="scroll-cue" href="#steps" aria-label="Weiter nach unten"><span></span></a>
        </section>

        <section class="section container" id="steps">
          <div class="section-head" data-reveal>
            <div class="eyebrow">Neu hier?</div>
            <h2>In drei Schritten ins Abenteuer</h2>
            <p>Ein ${term("rollenspiel")} ist wie ein Buch, in dem du die Hauptfigur spielst. Du musst keine Regeln auswendig kennen.</p>
          </div>
          <div class="steps-grid">
            ${[
              { i: "user", t: "Figur erschaffen", d: "Wähle Herkunft und Klasse, verteile deine Stärken. Ein Assistent führt dich Schritt für Schritt.", href: "#/figur/neu", cta: "Los geht's" },
              { i: "dice", t: "Würfeln verstehen", d: "Probier den 3D-Würfel aus und lerne, was eine Probe ist. Spielerisch, in fünf Minuten.", href: "#/lernen", cta: "Anleitung" },
              { i: "scroll", t: "Abenteuer erleben", d: "Claude erzählt als Spielleiter deine Geschichte – jedes Mal mit einem anderen, ausgewürfelten Anfang.", href: "#/abenteuer", cta: "Abenteuer starten" },
            ].map((s, i) => html`
              <article class="card tilt step-card" data-reveal style="--i:${i}">
                <div class="step-num">${i + 1}</div>
                <div class="step-icon">${icon(s.i)}</div>
                <h3>${s.t}</h3>
                <p>${s.d}</p>
                ${s.href ? html`<a class="link-arrow" href="${s.href}">${s.cta} ${icon("arrowRight")}</a>` : html`<span class="chip">${s.cta}</span>`}
              </article>`)}
          </div>
        </section>

        <section class="section container split">
          <div data-reveal="left">
            <div class="eyebrow">So fühlt es sich an</div>
            <h2>Du sagst, was du tust.<br/>Die Würfel sagen, ob es klappt.</h2>
            <p>Der ${term("spielleiter")} beschreibt die Szene. Du entscheidest frei, was deine Figur tut – es gibt keine vorgegebenen Antworten. Wird es knifflig, verlangt er eine ${term("probe")}: Du wirfst den ${term("w20")} und addierst deinen ${term("bonus")}.</p>
            <p>Erreichst du den ${term("sg", "Schwierigkeitsgrad")}, gelingt dein Plan. Wenn nicht, wird die Geschichte trotzdem spannend.</p>
            <a class="btn btn-ghost" href="#/lernen">${icon("book")} Mehr erfahren</a>
          </div>
          <div class="chat-demo card">
            <div class="bubble gm" data-reveal style="--i:1"><b>Spielleiter</b>Nebel hängt über dem Kloster. Hinter der Mauer hörst du Mönche singen – und das Klirren von Waffen.</div>
            <div class="bubble you" data-reveal style="--i:4"><b>Du</b>Ich klettere über die Mauer, ganz leise.</div>
            <div class="bubble gm" data-reveal style="--i:7"><b>Spielleiter</b>Die Steine sind feucht. Mach eine <em>Athletik-Probe</em>, Schwierigkeit 13.</div>
            <div class="bubble roll" data-reveal style="--i:10">
              <span class="mini-die">${diceShape(20)}</span>
              <span><b>14</b> gewürfelt <span class="op">+</span> <b>2</b> Stärke <span class="op">=</span> <b class="glow">16</b></span>
              <span class="chip good">${icon("check")} Geschafft</span>
            </div>
            <div class="bubble gm" data-reveal style="--i:13"><b>Spielleiter</b>Du ziehst dich über die Zinnen. Unten im Hof stehen drei Söldner um einen gefesselten Abt …</div>
          </div>
        </section>

        <section class="section container">
          <div class="section-head" data-reveal>
            <div class="eyebrow">Das Werkzeug</div>
            <h2>Die Würfel</h2>
            <p>„W“ steht für Würfel, die Zahl für die Anzahl der Seiten. „2W6“ heißt also: zwei sechsseitige Würfel werfen.</p>
          </div>
          <div class="dice-grid">
            ${DICE_INFO.map((d, i) => html`
              <a class="die-tile card tilt ${d.sides === 20 ? "featured" : ""}" href="#/wuerfel" data-reveal="scale" style="--i:${i}">
                ${diceShape(d.sides)}
                <b>${d.name}</b>
                <span>${d.use}</span>
              </a>`)}
          </div>
          <div class="center" data-reveal><a class="btn magnetic" href="#/wuerfel">${icon("dice")} Zum Würfeltisch</a></div>
        </section>

        <section class="section container">
          <div class="card fair-card glow-border" data-reveal>
            <div class="fair-icon">${icon("lock")}</div>
            <div>
              <h3>Jeder Wurf ist fair</h3>
              <p>Das Ergebnis würfelt der Server mit kryptografischem Zufall, <em>bevor</em> die Animation startet. Der 3D-Würfel rollt dann so, dass genau diese Zahl oben liegt. Niemand – weder du, noch die Webseite, noch der Spielleiter – kann das Ergebnis beeinflussen oder neu würfeln.</p>
            </div>
          </div>
        </section>

        <footer class="footer container">The Last Ember · Am letzten Feuer werden die besten Geschichten erzählt</footer>
      `);

      root.querySelectorAll<HTMLElement>("[data-split]").forEach((el, i) => splitLetters(el, 150 + i * 380, 55));
      enhance(root);
      disposeDie = mountHeroDie($(".hero-die-host", root));

      loadGameData().then(({ rules, classes }) => {
        root.querySelector('[data-stat="classes"]')!.textContent = String(classes.length);
        root.querySelector('[data-stat="skills"]')!.textContent = String(rules.skills.length);
      }).catch(() => {});
    },
    leave() { disposeDie?.(); },
  };
}
