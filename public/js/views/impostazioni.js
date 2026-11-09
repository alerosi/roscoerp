// Impostazioni: database (percorso file), negozio e operatori, tipologie, fornitori, liste, opzioni, backup.

import { store, normalizeDb } from "../store.js";
import * as L from "../logic.js";
import { el, eur, num, fmtDateTime, toDay, trim, downloadText, val } from "../util.js";
import { field, textInput, numInput, checkbox, toast, confirmDialog, promptDialog, alertDialog, openModal, dataTable, select } from "../ui.js";
import { apriVerifica } from "./magazzino.js";

const state = { section: "database" };
const SECTIONS = [
  ["database", "Database"], ["negozio", "Negozio e operatori"], ["tipologie", "Tipologie e prefissi"], ["fornitori", "Fornitori"],
  ["liste", "Zone, pagamenti, clienti"], ["spese", "Tipologie di spesa"], ["opzioni", "Opzioni"], ["backup", "Backup e integrità"],
];

export function renderImpostazioni(root, rerender) {
  const nav = el("div", { class: "settings-nav" }, SECTIONS.map(([k, label]) => el("button", { class: "btn" + (state.section === k ? " primary" : " ghost"), onClick: () => { state.section = k; rerender(); } }, label)));
  const content = el("div", {});
  const R = { database: secDatabase, negozio: secNegozio, tipologie: secTipologie, fornitori: secFornitori, liste: secListe, spese: secSpese, opzioni: secOpzioni, backup: secBackup };
  R[state.section](content, rerender);
  root.append(el("div", { class: "page-head" }, el("div", {}, el("h2", { text: "Impostazioni" }), el("p", { text: "Tutti i parametri del foglio \"Impostazioni\" di Excel, più la posizione del database." }))),
    el("div", { class: "settings-layout" }, nav, content));
}

