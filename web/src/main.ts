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

import { $, html, raw } from "./lib/dom";
import { applyPalette, logoSvg } from "./lib/palette";
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
  return raw(logoSvg(settings().palette));
}

function renderChrome() {
  const sound = settings().sound;
  $("#topbar").innerHTML = html`
    <a class="logo" href="#/">${logoMark()}<span>The Last <span class="amp">Ember</span></span></a>
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

applyPalette(settings().palette);
renderChrome();
let lastTheme = settings().diceTheme;
onSettings((s) => {
  applyPalette(s.palette);
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

startEmbers($<HTMLCanvasElement>("#bg-embers"), () => settings().backgroundFx, () => settings().palette);
startCursorGlow($("#cursor-glow"));
initTooltips();

// Würfeltexturen erst zeichnen, wenn die Schrift geladen ist (höchstens 1,5 s warten)
void Promise.race([document.fonts.load('700 64px "Cinzel"'), new Promise((r) => setTimeout(r, 1500))]).then(() => {
  clearDieCache();
  startRouter($("#app"), setActive);
});
