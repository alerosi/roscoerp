// Magazzino: tabella articoli con le operazioni del foglio Excel (Modifica, Mod. codice, Canc., ordinamenti) e verifica coerenza.

import { store } from "../store.js";
import * as L from "../logic.js";
import { flussoCarico, flussoModificaArticolo } from "../forms.js";
import { el, eur, num, like, downloadText, trim } from "../util.js";
import { dataTable, field, textInput, select, checkbox, toast, confirmDialog, promptDialog, alertDialog, openModal } from "../ui.js";

const state = { sortKey: "codice", sortDir: 1, q: "", tipo: "", soloDisp: false, selected: null, showAll: false };

export function renderMagazzino(root, rerender) {
  const s = store.db.settings;
  const consumo = L.consumoMap();
  const rows = store.db.magazzino.filter((a) =>
    (!state.tipo || a.tipologia === state.tipo) && (!state.soloDisp || a.giacenza > 0)
    && (!state.q || [a.codice, a.descrizione, a.dimensioni, a.decoro, a.fornitore, a.tipologia].some((f) => like(f, state.q))));
  const totGiac = rows.reduce((a, r) => a + (Number(r.giacenza) || 0), 0);
  const totVal = rows.reduce((a, r) => a + L.valoreArticolo(r), 0);

  const inQ = textInput(state.q, { placeholder: "codice, descrizione, decoro, fornitore…", onInput: (e) => { state.q = e.target.value; draw(); } });
  const selTipo = select([{ value: "", label: "Tutte" }, ...s.tipologie.map((t) => t.nome)], state.tipo, { onChange: (e) => { state.tipo = e.target.value; draw(); } });
  const ckDisp = checkbox("Solo disponibili", state.soloDisp);
  ckDisp.input.addEventListener("change", () => { state.soloDisp = ckDisp.input.checked; draw(); });

  const sel = () => store.db.magazzino.find((a) => a.id === state.selected) || null;
  const needSel = () => { const a = sel(); if (!a) toast("Selezionare prima una riga del magazzino.", "warn"); return a; };

  const modifica = async (a) => { if (await flussoModificaArticolo(a)) rerender(); };
  const cambiaCodice = async (a) => {
    const nuovo = await promptDialog("Inserire nuovo codice:", a.codice, { title: "Cambio codice" });
    if (nuovo === null || !trim(nuovo) || trim(nuovo).toUpperCase() === a.codice) return;
    try { L.cambiaCodice(a.id, nuovo); toast(`Codice ${a.codice} aggiornato in ${trim(nuovo).toUpperCase()} (anche su movimenti e vendite)`, "ok"); rerender(); }
    catch (e) { alertDialog(e.message); }
  };
  const cancella = async (a) => {
    const nMov = store.db.movimenti.filter((m) => m.codice === a.codice).length;
    const nVen = store.db.vendite.filter((v) => v.codice === a.codice).length;
    const ok = await confirmDialog(`Sei sicuro di voler cancellare il codice ${a.codice} (${a.tipologia} ${a.descrizione} ${a.decoro}, giacenza ${num(a.giacenza)})?\nCome nel file Excel verranno cancellati anche tutti i movimenti di magazzino (${nMov}) e le vendite (${nVen}) corrispondenti: i ricavi storici diminuiranno.`, { title: "Cancella codice", ok: "Cancella tutto", cancel: "Annulla", danger: true });
    if (!ok) return;
    const r = L.cancellaArticolo(a.id);
    state.selected = null;
    toast(`Codice ${r.codice} eliminato con ${r.movimentiEliminati} movimenti e ${r.venditeEliminate} vendite`, "warn");
    rerender();
  };

  const toolbar = el("div", { class: "toolbar" },
    el("button", { class: "btn green", onClick: async () => { await flussoCarico(); rerender(); } }, "＋ Carico a magazzino"),
    el("button", { class: "btn", onClick: () => { const a = needSel(); if (a) modifica(a); } }, "Modifica"),
    el("button", { class: "btn", onClick: () => { const a = needSel(); if (a) cambiaCodice(a); } }, "Mod. codice"),
    el("button", { class: "btn danger", onClick: () => { const a = needSel(); if (a) cancella(a); } }, "Canc."),
    el("button", { class: "btn", onClick: () => apriVerifica(rerender) }, "Verifica coerenza"),
    el("button", { class: "btn ghost", onClick: () => esportaCsv(rows, consumo) }, "Esporta CSV"),
  );

  const wrap = el("div", { class: "table-wrap" });
  const foot = el("div", { class: "table-foot" });
  const columns = [
    { key: "codice", label: "Codice", cls: "nowrap mono" }, { key: "tipologia", label: "Tipologia" }, { key: "descrizione", label: "Descrizione" },
    { key: "dimensioni", label: "Dimensioni" }, { key: "decoro", label: "Decoro" },
    { key: "consumo", label: "Consumo 12 mesi", num: true, sortValue: (r) => consumo.get(r.codice) || 0, render: (r) => num(consumo.get(r.codice) || 0) },
    { key: "giacenza", label: "Giacenza", num: true, render: (r) => el("span", { class: r.giacenza < 0 ? "neg" : (r.giacenza === 0 ? "zero" : ""), text: num(r.giacenza) }) },
    { key: "costo", label: "Costo", num: true, render: (r) => eur(r.costo) },
    { key: "valore", label: "Valore totale", num: true, sortValue: (r) => L.valoreArticolo(r), render: (r) => eur(L.valoreArticolo(r)) },
    { key: "fornitore", label: "Fornitore primario" },
    { key: "prezzo", label: "Prezzo", num: true, render: (r) => eur(r.prezzo) },
    { key: "_a", label: "", sortable: false, cls: "actions", render: (r) => el("span", {},
      el("button", { class: "btn xs", title: "Modifica", onClick: (e) => { e.stopPropagation(); modifica(r); } }, "✎"), " ",
      el("button", { class: "btn xs danger", title: "Cancella", onClick: (e) => { e.stopPropagation(); cancella(r); } }, "✕")) },
  ];
  function draw() {
    const filtered = store.db.magazzino.filter((a) =>
      (!state.tipo || a.tipologia === state.tipo) && (!state.soloDisp || a.giacenza > 0)
      && (!state.q || [a.codice, a.descrizione, a.dimensioni, a.decoro, a.fornitore, a.tipologia].some((f) => like(f, state.q))));
    wrap.innerHTML = "";
    const t = dataTable(columns, filtered, state, { rowKey: (r) => r.id, selectedKey: state.selected, onRowClick: (r) => { state.selected = r.id; draw(); }, onRowDblClick: (r) => modifica(r), onSort: draw, limit: state.showAll ? null : 600 });
    wrap.append(t);
    foot.innerHTML = "";
    foot.append(
      el("span", {}, `${filtered.length} articoli${t.truncated ? ` (mostrati ${t.shownCount})` : ""} · pezzi ${num(filtered.reduce((a, r) => a + (Number(r.giacenza) || 0), 0))} · valore ${eur(filtered.reduce((a, r) => a + L.valoreArticolo(r), 0))}`),
      t.truncated ? el("button", { class: "btn xs", onClick: () => { state.showAll = true; draw(); } }, "Mostra tutti") : el("span", { class: "hint", text: "Clic su una riga per selezionarla, doppio clic per modificarla, clic sull'intestazione per ordinare." }),
    );
  }
  draw();
  root.append(
    el("div", { class: "page-head" }, el("div", {}, el("h2", { text: "Magazzino" }), el("p", { text: `${store.db.magazzino.length} codici · ${num(totGiac)} pezzi · valore ${eur(totVal)}` })), toolbar),
    el("div", { class: "filters" }, field("Cerca", inQ, { cls: "wide" }), field("Tipologia", selTipo), ckDisp),
    wrap, foot,
  );
}

