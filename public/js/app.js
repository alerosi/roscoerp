// Punto di ingresso: carica il database, disegna la barra, gestisce le schede e lo stato di salvataggio.

import { store } from "./store.js";
import { el, $, fmtDateTime } from "./util.js";
import { toast, confirmDialog, alertDialog } from "./ui.js";
import { renderPannello } from "./views/pannello.js";
import { renderMagazzino } from "./views/magazzino.js";
import { renderVendite, renderMovimenti, renderSpese } from "./views/registri.js";
import { renderStatistiche } from "./views/statistiche.js";
import { renderTasse } from "./views/tasse.js";
import { renderImpostazioni } from "./views/impostazioni.js";
import { destroyAll } from "./charts.js";

const TABS = [
  ["pannello", "Pannello di controllo", renderPannello],
  ["magazzino", "Magazzino", renderMagazzino],
  ["vendite", "Vendite", renderVendite],
  ["movimenti", "Movimenti", renderMovimenti],
  ["spese", "Spese", renderSpese],
  ["statistiche", "Statistiche", renderStatistiche],
  ["tasse", "Tasse", renderTasse],
  ["impostazioni", "Impostazioni", renderImpostazioni],
];
let current = (location.hash || "#pannello").slice(1);
if (!TABS.some((t) => t[0] === current)) current = "pannello";

function renderTabs() {
  const nav = $("#tabs");
  nav.innerHTML = "";
  for (const [key, label] of TABS) nav.append(el("button", { class: "tab" + (key === current ? " active" : ""), onClick: () => go(key) }, label));
}
function go(key) {
  current = key;
  history.replaceState(null, "", "#" + key);
  renderTabs();
  render();
}
function render() {
  const main = $("#main");
  destroyAll(main);
  main.innerHTML = "";
  if (!store.db) { renderWelcome(main); return; }
  const tab = TABS.find((t) => t[0] === current) || TABS[0];
  try { tab[2](main, render); }
  catch (e) { console.error(e); main.append(el("div", { class: "banner danger", text: "Errore nel disegnare la pagina: " + e.message })); }
  $("#brandTitle").textContent = store.db.settings.nomeNegozio || "RoscoERP";
  renderOperatori();
}
function renderOperatori() {
  const sel = $("#operatoreSelect");
  const ops = store.db ? store.db.settings.operatori : [];
  sel.innerHTML = "";
  sel.append(el("option", { value: "", text: ops.length ? "— scegli —" : "(nessun operatore)" }));
  for (const o of ops) sel.append(el("option", { value: o, text: o }));
  sel.value = ops.includes(store.operatore) ? store.operatore : "";
}
function renderWelcome(main) {
  const card = el("div", { class: "card welcome" }, el("span", { class: "brand-mark" }), el("h2", { class: "center", text: "Benvenuto in RoscoERP" }));
  if (store.mode === "fs") {
    if (store.fileHandle) {
      card.append(el("p", { class: "center", text: `Database: ${store.dbPath}. Il browser richiede una conferma per riaprire il file.` }),
        el("div", { class: "toolbar", style: { justifyContent: "center", marginTop: "14px" } },
          el("button", { class: "btn primary big", onClick: async () => { try { await store.reopenHandle(); render(); } catch (e) { alertDialog(e.message); } } }, "Riapri il database"),
          el("button", { class: "btn", onClick: async () => { try { await store.pickFile(false); render(); } catch (e) { if (e.name !== "AbortError") alertDialog(e.message); } } }, "Scegli un altro file…")));
    } else {
      card.append(el("p", { class: "center", text: "Scegli il file JSON del database oppure creane uno nuovo. Il browser lo riscriverà ad ogni modifica." }),
        el("div", { class: "toolbar", style: { justifyContent: "center", marginTop: "14px" } },
          el("button", { class: "btn primary big", onClick: async () => { try { await store.pickFile(false); render(); } catch (e) { if (e.name !== "AbortError") alertDialog(e.message); } } }, "Apri database esistente…"),
          el("button", { class: "btn big", onClick: async () => { try { await store.pickFile(true); render(); } catch (e) { if (e.name !== "AbortError") alertDialog(e.message); } } }, "Crea nuovo database…")));
    }
  } else if (store.mode === "local") {
    card.append(el("p", { class: "center", text: "Apri il file roscoerp.json del negozio (ad esempio da OneDrive) per vedere e modificare i dati. Le modifiche restano in questo browser finché non premi «Salva file»." }),
      el("div", { class: "toolbar", style: { justifyContent: "center", marginTop: "14px" } },
        el("label", { class: "btn primary big" }, "Apri file…", el("input", { type: "file", accept: ".json,application/json", hidden: true, onChange: (e) => apriFileLocale(e.target) })),
        el("button", { class: "btn big", onClick: async () => { if (await confirmDialog("Iniziare con un database vuoto? Ricordati poi di salvarlo con «Salva file».", { ok: "Inizia da zero" })) store.startEmptyLocal(); } }, "Inizia da zero")));
  } else {
    card.append(el("p", { class: "center", text: "Caricamento del database in corso…" }));
  }
  main.append(card);
}

