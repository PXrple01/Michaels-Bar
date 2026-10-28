import { checkClass } from "../../../shared/classbuilder";
import { MAX_REVIEW_ROUNDS, type ClassDraftInput, type ReviewEvent, type ReviewResult, type SignedClass } from "../../../shared/classreview";
import { classSchema, type ClassDef } from "../../../shared/schema";
import { enhance } from "../fx/effects";
import { api, ApiError, loadGameData, type GameData } from "../lib/api";
import { classStore } from "../lib/customClasses";
import { $, $$, html, setHTML, uuid, type Raw } from "../lib/dom";
import { setAccessCode, streamSse } from "../lib/gm";
import { term } from "../lib/glossary";
import { modsChips } from "../lib/attrMods";
import { icon, sigil } from "../lib/icons";
import { go, type Page } from "../lib/router";
import { confirmDialog, toast } from "../lib/ui";

const USES: Record<string, string> = { passiv: "immer aktiv", einmal_pro_kampf: "1× pro Kampf", einmal_pro_rast: "1× pro Rast", einmal_pro_tag: "1× pro Tag", beliebig: "beliebig oft" };
const VERDICT: Record<string, { label: string; cls: string }> = {
  zu_schwach: { label: "eher zu schwach", cls: "gold" }, ausgewogen: { label: "ausgewogen", cls: "good" }, zu_stark: { label: "zu stark", cls: "bad" },
};
const EXAMPLE = "Ein Glockengießer, der mit schweren Hämmern umgehen kann und die Kirchenglocken seines Dorfes gegossen hat. Er hält viel aus, ist aber langsam. Einmal pro Kampf kann er einen Schlag führen, der dröhnt wie eine Glocke und Gegner kurz benommen macht. Er erkennt Metalle und kann Werkzeug reparieren.";

