// Lautstärke: zwei Regler (Musik, Sounds) – oben in der Leiste als kleines Menü und auf der Einstellungsseite.
import { playImpact, unlockAudio } from "../dice3d/audio";
import { html, type Raw } from "./dom";
import { icon } from "./icons";
import { onSettings, settings, updateSettings } from "./settings";

type Channel = "music" | "sound";
const CH: Record<Channel, { vol: "musicVolume" | "soundVolume"; label: string; hint: string }> = {
  music: { vol: "musicVolume", label: "Musik", hint: "Stimmungsmusik im Abenteuer" },
  sound: { vol: "soundVolume", label: "Sounds", hint: "Würfel, Fanfare bei der 20" },
};

/** Ein Regler mit Stumm-Knopf. Stumm = Schalter aus, der Regler behält seinen Wert. */
function row(ch: Channel): Raw {
  const s = settings(), on = s[ch], v = s[CH[ch].vol];
  return html`<div class="vol-row ${on ? "" : "muted-ch"}" data-ch="${ch}">
    <button class="icon-btn vol-mute" data-mute="${ch}" aria-label="${CH[ch].label} ${on ? "stumm schalten" : "einschalten"}" title="${on ? "Stumm schalten" : "Einschalten"}">${icon(on && v > 0 ? "sound" : "mute")}</button>
    <label class="vol-label"><b>${CH[ch].label}</b><small>${CH[ch].hint}</small>
      <input type="range" min="0" max="100" step="5" value="${v}" data-vol="${ch}" aria-label="Lautstärke ${CH[ch].label}">
    </label>
    <span class="vol-num">${on ? `${v} %` : "aus"}</span>
  </div>`;
}

export const volumeRows = (): Raw => html`<div class="vol-rows">${row("music")}${row("sound")}</div>`;

/** Regler in `root` verdrahten (Seite oder Menü). */
export function bindVolume(root: HTMLElement) {
  let lastClick = 0;
  root.addEventListener("input", (e) => {
    const r = (e.target as HTMLElement).closest<HTMLInputElement>("[data-vol]");
    if (!r) return;
    const ch = r.dataset.vol as Channel, v = Number(r.value);
    updateSettings({ [CH[ch].vol]: v, [ch]: v > 0 } as Partial<ReturnType<typeof settings>>);
    // Kurzes Klacken als Hörprobe (höchstens alle 150 ms)
    if (ch === "sound" && Date.now() - lastClick > 150) { lastClick = Date.now(); unlockAudio(); playImpact("table", 12); }
  });
  root.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-mute]");
    if (!b) return;
    const ch = b.dataset.mute as Channel, s = settings();
    const on = !s[ch];
    updateSettings({ [ch]: on, ...(on && s[CH[ch].vol] === 0 ? { [CH[ch].vol]: 60 } : {}) } as Partial<ReturnType<typeof settings>>);
  });
  // Anzeige aktuell halten, ohne die Regler neu zu bauen (sonst springt der Finger beim Ziehen)
  const off = onSettings(() => {
    if (!root.isConnected) { off(); return; }
    (["music", "sound"] as Channel[]).forEach((ch) => {
      const el = root.querySelector<HTMLElement>(`.vol-row[data-ch="${ch}"]`);
      if (!el) return;
      const s = settings(), on = s[ch], v = s[CH[ch].vol];
      el.classList.toggle("muted-ch", !on);
      el.querySelector(".vol-num")!.textContent = on ? `${v} %` : "aus";
      el.querySelector(".vol-mute")!.innerHTML = icon(on && v > 0 ? "sound" : "mute").value;
      const input = el.querySelector<HTMLInputElement>("[data-vol]")!;
      if (document.activeElement !== input) input.value = String(v);
    });
  });
}

let panel: HTMLElement | null = null;

/** Kleines Menü unter dem Lautsprecher-Knopf oben rechts. */
export function toggleVolumePanel(anchor: HTMLElement) {
  if (panel) { closePanel(); return; }
  panel = document.createElement("div");
  panel.className = "vol-panel card";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Lautstärke");
  panel.innerHTML = html`<div class="eyebrow">Lautstärke</div>${volumeRows()}`.value;
  document.body.append(panel);
  const r = anchor.getBoundingClientRect();
  panel.style.top = `${r.bottom + 8}px`;
  panel.style.right = `${Math.max(8, innerWidth - r.right)}px`;
  bindVolume(panel);
  setTimeout(() => { addEventListener("pointerdown", outside); addEventListener("keydown", onKey); });
}

function closePanel() {
  panel?.remove();
  panel = null;
  removeEventListener("pointerdown", outside);
  removeEventListener("keydown", onKey);
}
const outside = (e: Event) => { if (panel && !panel.contains(e.target as Node) && !(e.target as HTMLElement).closest("#sound-btn")) closePanel(); };
const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closePanel(); };
addEventListener("hashchange", closePanel);