function esportaCsv(rows, consumo) {
  const head = ["Codice", "Tipologia", "Descrizione", "Dimensioni", "Decoro", "Consumo 12 mesi", "Giacenza", "Costo", "Valore totale", "Fornitore", "Prezzo"];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [head.join(";"), ...rows.map((a) => [a.codice, a.tipologia, a.descrizione, a.dimensioni, a.decoro, consumo.get(a.codice) || 0, a.giacenza, String(a.costo).replace(".", ","), String(L.valoreArticolo(a)).replace(".", ","), a.fornitore, a.prezzo ?? ""].map(esc).join(";"))];
  downloadText("magazzino.csv", "﻿" + lines.join("\r\n"), "text/csv");
}

/** Finestra "Verifica coerenza": giacenze vs movimenti, codici duplicati, anomalie costi (check_mov). */
export function apriVerifica(rerender) {
  const problemi = L.verificaIntegrita();
  const anomalieCosti = L.checkMovimenti();
  const body = el("div", {});
  if (!problemi.length) body.append(el("div", { class: "banner info", text: "Nessuna anomalia: tutte le giacenze coincidono con la somma dei movimenti e non ci sono codici duplicati." }));
  else {
    body.append(el("div", { class: "banner danger", text: `${problemi.length} anomalie trovate. Ogni correzione viene tracciata con un movimento di tipo "Correzione".` }));
    const list = el("div", { class: "table-wrap", style: { maxHeight: "40vh" } });
    list.append(dataTable([
      { key: "tipo", label: "Tipo", render: (p) => el("span", { class: "tag", text: p.tipo }) },
      { key: "testo", label: "Dettaglio" },
      { key: "_a", label: "", sortable: false, cls: "actions", render: (p) => p.tipo === "giacenza" ? el("span", {},
        el("button", { class: "btn xs", title: "Porta la giacenza al valore dei movimenti", onClick: () => { L.allineaGiacenza(p.codice, true); toast(`${p.codice}: giacenza allineata ai movimenti`, "ok"); api.close(); apriVerifica(rerender); rerender(); } }, "Usa movimenti"), " ",
        el("button", { class: "btn xs", title: "Mantieni la giacenza e registra un movimento di correzione", onClick: () => { L.allineaGiacenza(p.codice, false); toast(`${p.codice}: registrata correzione`, "ok"); api.close(); apriVerifica(rerender); rerender(); } }, "Tieni giacenza")) : "" },
    ], problemi, { sortKey: "tipo" }));
    body.append(list);
  }
  const costiBox = el("div", { style: { marginTop: "14px" } },
    el("h3", { text: `Check costi movimenti: ${anomalieCosti.length} differenze` }),
    el("p", { class: "hint", text: "Come il pulsante \"Check\" di Excel: confronta il costo registrato sui movimenti di carico con il costo attuale dell'articolo. Le differenze sono normali quando il costo d'acquisto è cambiato nel tempo; sovrascriverle modifica il calcolo storico dei debiti verso i fornitori." }),
    anomalieCosti.length ? el("div", { class: "table-wrap", style: { maxHeight: "30vh" } }, dataTable([{ key: "testo", label: "Anomalia" }], anomalieCosti.slice(0, 500), {})) : null,
    anomalieCosti.length ? el("button", { class: "btn sm", style: { marginTop: "8px" }, onClick: async () => { if (await confirmDialog(`Allineare il costo di ${anomalieCosti.length} movimenti al costo attuale degli articoli?`, { title: "Correggere?", danger: true })) { const n = L.correggiCostiMovimenti(); toast(`${n} movimenti corretti`, "ok"); api.close(); rerender(); } } }, "Correggi costi movimenti") : null,
  );
  const api = openModal({ title: "Verifica coerenza magazzino", width: "900px", body: [body, costiBox], buttons: [{ label: "Chiudi", class: "primary", onClick: (a) => a.close() }] });
}