function download(name: string, content: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function classPreview(cls: ClassDef, data: GameData, costs?: { label: string; points: number }[]): Raw {
  const skill = (id: string) => data.rules.skills.find((s) => s.id === id)?.name ?? id;
  const costOf = (name: string) => costs?.find((c) => c.label === `Fähigkeit „${name}“`)?.points;
  const modsPoints = costs?.find((c) => c.label.startsWith("Grundwerte"))?.points;
  return html`<div class="class-preview">
    <div class="cp-head">
      <div class="cp-sigil">${sigil(cls.sigil, "draw")}</div>
      <div><h3>${cls.name}</h3><div class="class-role">${cls.role}</div><p class="tagline">„${cls.tagline}“</p></div>
    </div>
    <p>${cls.description}</p>
    <div class="cd-stats">
      <div><span>${term("trefferwuerfel")}</span><b>W${cls.hitDie}</b></div>
      <div><span>Rüstung</span><b>${cls.armor.join(", ") || "keine"}</b></div>
      <div><span>Grundwerte${modsPoints !== undefined ? ` (${modsPoints} P)` : ""}</span><b>${modsChips(cls.attributeMods, data.rules)}</b></div>
      <div><span>Geübt</span><b>${cls.trainedSkills.map(skill).join(", ") || "—"}</b></div>
      <div><span>Zur Wahl (${cls.skillChoices.count})</span><b>${cls.skillChoices.from.map(skill).join(", ") || "—"}</b></div>
    </div>
    <div class="abilities">
      ${cls.abilities.map((a) => html`<details class="ability">
        <summary><b>${a.name}</b><span class="chip">${USES[a.uses] ?? a.uses}</span>${a.magic ? html`<span class="chip">${icon("wand")} Magie</span>` : ""}${costOf(a.name) !== undefined ? html`<span class="chip gold">${costOf(a.name)} P</span>` : ""}<span>${a.beginnerText}</span></summary>
        <p class="rule-text">${icon("scroll")} ${a.text}</p>
      </details>`)}
    </div>
  </div>`;
}

/* ───────────── Übersicht ───────────── */

export function classesPage(): Page {
  return {
    async render(root) {
      const data = await loadGameData();
      const list = classStore.list();
      setHTML(root, html`
        <div class="container classes">
          <header class="page-head" data-reveal>
            <div class="eyebrow">Selbst gemacht</div>
            <h1>Eigene Klassen</h1>
            <p class="lead">Beschreibe eine Klasse in eigenen Worten. Claude macht daraus Spielwerte und bewertet sie – ein Regelprogramm prüft danach streng das Punktebudget. Erst wenn du bestätigst, wird die Klasse spielbar.</p>
          </header>
          <div class="process" data-reveal>
            ${[["quill", "Du beschreibst", "Freitext oder Formular"], ["sparkles", "Claude begutachtet", "Werte, Stärke, Probleme, Vorschläge"], ["shield", "Der Code entscheidet", `Budget ${data.rules.classBuilder.pointBudgetPerLevel[0]} Punkte, harte Grenzen`], ["check", "Du bestätigst", "Dann ist die Klasse spielbar"]]
              .map(([i, t, d], n) => html`<div class="proc-step" style="--i:${n}"><span>${icon(i)}</span><b>${t}</b><small>${d}</small></div>`)}
          </div>
          <div class="toolbar">
            <a class="btn magnetic glow-border" href="#/klassen/neu">${icon("plus")} Neue Klasse</a>
            <label class="btn btn-ghost">${icon("download")} Importieren<input type="file" accept=".json,application/json" id="import" hidden /></label>
          </div>
          ${list.length ? html`<div class="char-grid">
            ${list.map((s, i) => {
              const check = checkClass(s.cls, data.rules, data.campaign.magic_level);
              return html`<article class="card adv-card tilt" data-reveal="scale" style="--i:${i}">
                <div class="char-sigil">${sigil(s.cls.sigil, "draw")}</div>
                <h3>${s.cls.name}</h3>
                <p class="muted">${s.cls.role} · W${s.cls.hitDie} · ${check.cost.total} von ${check.cost.budget} Punkten</p>
                <div class="adv-actions">
                  <a class="btn btn-sm" href="#/klassen/${s.cls.id}/bearbeiten">${icon("quill")} Bearbeiten</a>
                  <a class="btn btn-ghost btn-sm" href="#/klassen/${s.cls.id}/kopieren" title="Kopieren">${icon("plus")}</a>
                  <button class="btn btn-ghost btn-sm" data-export="${s.cls.id}" title="Als Datei exportieren">${icon("download")}</button>
                  <button class="btn btn-ghost btn-sm" data-delete="${s.cls.id}" title="Löschen">${icon("trash")}</button>
                </div>
              </article>`;
            })}
          </div>` : html`<div class="card empty" data-reveal><p>Noch keine eigene Klasse. Wie wäre es mit einem Glockengießer, einer Schmugglerin oder einem Rattenfänger?</p></div>`}
          <p class="hint center" style="margin-top:24px">Eigene Klassen werden in deinem Konto gespeichert. Exportierte Klassen-Dateien kannst du auch weitergeben.</p>
        </div>`);

      root.addEventListener("click", async (e) => {
        const t = e.target as HTMLElement;
        const exp = t.closest<HTMLElement>("[data-export]");
        if (exp) {
          const s = classStore.get(exp.dataset.export!)!;
          download(`klasse-${s.cls.name.toLowerCase().replace(/[^a-z0-9äöüß]+/g, "-")}.json`, JSON.stringify(s, null, 2));
        }
        const del = t.closest<HTMLElement>("[data-delete]");
        if (del && (await confirmDialog("Klasse löschen?", "Figuren, die schon mit dieser Klasse erschaffen wurden, bleiben spielbar – sie tragen eine Kopie.", "Löschen", true))) {
          classStore.remove(del.dataset.delete!);
          go("/klassen");
        }
      });
      $<HTMLInputElement>("#import", root).addEventListener("change", async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        let parsed: unknown;
        try { parsed = JSON.parse(await file.text()); } catch { toast("Die Datei ist kein gültiges JSON.", "error"); return; }
        try {
          const res = await api.verifyClass(parsed);
          classStore.save({ cls: res.cls, sig: (parsed as SignedClass).sig });
          toast(`„${res.cls.name}“ importiert.`, "success");
          go("/klassen");
        } catch (err) {
          const cls = classSchema.safeParse((parsed as { cls?: unknown })?.cls ?? parsed);
          if (cls.success) {
            sessionStorage.setItem("wus.importDraft", JSON.stringify(cls.data));
            toast("Die Klasse stammt nicht von dieser Seite – lass sie hier neu bewerten.");
            go("/klassen/neu");
          } else toast((err as Error).message, "error");
        }
      });
      enhance(root);
    },
  };
}

