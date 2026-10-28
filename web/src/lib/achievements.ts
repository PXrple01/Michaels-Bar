// Erfolge im Browser: aus Figuren, eigenen Klassen, Solo-Abenteuern und zuletzt gesehenen Gruppenständen prüfen,
// Neues mit einer kleinen Einblendung feiern. Gespeichert wird im Konto (wus.achievements.v1, siehe account.ts).
import { ACHIEVEMENTS, isDone, summarizeRun, type AchievementStats, type RunSummary } from "../../../shared/achievements";
import type { RollRecord } from "../../../shared/dice";
import type { PartyView } from "../../../shared/party";
import { campaignStore } from "./campaigns";
import { classStore } from "./customClasses";
import { $, fragment, html } from "./dom";
import { icon } from "./icons";
import { characterStore } from "./store";

const KEY = "wus.achievements.v1";
interface Saved { unlocked: Record<string, string>; parties: Record<string, RunSummary> }

function read(): Saved | null {
  try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function write(s: Saved) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* nur diese Sitzung */ } }

/** Alles, was für die Erfolge zählt. */
export function achievementStats(saved = read()): AchievementStats {
  const solo = campaignStore.list().map((c) => summarizeRun(c.state.world, c.characterId,
    c.story.flatMap((e) => (e.type === "roll" && !e.auto ? [e.record] : [])), c.story.filter((e) => e.type === "player").length, false));
  return { characters: characterStore.list().length, classes: classStore.list().length, runs: [...solo, ...Object.values(saved?.parties ?? {})] };
}

export const unlockedAchievements = () => read()?.unlocked ?? {};

/** Gruppenstand merken (die Gruppe liegt auf dem Server – so zählt sie auch später noch). */
export function noteParty(view: PartyView) {
  const me = view.players.find((p) => p.id === view.you);
  if (!me || view.status !== "playing") return;
  const rolls: RollRecord[] = view.story.flatMap((e) => (e.type === "roll" && !e.auto && e.playerId === me.id ? [e.record] : []));
  const turns = view.story.reduce((n, e) => n + (e.type === "actions" ? e.items.filter((i) => i.playerId === me.id).length : 0), 0);
  const run = summarizeRun(view.world, me.characterId, rolls, turns, true);
  const saved = read() ?? { unlocked: {}, parties: {} };
  if (JSON.stringify(saved.parties[view.code]) === JSON.stringify(run)) return;
  saved.parties[view.code] = run;
  write(saved);
  scheduleAchievementCheck();
}

let timer: ReturnType<typeof setTimeout> | undefined;
/** Etwas später prüfen (mehrere Speichervorgänge kurz hintereinander zählen als einer). */
export function scheduleAchievementCheck() {
  clearTimeout(timer);
  timer = setTimeout(checkAchievements, 700);
}

export function checkAchievements() {
  const prev = read();
  const saved: Saved = prev ?? { unlocked: {}, parties: {} };
  const stats = achievementStats(saved);
  const fresh = ACHIEVEMENTS.filter((a) => !saved.unlocked[a.id] && isDone(a, stats));
  if (!fresh.length) { if (!prev) write(saved); return; }
  const now = new Date().toISOString();
  for (const a of fresh) saved.unlocked[a.id] = now;
  write(saved);
  // Beim allerersten Prüfen (alter Fortschritt) nicht mit Einblendungen überschütten
  if (!prev && fresh.length > 2) celebrate(`${fresh.length} Erfolge freigeschaltet`, "Dein bisheriger Fortschritt zählt mit.", "crown");
  else fresh.slice(0, 3).forEach((a, i) => setTimeout(() => celebrate(a.name, a.text, a.icon), i * 1400));
}

/** Goldene Einblendung „Erfolg freigeschaltet“ – antippen öffnet die Erfolge. */
function celebrate(title: string, text: string, ico: string) {
  const host = document.querySelector("#toasts");
  if (!host) return;
  const el = fragment(html`<a class="toast achievement-toast" href="#/erfolge" role="status">
    <span class="at-medal">${icon(ico)}<i></i></span>
    <span class="at-text"><small>Erfolg freigeschaltet</small><b>${title}</b><span>${text}</span></span>
  </a>`);
  $("#toasts").append(el);
  setTimeout(() => { el.classList.add("out"); el.addEventListener("animationend", () => el.remove()); }, 6000);
}

addEventListener("wus:progress", scheduleAchievementCheck);
