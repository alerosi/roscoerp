// Registri: Vendite, Movimenti, Spese (fogli omonimi di Excel) con filtri, ordinamento e cancellazione.

import { store } from "../store.js";
import * as L from "../logic.js";
import { flussoVendita, flussoIncasso, flussoSpesa, formSpesa, formModificaVendita } from "../forms.js";
import { el, eur, num, pct, fmtDateTime, like, toDay, parseDate, floorDay, addDays, downloadText } from "../util.js";
import { dataTable, field, textInput, select, checkbox, toast, confirmDialog, alertDialog } from "../ui.js";
import { apriVerifica } from "./magazzino.js";

const stV = { sortKey: "data", sortDir: -1, q: "", da: "", a: "", op: "", selected: null, showAll: false, periodo: true };
const stM = { sortKey: "data", sortDir: -1, q: "", tipo: "", selected: null, showAll: false };
const stS = { sortKey: "data", sortDir: -1, q: "", tipo: "", selected: null, showAll: false, periodo: true };

function inPeriodo(dateStr, dataIn, dataEnd) {
  const d = parseDate(dateStr);
  return d >= floorDay(dataIn) && d < addDays(floorDay(dataEnd), 1);
}
function footer(t, totalText, state, draw) {
  return el("div", { class: "table-foot" }, el("span", { text: totalText + (t.truncated ? ` (mostrate ${t.shownCount} righe)` : "") }),
    t.truncated ? el("button", { class: "btn xs", onClick: () => { state.showAll = true; draw(); } }, "Mostra tutte") : el("span", { class: "hint", text: "Clic sull'intestazione per ordinare." }));
}
const csv = (name, head, rows) => downloadText(name, "﻿" + [head.join(";"), ...rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";"))].join("\r\n"), "text/csv");