// ---------------------------------------------------------------- database
function secDatabase(root, rerender) {
  const card = el("div", { class: "card" }, el("div", { class: "card-title" }, el("h3", { text: "File del database" })));
  if (store.mode === "server") {
    const inPath = textInput(store.dbPath, { style: { fontFamily: "monospace" } });
    card.append(
      el("p", {}, "Il database è un file JSON sul disco del computer che esegue il server. Viene letto all'apertura e riscritto ad ogni modifica, alla chiusura della pagina e all'apertura. Prima di ogni scrittura viene conservata una copia in una cartella di backup accanto al file."),
      el("div", { class: "stat-row" }, el("span", { text: "Percorso attuale" }), el("b", { class: "path-box", text: store.dbPath })),
      el("div", { class: "stat-row" }, el("span", { text: "Cartella backup" }), el("b", { class: "path-box", text: store.serverInfo ? store.serverInfo.backupDir : "" })),
      el("div", { class: "stat-row" }, el("span", { text: "Ultimo salvataggio" }), el("b", { text: fmtDateTime(store.db.meta.savedAt) + ` · revisione ${store.db.meta.revision}` })),
      el("div", { style: { marginTop: "14px" } }, field("Nuovo percorso (assoluto o relativo alla cartella dell'app)", inPath, { hint: "Esempio: C:\\Negozio\\dati\\roscoerp.json oppure data/roscoerp.json. Si può indicare anche una cartella condivisa in rete." })),
      el("div", { class: "toolbar", style: { marginTop: "10px" } },
        el("button", { class: "btn primary", onClick: () => cambiaPercorso(inPath.value, rerender) }, "Usa questo file"),
        el("span", { class: "hint", text: "Se il file esiste viene caricato; se non esiste puoi crearlo vuoto oppure copiarci il database attuale." })),
    );
  } else if (store.mode === "fs") {
    card.append(
      el("p", {}, "Pagina aperta senza il server locale: il browser scrive direttamente sul file JSON scelto (File System Access API). Il permesso viene ricordato dal browser; alla riapertura potrebbe essere richiesta una conferma."),
      el("div", { class: "stat-row" }, el("span", { text: "File attuale" }), el("b", { class: "path-box", text: store.dbPath || "(nessuno)" })),
      el("div", { class: "toolbar", style: { marginTop: "10px" } },
        el("button", { class: "btn primary", onClick: async () => { try { await store.pickFile(false); toast("Database caricato", "ok"); rerender(); } catch (e) { if (e.name !== "AbortError") alertDialog(e.message); } } }, "Apri un altro file…"),
        el("button", { class: "btn", onClick: async () => { if (!await confirmDialog("Creare un nuovo database vuoto in un nuovo file? I dati attuali restano nel vecchio file.")) return; try { await store.pickFile(true); rerender(); } catch (e) { if (e.name !== "AbortError") alertDialog(e.message); } } }, "Crea nuovo file…")),
    );
  } else {
    const info = store.localInfo;
    card.append(
      el("p", {}, "Su questo dispositivo il database è conservato nella memoria del browser. Per scambiarlo con gli altri dispositivi usa i pulsanti «Apri file» e «Salva file» nella barra in alto: sul telefono «Salva file» apre il menu Condividi, da cui si sceglie OneDrive (sostituendo il roscoerp.json esistente)."),
      el("div", { class: "stat-row" }, el("span", { text: "Ultimo file aperto" }), el("b", { text: info.fileName ? `${info.fileName}${info.openedAt ? " · " + fmtDateTime(info.openedAt) : ""}` : "(nessuno)" })),
      el("div", { class: "stat-row" }, el("span", { text: "Ultimo «Salva file»" }), el("b", { text: info.exportedAt ? fmtDateTime(info.exportedAt) : "mai" })),
      el("div", { class: "stat-row" }, el("span", { text: "Modifiche da salvare su file" }), el("b", { text: info.unsaved ? "sì" : "no" })),
      el("p", { class: "hint", style: { marginTop: "8px" }, text: "Evita di modificare i dati su due dispositivi nello stesso momento: vale l'ultimo file salvato." }));
  }
  const exp = el("div", { class: "card", style: { marginTop: "18px" } }, el("div", { class: "card-title" }, el("h3", { text: "Esporta / importa" })),
    el("div", { class: "toolbar" },
      el("button", { class: "btn", onClick: () => downloadText(`roscoerp-${toDay(new Date())}.json`, store.exportJson()) }, "Scarica copia del database (JSON)"),
      el("label", { class: "btn" }, "Importa database da file JSON…", el("input", { type: "file", accept: ".json,application/json", style: { display: "none" }, onChange: async (e) => {
        const f = e.target.files[0]; if (!f) return;
        try {
          const obj = JSON.parse(await f.text());
          if (!obj || !Array.isArray(obj.magazzino)) throw new Error("Il file non sembra un database RoscoERP");
          const ok = await confirmDialog(`Sostituire il database attuale (${store.db.magazzino.length} articoli, ${store.db.vendite.length} vendite) con quello del file "${f.name}" (${obj.magazzino.length} articoli, ${(obj.vendite || []).length} vendite)?\nIl database attuale resta nei backup.`, { title: "Importa database", danger: true, ok: "Sostituisci" });
          if (ok) { await store.replaceDb(obj); toast("Database importato", "ok"); rerender(); }
        } catch (err) { alertDialog(err.message); }
        e.target.value = "";
      } }))),
    el("p", { class: "hint", style: { marginTop: "8px" }, text: "Per importare di nuovo i dati dal file Excel originale usare lo script tools/import_xlsm.py (vedi README)." }));
  root.append(card, exp);
}
async function cambiaPercorso(p, rerender) {
  p = trim(p);
  if (!p) return;
  try {
    await store.setServerPath(p, "load");
    toast("Database caricato da " + store.dbPath, "ok"); rerender();
  } catch (e) {
    if (e.body && e.body.exists === false) {
      let mode = null;
      await new Promise((resolve) => openModal({
        title: "File non trovato", width: "520px",
        body: el("p", { text: `Il file ${e.body.dbPath} non esiste. Vuoi crearlo vuoto (si parte da zero) oppure copiarci il database attuale?` }),
        onClose: resolve,
        buttons: [{ label: "Annulla", onClick: (a) => a.close() }, { label: "Crea vuoto", onClick: (a) => { mode = "create"; a.close(); } }, { label: "Copia database attuale", class: "primary", onClick: (a) => { mode = "copy"; a.close(); } }],
      }));
      if (!mode) return;
      try { await store.setServerPath(p, mode); toast(mode === "copy" ? "Database copiato nel nuovo file" : "Nuovo database vuoto creato", "ok"); rerender(); }
      catch (err) { alertDialog(err.message); }
    } else alertDialog(e.message);
  }
}

