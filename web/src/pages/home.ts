// Startseite: Die Seite ist selbst die erste Probe. Eine kurze Szene im Erzählstil des Spiels, der W20 daneben –
// ein Klick wirft ihn, er bleibt mit der geworfenen Zahl zum Betrachter liegen, eine Probenleiste zeigt, ob der Wurf
// samt Bonus die Schwierigkeit schafft, und die Geschichte schreibt sich passend weiter.
import { ACHIEVEMENTS } from "../../../shared/achievements";
import { unlockedAchievements } from "../lib/achievements";
import { legacySummary, summaryText } from "../lib/account";
import { playCrit, playFumble, playImpact, playSettle, unlockAudio } from "../dice3d/audio";
import { mountHeroDie, type HeroDie } from "../dice3d/heroDie";
import { burnAway } from "../fx/burn";
import { enhance } from "../fx/effects";
import { burst, calmMotion, countTo, embers, igniteTitle, inkWords, onceInView, sleep, type BurstKind } from "../fx/homeMotion";
import { $, html, setHTML } from "../lib/dom";
import { term } from "../lib/glossary";
import { diceShape, icon } from "../lib/icons";
import { go, type Page } from "../lib/router";
import { quickStart } from "../lib/quickstart";
import { settings } from "../lib/settings";

const DC = 13, BONUS = 2, SCALE_MAX = 22;
/** Stelle eines Werts auf der Probenleiste (1 bis 22) in Prozent. */
const at = (v: number) => ((Math.max(1, Math.min(SCALE_MAX, v)) - 1) / (SCALE_MAX - 1)) * 100;

/** Wie die Kletterei ausgeht – genau so, wie der Spielleiter im Spiel weitererzählt. */
const OUTCOME: Record<BurstKind, { word: string; text: string }> = {
  crit: { word: "Kritischer Erfolg", text: "Du fliegst förmlich über die Zinnen. Unten im Hof stehen drei Söldner um einen gefesselten Abt – und keiner von ihnen hat dich bemerkt." },
  hit: { word: "Geschafft", text: "Du ziehst dich über die Zinnen. Unten im Hof stehen drei Söldner um einen gefesselten Abt. Einer dreht sich langsam zu deiner Mauer um …" },
  miss: { word: "Nicht geschafft", text: "Ein Stein bricht unter deinem Stiefel. Du landest unsanft im Gras, und hinter der Mauer verstummt der Gesang. Jemand hat dich gehört." },
  fumble: { word: "Patzer", text: "Du rutschst ab, reißt eine Ranke mit dir und landest scheppernd vor dem Tor. Drinnen schlägt ein Hund an, Fackeln kommen näher." },
};

const DICE = [
  { sides: 4, name: "W4", use: "Dolch", r: -14 },
  { sides: 6, name: "W6", use: "Speer", r: 9 },
  { sides: 8, name: "W8", use: "Langschwert", r: -6 },
  { sides: 20, name: "W20", use: "Jede Probe, jeder Angriff", r: 0 },
  { sides: 10, name: "W10", use: "Armbrust", r: 12 },
  { sides: 12, name: "W12", use: "Zweihänder", r: -10 },
  { sides: 100, name: "W100", use: "Zufall", r: 5 },
];

const ROUTE = [
  { t: "Figur erschaffen", d: "Herkunft, Klasse, ein Gesicht. Ein Assistent führt dich, oder der Schnellstart würfelt dir eine Figur aus.", href: "#/figur/neu", cta: "Figur erschaffen" },
  { t: "Zuhören und handeln", d: "Claude erzählt als Spielleiter. Du schreibst in eigenen Worten, was du tust – allein oder mit Freunden in einer Gruppe.", href: "#/abenteuer", cta: "Abenteuer ansehen" },
  { t: "Würfeln, wenn es knifflig wird", d: "Ein W20 plus dein Bonus gegen die Schwierigkeit. Gelingt es nicht, wird die Geschichte trotzdem weitergehen – nur anders.", href: "#/lernen", cta: "In fünf Minuten lernen" },
];

function secureRoll(sides: number): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return (a[0] % sides) + 1;
}