// ================================================================= VENDITE
export function renderVendite(root, rerender) {
  const s = store.db.settings;
  const arts = L.articoliByCodice();
  const { dataIn, dataEnd } = L.risolviPeriodo();
  const desc = (v) => { const a = arts.get(v.codice); return a ? [a.tipologia, a.descrizione, a.dimensioni, a.decoro].filter(Boolean).join(" · ") : (L.CODICI_SPECIALI.includes(v.codice) ? "" : "(codice non in magazzino)"); };
  const filtered = () => store.db.vendite.filter((v) =>
    (!stV.periodo || inPeriodo(v.data, dataIn, dataEnd)) && (!stV.op || v.operatore === stV.op)
    && (!stV.q || like(v.codice, stV.q) || like(desc(v), stV.q) || like(v.cliente, stV.q) || like(v.zona, stV.q) || like(v.pagamento, stV.q)));

  const cancella = async (v) => {
    const ok = await confirmDialog(`Sei sicuro di voler cancellare la vendita del ${fmtDateTime(v.data)} (${v.codice} × ${num(v.qta)}, ${eur(L.prezzoTotVendita(v))})?${L.CODICI_SPECIALI.includes(v.codice) ? "" : "\nLa quantità tornerà in magazzino e il movimento di vendita sarà rimosso."}`, { title: "Cancella vendita", ok: "Cancella", cancel: "Annulla", danger: true });
    if (!ok) return;
    try { const r = L.cancellaVendita(v.id); toast(r.ripristinato ? `Vendita cancellata, ${num(r.ripristinato)} pezzi tornati su ${r.codice}` : "Incasso cancellato", "ok"); rerender(); }
    catch (e) { alertDialog(e.message); }
  };
  const modifica = async (v) => { const r = await formModificaVendita(v); if (r) { L.modificaVendita(v.id, r); toast("Vendita aggiornata", "ok"); rerender(); } };
  const sel = () => store.db.vendite.find((v) => v.id === stV.selected);

  const wrap = el("div", { class: "table-wrap" });
  const footBox = el("div");
  const columns = [
    { key: "data", label: "Data", cls: "nowrap", render: (v) => fmtDateTime(v.data) },
    { key: "codice", label: "Codice", cls: "nowrap mono", render: (v) => L.CODICI_SPECIALI.includes(v.codice) ? el("span", { class: "tag speciale", text: v.codice }) : v.codice },
    { key: "_d", label: "Articolo", sortValue: desc, render: (v) => el("span", { class: "small", text: desc(v) }) },
    { key: "qta", label: "Q.tà", num: true, render: (v) => num(v.qta) },
    { key: "prezzo", label: "Prezzo", num: true, render: (v) => eur(v.prezzo) },
    { key: "_pt", label: "Prezzo tot.", num: true, sortValue: L.prezzoTotVendita, render: (v) => eur(L.prezzoTotVendita(v)) },
    { key: "costo", label: "Costo", num: true, render: (v) => eur(v.costo) },
    { key: "_ct", label: "Costo tot.", num: true, sortValue: L.costoTotVendita, render: (v) => eur(L.costoTotVendita(v)) },
    { key: "_mu", label: "MU", num: true, sortValue: L.muVendita, render: (v) => { const m = L.muVendita(v); return m ? num(m) : ""; } },
    { key: "iva", label: "IVA", render: (v) => v.iva ? `sì ${v.ivaVal ? pct(v.ivaVal) : ""}` : "no" },
    { key: "cliente", label: "Cliente" }, { key: "zona", label: "Zona" }, { key: "pagamento", label: "Pagamento" }, { key: "operatore", label: "Operatore" },
    { key: "_a", label: "", sortable: false, cls: "actions", render: (v) => el("span", {}, el("button", { class: "btn xs", title: "Modifica", onClick: (e) => { e.stopPropagation(); modifica(v); } }, "✎"), " ", el("button", { class: "btn xs danger", title: "Cancella", onClick: (e) => { e.stopPropagation(); cancella(v); } }, "✕")) },
  ];
  const draw = () => {
    const rows = filtered();
    wrap.innerHTML = "";
    const t = dataTable(columns, rows, stV, { rowKey: (r) => r.id, selectedKey: stV.selected, onRowClick: (r) => { stV.selected = r.id; draw(); }, onSort: draw, limit: stV.showAll ? null : 500 });
    wrap.append(t);
    const tot = rows.reduce((a, v) => a + L.prezzoTotVendita(v), 0);
    const netto = rows.reduce((a, v) => a + L.nettoVendita(v), 0);
    footBox.innerHTML = "";
    footBox.append(footer(t, `${rows.length} righe · incassato ${eur(tot)} (netto IVA ${eur(netto)}) · pezzi ${num(rows.reduce((a, v) => a + (L.CODICI_SPECIALI.includes(v.codice) ? 0 : Number(v.qta) || 0), 0))}`, stV, draw));
  };
  const inQ = textInput(stV.q, { placeholder: "codice, articolo, cliente…", onInput: (e) => { stV.q = e.target.value; draw(); } });
  const selOp = select([{ value: "", label: "Tutti" }, ...s.operatori], stV.op, { onChange: (e) => { stV.op = e.target.value; draw(); } });
  const ckPer = checkbox(`Solo periodo del pannello (${toDay(dataIn)} → ${toDay(dataEnd)})`, stV.periodo);
  ckPer.input.addEventListener("change", () => { stV.periodo = ckPer.input.checked; draw(); });
  draw();
  root.append(
    el("div", { class: "page-head" }, el("div", {}, el("h2", { text: "Vendite" }), el("p", { text: `${store.db.vendite.length} vendite registrate in totale` })),
      el("div", { class: "toolbar" },
        el("button", { class: "btn primary", onClick: async () => { await flussoVendita(); rerender(); } }, "＋ Vendita diretta"),
        el("button", { class: "btn ochre", onClick: async () => { await flussoIncasso(); rerender(); } }, "＋ Incasso"),
        el("button", { class: "btn", onClick: () => { const v = sel(); if (v) modifica(v); else toast("Selezionare una vendita.", "warn"); } }, "Modifica"),
        el("button", { class: "btn danger", onClick: () => { const v = sel(); if (v) cancella(v); else toast("Selezionare una vendita.", "warn"); } }, "Canc."),
        el("button", { class: "btn ghost", onClick: () => csv("vendite.csv", ["Data", "Codice", "Articolo", "Qta", "Prezzo", "Prezzo tot", "Costo", "Costo tot", "IVA", "Val IVA", "Cliente", "Zona", "Pagamento", "Operatore"], filtered().map((v) => [v.data, v.codice, desc(v), v.qta, v.prezzo, L.prezzoTotVendita(v), v.costo ?? "", L.costoTotVendita(v) ?? "", v.iva ? 1 : 0, v.ivaVal, v.cliente, v.zona, v.pagamento, v.operatore])) }, "Esporta CSV"))),
    el("div", { class: "filters" }, field("Cerca", inQ, { cls: "wide" }), field("Operatore", selOp), ckPer),
    wrap, footBox,
  );
}