// ---------------------------------------------------------------- negozio e operatori
function secNegozio(root, rerender) {
  const s = store.db.settings;
  const inNome = textInput(s.nomeNegozio || "", { onChange: (e) => { s.nomeNegozio = trim(e.target.value) || "RoscoERP"; store.commit("settings"); } });
  root.append(
    el("div", { class: "card" }, el("div", { class: "card-title" }, el("h3", { text: "Negozio" })), field("Nome mostrato nell'intestazione", inNome)),
    listEditor("Operatori", s.operatori, rerender, { hint: "Gli operatori compaiono nella tendina in alto e nelle vendite. L'operatore attivo viene registrato come utente su movimenti e spese.", onDelete: (v) => store.db.vendite.filter((x) => x.operatore === v).length ? `L'operatore "${v}" compare in ${store.db.vendite.filter((x) => x.operatore === v).length} vendite (restano invariate).` : null }),
  );
}

/** Editor generico per liste di stringhe (zone, pagamenti, clienti, operatori). */
function listEditor(title, list, rerender, { hint = "", onDelete = null } = {}) {
  const inNew = textInput("", { placeholder: "nuovo valore…" });
  const add = () => { const v = trim(inNew.value); if (!v) return; if (list.some((x) => x.toLowerCase() === v.toLowerCase())) return toast("Valore già presente", "warn"); list.push(v); list.sort((a, b) => a.localeCompare(b, "it", { sensitivity: "base" })); store.commit("settings"); rerender(); };
  inNew.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
  return el("div", { class: "card list-editor", style: { marginTop: "18px" } },
    el("div", { class: "card-title" }, el("h3", { text: `${title} (${list.length})` }), el("div", { class: "toolbar" }, inNew, el("button", { class: "btn sm primary", onClick: add }, "＋ Aggiungi"))),
    hint ? el("p", { class: "hint", text: hint }) : null,
    el("div", { class: "table-wrap", style: { maxHeight: "360px", marginTop: "8px" } }, el("table", { class: "data" }, el("tbody", {}, list.map((v, i) => el("tr", {},
      el("td", {}, textInput(v, { onChange: (e) => { const nv = trim(e.target.value); if (!nv) { e.target.value = v; return; } list[i] = nv; store.commit("settings"); } })),
      el("td", { class: "actions" }, el("button", { class: "btn xs danger", onClick: async () => { const warn = onDelete ? onDelete(v) : null; if (await confirmDialog(`Eliminare "${v}" dalla lista?${warn ? "\n" + warn : ""}`, { danger: true, ok: "Elimina" })) { list.splice(i, 1); store.commit("settings"); rerender(); } } }, "✕"))))))),
    !list.length ? el("p", { class: "muted", text: "Lista vuota." }) : null);
}

