// Anmeldeseite: Benutzername und Passwort – mehr braucht es nicht. Erscheint, solange niemand angemeldet ist.
import { AccountApiError, downloadExport, exportData, login, register, SYNC_KEYS } from "../lib/account";
import { $, html, raw, setHTML } from "../lib/dom";
import { icon } from "../lib/icons";
import { applyPalette, logoSvg } from "../lib/palette";
import { settings } from "../lib/settings";
import { startEmbers } from "../fx/effects";

/** Spielstände aus der Zeit vor den Konten, die noch in diesem Browser liegen. */
function oldSaves(): { characters: number; campaigns: number; classes: number } | null {
  try {
    if (localStorage.getItem("wus.owner.v1")) return null;
    const n = (k: string) => { try { const v = JSON.parse(localStorage.getItem(k) ?? "[]"); return Array.isArray(v) ? v.length : 0; } catch { return 0; } };
    const r = { characters: n("wus.characters.v1"), campaigns: n("wus.campaigns.v1"), classes: n("wus.classes.v1") };
    return r.characters || r.campaigns || r.classes ? r : null;
  } catch { return null; }
}

export async function showLogin() {
  applyPalette(settings().palette);
  document.body.classList.add("auth");
  startEmbers($<HTMLCanvasElement>("#bg-embers"), () => settings().backgroundFx, () => settings().palette);
  const invite = await fetch("/api/config").then((r) => r.json()).then((c) => !!c.accessRequired).catch(() => false);
  const old = oldSaves();
  let mode: "login" | "register" = "login";
  const root = $("#app");

  const render = () => {
    setHTML(root, html`<div class="auth-wrap">
      <div class="auth-card card glow-border">
        <div class="auth-logo">${raw(logoSvg(settings().palette))}</div>
        <h1 class="auth-title">The Last <span>Ember</span></h1>
        <p class="auth-sub">Am letzten Feuer werden die besten Geschichten erzählt.</p>
        <div class="auth-tabs" role="tablist">
          <button role="tab" class="${mode === "login" ? "active" : ""}" aria-selected="${mode === "login"}" data-mode="login">Anmelden</button>
          <button role="tab" class="${mode === "register" ? "active" : ""}" aria-selected="${mode === "register"}" data-mode="register">Konto erstellen</button>
        </div>
        <form class="auth-form" id="auth-form" novalidate>
          <label class="field"><span>Benutzername</span><input class="input" id="auth-user" autocomplete="username" maxlength="24" required placeholder="z. B. Hedwig" /></label>
          <label class="field"><span>Passwort</span><input class="input" id="auth-pass" type="password" autocomplete="${mode === "login" ? "current-password" : "new-password"}" required placeholder="${mode === "register" ? "mindestens 8 Zeichen" : ""}" /></label>
          ${mode === "register" ? html`
            <label class="field"><span>Passwort wiederholen</span><input class="input" id="auth-pass2" type="password" autocomplete="new-password" required /></label>
            ${invite ? html`<label class="field"><span>Einladungscode</span><input class="input" id="auth-invite" autocomplete="off" required placeholder="Hast du von der Person, die dir die Seite gezeigt hat" /></label>` : ""}
            <p class="hint">${icon("info")} Es gibt keine E-Mail-Adresse – merke dir dein Passwort gut, es lässt sich nicht zurücksetzen.</p>` : ""}
          <p class="auth-error" id="auth-error" role="alert" hidden></p>
          <button class="btn btn-lg magnetic" type="submit" id="auth-submit">${icon(mode === "login" ? "arrowRight" : "sparkles")} ${mode === "login" ? "Anmelden" : "Konto erstellen"}</button>
        </form>
        ${old ? html`<div class="auth-old">
          <b>${icon("scroll")} Spielstände von früher gefunden</b>
          <p>In diesem Browser gefunden: ${[old.characters && `${old.characters} Figur${old.characters === 1 ? "" : "en"}`, old.campaigns && `${old.campaigns} Abenteuer`, old.classes && `${old.classes} eigene Klasse${old.classes === 1 ? "" : "n"}`].filter(Boolean).join(", ")}. Beim Anmelden kommen sie automatisch in dein Konto – im Browser wird dabei nichts gelöscht.</p>
          <button class="btn btn-ghost btn-sm" id="auth-backup">${icon("download")} Vorher als Datei sichern</button>
        </div>` : ""}
      </div>
    </div>`);
    root.querySelectorAll<HTMLElement>("[data-mode]").forEach((b) => b.addEventListener("click", () => { mode = b.dataset.mode as typeof mode; render(); }));
    root.querySelector("#auth-backup")?.addEventListener("click", () => {
      const data = Object.fromEntries(SYNC_KEYS.map((k) => [k, localStorage.getItem(k)]).filter(([, v]) => v !== null).map(([k, v]) => [k, JSON.parse(v!)]));
      downloadExport(exportData(data), "alte-spielstaende");
    });
    const form = $<HTMLFormElement>("#auth-form", root);
    $<HTMLInputElement>("#auth-user", root).focus();
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const user = $<HTMLInputElement>("#auth-user", root).value.trim();
      const pass = $<HTMLInputElement>("#auth-pass", root).value;
      const err = $("#auth-error", root);
      const fail = (m: string) => { err.textContent = m; err.hidden = false; };
      err.hidden = true;
      if (!user || !pass) return fail("Bitte Benutzername und Passwort eingeben.");
      if (mode === "register") {
        if (pass.length < 8) return fail("Das Passwort braucht mindestens 8 Zeichen.");
        if (pass !== $<HTMLInputElement>("#auth-pass2", root).value) return fail("Die beiden Passwörter sind nicht gleich.");
      }
      const btn = $<HTMLButtonElement>("#auth-submit", root);
      btn.disabled = true;
      btn.textContent = mode === "login" ? "Melde an …" : "Erstelle Konto …";
      try {
        if (mode === "login") await login(user, pass);
        else await register(user, pass, root.querySelector<HTMLInputElement>("#auth-invite")?.value.trim());
        location.reload();
      } catch (ex) {
        fail(ex instanceof AccountApiError || ex instanceof Error ? ex.message : "Das hat nicht geklappt.");
        btn.disabled = false;
        btn.innerHTML = html`${icon(mode === "login" ? "arrowRight" : "sparkles")} ${mode === "login" ? "Anmelden" : "Konto erstellen"}`.value;
      }
    });
  };
  render();
}