// ================================================================= MOVIMENTI
export function renderMovimenti(root, rerender) {
  const arts = L.articoliByCodice();
  const filtered = () => store.db.movimenti.filter((m) => (!stM.tipo || m.tipo === stM.tipo) && (!stM.q || like(m.codice, stM.q) || like(m.fornitore, stM.q) || like(m.utente, stM.q)));
  const wrap = el("div", { class: "table-wrap" });
  const footBox = el("div");
  const columns = [
    { key: "data", label: "Data", cls: "nowrap", render: (m) => fmtDateTime(m.data) },
    { key: "utente", label: "Utente" },
    { key: "codice", label: "Codice", cls: "nowrap mono", render: (m) => arts.has(m.codice) ? m.codice : el("span", { class: "neg", title: "Codice non presente in magazzino", text: m.codice }) },
    { key: "_d", label: "Articolo", sortValue: (m) => { const a = arts.get(m.codice); return a ? a.descrizione : ""; }, render: (m) => { const a = arts.get(m.codice); return el("span", { class: "small", text: a ? [a.tipologia, a.descrizione, a.dimensioni, a.decoro].filter(Boolean).join(" · ") : "" }); } },
    { key: "movimento", label: "Movimento", num: true, render: (m) => el("span", { class: m.movimento < 0 ? "neg" : "", text: (m.movimento > 0 ? "+" : "") + num(m.movimento) }) },
    { key: "costo", label: "Costo", num: true, render: (m) => eur(m.costo) },
    { key: "fornitore", label: "Fornitore" },
    { key: "tipo", label: "Tipologia", render: (m) => el("span", { class: `tag ${String(m.tipo).toLowerCase()}`, text: m.tipo }) },
  ];
  const draw = () => {
    const rows = filtered();
    wrap.innerHTML = "";
    const t = dataTable(columns, rows, stM, { rowKey: (r) => r.id, onSort: draw, limit: stM.showAll ? null : 500 });
    wrap.append(t);
    footBox.innerHTML = "";
    footBox.append(footer(t, `${rows.length} movimenti · saldo pezzi ${num(rows.reduce((a, m) => a + (Number(m.movimento) || 0), 0))}`, stM, draw));
  };
  const inQ = textInput(stM.q, { placeholder: "codice, fornitore, utente…", onInput: (e) => { stM.q = e.target.value; draw(); } });
  const selTipo = select([{ value: "", label: "Tutti" }, "Carico", "Vendita", "Correzione"], stM.tipo, { onChange: (e) => { stM.tipo = e.target.value; draw(); } });
  draw();
  root.append(
    el("div", { class: "page-head" }, el("div", {}, el("h2", { text: "Movimenti di magazzino" }), el("p", { text: "Ogni carico, vendita e correzione lascia una riga: la giacenza di ogni codice deve coincidere con la somma dei suoi movimenti." })),
      el("div", { class: "toolbar" }, el("button", { class: "btn", onClick: () => apriVerifica(rerender) }, "Check"),
        el("button", { class: "btn ghost", onClick: () => csv("movimenti.csv", ["Data", "Utente", "Codice", "Movimento", "Costo", "Fornitore", "Tipologia"], filtered().map((m) => [m.data, m.utente, m.codice, m.movimento, m.costo ?? "", m.fornitore, m.tipo])) }, "Esporta CSV"))),
    el("div", { class: "filters" }, field("Cerca", inQ, { cls: "wide" }), field("Tipologia", selTipo)),
    wrap, footBox,
  );
}