export function homePage(): Page {
  let die: HeroDie | null = null;
  return {
    async render(root) {
      const achieved = Object.keys(unlockedAchievements()).length;
      const calm = calmMotion();
      setHTML(root, html`
        ${legacySummary() ? html`<div class="container"><div class="legacy-banner">${icon("scroll")}<p><b>Spielstände von früher gefunden:</b> ${summaryText(legacySummary()!)}. Übernimm sie mit einem Klick in dein Konto.</p><a class="btn btn-sm" href="#/einstellungen">${icon("arrowRight")} Zur Übernahme</a></div></div>` : ""}

        <section class="hm-hero container" data-state="idle">
          <div class="hm-copy">
            <h1 class="hm-title">The Last Ember</h1>
            <p class="hm-pitch">Ein Erzähl-Abenteuer im Mittelalter. Claude erzählt, du entscheidest, die Würfel urteilen. Neu dabei? <a href="#/lernen">In fünf Minuten zeigen wir dir, wie es geht.</a></p>

            <div class="hm-scene" aria-live="polite">
              <span class="hm-glowline" aria-hidden="true"></span>
              <span class="hm-quill" aria-hidden="true">${icon("feather")}</span>
              <p class="hm-intro">Nebel hängt über dem Kloster. Hinter der Mauer singen Mönche – und dazwischen klirren Waffen. Du willst hinüber, aber die Steine sind feucht und glatt.</p>
              <p class="hm-ask">Mach eine ${term("probe")} auf Klettern. Du brauchst mindestens <b>${DC}</b>, dein ${term("bonus")} ist <b>+${BONUS}</b>.</p>
              <div class="hm-result" hidden>
                <div class="hm-meter" aria-hidden="true">
                  <div class="hm-track">
                    <span class="hm-fill"></span>
                    <span class="hm-gap"><small></small></span>
                    <span class="hm-dc" style="--at:${at(DC)}%"><small>${DC} nötig</small></span>
                    <span class="hm-you"><b>1</b><i class="hm-plus">+${BONUS}</i></span>
                  </div>
                  <div class="hm-ends"><span>1</span><span>${SCALE_MAX}</span></div>
                </div>
                <p class="hm-sum"></p>
                <p class="hm-outcome"></p>
                <p class="hm-moral">So geht es im Spiel weiter – nur entscheidest dort du, was als Nächstes passiert.</p>
              </div>
              <button class="btn hm-roll is-calling" data-roll>${icon("dice")} <span>Würfeln</span></button>
            </div>

            <div class="hm-cta">
              <a class="btn btn-lg magnetic glow-border hm-start" href="#/abenteuer">${icon("scroll")} Abenteuer beginnen</a>
              <button class="btn btn-ghost btn-lg" data-quick title="Zufällige Figur, sofort losspielen">${icon("dice")} Schnellstart</button>
              <a class="hm-textlink" href="#/figur/neu">Eigene Figur erschaffen</a>
            </div>
            ${achieved ? html`<a class="ach-link" href="#/erfolge">${icon("crown")} Erfolge <b>${achieved} / ${ACHIEVEMENTS.length}</b></a>` : ""}
          </div>

          <div class="hm-fire">
            <div class="hm-embers" aria-hidden="true"></div>
            <div class="hm-die" data-roll role="button" tabindex="0" aria-label="W20 werfen"></div>
            <output class="hm-number" aria-hidden="true"></output>
          </div>
        </section>

        <section class="hm-route container" aria-labelledby="route-title">
          <h2 id="route-title">Ein Abend am Feuer</h2>
          <div class="hm-path">
            <ol class="hm-stations">
              ${ROUTE.map((r, i) => html`
                <li class="hm-station" style="--i:${i}">
                  <span class="hm-mark" aria-hidden="true">${i + 1}</span>
                  <h3>${r.t}</h3>
                  <p>${r.d}</p>
                  <a href="${r.href}">${r.cta}</a>
                </li>`)}
            </ol>
            <span class="hm-traveler" aria-hidden="true"></span>
          </div>
        </section>

        <section class="hm-bag container" aria-labelledby="bag-title">
          <div class="hm-bag-text">
            <h2 id="bag-title">Der Würfelbeutel</h2>
            <p>„W“ heißt Würfel, die Zahl dahinter verrät die Seiten. „2W6“ bedeutet also: zwei sechsseitige Würfel. Meist brauchst du nur den W20 – die anderen bestimmen, wie hart eine Waffe trifft.</p>
            <p class="hm-hint">Tipp einen Würfel an – er zeigt dir, welche Zahlen er werfen kann.</p>
            <a class="btn btn-ghost" href="#/wuerfel">${icon("dice")} Zum Würfeltisch</a>
          </div>
          <ul class="hm-table">
            ${DICE.map((d, i) => html`<li class="hm-d ${d.sides === 20 ? "is-main" : ""}" style="--i:${i};--r:${d.r}deg">
              <button class="hm-dbtn" data-sides="${d.sides}" aria-label="${d.name} werfen (1 bis ${d.sides})">
                <span class="hm-badge" aria-live="polite"></span>${diceShape(d.sides)}<b>${d.name}</b><span>${d.use}</span>
              </button></li>`)}
          </ul>
        </section>

        <section class="hm-seal container">
          <div class="hm-wax" aria-hidden="true" title="Nochmal siegeln">${icon("lock")}</div>
          <div class="hm-seal-text">
            <h2>Jeder Wurf ist besiegelt</h2>
            <p>Im Abenteuer würfelt der Server mit kryptografischem Zufall, <em>bevor</em> die Animation beginnt, und der 3D-Würfel rollt dann genau auf diese Zahl. Weder du noch die Webseite noch der Spielleiter kann ein Ergebnis ändern oder neu würfeln.</p>
          </div>
        </section>

        <footer class="footer container">The Last Ember – am letzten Feuer werden die besten Geschichten erzählt.</footer>
      `);

      root.classList.toggle("hm-calm", calm);
      const hero = $(".hm-hero", root);
      const quill = $(".hm-quill", root), glowline = $(".hm-glowline", root);
      const fire = $(".hm-fire", root);
      const number = $(".hm-number", root);
      const result = $(".hm-result", root);
      const meter = $(".hm-meter", root);
      const rollBtn = $<HTMLButtonElement>(".hm-roll", root);
      die = mountHeroDie($(".hm-die", root));

      // ── Auftakt: Titel fängt Feuer, Würfel fällt in die Glut, die Szene schreibt sich ──
      igniteTitle($(".hm-title", root), 150);
      embers($(".hm-embers", root));
      let quillY = 0, writingUntil = 0;
      /** Feder (und die glühende Linie) bis zum Ende eines Elements wandern lassen. */
      const quillTo = (el: HTMLElement, ms: number, delay = 0) => {
        const y = Math.max(0, el.offsetTop + el.offsetHeight - 22);
        if (calm) { quill.style.transform = `translateY(${y}px)`; glowline.style.height = `${y + 20}px`; quillY = y; return; }
        quill.animate([{ transform: `translateY(${quillY}px)` }, { transform: `translateY(${y}px)` }], { duration: ms, delay, easing: "linear", fill: "forwards" });
        writingUntil = Math.max(writingUntil, performance.now() + delay + ms);
        setTimeout(() => quill.classList.add("is-writing"), delay);
        setTimeout(() => { if (performance.now() >= writingUntil - 30) quill.classList.remove("is-writing"); }, delay + ms);
        glowline.animate([{ height: `${quillY + 20}px` }, { height: `${y + 20}px` }], { duration: ms, delay, easing: "linear", fill: "forwards" });
        quillY = y;
      };
      if (!calm) {
        const intro = $(".hm-intro", root), ask = $(".hm-ask", root);
        const endIntro = inkWords([intro], 900, 26);
        const end = inkWords([ask], endIntro + 120, 26);
        quillTo(intro, endIntro - 900, 900);
        quillTo(ask, end - endIntro, endIntro + 120);
        rollBtn.style.setProperty("--call-delay", `${end + 400}ms`);
      } else quillTo($(".hm-ask", root), 0);

      // ── Der Wurf ──
      let rolling = false;
      async function roll() {
        if (rolling || !die) return;
        rolling = true;
        rollBtn.disabled = true;
        rollBtn.classList.remove("is-calling");
        hero.dataset.state = "rolling";
        result.hidden = true;
        result.classList.remove("is-done");
        meter.className = "hm-meter";
        const sound = settings().sound;
        if (sound) { unlockAudio(); [0, 160, 330].forEach((ms, i) => setTimeout(() => playImpact(i === 1 ? "die" : "table", 13 - i * 3), ms)); }
        // Liegt der Würfel gerade außerhalb des Bildes (Handy, unten auf „Würfeln“ getippt), erst zu ihm hin
        const r = fire.getBoundingClientRect();
        const offscreen = r.bottom < 60 || r.top > innerHeight - 60;
        if (offscreen) fire.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "center" });
        const n = secureRoll(20);
        await die.roll(n);
        const total = n + BONUS;
        const kind: BurstKind = n === 20 ? "crit" : n === 1 ? "fumble" : total >= DC ? "hit" : "miss";

        // Aufprall: Glut lodert auf, Funken oder Rauch, die Zahl glimmt hinter dem Würfel
        fire.classList.remove("is-flare", "is-shake"); void fire.offsetWidth;
        fire.classList.add("is-flare");
        if (kind === "fumble") fire.classList.add("is-shake");
        burst(fire, kind);
        if (sound) { playSettle(); if (kind === "crit") playCrit(); if (kind === "fumble") playFumble(); }
        number.textContent = String(n);
        hero.dataset.state = kind;

        // Probenleiste: erst der Würfel, dann schiebt der Bonus nach – reicht es bis zur Schwierigkeit?
        const you = $(".hm-you b", meter), gap = $(".hm-gap", meter);
        $(".hm-sum", root).innerHTML = "";
        $(".hm-outcome", root).textContent = "";
        meter.style.setProperty("--x", "0%");
        result.hidden = false;
        if (offscreen) setTimeout(() => result.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "center" }), calm ? 0 : 500);
        quillTo(meter, 300);
        await sleep(350);
        meter.classList.add("is-roll");
        meter.style.setProperty("--x", `${at(n)}%`);
        countTo(you, 1, n, 650);
        await sleep(900);
        meter.classList.add("is-bonus");
        await sleep(380);
        meter.style.setProperty("--x", `${at(total)}%`);
        countTo(you, n, total, 450);
        await sleep(600);
        const pass = kind === "crit" || kind === "hit";
        const diff = Math.abs(total - DC);
        gap.style.setProperty("--from", `${at(Math.min(total, DC))}%`);
        gap.style.setProperty("--to", `${at(Math.max(total, DC))}%`);
        $("small", gap).textContent = pass ? (diff ? `${diff} über der Schwierigkeit` : "genau geschafft") : `es fehlen ${diff}`;
        meter.classList.add(pass ? "is-pass" : "is-fail", `is-${kind}`);

        // Ergebnis und Fortsetzung der Geschichte
        $(".hm-sum", root).innerHTML = html`<span>${n}</span> gewürfelt + <span>${BONUS}</span> Bonus = <b>${total}</b> <em>${OUTCOME[kind].word}</em>`.value;
        const outcome = $(".hm-outcome", root);
        // Text und Wort-Hüllen im selben Schritt setzen – sonst stünde der Satz kurz komplett da, bevor er sich schreibt
        outcome.textContent = OUTCOME[kind].text;
        const inkEnd = calm ? 0 : inkWords([outcome], 300, 30);
        result.style.setProperty("--moral-delay", `${inkEnd + 200}ms`);
        result.classList.add("is-done");
        quillTo(outcome, inkEnd - 300, 300);
        rollBtn.querySelector("span")!.textContent = "Nochmal würfeln";
        rollBtn.disabled = false;
        rolling = false;
      }

      root.querySelectorAll<HTMLElement>("[data-roll]").forEach((el) => {
        el.addEventListener("click", () => void roll());
        el.addEventListener("keydown", (e) => { if (el.tagName !== "BUTTON" && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); void roll(); } });
      });

      // ── Abenteuer beginnen: die Seite brennt vom Knopf aus weg ──
      const start = $<HTMLAnchorElement>(".hm-start", root);
      start.addEventListener("click", (e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        const b = start.getBoundingClientRect();
        void burnAway({ x: b.left + b.width / 2, y: b.top + b.height / 2 }, () => go("/abenteuer"));
      });
      root.querySelector("[data-quick]")?.addEventListener("click", () => void quickStart());

      // ── Weiter unten: Route, Würfelbeutel, Siegel – jeweils, sobald sie ins Bild kommen ──
      onceInView($(".hm-path", root), () => $(".hm-route", root).classList.add("is-live"));
      onceInView($(".hm-table", root), () => $(".hm-bag", root).classList.add("is-live"), 0.4);
      const seal = $(".hm-seal", root), wax = $(".hm-wax", root);
      const stamp = () => {
        seal.classList.remove("is-live"); void seal.offsetWidth; seal.classList.add("is-live");
        if (settings().sound && !calm) setTimeout(() => { unlockAudio(); playImpact("table", 20); }, 380);
      };
      onceInView(seal, () => seal.classList.add("is-live"), 0.6);
      wax.addEventListener("click", stamp);

      root.querySelectorAll<HTMLButtonElement>(".hm-dbtn").forEach((b) => b.addEventListener("click", () => {
        const sides = Number(b.dataset.sides);
        const badge = $(".hm-badge", b);
        b.classList.remove("is-rolling", "is-shown"); void b.offsetWidth;
        b.classList.add("is-rolling");
        if (settings().sound) { unlockAudio(); playImpact("die", 10); }
        setTimeout(() => { badge.textContent = String(secureRoll(sides)); b.classList.add("is-shown"); }, calm ? 0 : 520);
      }));
      enhance(root);
    },
    leave() { die?.dispose(); die = null; },
  };
}
