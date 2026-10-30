// Spielstand als Datei herunterladen und wieder einlesen (z. B. auf einem anderen Gerät oder in einem anderen Konto).
import type { CampaignSave } from "../../../shared/campaign";
import { makeSaveFile, parseSaveFile } from "../../../shared/saveFile";
import type { Character } from "../../../shared/schema";
import { campaignStore } from "./campaigns";
import { $, fragment, html, uuid } from "./dom";
import { streamGm } from "./gm";
import { characterStore } from "./store";
import { confirmDialog, toast } from "./ui";

const slug = (s: string) => s.toLowerCase().replace(/[äöüß]/g, (c) => ({ ä: "ae", ö: "oe", ü: "ue", ß: "ss" })[c]!).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "abenteuer";

export function exportSave(save: CampaignSave): boolean {
  const c = characterStore.get(save.characterId);
  if (!c) { toast("Die Figur zu diesem Abenteuer fehlt – ohne sie geht kein Export.", "error"); return false; }
  const blob = new Blob([JSON.stringify(makeSaveFile(c, save))], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${slug(save.title)}.ember.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast("Spielstand gespeichert. Einlesen geht über „Spielstand importieren“.", "success");
  return true;
}

/** Eigene Figur für ein vorbereitetes Abenteuer wählen. */
function pickCharacter(suggested: string, title: string): Promise<Character | null> {
  const chars = characterStore.list();
  if (!chars.length) { toast("Lege zuerst eine Figur an – mit ihr spielst du das Abenteuer.", "error", 7000); return Promise.resolve(null); }
  const match = chars.filter((c) => c.name.trim().toLowerCase() === suggested.trim().toLowerCase());
  const order = [...match, ...chars.filter((c) => !match.includes(c))];
  return new Promise((resolve) => {
    const el = fragment(html`
      <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Figur wählen">
        <div class="modal card glow-border">
          <h3>Mit welcher Figur?</h3>
          <p>„${title}“ ist ein vorbereitetes Abenteuer. Wähle die Figur, die es erleben soll.</p>
          <div class="pick-list">${order.map((c, i) => html`<button class="btn ${i === 0 && match.length ? "" : "btn-ghost"} btn-sm" data-pick="${c.id}">${c.name}${i === 0 && match.length ? " (vorgeschlagen)" : ""}</button>`)}</div>
          <div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="btn btn-ghost btn-sm" data-pick="">Abbrechen</button></div>
        </div>
      </div>`);
    const close = (c: Character | null) => { el.remove(); removeEventListener("keydown", onKey); resolve(c); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(null); };
    el.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-pick]");
      if (b) close(chars.find((c) => c.id === b.dataset.pick) ?? null);
      else if (e.target === el) close(null);
    });
    addEventListener("keydown", onKey);
    $("#modal-root").append(el);
    el.querySelector<HTMLButtonElement>("[data-pick]")?.focus();
  });
}

const sameCharacter = (a: Character, b: Character) => JSON.stringify({ ...a, updatedAt: "" }) === JSON.stringify({ ...b, updatedAt: "" });

/** Datei einlesen: Der Server prüft alles und signiert neu. Gibt die ID des neuen Abenteuers zurück (oder null). */
export async function importSaveFile(file: File): Promise<string | null> {
  const f = parseSaveFile(await file.text());
  if (typeof f === "string") { toast(f, "error", 7000); return null; }
  // Vorbereitetes Abenteuer ohne Figur: eine eigene wählen (passender Name wird vorgeschlagen)
  const own = !f.character;
  const character = f.character ?? (await pickCharacter(f.characterName ?? "", f.campaign.title));
  if (!character) return null;
  const local = characterStore.get(character.id);
  if (!own && local && !sameCharacter(local, character)
    && !(await confirmDialog("Figur überschreiben?", `„${character.name}“ gibt es bei dir schon in einer anderen Fassung. Mit dem Import wird sie durch die Figur aus der Datei ersetzt – deine anderen Abenteuer mit ihr passen dann womöglich nicht mehr.`, "Ersetzen", true))) return null;
  let id: string | null = null;
  await streamGm("import", { character, campaign: f.campaign }, (ev) => {
    if (ev.type === "error") { toast(ev.message, "error", 7000); return; }
    if (ev.type !== "imported") return;
    const now = new Date().toISOString();
    if (!own) characterStore.save({ ...character, updatedAt: now });
    const save: CampaignSave = {
      id: uuid(), characterId: character.id, title: ev.title, opening: ev.opening, openingSummary: ev.openingSummary,
      state: ev.state, pending: ev.pending, story: ev.story, started: true, costUsd: 0, imageUsd: 0, createdAt: now, updatedAt: now,
    };
    campaignStore.save(save);
    id = save.id;
    toast(ev.trusted ? "Spielstand importiert – es geht genau dort weiter." : "Spielstand importiert. Der Spielleiter kennt die Geschichte als Zusammenfassung und erzählt von dort weiter.", "success", 7000);
  });
  return id;
}