// ---------------------------------------------------------------- tipologie
function secTipologie(root, rerender) {
  const s = store.db.settings;
  const inDigit = numInput(s.numDigit, { min: 2, max: 8, step: 1, style: { width: "90px" }, onChange: async (e) => {
    const n = Math.round(val(e.target.value));
    if (n < 2 || n > 8) { e.target.value = s.numDigit; return; }
    if (store.db.magazzino.length && !await confirmDialog("Cambiare il numero di cifre dei codici con articoli già presenti rende i codici esistenti non riconoscibili dalle statistiche. Continuare?", { danger: true })) { e.target.value = s.numDigit; return; }
    s.numDigit = n; store.commit("settings"); rerender();
  } });
  const add = async () => {
    const nome = await promptDialog("Inserire la nuova tipologia:", "", { title: "Nuovo tipo" }); if (!trim(nome || "")) return;
    const pre = await promptDialog("Inserire il prefisso per la nuova tipologia:", "", { title: "Nuovo prefisso", placeholder: "es. PIA" }); if (!trim(pre || "")) return;
    try { L.aggiungiTipologia(nome, pre); toast("Tipologia aggiunta", "ok"); rerender(); } catch (e) { alertDialog(e.message); }
  };
  const mod = async (i) => {
    const t = s.tipologie[i];
    const nome = await promptDialog("Inserire la nuova tipologia:", t.nome, { title: "Modifica tipo" }); if (!trim(nome || "")) return;
    const pre = await promptDialog("Inserire il prefisso per la tipologia:", t.prefisso, { title: "Modifica prefisso" }); if (!trim(pre || "")) return;
    const n = L.articoliDiTipologia(i);
    if (trim(pre).toUpperCase() !== t.prefisso && n && !await confirmDialog(`Il prefisso cambia da ${t.prefisso} a ${trim(pre).toUpperCase()}: verranno rinominati i codici di ${n} articoli e di tutti i loro movimenti e vendite. Continuare?`, { title: "Rinomina codici", danger: true })) return;
    try { L.modificaTipologia(i, nome, pre); toast("Tipologia aggiornata", "ok"); rerender(); } catch (e) { alertDialog(e.message); }
  };
  const canc = async (i) => {
    const t = s.tipologie[i]; const n = L.articoliDiTipologia(i);
    const ok = await confirmDialog(`Sei sicuro di voler cancellare la tipologia "${t.nome}" (${t.prefisso})?\nCome in Excel questa operazione cancella TUTTI i ${n} articoli con questo prefisso, con i loro movimenti e vendite. Operazione non annullabile (resta il backup del file).`, { title: "Cancella tipologia", danger: true, ok: "Cancella tutto" });
    if (!ok) return;
    const k = L.cancellaTipologia(i); toast(`Tipologia eliminata con ${k} articoli`, "warn"); rerender();
  };
  root.append(el("div", { class: "card" },
    el("div", { class: "card-title" }, el("h3", { text: `Tipologie (${s.tipologie.length})` }), el("div", { class: "toolbar" }, el("span", { class: "hint", text: "Cifre codice:" }), inDigit, el("button", { class: "btn sm primary", onClick: add }, "＋ Aggiungi"))),
    el("p", { class: "hint", text: "Il codice articolo è prefisso + numero progressivo (es. PIA00041). Rinominare un prefisso aggiorna tutti i codici collegati." }),
    el("div", { class: "table-wrap", style: { maxHeight: "none", marginTop: "8px" } }, dataTable([
      { key: "nome", label: "Tipologia" }, { key: "prefisso", label: "Prefisso", cls: "mono" },
      { key: "_n", label: "Articoli", num: true, sortValue: (t) => L.articoliDiTipologia(s.tipologie.indexOf(t)), render: (t) => num(L.articoliDiTipologia(s.tipologie.indexOf(t))) },
      { key: "_a", label: "", sortable: false, cls: "actions", render: (t) => { const i = s.tipologie.indexOf(t); return el("span", {}, el("button", { class: "btn xs", onClick: () => mod(i) }, "Mod."), " ", el("button", { class: "btn xs danger", onClick: () => canc(i) }, "Canc.")); } },
    ], s.tipologie, { sortKey: "nome" }))));
}

// ---------------------------------------------------------------- fornitori
function secFornitori(root, rerender) {
  const s = store.db.settings;
  const inNew = textInput("", { placeholder: "nuovo fornitore…" });
  const add = () => { if (L.aggiungiFornitore(inNew.value)) { store.commit("settings"); rerender(); } else toast("Nome vuoto o già presente", "warn"); };
  inNew.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
  root.append(el("div", { class: "card list-editor" },
    el("div", { class: "card-title" }, el("h3", { text: `Fornitori (${s.fornitori.length})` }), el("div", { class: "toolbar" }, inNew, el("button", { class: "btn sm primary", onClick: add }, "＋ Aggiungi"))),
    el("p", { class: "hint", text: "\"Default\" è il fornitore proposto nel carico. \"Debito alla data\" è il saldo dovuto al fornitore alla data indicata: da lì il Conto Economico somma i carichi (a costo) e sottrae le spese di tipo Materiale intestate al fornitore." }),
    el("div", { class: "table-wrap", style: { maxHeight: "none", marginTop: "8px" } }, el("table", { class: "data" },
      el("thead", {}, el("tr", {}, el("th", { text: "Nome" }), el("th", { text: "Default" }), el("th", { text: "Debito (€)" }), el("th", { text: "…alla data" }), el("th", { text: "Articoli" }), el("th"))),
      el("tbody", {}, s.fornitori.map((f, i) => el("tr", {},
        el("td", {}, textInput(f.nome, { onChange: (e) => { const nv = trim(e.target.value); if (!nv) { e.target.value = f.nome; return; } f.nome = nv; store.commit("settings"); } })),
        el("td", {}, (() => { const r = el("input", { type: "radio", name: "forndef" }); r.checked = !!f.default; r.addEventListener("change", () => { s.fornitori.forEach((x) => x.default = false); f.default = true; store.commit("settings"); }); return r; })()),
        el("td", {}, numInput(f.debito ?? 0, { step: "0.01", onChange: (e) => { f.debito = val(e.target.value); store.commit("settings"); } })),
        el("td", {}, el("input", { type: "date", value: f.dataDebito || "", onChange: (e) => { f.dataDebito = e.target.value || toDay(new Date()); store.commit("settings"); } })),
        el("td", { class: "num", text: num(store.db.magazzino.filter((a) => a.fornitore === f.nome).length) }),
        el("td", { class: "actions" }, el("button", { class: "btn xs danger", onClick: async () => { if (await confirmDialog(`Eliminare il fornitore "${f.nome}" dalla lista? Articoli, movimenti e spese che lo citano restano invariati.`, { danger: true, ok: "Elimina" })) { s.fornitori.splice(i, 1); store.commit("settings"); rerender(); } } }, "✕")))))))));
}