/* ───────────── Editor mit Gutachten ───────────── */

export function classEditorPage(): Page {
  return {
    async render(root, params) {
      const data = await loadGameData();
      const mode = params.mode as "bearbeiten" | "kopieren" | undefined;
      const existing = params.id ? classStore.get(params.id) : null;
      let imported: ClassDef | null = null;
      try { const raw = sessionStorage.getItem("wus.importDraft"); if (raw && !existing) { imported = JSON.parse(raw); sessionStorage.removeItem("wus.importDraft"); } } catch { /* egal */ }
      let base: ClassDef | null = existing ? structuredClone(existing.cls) : imported;
      if (base && mode === "kopieren") base = { ...base, name: `${base.name} (Kopie)` };

      const draftId = uuid();
      let round = 0;
      let token: string | null = null;
      let result: ReviewResult | null = null;
      let busy = false;
      let error: string | null = null;
      let needsCode = false;

      setHTML(root, html`
        <div class="container class-editor">
          <header class="page-head" data-reveal>
            <a class="link-arrow back" href="#/klassen">${icon("arrowLeft")} Eigene Klassen</a>
            <h1>${existing && mode !== "kopieren" ? `„${existing.cls.name}“ bearbeiten` : base ? "Klasse überarbeiten" : "Neue Klasse"}</h1>
          </header>
          <div class="editor-grid">
            <section class="card editor-input" data-reveal>
              <div class="field">
                <label for="freitext" id="freitext-label">${base ? "Was soll sich ändern? (leer lassen für eine neue Bewertung)" : "Beschreibe deine Klasse"}</label>
                <textarea class="textarea" id="freitext" rows="8" maxlength="3000" placeholder="${base ? "z. B. „Etwas mehr Rüstung, dafür weniger Schaden“" : "Wer ist sie, was kann sie besonders gut, wo ist sie schwach? Fähigkeiten gern mit Häufigkeit („einmal pro Kampf“)."}"></textarea>
              </div>
              ${base ? html`<div class="callout slim">${icon("info")}<p>Grundlage ist „${base.name}“. Claude arbeitet daran weiter.</p></div>` : html`<button class="btn btn-ghost btn-sm" id="example">${icon("sparkles")} Beispiel einfügen</button>`}
              <details class="form-extra">
                <summary>${icon("settings")} Formular (optional)</summary>
                <div class="field"><label for="f-name">Name</label><input class="input" id="f-name" maxlength="40" value="${base?.name ?? ""}" /></div>
                <div class="field"><label for="f-hd">Trefferwürfel</label>
                  <select class="select" id="f-hd"><option value="">Claude entscheiden lassen</option>${[6, 8, 10, 12].map((d) => html`<option value="${d}" ${base?.hitDie === d ? "selected" : ""}>W${d}</option>`)}</select></div>
                <div class="field"><label>Wichtigste Attribute (höchstens 2)</label>
                  <div class="check-row">${data.rules.attributes.map((a) => html`<label class="chip check"><input type="checkbox" name="attr" value="${a.id}" ${base?.primaryAttributes.includes(a.id) ? "checked" : ""}/> ${a.name}</label>`)}</div></div>
                <div class="field"><label>Rüstung</label>
                  <div class="check-row">${["leicht", "mittel", "schwer", "schild"].map((r) => html`<label class="chip check"><input type="checkbox" name="armor" value="${r}" ${base?.armor.includes(r as never) ? "checked" : ""}/> ${r}</label>`)}</div></div>
                <div class="field"><label>Fähigkeiten (höchstens ${data.rules.classBuilder.maxAbilitiesAtLevel1})</label>
                  <div id="abilities">${(base?.abilities ?? [{ name: "", text: "" }]).map((a) => abilityRow(a.name, a.text))}</div>
                  <button class="btn btn-ghost btn-sm" id="add-ability" type="button">${icon("plus")} Fähigkeit</button></div>
              </details>
              <div class="review-bar">
                <span class="badge-num" id="rounds">0/${MAX_REVIEW_ROUNDS}</span>
                <button class="btn magnetic glow-border" id="review">${icon("sparkles")} Von Claude bewerten lassen</button>
              </div>
            </section>
            <section class="editor-output" id="output" aria-live="polite"></section>
          </div>
        </div>`);

      function abilityRow(name = "", text = ""): Raw {
        return html`<div class="ability-row"><input class="input" placeholder="Name" maxlength="60" value="${name}" data-ab="name" /><textarea class="textarea" rows="2" placeholder="Was bewirkt sie? Wie oft?" maxlength="400" data-ab="text">${text}</textarea><button class="icon-btn" type="button" data-remove-ab aria-label="Fähigkeit entfernen">${icon("x")}</button></div>`;
      }

      const out = $("#output", root);

      function collect(): ClassDraftInput {
        const abilities = $$<HTMLElement>(".ability-row", root)
          .map((r) => ({ name: r.querySelector<HTMLInputElement>("[data-ab=name]")!.value.trim(), beschreibung: r.querySelector<HTMLTextAreaElement>("[data-ab=text]")!.value.trim() }))
          .filter((a) => a.name || a.beschreibung);
        const hd = Number($<HTMLSelectElement>("#f-hd", root).value) || undefined;
        return {
          freitext: $<HTMLTextAreaElement>("#freitext", root).value.trim(),
          formular: {
            name: $<HTMLInputElement>("#f-name", root).value.trim() || undefined,
            trefferwuerfel: hd,
            attribute: $$<HTMLInputElement>("input[name=attr]:checked", root).map((i) => i.value).slice(0, 2),
            ruestung: $$<HTMLInputElement>("input[name=armor]:checked", root).map((i) => i.value),
            faehigkeiten: abilities,
          },
          vorher: result?.check.cls ?? base,
        };
      }

      function renderOutput() {
        $("#rounds", root).textContent = `${round}/${MAX_REVIEW_ROUNDS}`;
        const reviewBtn = $<HTMLButtonElement>("#review", root);
        reviewBtn.disabled = busy || round >= MAX_REVIEW_ROUNDS;
        reviewBtn.innerHTML = html`${icon("sparkles")} ${round ? "Neu bewerten lassen" : "Von Claude bewerten lassen"}`.value;
        if (busy) {
          out.innerHTML = html`<div class="card review-wait"><div class="scroll-anim">${icon("scroll")}</div><h3>Claude prüft deine Klasse …</h3><p class="muted">Werte übertragen, Punkte schätzen, Probleme suchen. Das dauert meist 10–30 Sekunden.</p><div class="dots"><i></i><i></i><i></i></div></div>`.value;
          return;
        }
        if (needsCode) {
          out.innerHTML = html`<form class="card setup-card" id="access-form"><h3>${icon("lock")} Zugangscode</h3><p>Die Bewertung nutzt Claude und ist deshalb geschützt.</p><div class="input-row"><input class="input" id="access-code" type="password" placeholder="Zugangscode" /><button class="btn" type="submit">Weiter</button></div></form>`.value;
          out.querySelector("#access-form")!.addEventListener("submit", (e) => { e.preventDefault(); setAccessCode(out.querySelector<HTMLInputElement>("#access-code")!.value.trim()); needsCode = false; void review(); });
          return;
        }
        if (error) { out.innerHTML = html`<div class="card setup-card error"><h3>${icon("info")} Das hat nicht geklappt</h3><p>${error}</p></div>`.value; return; }
        if (!result) {
          out.innerHTML = html`<div class="card review-empty">
            <h3>${icon("sparkles")} So läuft die Bewertung</h3>
            <ol>
              <li><b>Claude</b> überträgt deine Beschreibung in Spielwerte und schätzt die Stärke.</li>
              <li><b>Das Regelprogramm</b> rechnet nach: höchstens ${data.rules.classBuilder.pointBudgetPerLevel[0]} Punkte, feste Grenzen für Schaden, Rüstung und Boni. Zu Starkes wird gekürzt oder abgelehnt – egal, was Claude meint.</li>
              <li><b>Du</b> passt an und bewertest neu (bis zu ${MAX_REVIEW_ROUNDS}-mal) und speicherst, wenn alles passt.</li>
            </ol>
            ${base ? classPreview(base, data) : ""}
          </div>`.value;
          return;
        }
        const r = result;
        const pct = Math.min(130, (r.check.cost.total / r.check.cost.budget) * 100);
        const claudePct = Math.min(130, (r.assessment.staerke.punkte / r.check.cost.budget) * 100);
        const v = VERDICT[r.assessment.staerke.urteil];
        out.innerHTML = html`
          <div class="card review-result glow-border">
            <div class="rr-head">
              <span class="chip ${r.check.ok ? "good" : "bad"}">${icon(r.check.ok ? "check" : "x")} Regelprüfung ${r.check.ok ? "bestanden" : "nicht bestanden"}</span>
              <span class="chip ${v.cls}">Claude: ${v.label}</span>
              <span class="muted small">Runde ${r.round}/${r.maxRounds}</span>
            </div>
            <div class="power">
              <div class="power-label"><b>${r.check.cost.total}</b> von ${r.check.cost.budget} Punkten <span class="muted small">(Claude schätzt ${r.assessment.staerke.punkte})</span></div>
              <div class="power-bar"><i class="${r.check.cost.total > r.check.cost.budget ? "over" : ""}" style="--w:${pct / 1.3}%"></i><span class="power-limit" style="left:${100 / 1.3}%"></span><span class="power-claude" style="left:${claudePct / 1.3}%" title="Claudes Schätzung"></span></div>
            </div>
            <p>${r.assessment.zusammenfassung}</p>
            ${r.check.errors.length ? html`<div class="rr-box bad"><h4>${icon("x")} Abgelehnt, weil …</h4><ul>${r.check.errors.map((e) => html`<li>${e}</li>`)}</ul>
              ${r.assessment.gegenvorschlag ? html`<p class="counter">${icon("sparkles")} <b>Gegenvorschlag:</b> ${r.assessment.gegenvorschlag}</p>` : ""}</div>` : ""}
            ${r.check.adjustments.length ? html`<div class="rr-box gold"><h4>${icon("scroll")} Automatisch angepasst</h4><ul>${r.check.adjustments.map((e) => html`<li>${e}</li>`)}</ul></div>` : ""}
            ${r.check.warnings.length ? html`<div class="rr-box gold"><ul>${r.check.warnings.map((e) => html`<li>${e}</li>`)}</ul></div>` : ""}
            ${r.assessment.probleme.length ? html`<h4>Claudes Hinweise</h4><ul class="problems">${r.assessment.probleme.map((p) => html`<li class="${p.schwere}">${icon(p.schwere === "fehler" ? "x" : p.schwere === "warnung" ? "info" : "sparkles")} ${p.text}</li>`)}</ul>` : ""}
            ${r.assessment.vorschlaege.length ? html`<h4>Vorschläge</h4><ul class="suggest-list">${r.assessment.vorschlaege.map((s) => html`<li>${s}</li>`)}</ul>` : ""}
            <details class="cost-details"><summary>Punkte im Detail</summary><ul>${r.check.cost.items.map((i) => html`<li><span>${i.label}</span><b>${i.points}</b></li>`)}</ul></details>
          </div>
          <div class="card">${classPreview(r.check.cls, data, r.check.cost.items)}</div>
          <div class="save-bar">
            <button class="btn btn-lg magnetic ${r.check.ok ? "glow-border" : ""}" id="save" ${r.check.ok ? "" : "disabled"}>${icon("check")} Klasse speichern</button>
            ${r.check.ok ? "" : html`<p class="hint">Erst wenn die Regelprüfung besteht, kann gespeichert werden. Beschreibe links, was sich ändern soll, und bewerte neu.</p>`}
          </div>`.value;
        out.querySelector("#save")?.addEventListener("click", save);
        enhance(out);
      }

      async function review() {
        if (busy || round >= MAX_REVIEW_ROUNDS) return;
        const input = collect();
        if (input.freitext.length < 10 && !input.formular.name && !input.vorher) { toast("Beschreibe deine Klasse in ein paar Sätzen."); return; }
        busy = true; error = null;
        renderOutput();
        out.scrollIntoView({ behavior: "smooth", block: "nearest" });
        let got: ReviewResult | null = null;
        await streamSse<ReviewEvent>("/api/classes/review", { draftId, round: round + 1, token, input }, (ev) => {
          if (ev.type === "review") got = ev.result;
          if (ev.type === "error") { if (ev.code === "access") needsCode = true; else error = ev.message; }
        });
        busy = false;
        if (got) {
          result = got;
          round = (got as ReviewResult).round;
          token = (got as ReviewResult).nextToken;
          $<HTMLTextAreaElement>("#freitext", root).value = "";
          $("#freitext-label", root).textContent = "Was soll sich ändern? (leer lassen für eine neue Bewertung)";
        }
        renderOutput();
      }

      async function save() {
        if (!result?.check.ok) return;
        const btn = out.querySelector<HTMLButtonElement>("#save")!;
        btn.disabled = true;
        try {
          const signed = await api.confirmClass(result.check.cls);
          classStore.save(signed, mode === "bearbeiten" ? existing?.cls.id : undefined);
          toast(`„${signed.cls.name}“ ist gespeichert und spielbar!`, "success");
          go("/klassen");
        } catch (e) {
          toast(e instanceof ApiError && e.problems.length ? e.problems.join(" ") : (e as Error).message, "error", 7000);
          btn.disabled = false;
        }
      }

      root.addEventListener("click", (e) => {
        const t = e.target as HTMLElement;
        if (t.closest("#example")) $<HTMLTextAreaElement>("#freitext", root).value = EXAMPLE;
        if (t.closest("#add-ability")) {
          const box = $("#abilities", root);
          if (box.children.length < data.rules.classBuilder.maxAbilitiesAtLevel1) box.insertAdjacentHTML("beforeend", abilityRow().value);
          else toast(`Höchstens ${data.rules.classBuilder.maxAbilitiesAtLevel1} Fähigkeiten auf Stufe 1.`);
        }
        const rm = t.closest<HTMLElement>("[data-remove-ab]");
        if (rm) rm.closest(".ability-row")?.remove();
        if (t.closest("#review")) void review();
      });
      root.addEventListener("change", (e) => {
        const t = e.target as HTMLInputElement;
        if (t.name === "attr" && $$<HTMLInputElement>("input[name=attr]:checked", root).length > 2) { t.checked = false; toast("Höchstens zwei wichtigste Attribute."); }
      });
      renderOutput();
      enhance(root);
    },
  };
}
