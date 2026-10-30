// Startseite: Die Seite ist selbst die erste Probe. Eine kurze Szene im Erzählstil des Spiels, der W20 daneben –
// ein Klick wirft ihn, er bleibt mit der geworfenen Zahl zum Betrachter liegen, und die Geschichte geht passend weiter.
import { ACHIEVEMENTS } from "../../../shared/achievements";
import { unlockedAchievements } from "../lib/achievements";
import { legacySummary, summaryText } from "../lib/account";
import { playCrit, playFumble, playImpact, unlockAudio } from "../dice3d/audio";
import { mountHeroDie, type HeroDie } from "../dice3d/heroDie";
import { enhance } from "../fx/effects";
import { $, html, setHTML } from "../lib/dom";
import { term } from "../lib/glossary";
import { diceShape, icon } from "../lib/icons";
import type { Page } from "../lib/router";
import { quickStart } from "../lib/quickstart";
import { settings } from "../lib/settings";

const DC = 13, BONUS = 2;

/** Wie die Kletterei ausgeht – genau so, wie der Spielleiter im Spiel weitererzählt. */
const OUTCOME = {
  crit: { word: "Kritischer Erfolg", text: "Du fliegst förmlich über die Zinnen. Unten im Hof stehen drei Söldner um einen gefesselten Abt – und keiner von ihnen hat dich bemerkt." },
  hit: { word: "Geschafft", text: "Du ziehst dich über die Zinnen. Unten im Hof stehen drei Söldner um einen gefesselten Abt. Einer dreht sich langsam zu deiner Mauer um …" },
  miss: { word: "Nicht geschafft", text: "Ein Stein bricht unter deinem Stiefel. Du landest unsanft im Gras, und hinter der Mauer verstummt der Gesang. Jemand hat dich gehört." },
  fumble: { word: "Patzer", text: "Du rutschst ab, reißt eine Ranke mit dir und landest scheppernd vor dem Tor. Drinnen schlägt ein Hund an, Fackeln kommen näher." },
};

const DICE = [
  { sides: 4, name: "W4", use: "Dolch" },
  { sides: 6, name: "W6", use: "Kurzschwert" },
  { sides: 8, name: "W8", use: "Langschwert" },
  { sides: 20, name: "W20", use: "Jede Probe, jeder Angriff" },
  { sides: 10, name: "W10", use: "Armbrust" },
  { sides: 12, name: "W12", use: "Streitaxt" },
  { sides: 100, name: "W100", use: "Zufall" },
];

const ROUTE = [
  { t: "Figur erschaffen", d: "Herkunft, Klasse, ein Gesicht. Ein Assistent führt dich, oder der Schnellstart würfelt dir eine Figur aus.", href: "#/figur/neu", cta: "Figur erschaffen" },
  { t: "Zuhören und handeln", d: "Claude erzählt als Spielleiter. Du schreibst in eigenen Worten, was du tust – allein oder mit Freunden in einer Gruppe.", href: "#/abenteuer", cta: "Abenteuer ansehen" },
  { t: "Würfeln, wenn es knifflig wird", d: "Ein W20 plus dein Bonus gegen die Schwierigkeit. Gelingt es nicht, wird die Geschichte trotzdem weitergehen – nur anders.", href: "#/lernen", cta: "In fünf Minuten lernen" },
];

function secureD20(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return (a[0] % 20) + 1;
}

