import { formatModifier } from "../../../shared/dice";
import { modifier } from "../../../shared/character";
import { rollWithOverlay } from "../dice3d/roller";
import { countUp, enhance } from "../fx/effects";
import { api, loadGameData } from "../lib/api";
import { $, $$, html, setHTML, uuid } from "../lib/dom";
import { GLOSSARY, term } from "../lib/glossary";
import { diceShape, icon } from "../lib/icons";
import type { Page } from "../lib/router";

function successFaces(bonus: number, dc: number): boolean[] {
  return Array.from({ length: 20 }, (_, i) => {
    const f = i + 1;
    return f === 20 ? true : f === 1 ? false : f + bonus >= dc;
  });
}

const CHAPTERS = [
  ["worum", "Worum geht's?"],
  ["attribute", "Deine Figur"],
  ["probe", "Die Probe"],
  ["vorteil", "Vorteil & Nachteil"],
  ["kampf", "Kampf in Kürze"],
  ["wuerfel", "Würfel lesen"],
  ["lexikon", "Lexikon"],
] as const;

export function learnPage(): Page {
  let spy: IntersectionObserver | null = null;
  return {
    async render(root) {
      const { rules } = await loadGameData();
      const diffs = rules.checks.difficulties;
      setHTML(root, html`
        <div class="container learn">
          <header class="page-head" data-reveal>
            <div class="eyebrow">Spielanleitung</div>
            <h1>So funktioniert's</h1>
            <p class="lead">Alles, was du für dein erstes Abenteuer brauchst – in sieben kurzen Kapiteln. Fachbegriffe sind <span class="term" tabindex="0" data-term="rollenspiel">so markiert</span>: Fahr mit der Maus drüber oder tippe darauf.</p>
          </header>

          <div class="learn-layout">
            <nav class="toc" aria-label="Kapitel">
              ${CHAPTERS.map(([id, t], i) => html`<a href="#/lernen" data-toc="${id}"><span>${i + 1}</span>${t}</a>`)}
            </nav>

            <div class="chapters">
              <section class="chapter" id="worum" data-reveal>
                <h2><span class="ch-num">1</span>Worum geht's?</h2>
                <p>Ihr erzählt gemeinsam eine Geschichte im Mittelalter: Burgen, Klöster, Märkte, finstere Wälder. Es gibt drei Rollen:</p>
                <div class="roles">
                  <div class="role card tilt">${icon("user")}<h3>Du</h3><p>Spielst deine ${term("figur")}. Du sagst, was sie tut, sagt und denkt – frei, ohne vorgegebene Antworten.</p></div>
                  <div class="role card tilt">${icon("quill")}<h3>Der Spielleiter</h3><p>Beschreibt die Welt, spielt alle anderen Personen und sagt, wann gewürfelt wird.</p></div>
                  <div class="role card tilt">${icon("dice")}<h3>Die Würfel</h3><p>Entscheiden, ob riskante Taten gelingen. Sie sorgen für Spannung und Überraschungen.</p></div>
                </div>
                <div class="callout">${icon("info")}<p>Es gibt kein „Gewinnen“ oder „Verlieren“. Auch ein Fehlschlag treibt die Geschichte voran – oft sind das die besten Momente.</p></div>
              </section>

              <section class="chapter" id="attribute" data-reveal>
                <h2><span class="ch-num">2</span>Deine Figur: sechs Attribute</h2>
                <p>Jede Figur hat sechs ${term("attribut", "Attribute")}. 10 ist Durchschnitt. Aus jedem Wert ergibt sich ein ${term("bonus")}, der zu Würfen addiert wird.</p>
                <div class="attr-cards">
                  ${rules.attributes.map((a, i) => html`<div class="attr-card card tilt" data-reveal="scale" style="--i:${i}">
                    <div class="attr-icon">${icon(a.icon)}</div>
                    <h3>${a.name} <small>${a.short}</small></h3>
                    <p>${a.description}</p>
                    <ul>${a.examples.map((e) => html`<li>${e}</li>`)}</ul>
                  </div>`)}
                </div>
                <div class="card bonus-lab glow-border">
                  <h3>Probier's aus: Wert → Bonus</h3>
                  <div class="bonus-row">
                    <input type="range" min="6" max="18" value="14" id="val-slider" aria-label="Attributswert" />
                    <div class="bonus-out"><span class="bo-val" id="val-out">14</span>${icon("arrowRight")}<span class="bo-bonus" id="bonus-out">+2</span></div>
                  </div>
                  <div class="bonus-scale" id="bonus-scale">
                    ${Array.from({ length: 13 }, (_, i) => i + 6).map((v) => html`<div data-v="${v}"><b>${v}</b><span>${formatModifier(modifier(v))}</span></div>`)}
                  </div>
                  <p class="hint">Faustregel: Ab 10 gibt es für je zwei Punkte +1. Unter 10 wird es negativ.</p>
                </div>
              </section>

              <section class="chapter" id="probe" data-reveal>
                <h2><span class="ch-num">3</span>Die Probe – das Herz des Spiels</h2>
                <p>Wenn etwas schiefgehen kann, verlangt der Spielleiter eine ${term("probe")}. So geht's:</p>
                <div class="formula" data-reveal="scale">
                  <div class="f-box">${diceShape(20)}<span>W20 werfen</span></div>
                  <div class="f-op">+</div>
                  <div class="f-box"><b>+2</b><span>Bonus addieren</span></div>
                  <div class="f-op">≥</div>
                  <div class="f-box"><b>13</b><span>Schwierigkeit erreichen</span></div>
                  <div class="f-op">=</div>
                  <div class="f-box good">${icon("check")}<span>Geschafft!</span></div>
                </div>
                <div class="card probe-lab glow-border">
                  <h3>Interaktiv: Wie gut stehen deine Chancen?</h3>
                  <div class="lab-controls">
                    <div class="field">
                      <label for="lab-bonus">Dein Bonus: <b id="lab-bonus-out">+2</b></label>
                      <input type="range" id="lab-bonus" min="-2" max="8" value="2" />
                    </div>
                    <div class="field">
                      <label for="lab-dc">${term("sg", "Schwierigkeit")}</label>
                      <select class="select" id="lab-dc">
                        ${diffs.map((d) => html`<option value="${d.dc}" ${d.dc === 13 ? "selected" : ""}>${d.name} (${d.dc}) – ${d.example}</option>`)}
                      </select>
                    </div>
                  </div>
                  <div class="face-strip" id="face-strip" aria-label="Würfelergebnisse 1 bis 20"></div>
                  <div class="legend"><span><i class="lg-good"></i>klappt</span><span><i class="lg-bad"></i>klappt nicht</span><span><i class="lg-crit"></i>20: klappt immer</span><span><i class="lg-fumble"></i>1: misslingt immer</span></div>
                  <div class="chance">
                    <div><span class="chance-num" id="chance">60</span><span class="chance-pc">%</span></div>
                    <p id="chance-text">Du brauchst mindestens eine 11 auf dem W20.</p>
                  </div>
                  <button class="btn magnetic" id="lab-roll">${icon("dice")} Probe würfeln</button>
                </div>
              </section>

              <section class="chapter" id="vorteil" data-reveal>
                <h2><span class="ch-num">4</span>Vorteil &amp; Nachteil</h2>
                <p>Manchmal ist die Lage besonders günstig (du greifst einen schlafenden Wächter an) oder ungünstig (du kletterst im Sturm). Dann wirfst du <b>zwei W20</b>:</p>
                <div class="advdis">
                  <div class="card ad-card good tilt"><div class="ad-dice"><span class="mini">17</span><span class="mini dim">6</span></div><h3>${term("vorteil")}</h3><p>Das <b>höhere</b> Ergebnis zählt.</p></div>
                  <div class="card ad-card bad tilt"><div class="ad-dice"><span class="mini dim">17</span><span class="mini">6</span></div><h3>${term("nachteil")}</h3><p>Das <b>niedrigere</b> Ergebnis zählt.</p></div>
                </div>
                <div class="card chance-bars">
                  <h3>Deine Chance bei der Probe von oben</h3>
                  <div class="bar-row"><span>Nachteil</span><div class="bar"><i id="bar-dis"></i></div><b id="pc-dis"></b></div>
                  <div class="bar-row"><span>Normal</span><div class="bar"><i id="bar-norm"></i></div><b id="pc-norm"></b></div>
                  <div class="bar-row"><span>Vorteil</span><div class="bar"><i id="bar-adv"></i></div><b id="pc-adv"></b></div>
                  <div class="btn-row">
                    <button class="btn btn-ghost btn-sm" data-mode="advantage">${icon("dice")} Mit Vorteil würfeln</button>
                    <button class="btn btn-ghost btn-sm" data-mode="disadvantage">${icon("dice")} Mit Nachteil würfeln</button>
                  </div>
                </div>
              </section>

              <section class="chapter" id="kampf" data-reveal>
                <h2><span class="ch-num">5</span>Kampf in Kürze</h2>
                <p>Kämpfe laufen in Runden ab. Jede Figur ist reihum dran. Ein Angriff funktioniert wie eine Probe:</p>
                <ol class="flow">
                  <li data-reveal style="--i:0">${icon("sword")}<b>Angreifen</b><span>${term("w20")} + Angriffsbonus</span></li>
                  <li data-reveal style="--i:1">${icon("shield")}<b>Treffer?</b><span>Ergebnis ≥ ${term("ruestung")} des Gegners</span></li>
                  <li data-reveal style="--i:2">${icon("zap")}<b>Schaden</b><span>Waffenwürfel werfen, z. B. 1W8</span></li>
                  <li data-reveal style="--i:3">${icon("heart")}<b>Wunden</b><span>Gegner verliert so viele ${term("tp")}</span></li>
                </ol>
                <div class="callout">${icon("info")}<p>Bei einer natürlichen 20 ist es ein ${term("krit", "kritischer Treffer")}: Du wirfst die Schadenswürfel doppelt. Das komplette Kampfsystem folgt in Etappe 5.</p></div>
              </section>

              <section class="chapter" id="wuerfel" data-reveal>
                <h2><span class="ch-num">6</span>Würfel richtig lesen</h2>
                <div class="read-grid">
                  <div class="card tilt"><div class="read-art">${diceShape(100)}</div><h3>W100: zwei Zehnerwürfel</h3><p>Einer zeigt Zehner (<b>00–90</b>), einer Einer (<b>0–9</b>). <b>40</b> und <b>7</b> ergeben <b>47</b>. <b>00</b> und <b>0</b> ergeben <b>100</b>.</p></div>
                  <div class="card tilt"><div class="read-art">${diceShape(4)}</div><h3>W4: die Spitze zählt</h3><p>Ein W4 hat keine Fläche oben. Es zählt die Zahl, die an der <b>oberen Spitze</b> steht – sie ist auf allen sichtbaren Seiten gleich.</p></div>
                  <div class="card tilt"><div class="read-art">${diceShape(6)}</div><h3>6 oder 9?</h3><p>Auf W8 bis W20 sind <b>6</b> und <b>9</b> unterstrichen, damit du sie nicht verwechselst. Gegenüberliegende Seiten ergeben beim W20 immer 21.</p></div>
                </div>
              </section>

              <section class="chapter" id="lexikon" data-reveal>
                <h2><span class="ch-num">7</span>Kleines Lexikon</h2>
                <input class="input" id="lex-search" placeholder="Begriff suchen … (z. B. Vorteil)" />
                <dl class="lexicon" id="lexicon">
                  ${Object.entries(GLOSSARY).sort((a, b) => a[1].title.localeCompare(b[1].title, "de")).map(([k, t]) => html`<div class="lex-item" data-key="${k} ${t.title.toLowerCase()}"><dt>${t.title}</dt><dd>${t.short}</dd></div>`)}
                </dl>
              </section>

              <div class="learn-end card glow-border" data-reveal>
                <h2>Bereit?</h2>
                <p>Du weißt jetzt mehr als genug. Erschaffe deine erste Figur!</p>
                <a class="btn btn-lg magnetic" href="#/figur/neu">${icon("sparkles")} Figur erschaffen</a>
              </div>
            </div>
          </div>
        </div>`);

      // Wert → Bonus
      const slider = $<HTMLInputElement>("#val-slider", root);
      const updBonus = () => {
        const v = Number(slider.value);
        $("#val-out", root).textContent = String(v);
        const b = $("#bonus-out", root);
        b.textContent = formatModifier(modifier(v));
        b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop");
        $$("#bonus-scale > div", root).forEach((d) => d.classList.toggle("on", Number(d.dataset.v) === v));
      };
      slider.addEventListener("input", updBonus);
      updBonus();

      // Probe-Labor
      const bonusIn = $<HTMLInputElement>("#lab-bonus", root);
      const dcIn = $<HTMLSelectElement>("#lab-dc", root);
      const strip = $("#face-strip", root);
      strip.innerHTML = Array.from({ length: 20 }, (_, i) => `<div class="face" style="--i:${i}"><span>${i + 1}</span></div>`).join("");
      let lastChance = 0;
      const updLab = () => {
        const bonus = Number(bonusIn.value), dc = Number(dcIn.value);
        $("#lab-bonus-out", root).textContent = formatModifier(bonus);
        const ok = successFaces(bonus, dc);
        $$(".face", strip).forEach((el, i) => {
          el.className = `face ${i === 19 ? "crit" : i === 0 ? "fumble" : ok[i] ? "good" : "bad"}`;
        });
        const p = ok.filter(Boolean).length / 20;
        const pct = Math.round(p * 100);
        countUp($("#chance", root), pct, 500, lastChance);
        lastChance = pct;
        const need = Math.max(2, Math.min(20, dc - bonus));
        $("#chance-text", root).textContent = need >= 20 ? "Nur eine natürliche 20 rettet dich!" : need <= 2 ? "Nur eine natürliche 1 kann dich aufhalten." : `Du brauchst mindestens eine ${need} auf dem W20.`;
        const adv = 1 - (1 - p) ** 2, dis = p ** 2;
        for (const [id, val] of [["dis", dis], ["norm", p], ["adv", adv]] as const) {
          $(`#bar-${id}`, root).style.transform = `scaleX(${val})`;
          $(`#pc-${id}`, root).textContent = `${Math.round(val * 100)} %`;
        }
      };
      bonusIn.addEventListener("input", updLab);
      dcIn.addEventListener("change", updLab);
      updLab();

      const practice = (mode: "normal" | "advantage" | "disadvantage") => {
        const bonus = Number(bonusIn.value), dc = Number(dcIn.value);
        const notation = `1W20${bonus ? formatModifier(bonus).replace("−", "-") : ""}`;
        const label = mode === "normal" ? `Übungsprobe gegen SG ${dc}` : `Übungsprobe mit ${mode === "advantage" ? "Vorteil" : "Nachteil"} gegen SG ${dc}`;
        void rollWithOverlay(label, () => api.roll({ requestId: uuid(), notation, mode, label, dc }));
      };
      $("#lab-roll", root).addEventListener("click", () => practice("normal"));
      $$("[data-mode]", root).forEach((b) => b.addEventListener("click", () => practice(b.dataset.mode as "advantage" | "disadvantage")));

      // Lexikon-Suche
      $<HTMLInputElement>("#lex-search", root).addEventListener("input", (e) => {
        const q = (e.target as HTMLInputElement).value.trim().toLowerCase();
        $$(".lex-item", root).forEach((el) => { el.hidden = !!q && !(el.dataset.key ?? "").includes(q) && !el.textContent!.toLowerCase().includes(q); });
      });

      // Inhaltsverzeichnis: Sprung + aktuelles Kapitel hervorheben
      $$("[data-toc]", root).forEach((a) => a.addEventListener("click", (e) => {
        e.preventDefault();
        document.getElementById(a.dataset.toc!)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }));
      spy = new IntersectionObserver((entries) => {
        for (const en of entries) if (en.isIntersecting) $$("[data-toc]", root).forEach((a) => a.classList.toggle("active", a.dataset.toc === en.target.id));
      }, { rootMargin: "-40% 0px -55% 0px" });
      $$(".chapter", root).forEach((c) => spy!.observe(c));

      enhance(root);
    },
    leave() { spy?.disconnect(); },
  };
}