// ---------------------------------------------------------------- liste
function secListe(root, rerender) {
  const s = store.db.settings;
  root.append(
    listEditor("Zone / paesi", s.zone, rerender, { hint: "Proposte nella vendita; i valori nuovi digitati nella vendita vengono aggiunti automaticamente." }),
    listEditor("Tipi di pagamento", s.pagamenti, rerender),
    listEditor("Clienti", s.clienti, rerender),
  );
}

// ---------------------------------------------------------------- tipologie spese
function secSpese(root, rerender) {
  const s = store.db.settings;
  const inNew = textInput("", { placeholder: "nuova tipologia di spesa…" });
  const ckDir = checkbox("diretta", false);
  const add = () => { if (L.aggiungiTipologiaSpesa(inNew.value, ckDir.input.checked)) { store.commit("settings"); rerender(); } else toast("Nome vuoto o già presente", "warn"); };
  root.append(el("div", { class: "card list-editor" },
    el("div", { class: "card-title" }, el("h3", { text: `Tipologie di spesa (${s.tipologieSpese.length})` }), el("div", { class: "toolbar" }, inNew, ckDir, el("button", { class: "btn sm primary", onClick: add }, "＋ Aggiungi"))),
    el("p", { class: "hint", text: "Le spese \"dirette\" (materiale, imballo, spedizione…) entrano nel Costo del venduto; le altre nelle Spese generali (SG&A). Il fornitore si può indicare solo per la tipologia \"Materiale\"." }),
    el("div", { class: "table-wrap", style: { maxHeight: "none", marginTop: "8px" } }, el("table", { class: "data" },
      el("thead", {}, el("tr", {}, el("th", { text: "Tipologia" }), el("th", { text: "Diretta" }), el("th", { text: "Spese registrate" }), el("th"))),
      el("tbody", {}, s.tipologieSpese.map((t, i) => el("tr", {},
        el("td", {}, textInput(t.nome, { onChange: (e) => { const nv = trim(e.target.value); if (!nv) { e.target.value = t.nome; return; } const old = t.nome; t.nome = nv; store.db.spese.forEach((x) => { if (x.tipologia === old) x.tipologia = nv; }); store.commit("settings"); } })),
        el("td", {}, (() => { const c = el("input", { type: "checkbox" }); c.checked = !!t.diretta; c.addEventListener("change", () => { t.diretta = c.checked; store.commit("settings"); }); return c; })()),
        el("td", { class: "num", text: num(store.db.spese.filter((x) => x.tipologia === t.nome).length) }),
        el("td", { class: "actions" }, el("button", { class: "btn xs danger", onClick: async () => { if (await confirmDialog(`Eliminare la tipologia "${t.nome}"? Le spese già registrate restano e saranno trattate come spese generali.`, { danger: true, ok: "Elimina" })) { s.tipologieSpese.splice(i, 1); store.commit("settings"); rerender(); } } }, "✕")))))))));
}