export function homePage(): Page {
  let die: HeroDie | null = null;
  return {
    async render(root) {
      const achieved = Object.keys(unlockedAchievements()).length;
      setHTML(root, html`
        ${legacySummary() ? html`<div class="container"><div class="legacy-banner">${icon("scroll")}<p><b>Spielstände von früher gefunden:</b> ${summaryText(legacySummary()!)}. Übernimm sie mit einem Klick in dein Konto.</p><a class="btn btn-sm" href="#/einstellungen">${icon("arrowRight")} Zur Übernahme</a></div></div>` : ""}

        <section class="hm-hero container" data-state="idle">
          <div class="hm-copy">
            <h1 class="hm-title">The Last Ember</h1>
            <p class="hm-pitch">Ein Erzähl-Abenteuer im Mittelalter. Claude erzählt, du entscheidest, die Würfel urteilen. Neu dabei? <a href="#/lernen">In fünf Minuten zeigen wir dir, wie es geht.</a></p>

            <div class="hm-scene" aria-live="polite">
              <span class="hm-quill">${icon("feather")}</span>
              <p>Nebel hängt über dem Kloster. Hinter der Mauer singen Mönche – und dazwischen klirren Waffen. Du willst hinüber, aber die Steine sind feucht und glatt.</p>
              <p class="hm-ask">Mach eine ${term("probe")} auf Klettern. Du brauchst mindestens <b>${DC}</b>, dein ${term("bonus")} ist <b>+${BONUS}</b>.</p>
              <div class="hm-result" hidden>
                <p class="hm-sum"></p>
                <p class="hm-outcome"></p>
                <p class="hm-moral">So geht es im Spiel weiter – nur entscheidest dort du, was als Nächstes passiert.</p>
              </div>
              <button class="btn hm-roll" data-roll>${icon("dice")} <span>Würfeln</span></button>
            </div>

            <div class="hm-cta">
              <a class="btn btn-lg magnetic glow-border" href="#/abenteuer">${icon("scroll")} Abenteuer beginnen</a>
              <button class="btn btn-ghost btn-lg" data-quick title="Zufällige Figur, sofort losspielen">${icon("dice")} Schnellstart</button>
              <a class="hm-textlink" href="#/figur/neu">Eigene Figur erschaffen</a>
            </div>
            ${achieved ? html`<a class="ach-link" href="#/erfolge">${icon("crown")} Erfolge <b>${achieved} / ${ACHIEVEMENTS.length}</b></a>` : ""}
          </div>

          <div class="hm-fire">
            <div class="hm-die" data-roll role="button" tabindex="0" aria-label="W20 werfen"></div>
            <output class="hm-number" aria-hidden="true"></output>
          </div>
        </section>

        <section class="hm-route container" aria-labelledby="route-title">
          <h2 id="route-title">Ein Abend am Feuer</h2>
          <ol class="hm-stations">
            ${ROUTE.map((r, i) => html`
              <li class="hm-station">
                <span class="hm-mark" aria-hidden="true">${i + 1}</span>
                <h3>${r.t}</h3>
                <p>${r.d}</p>
                <a href="${r.href}">${r.cta}</a>
              </li>`)}
          </ol>
        </section>

        <section class="hm-bag container" aria-labelledby="bag-title">
          <div class="hm-bag-text">
            <h2 id="bag-title">Der Würfelbeutel</h2>
            <p>„W“ heißt Würfel, die Zahl dahinter verrät die Seiten. „2W6“ bedeutet also: zwei sechsseitige Würfel. Meist brauchst du nur den W20 – die anderen bestimmen, wie hart eine Waffe trifft.</p>
            <a class="btn btn-ghost" href="#/wuerfel">${icon("dice")} Zum Würfeltisch</a>
          </div>
          <ul class="hm-table">
            ${DICE.map((d) => html`<li class="hm-d ${d.sides === 20 ? "is-main" : ""}">${diceShape(d.sides)}<b>${d.name}</b><span>${d.use}</span></li>`)}
          </ul>
        </section>

        <section class="hm-seal container">
          <div class="hm-wax" aria-hidden="true">${icon("lock")}</div>
          <div>
            <h2>Jeder Wurf ist besiegelt</h2>
            <p>Im Abenteuer würfelt der Server mit kryptografischem Zufall, <em>bevor</em> die Animation beginnt, und der 3D-Würfel rollt dann genau auf diese Zahl. Weder du noch die Webseite noch der Spielleiter kann ein Ergebnis ändern oder neu würfeln.</p>
          </div>
        </section>

        <footer class="footer container">The Last Ember – am letzten Feuer werden die besten Geschichten erzählt.</footer>
      `);

      const hero = $(".hm-hero", root);
      const number = $(".hm-number", root);
      const result = $(".hm-result", root);
      const rollBtn = $<HTMLButtonElement>(".hm-roll", root);
      die = mountHeroDie($(".hm-die", root));
      let rolling = false;

      async function roll() {
        if (rolling || !die) return;
        rolling = true;
        rollBtn.disabled = true;
        hero.dataset.state = "rolling";
        const sound = settings().sound;
        if (sound) { unlockAudio(); [0, 160, 330].forEach((ms, i) => setTimeout(() => playImpact(i === 1 ? "die" : "table", 13 - i * 3), ms)); }
        // Liegt der Würfel gerade außerhalb des Bildes (Handy, unten auf „Würfeln“ getippt), erst zu ihm hin
        const fire = $(".hm-fire", root), r = fire.getBoundingClientRect();
        const offscreen = r.bottom < 60 || r.top > innerHeight - 60;
        if (offscreen) fire.scrollIntoView({ behavior: "smooth", block: "center" });
        const n = secureD20();
        await die.roll(n);
        const total = n + BONUS;
        const kind = n === 20 ? "crit" : n === 1 ? "fumble" : total >= DC ? "hit" : "miss";
        if (sound && kind === "crit") playCrit();
        if (sound && kind === "fumble") playFumble();
        number.textContent = String(n);
        $(".hm-sum", root).innerHTML = html`<span>${n}</span> gewürfelt + <span>${BONUS}</span> Bonus = <b>${total}</b> <em>${OUTCOME[kind].word}</em>`.value;
        $(".hm-outcome", root).textContent = OUTCOME[kind].text;
        result.hidden = false;
        hero.dataset.state = kind;
        rollBtn.querySelector("span")!.textContent = "Nochmal würfeln";
        rollBtn.disabled = false;
        rolling = false;
        if (offscreen) setTimeout(() => result.scrollIntoView({ behavior: "smooth", block: "center" }), 700);
      }

      root.querySelectorAll<HTMLElement>("[data-roll]").forEach((el) => {
        el.addEventListener("click", () => void roll());
        el.addEventListener("keydown", (e) => { if (el.tagName !== "BUTTON" && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); void roll(); } });
      });
      root.querySelector("[data-quick]")?.addEventListener("click", () => void quickStart());
      enhance(root);
    },
    leave() { die?.dispose(); die = null; },
  };
}