// ------------------------------------------------- modalità local: Apri file / Salva file
async function apriFileLocale(input) {
  const file = input.files && input.files[0];
  input.value = "";
  if (!file) return;
  try {
    const obj = await store.readDbFile(file);
    const info = store.localInfo;
    const fileSaved = obj.meta && obj.meta.savedAt;
    const righe = [`File "${file.name}": ${obj.magazzino.length} articoli, ${(obj.vendite || []).length} vendite` + (fileSaved ? `, salvato il ${fmtDateTime(fileSaved)}.` : ".")];
    if (store.db) {
      if (info.unsaved) righe.push("\nATTENZIONE: in questo browser ci sono modifiche non ancora salvate su file. Aprendo il file andranno perse.");
      const ultimo = info.exportedAt || info.fileSavedAt;
      if (fileSaved && ultimo && fileSaved < ultimo) righe.push(`\nIl file sembra più vecchio dei dati che hai qui (${fmtDateTime(ultimo)}): forse OneDrive non l'ha ancora sincronizzato.`);
      const ok = await confirmDialog(righe.join("\n") + "\n\nSostituire i dati di questo browser con quelli del file?", { title: "Apri file", ok: "Apri il file", danger: info.unsaved });
      if (!ok) return;
    }
    await store.openLocalFile(file, obj);
    toast(`Dati caricati da ${file.name}`, "ok");
  } catch (e) { alertDialog(e.message); }
}
async function salvaFileLocale() {
  try {
    const how = await store.saveToFile();
    if (how === "shared") toast("File pronto: se hai scelto OneDrive, sostituisci il roscoerp.json esistente", "ok", 6000);
    else if (how === "downloaded") toast("File roscoerp.json scaricato: copialo in OneDrive al posto del precedente", "ok", 6000);
  } catch (e) { alertDialog("Salvataggio su file non riuscito: " + e.message); }
}
function renderFileBar() {
  const bar = $("#fileBar");
  const local = store.mode === "local" && !!store.db;
  bar.classList.toggle("hidden", !local);
  $("#fileSaveBtn").classList.toggle("primary", local && store.localInfo.unsaved);
}

function setStatus(s, err) {
  const box = $("#saveStatus");
  box.className = "save-status " + s;
  const label = box.querySelector(".label");
  const where = store.dbPath;
  renderFileBar();
  if (store.mode === "local" && store.db && s !== "error") {
    // qui conta se i dati sono stati salvati su file, non nella memoria del browser
    const info = store.localInfo;
    box.className = "save-status " + (info.unsaved ? "unsaved" : "saved");
    label.textContent = info.unsaved ? "Da salvare su file"
      : info.exportedAt ? `Salvato su file ${fmtDateTime(info.exportedAt).slice(-5)}`
      : `Da ${info.fileName || "file"}`;
    box.title = "I dati sono nella memoria di questo browser." + (info.fileName ? `\nUltimo file aperto: ${info.fileName}${info.openedAt ? " (" + fmtDateTime(info.openedAt) + ")" : ""}` : "") + (info.exportedAt ? `\nUltimo «Salva file»: ${fmtDateTime(info.exportedAt)}` : "");
    return;
  }
  if (s === "saving") label.textContent = "Salvataggio…";
  else if (s === "saved") label.textContent = `Salvato ${fmtDateTime(store.db.meta.savedAt).slice(-5)} · ${where ? where.split(/[\\/]/).pop() : ""}`;
  else if (s === "error") label.textContent = "Errore di salvataggio!";
  else if (s === "conflict") label.textContent = "Conflitto: file modificato altrove";
  else label.textContent = "";
  box.title = `Database: ${where || "-"}\nModalità: ${store.mode}`;
  if (s === "conflict") handleConflict(err);
  if (s === "error") toast("Salvataggio fallito: " + (err && err.message), "err", 6000);
}
let conflictOpen = false;
async function handleConflict(info) {
  if (conflictOpen) return;
  conflictOpen = true;
  const keep = await confirmDialog("Il file del database è stato modificato da un'altra sessione (un altro computer o un'altra finestra) dopo l'apertura di questa pagina.\n\nScegli: ricaricare i dati dal file (perdendo le modifiche non salvate di questa finestra) oppure sovrascrivere il file con i dati di questa finestra.", { title: "Conflitto di salvataggio", ok: "Ricarica dal file", cancel: "Sovrascrivi il file", danger: true });
  conflictOpen = false;
  if (keep) { await store.loadFromServer(); render(); toast("Dati ricaricati dal file", "ok"); }
  else { await store.save(true, true); }
}

async function main() {
  renderTabs();
  store.onStatus(setStatus);
  store.subscribe((what) => {
    if (what === "load") render();
    if (store.mode === "local" && (what === "load" || what === "localFile")) setStatus(store.status);
    if (what === "localFile" && current === "impostazioni") render();
  });
  $("#fileOpenInput").addEventListener("change", (e) => apriFileLocale(e.target));
  $("#fileSaveBtn").addEventListener("click", salvaFileLocale);
  $("#operatoreSelect").addEventListener("change", (e) => store.setOperatore(e.target.value));
  window.addEventListener("hashchange", () => { const k = location.hash.slice(1); if (TABS.some((t) => t[0] === k) && k !== current) go(k); });
  try { await store.init(); }
  catch (e) { console.error(e); $("#main").append(el("div", { class: "banner danger", text: "Impossibile caricare il database: " + e.message })); return; }
  render();
  if (store.mode === "local") setStatus(store.status);
}
main();
