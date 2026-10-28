// Wiederherstellungscode anzeigen: groß, zum Abschreiben, Kopieren oder als Datei – erst nach Bestätigung schließbar.
import { session } from "./account";
import { $, fragment, html } from "./dom";
import { icon } from "./icons";
import { toast } from "./ui";

export function showRecoveryCode(code: string, fresh = true): Promise<void> {
  return new Promise((resolve) => {
    const el = fragment(html`<div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Wiederherstellungscode">
      <div class="modal card glow-border recovery-modal">
        <div class="rc-icon">${icon("lock")}</div>
        <h3>Dein Wiederherstellungscode</h3>
        <p>${fresh ? "Hast du dein Passwort einmal vergessen, kannst du es mit diesem Code neu setzen." : "Dein neuer Code – der alte gilt ab sofort nicht mehr."} <b>Er wird nur jetzt angezeigt.</b> Schreib ihn auf oder speichere ihn an einem sicheren Ort.</p>
        <code class="rc-code" id="rc-code">${code}</code>
        <div class="rc-actions">
          <button class="btn btn-ghost btn-sm" id="rc-copy">${icon("scroll")} Kopieren</button>
          <button class="btn btn-ghost btn-sm" id="rc-file">${icon("download")} Als Datei speichern</button>
        </div>
        <label class="rc-check"><input type="checkbox" id="rc-ok" /> Ich habe den Code sicher aufgehoben.</label>
        <button class="btn" id="rc-done" disabled>${icon("check")} Fertig</button>
      </div>
    </div>`);
    const root = el as unknown as HTMLElement;
    const q = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
    q("#rc-copy").addEventListener("click", async () => { try { await navigator.clipboard.writeText(code); toast("Kopiert.", "success"); } catch { toast(code); } });
    q("#rc-file").addEventListener("click", () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([`The Last Ember – Wiederherstellungscode\n\nBenutzername: ${session()?.username ?? ""}\nCode: ${code}\n\nDamit setzt du auf der Anmeldeseite unter „Passwort vergessen?“ ein neues Passwort.\n`], { type: "text/plain" }));
      a.download = "the-last-ember-wiederherstellungscode.txt";
      document.body.append(a); a.click(); a.remove();
    });
    q<HTMLInputElement>("#rc-ok").addEventListener("change", (e) => { q<HTMLButtonElement>("#rc-done").disabled = !(e.target as HTMLInputElement).checked; });
    q("#rc-done").addEventListener("click", () => { root.remove(); resolve(); });
    $("#modal-root").append(el);
  });
}