// ================================================================= SPESE
export function renderSpese(root, rerender) {
  const s = store.db.settings;
  const { dataIn, dataEnd } = L.risolviPeriodo();
  const dirette = new Set(s.tipologieSpese.filter((t) => t.diretta).map((t) => t.nome));
  const filtered = () => store.db.spese.filter((x) => (!stS.periodo || inPeriodo(x.data, dataIn, dataEnd)) && (!stS.tipo || x.tipologia === stS.tipo) && (!stS.q || like(x.descrizione, stS.q) || like(x.fornitore, stS.q) || like(x.tipologia, stS.q)));
  const cancella = async (x) => {
    if (!await confirmDialog(`Sei sicuro di voler cancellare la spesa "${x.tipologia}" di ${eur(x.spesa)} del ${fmtDateTime(x.data)}?`, { title: "Cancella spesa", ok: "Cancella", cancel: "Annulla", danger: true })) return;
    L.cancellaSpesa(x.id); toast("Spesa cancellata", "ok"); rerender();
  };
  const modifica = async (x) => { const r = await formSpesa(x); if (r) { L.modificaSpesa(x.id, r); toast("Spesa aggiornata", "ok"); rerender(); } };
  const sel = () => store.db.spese.find((x) => x.id === stS.selected);
  const wrap = el("div", { class: "table-wrap" });
  const footBox = el("div");
  const columns = [
    { key: "data", label: "Data", cls: "nowrap", render: (x) => fmtDateTime(x.data) },
    { key: "utente", label: "Utente" },
    { key: "tipologia", label: "Tipologia", render: (x) => el("span", { class: `tag ${dirette.has(x.tipologia) ? "carico" : ""}`, title: dirette.has(x.tipologia) ? "Spesa diretta" : "Spesa generale", text: x.tipologia }) },
    { key: "descrizione", label: "Descrizione" },
    { key: "spesa", label: "Spesa", num: true, render: (x) => eur(x.spesa) },
    { key: "_n", label: "Netto IVA", num: true, sortValue: (x) => x.spesa / (1 + (x.iva ? x.ivaVal : 0)), render: (x) => eur(x.spesa / (1 + (x.iva ? x.ivaVal : 0))) },
    { key: "fornitore", label: "Fornitore" },
    { key: "iva", label: "IVA", render: (x) => x.iva ? `sì ${pct(x.ivaVal)}` : "no" },
    { key: "_a", label: "", sortable: false, cls: "actions", render: (x) => el("span", {}, el("button", { class: "btn xs", title: "Modifica", onClick: (e) => { e.stopPropagation(); modifica(x); } }, "✎"), " ", el("button", { class: "btn xs danger", title: "Cancella", onClick: (e) => { e.stopPropagation(); cancella(x); } }, "✕")) },
  ];
  const draw = () => {
    const rows = filtered();
    wrap.innerHTML = "";
    const t = dataTable(columns, rows, stS, { rowKey: (r) => r.id, selectedKey: stS.selected, onRowClick: (r) => { stS.selected = r.id; draw(); }, onRowDblClick: modifica, onSort: draw, limit: stS.showAll ? null : 500 });
    wrap.append(t);
    footBox.innerHTML = "";
    footBox.append(footer(t, `${rows.length} spese · totale ${eur(rows.reduce((a, x) => a + (Number(x.spesa) || 0), 0))}`, stS, draw));
  };
  const inQ = textInput(stS.q, { placeholder: "descrizione, fornitore…", onInput: (e) => { stS.q = e.target.value; draw(); } });
  const selTipo = select([{ value: "", label: "Tutte" }, ...s.tipologieSpese.map((t) => t.nome)], stS.tipo, { onChange: (e) => { stS.tipo = e.target.value; draw(); } });
  const ckPer = checkbox(`Solo periodo del pannello (${toDay(dataIn)} → ${toDay(dataEnd)})`, stS.periodo);
  ckPer.input.addEventListener("change", () => { stS.periodo = ckPer.input.checked; draw(); });
  draw();
  root.append(
    el("div", { class: "page-head" }, el("div", {}, el("h2", { text: "Spese" }), el("p", { text: `${store.db.spese.length} spese registrate in totale` })),
      el("div", { class: "toolbar" }, el("button", { class: "btn terracotta", onClick: async () => { await flussoSpesa(); rerender(); } }, "＋ Aggiungi spesa"),
        el("button", { class: "btn", onClick: () => { const x = sel(); if (x) modifica(x); else toast("Selezionare una spesa.", "warn"); } }, "Modifica"),
        el("button", { class: "btn danger", onClick: () => { const x = sel(); if (x) cancella(x); else toast("Selezionare una spesa.", "warn"); } }, "Canc."),
        el("button", { class: "btn ghost", onClick: () => csv("spese.csv", ["Data", "Utente", "Tipologia", "Descrizione", "Spesa", "Fornitore", "IVA", "Val IVA"], filtered().map((x) => [x.data, x.utente, x.tipologia, x.descrizione, x.spesa, x.fornitore, x.iva ? 1 : 0, x.ivaVal])) }, "Esporta CSV"))),
    el("div", { class: "filters" }, field("Cerca", inQ, { cls: "wide" }), field("Tipologia", selTipo), ckPer),
    wrap, footBox,
  );
}
