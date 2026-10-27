import "@fontsource/cinzel/500.css";
import "@fontsource/cinzel/700.css";
import "@fontsource/cinzel-decorative/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/pages.css";

import { $, html } from "./lib/dom";
import { icon } from "./lib/icons";
import { route, startRouter } from "./lib/router";
import { onSettings, settings, updateSettings } from "./lib/settings";
import { initTooltips } from "./lib/ui";
import { startCursorGlow, startEmbers } from "./fx/effects";
import { clearDieCache } from "./dice3d/textures";
import { homePage } from "./pages/home";
import { learnPage } from "./pages/learn";
import { charactersPage } from "./pages/characters";
import { createPage } from "./pages/create";
import { sheetPage } from "./pages/sheet";
import { tablePage } from "./pages/table";
import { settingsPage } from "./pages/settings";
import { adventuresPage, playPage } from "./pages/adventure";
import { classEditorPage, classesPage } from "./pages/classes";
import { partyHomePage, partyPage } from "./pages/party";

const NAV = [
  { id: "home", href: "#/", label: "Start", icon: "home" },
  { id: "learn", href: "#/lernen", label: "Lernen", icon: "book" },
  { id: "chars", href: "#/figuren", label: "Figuren", icon: "users" },
  { id: "adventure", href: "#/abenteuer", label: "Abenteuer", icon: "scroll" },
  { id: "table", href: "#/wuerfel", label: "Würfeltisch", icon: "dice" },
  { id: "settings", href: "#/einstellungen", label: "Einstellungen", icon: "settings" },
];

function logoMark() {
  return html`<svg class="logo-mark" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ddd6fe"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs><polygon points="32,3 57,17.5 57,46.5 32,61 7,46.5 7,17.5" fill="#0d0a14" stroke="url(#lg)" stroke-width="2.5"/><polygon points="32,15 47,41 17,41" fill="none" stroke="url(#lg)" stroke-width="2"/><path d="M32 3v12M57 17.5 47 41M7 17.5 17 41M32 61 17 41M32 61l15-20" stroke="url(#lg)" stroke-width="1.2" opacity=".6"/><text x="32" y="36.5" font-family="Cinzel,serif" font-weight="700" font-size="12" text-anchor="middle" fill="#ede9fe">20</text></svg>`;
}

function renderChrome() {
  const sound = settings().sound;
  $("#topbar").innerHTML = html`
    <a class="logo" href="#/">${logoMark()}<span>Michaels <span class="amp">Bar</span></span></a>
    <nav class="nav" aria-label="Hauptnavigation">
      ${NAV.map((n) => html`<a href="${n.href}" data-nav="${n.id}">${icon(n.icon)}<span>${n.label}</span></a>`)}
    </nav>
    <a class="icon-btn mobile-only" href="#/einstellungen" aria-label="Einstellungen" data-nav="settings">${icon("settings")}</a>
    <button class="icon-btn" id="sound-btn" aria-label="${sound ? "Ton ausschalten" : "Ton einschalten"}" title="Würfelgeräusche">${icon(sound ? "sound" : "mute")}</button>`.value;
  $("#tabbar").innerHTML = html`${NAV.filter((n) => n.id !== "settings").map((n) => html`<a href="${n.href}" data-nav="${n.id}">${icon(n.icon)}<span>${n.id === "table" ? "Würfel" : n.id === "settings" ? "Optionen" : n.label}</span></a>`)}`.value;
  $("#sound-btn").addEventListener("click", () => updateSettings({ sound: !settings().sound }));
}

let activeNav = "home";
function setActive(nav: string) {
  activeNav = nav;
  document.querySelectorAll<HTMLElement>("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === nav));
}

route("/", "home", homePage);
route("/lernen", "learn", learnPage);
route("/figuren", "chars", charactersPage);
route("/figur/neu", "chars", createPage);
route("/figur/:id", "chars", sheetPage);
route("/wuerfel", "table", tablePage);
route("/abenteuer", "adventure", adventuresPage);
route("/klassen", "chars", classesPage);
route("/gruppe", "adventure", partyHomePage);
route("/gruppe/:code", "adventure", partyPage);
route("/klassen/neu", "chars", classEditorPage);
route("/klassen/:id/:mode", "chars", classEditorPage);
route("/abenteuer/:id", "adventure", playPage);
route("/einstellungen", "settings", settingsPage);

renderChrome();
let lastTheme = settings().diceTheme;
onSettings((s) => {
  renderChrome();
  setActive(activeNav);
  document.body.classList.toggle("calm", !s.backgroundFx);
  if (s.diceTheme !== lastTheme) { lastTheme = s.diceTheme; clearDieCache(); }
});
document.body.classList.toggle("calm", !settings().backgroundFx);

// Kopfleiste beim Runterscrollen ausblenden, beim Hochscrollen zeigen
let lastY = 0;
addEventListener("scroll", () => {
  const y = scrollY;
  $("#topbar").classList.toggle("hide", y > 120 && y > lastY);
  lastY = y;
}, { passive: true });

startEmbers($<HTMLCanvasElement>("#bg-embers"), () => settings().backgroundFx);
startCursorGlow($("#cursor-glow"));
initTooltips();

// Würfeltexturen erst zeichnen, wenn die Schrift geladen ist (höchstens 1,5 s warten)
void Promise.race([document.fonts.load('700 64px "Cinzel"'), new Promise((r) => setTimeout(r, 1500))]).then(() => {
  clearDieCache();
  startRouter($("#app"), setActive);
});