// ---------------------------------------------------------------- opzioni
function secOpzioni(root, rerender) {
  const s = store.db.settings;
  const flag = (key, label, hint) => { const c = checkbox(label, !!s.flags[key]); c.input.addEventListener("change", () => { s.flags[key] = c.input.checked; store.commit("settings"); }); return el("div", {}, c, el("div", { class: "hint", style: { marginLeft: "24px" }, text: hint })); };
  const inIva = numInput(s.ivaDefault ?? 22, { min: 0, max: 100, step: "0.1", style: { width: "100px" }, onChange: (e) => { s.ivaDefault = val(e.target.value); store.commit("settings"); } });
  root.append(el("div", { class: "card" }, el("div", { class: "card-title" }, el("h3", { text: "Opzioni delle finestre" })),
    el("div", { style: { display: "grid", gap: "14px" } },
      flag("mostraGiacenzaZero", "Vendita: includi articoli con giacenza 0", "Mostra nella lista della vendita anche gli articoli esauriti (equivalente della casella \"Giacenza 0\")."),
      flag("soloConPrezzo", "Vendita: solo articoli con prezzo base", "Nasconde gli articoli senza prezzo di listino."),
      flag("spesaAutoCarico", "Carico: crea spesa in automatico", "Ad ogni carico registra una spesa \"Materiale\" pari a costo × quantità intestata al fornitore."),
      flag("ivaSuCostoCarico", "Carico: il costo digitato include l'IVA", "Se attivo, il costo inserito nel carico viene scorporato dell'IVA. Nella modifica di un articolo il costo è sempre inteso netto."),
      field("Aliquota IVA predefinita (%)", inIva))));
}

// ---------------------------------------------------------------- backup e integrità
function secBackup(root, rerender) {
  const card = el("div", { class: "card" }, el("div", { class: "card-title" }, el("h3", { text: "Verifica coerenza" })),
    el("p", {}, "Controlla che la giacenza di ogni codice coincida con la somma dei suoi movimenti, che non esistano codici duplicati e che ogni vendita abbia il suo movimento. È il modo più rapido per capire se qualcosa è \"sparito\" dal magazzino."),
    el("button", { class: "btn primary", onClick: () => apriVerifica(rerender) }, "Esegui verifica"));
  root.append(card);
  if (store.mode === "server") {
    const box = el("div", { class: "card", style: { marginTop: "18px" } }, el("div", { class: "card-title" }, el("h3", { text: "Backup automatici" })), el("p", { class: "muted", text: "Caricamento…" }));
    root.append(box);
    fetch("/api/backups").then((r) => r.json()).then((b) => {
      box.innerHTML = "";
      box.append(el("div", { class: "card-title" }, el("h3", { text: "Backup automatici" })),
        el("p", {}, `Cartella: `, el("span", { class: "path-box", text: b.dir })),
        el("p", { class: "hint", text: "\".prev\" è la versione immediatamente precedente all'ultimo salvataggio; i file datati sono il primo salvataggio di ogni giornata (conservati 90 giorni)." }),
        b.files.length ? el("div", { class: "table-wrap", style: { maxHeight: "360px" } }, dataTable([
          { key: "file", label: "File", cls: "mono" }, { key: "mtime", label: "Data", render: (f) => fmtDateTime(f.mtime) }, { key: "size", label: "Dimensione", num: true, render: (f) => num(Math.round(f.size / 1024)) + " KB" },
          { key: "_a", label: "", sortable: false, cls: "actions", render: (f) => el("button", { class: "btn xs danger", onClick: async () => {
            if (!await confirmDialog(`Ripristinare il backup "${f.file}"? Il database attuale verrà sostituito (una copia resta nei backup).`, { danger: true, ok: "Ripristina" })) return;
            const r = await fetch("/api/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file: f.file }) });
            if (r.ok) { await store.loadFromServer(); toast("Backup ripristinato", "ok"); rerender(); } else alertDialog("Ripristino fallito");
          } }, "Ripristina") },
        ], b.files, { sortKey: "mtime", sortDir: -1 })) : el("p", { class: "muted", text: "Nessun backup ancora creato." }));
    }).catch(() => { box.innerHTML = ""; box.append(el("p", { class: "muted", text: "Backup non disponibili." })); });
  }
}
