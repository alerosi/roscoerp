// Finestre di inserimento: porting delle UserForm VBA (carica, seleziona, vendita, incasso, spesa).

import { store } from "./store.js";
import * as L from "./logic.js";
import { openModal, field, textInput, numInput, checkbox, combo, listbox, dataTable, toast, confirmDialog, yesNoCancel, alertDialog, select } from "./ui.js";
import { el, trim, val, eur, num, fmtDateTime, toIso, parseDate, nowIso, lc } from "./util.js";

const S = () => store.db.settings;
const ivaPct = () => Number(S().ivaDefault) || 22;

// ============================================================ UserForm_seleziona
/** Mostra gli articoli che corrispondono ai filtri ("contiene"); risolve l'articolo scelto o null. */
export function formSeleziona(filtri) {
  return new Promise((resolve) => {
    const rows = L.cercaArticoli(filtri);
    if (!rows.length) { alertDialog("Nessun codice risponde ai parametri inseriti").then(() => resolve(null)); return; }
    let chosen = null;
    const state = { sortKey: "codice", sortDir: 1 };
    const wrap = el("div", { class: "table-wrap", style: { maxHeight: "50vh" } });
    const render = () => {
      wrap.innerHTML = "";
      wrap.append(dataTable([
        { key: "codice", label: "Codice" }, { key: "tipologia", label: "Tipologia" }, { key: "descrizione", label: "Descrizione" },
        { key: "dimensioni", label: "Dimensioni" }, { key: "decoro", label: "Decoro" }, { key: "giacenza", label: "Giac.", num: true },
        { key: "costo", label: "Costo", num: true, render: (r) => eur(r.costo) }, { key: "fornitore", label: "Fornitore" },
      ], rows, state, { rowKey: (r) => r.id, selectedKey: chosen && chosen.id, onRowClick: (r) => { chosen = r; render(); }, onRowDblClick: (r) => { chosen = r; api.close(r); }, onSort: render }));
    };
    const api = openModal({
      title: "Seleziona codice", width: "960px", body: [el("p", { class: "hint", text: `${rows.length} articoli trovati. Doppio clic per selezionare.` }), wrap],
      onClose: (r) => resolve(r || null),
      buttons: [{ label: "Annulla", onClick: (a) => a.close(null) }, { label: "Seleziona", class: "primary", onClick: (a) => { if (!chosen) toast("Selezionare un codice.", "warn"); else a.close(chosen); } }],
    });
    render();
  });
}

// ============================================================ UserForm_carica
/**
 * Form di carico/modifica articolo. mode: "Inserisci" | "Salva".
 * Risolve { tipo, descr, dim, decoro, qty, costo (netto), costoLordo, forn, prezzo, spesaAuto, iva, ivaVal, cerca } oppure null.
 */
export function formCarica(defaults = {}, mode = "Inserisci") {
  return new Promise((resolve) => {
    const s = S();
    const tipi = s.tipologie.map((t) => t.nome);
    const lbTipo = listbox(tipi, defaults.tipo || "", null, { height: "260px" });
    const inDescr = textInput(defaults.descr || "");
    const inDim = textInput(defaults.dim || "");
    const inDecoro = textInput(defaults.decoro || "");
    const inQty = numInput(defaults.qty ?? 1, { min: 0, step: 1 });
    const inCosto = numInput(defaults.costo ? defaults.costo : "", { min: 0, placeholder: "senza IVA" });
    const inPrezzo = numInput(defaults.prezzo ?? "", { min: 0 });
    const fornDefault = defaults.forn || (s.fornitori.find((f) => f.default) || {}).nome || "";
    const cbForn = combo(s.fornitori.map((f) => f.nome), fornDefault);
    const ckIva = checkbox("Il costo inserito include IVA", mode === "Inserisci" ? !!s.flags.ivaSuCostoCarico : false);
    const inIva = numInput(ivaPct(), { min: 0, max: 100, style: { width: "80px" } });
    inIva.disabled = !ckIva.input.checked;
    ckIva.input.addEventListener("change", () => { inIva.disabled = !ckIva.input.checked; });
    const ckSpesa = checkbox("Crea spesa in automatico (Materiale)", !!s.flags.spesaAutoCarico);
    const err = el("div", { class: "error-text" });

    const body = el("div", { class: "form-grid" },
      el("div", { class: "field", style: { gridRow: "span 4" } }, el("span", { text: "Tipologia" }), lbTipo),
      field("Descrizione", inDescr), field("Dimensioni", inDim), field("Decoro", inDecoro),
      field("Quantità", inQty),
      field("Costo unitario", el("div", { style: { display: "flex", gap: "8px", alignItems: "center" } }, inCosto)),
      field("Prezzo base (vendita)", inPrezzo),
      field("Fornitore", cbForn, { cls: "span-2" }),
      el("div", { class: "span-all", style: { display: "flex", gap: "18px", flexWrap: "wrap", alignItems: "center" } }, ckIva, el("span", { class: "hint" }, "IVA % ", inIva), mode === "Inserisci" ? ckSpesa : null),
      el("div", { class: "span-all" }, err),
    );
    const collect = () => {
      err.textContent = "";
      const tipo = lbTipo.getValue();
      if (!tipo) { err.textContent = "Selezionare una tipologia."; return null; }
      const qty = val(inQty.value);
      if (qty < 0 || (mode === "Inserisci" && qty <= 0)) { err.textContent = "Selezionare una quantità positiva."; return null; }
      const costoLordo = val(inCosto.value);
      if (costoLordo <= 0) { err.textContent = "Selezionare un costo positivo."; return null; }
      const iva = ckIva.input.checked;
      const ivaVal = iva ? val(inIva.value) / 100 : 0;
      const costo = iva ? costoLordo / (1 + ivaVal) : costoLordo;
      s.flags.spesaAutoCarico = ckSpesa.input.checked;
      if (mode === "Inserisci") s.flags.ivaSuCostoCarico = iva;
      return {
        tipo, descr: trim(inDescr.value), dim: trim(inDim.value), decoro: trim(inDecoro.value), qty, costo, costoLordo,
        forn: trim(cbForn.input.value), prezzo: trim(inPrezzo.value) === "" ? null : val(inPrezzo.value), spesaAuto: ckSpesa.input.checked, iva, ivaVal,
      };
    };
    const api = openModal({
      title: mode === "Inserisci" ? "Carico a magazzino" : "Modifica articolo", color: "green", width: "860px", body,
      onClose: (r) => resolve(r || null), focus: "input[type=text]",
      onEnter: (a) => { const r = collect(); if (r) a.close(r); },
      buttons: [
        { label: "Cerca", left: true, onClick: async () => {
          const art = await formSeleziona({ tipo: lbTipo.getValue() || "", descr: inDescr.value, dim: inDim.value, decoro: inDecoro.value });
          if (art) { lbTipo.setValue(art.tipologia); inDescr.value = art.descrizione; inDim.value = art.dimensioni; inDecoro.value = art.decoro; inCosto.value = art.costo || ""; cbForn.input.value = art.fornitore || ""; if (art.prezzo !== null && art.prezzo !== undefined) inPrezzo.value = art.prezzo; ckIva.input.checked = false; inIva.disabled = true; }
        } },
        { label: "Cancella", left: true, onClick: () => { lbTipo.clear(); inDescr.value = ""; inDim.value = ""; inDecoro.value = ""; inQty.value = 1; inCosto.value = ""; inPrezzo.value = ""; err.textContent = ""; } },
        { label: "Esci", onClick: (a) => a.close(null) },
        { label: mode, class: "primary", onClick: (a) => { const r = collect(); if (r) a.close(r); } },
      ],
    });
  });
}

/** Flusso completo "Carico a Magazzino" (carica_mag): ciclo di inserimenti con conferme. */
export async function flussoCarico() {
  let defaults = { qty: 1 };
  for (;;) {
    const r = await formCarica(defaults, "Inserisci");
    if (!r) break;
    const esistente = L.trovaArticoloUguale(r.tipo, r.descr, r.dim, r.decoro);
    const decisioni = {};
    if (esistente) {
      const diff = [];
      if (Math.abs((Number(esistente.costo) || 0) - r.costo) > 0.005) diff.push({ k: "aggiornaCosto", label: `Costo: in memoria ${eur(esistente.costo)}, inserito ${eur(r.costo)}` });
      if (lc(esistente.fornitore) !== lc(r.forn) && r.forn) {
        if (!esistente.fornitore) decisioni.aggiornaFornitore = true;
        else diff.push({ k: "aggiornaFornitore", label: `Fornitore: in memoria "${esistente.fornitore}", inserito "${r.forn}"` });
      }
      const prezzoMem = esistente.prezzo === null || esistente.prezzo === undefined ? null : Number(esistente.prezzo);
      if ((prezzoMem ?? null) !== (r.prezzo ?? null) && r.prezzo !== null) diff.push({ k: "aggiornaPrezzo", label: `Prezzo base: in memoria ${prezzoMem === null ? "(vuoto)" : eur(prezzoMem)}, inserito ${eur(r.prezzo)}` });
      if (diff.length) {
        const checks = diff.map((d) => ({ d, cb: checkbox(d.label, true) }));
        const ok = await confirmDialog(`L'articolo esiste già (${esistente.codice}, giacenza ${num(esistente.giacenza)}). Verranno aggiunti ${num(r.qty)} pezzi.\nAlcuni dati inseriti sono diversi da quelli in memoria: scegli cosa aggiornare.`, {
          title: "Articolo già presente", ok: "Carica", cancel: "Annulla carico", extra: el("div", { style: { display: "grid", gap: "6px" } }, checks.map((c) => c.cb)),
        });
        if (!ok) { toast("Carico annullato: nessuna modifica effettuata.", "warn"); defaults = { ...r, qty: r.qty, costo: r.costoLordo }; continue; }
        for (const c of checks) decisioni[c.d.k] = c.cb.input.checked;
      }
    }
    let res;
    try { res = L.eseguiCarico(r, decisioni); }
    catch (e) { await alertDialog(e.message); continue; }
    toast(`${res.nuovo ? "Nuovo articolo" : "Carico"} ${res.articolo.codice}: +${num(r.qty)} (giacenza ${num(res.articolo.giacenza)})`, "ok");
    if (res.fornitoreNuovo) {
      const add = await yesNoCancel(`Il fornitore "${res.fornitoreNuovo}" non è nella lista dei fornitori standard. Vuoi aggiungerlo?`);
      if (add === "yes") { L.aggiungiFornitore(res.fornitoreNuovo); store.commit("settings"); }
    }
    defaults = { qty: 1, forn: r.forn };
  }
}

/** Modifica articolo (modifica_mag). */
export async function flussoModificaArticolo(art) {
  const r = await formCarica({ tipo: art.tipologia, descr: art.descrizione, dim: art.dimensioni, decoro: art.decoro, qty: art.giacenza, costo: art.costo, forn: art.fornitore, prezzo: art.prezzo }, "Salva");
  if (!r) return false;
  const delta = r.qty - (Number(art.giacenza) || 0);
  if (delta !== 0) {
    const ok = await confirmDialog(`La giacenza passa da ${num(art.giacenza)} a ${num(r.qty)}: verrà registrato un movimento di Correzione di ${delta > 0 ? "+" : ""}${num(delta)}. Confermi?`, { title: "Correzione giacenza", ok: "Conferma", cancel: "Annulla" });
    if (!ok) return false;
  }
  try {
    const res = L.modificaArticolo(art.id, r);
    toast(`Articolo ${res.articolo.codice} aggiornato`, "ok");
    if (res.fornitoreNuovo) {
      const add = await yesNoCancel(`Il fornitore "${res.fornitoreNuovo}" non è nella lista dei fornitori standard. Vuoi aggiungerlo?`);
      if (add === "yes") { L.aggiungiFornitore(res.fornitoreNuovo); store.commit("settings"); }
    }
    return true;
  } catch (e) { await alertDialog(e.message); return false; }
}

// ============================================================ UserForm_vendita
export function formVendita(defaults = {}) {
  return new Promise((resolve) => {
    const s = S();
    const tipi = s.tipologie.map((t) => t.nome);
    let selected = defaults.oggetto || null;
    const inDescr = textInput(defaults.descr || "", { placeholder: "filtra…" });
    const inDim = textInput(defaults.dim || "", { placeholder: "filtra…" });
    const inDecoro = textInput(defaults.decoro || "", { placeholder: "filtra…" });
    const ckCosti = checkbox("Mostra costi", false);
    const ckSoloPrezzo = checkbox("Solo con prezzo", !!s.flags.soloConPrezzo);
    const ckGiac0 = checkbox("Includi giacenza 0", !!s.flags.mostraGiacenzaZero);
    const inQty = numInput(defaults.qty ?? 1, { min: 1, step: 1 });
    const inPrezzo = numInput(defaults.prezzo ? defaults.prezzo : "", { min: 0 });
    const ckIva = checkbox("IVA", true);
    const inIva = numInput(ivaPct(), { min: 0, max: 100, style: { width: "80px" } });
    ckIva.input.addEventListener("change", () => { inIva.disabled = !ckIva.input.checked; });
    const cbZona = combo(s.zone, defaults.zona || "");
    const cbPagam = combo(s.pagamenti, defaults.pagam || "");
    const cbCliente = combo(s.clienti, defaults.cliente || "");
    const opDefault = defaults.operatore || store.operatore || s.operatori[0] || "";
    const cbOper = combo(s.operatori, opDefault);
    const err = el("div", { class: "error-text" });
    const info = el("div", { class: "hint" });
    const wrap = el("div", { class: "table-wrap", style: { maxHeight: "260px" } });
    const state = { sortKey: "codice", sortDir: 1 };
    const lbTipo = listbox(tipi, defaults.tipo || "", () => renderList(), { height: "200px" });

    const filtered = () => L.cercaArticoli({ tipo: lbTipo.getValue() || "", descr: inDescr.value, dim: inDim.value, decoro: inDecoro.value }, { soloDisponibili: !ckGiac0.input.checked, soloConPrezzo: ckSoloPrezzo.input.checked });
    const renderList = () => {
      const rows = filtered();
      if (selected && !rows.some((r) => r.id === selected.id)) selected = null;
      wrap.innerHTML = "";
      info.textContent = `${rows.length} articoli`;
      wrap.append(dataTable([
        { key: "codice", label: "Codice" }, { key: "tipologia", label: "Tipologia" }, { key: "descrizione", label: "Descrizione" },
        { key: "dimensioni", label: "Dimens." }, { key: "decoro", label: "Decoro" },
        { key: "giacenza", label: "Giac.", num: true, render: (r) => el("span", { class: r.giacenza > 0 ? "" : "zero", text: num(r.giacenza) }) },
        { key: "costo", label: "Costo", num: true, render: (r) => ckCosti.input.checked ? eur(r.costo) : "***" },
        { key: "prezzo", label: "Prezzo", num: true, render: (r) => eur(r.prezzo) }, { key: "fornitore", label: "Fornitore" },
      ], rows, state, {
        rowKey: (r) => r.id, selectedKey: selected && selected.id, limit: 400,
        onRowClick: (r) => { selected = r; if (r.prezzo !== null && r.prezzo !== undefined && r.prezzo !== "") inPrezzo.value = r.prezzo; renderList(); },
        onRowDblClick: (r) => { selected = r; if (r.prezzo !== null && r.prezzo !== undefined) inPrezzo.value = r.prezzo; submit(); },
        onSort: renderList,
      }));
    };
    for (const i of [inDescr, inDim, inDecoro]) i.addEventListener("input", renderList);
    for (const c of [ckCosti, ckSoloPrezzo, ckGiac0]) c.input.addEventListener("change", renderList);

    const collect = () => {
      err.textContent = "";
      if (!selected) { err.textContent = "Selezionare un oggetto."; return null; }
      const qty = val(inQty.value);
      if (qty <= 0) { err.textContent = "Selezionare una quantità positiva."; return null; }
      if (trim(inPrezzo.value) === "" || val(inPrezzo.value) < 0) { err.textContent = "Indicare un prezzo di vendita positivo o nullo."; return null; }
      s.flags.soloConPrezzo = ckSoloPrezzo.input.checked;
      s.flags.mostraGiacenzaZero = ckGiac0.input.checked;
      return {
        codice: selected.codice, qty, prezzo: val(inPrezzo.value), tipo: lbTipo.getValue() || "", descr: trim(inDescr.value), dim: trim(inDim.value), decoro: trim(inDecoro.value),
        zona: trim(cbZona.input.value), pagam: trim(cbPagam.input.value), cliente: trim(cbCliente.input.value), iva: ckIva.input.checked, ivaVal: ckIva.input.checked ? val(inIva.value) / 100 : 0, operatore: trim(cbOper.input.value),
      };
    };
    const submit = () => { const r = collect(); if (r) api.close(r); };
    const body = [
      el("div", { class: "form-grid" },
        el("div", { class: "field", style: { gridRow: "span 3" } }, el("span", { text: "Tipologia" }), lbTipo),
        field("Descrizione", inDescr), field("Dimensioni", inDim), field("Decoro", inDecoro),
        el("div", { class: "span-2", style: { display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "center" } }, ckCosti, ckSoloPrezzo, ckGiac0, info),
      ),
      wrap,
      el("div", { class: "form-grid" },
        field("Quantità", inQty), field("Prezzo unitario (IVA incl.)", inPrezzo),
        el("div", { class: "field" }, el("span", { text: "IVA" }), el("div", { style: { display: "flex", gap: "8px", alignItems: "center" } }, ckIva, inIva, el("span", { class: "hint", text: "%" }))),
        field("Operatore", cbOper), field("Zona / Paese", cbZona), field("Pagamento", cbPagam), field("Cliente", cbCliente),
      ),
      err,
    ];
    const api = openModal({
      title: "Vendita diretta", width: "1100px", body, onClose: (r) => resolve(r || null), onEnter: submit, focus: "input[type=text]",
      buttons: [
        { label: "Cancella", left: true, onClick: () => { lbTipo.clear(); inDescr.value = ""; inDim.value = ""; inDecoro.value = ""; inQty.value = 1; inPrezzo.value = ""; selected = null; renderList(); } },
        { label: "Esci", onClick: (a) => a.close(null) },
        { label: "Inserisci", class: "primary", onClick: submit },
      ],
    });
    renderList();
  });
}

export async function flussoVendita() {
  let defaults = {};
  for (;;) {
    const r = await formVendita(defaults);
    if (!r) break;
    try {
      const v = L.eseguiVendita(r);
      const art = L.findArticolo(v.codice);
      toast(`Vendita registrata: ${v.codice} × ${num(v.qta)} a ${eur(v.prezzo)} (giacenza residua ${num(art.giacenza)})`, "ok");
    } catch (e) { await alertDialog(e.message); }
    defaults = { tipo: r.tipo, descr: r.descr, dim: r.dim, decoro: r.decoro, qty: r.qty, prezzo: r.prezzo, zona: r.zona, pagam: r.pagam, cliente: r.cliente, operatore: r.operatore };
  }
}

// ============================================================ UserForm_incasso
export function formIncasso() {
  return new Promise((resolve) => {
    const s = S();
    const inQty = numInput(1, { min: 1, step: 1 });
    const inPrezzo = numInput("", { min: 0 });
    const selTipo = select(["Incasso Generico", "Spedizione"], "Spedizione");
    const ckIva = checkbox("IVA", true);
    const inIva = numInput(ivaPct(), { min: 0, max: 100, style: { width: "80px" } });
    ckIva.input.addEventListener("change", () => { inIva.disabled = !ckIva.input.checked; });
    const cbZona = combo(s.zone, ""), cbPagam = combo(s.pagamenti, ""), cbCliente = combo(s.clienti, "");
    const cbOper = combo(s.operatori, store.operatore || s.operatori[0] || "");
    const err = el("div", { class: "error-text" });
    const collect = () => {
      err.textContent = "";
      if (val(inQty.value) <= 0) { err.textContent = "Selezionare una quantità positiva."; return null; }
      if (trim(inPrezzo.value) === "" || val(inPrezzo.value) < 0) { err.textContent = "Indicare un incasso positivo o nullo."; return null; }
      return { qty: val(inQty.value), prezzo: val(inPrezzo.value), zona: trim(cbZona.input.value), pagam: trim(cbPagam.input.value), cliente: trim(cbCliente.input.value), iva: ckIva.input.checked, ivaVal: ckIva.input.checked ? val(inIva.value) / 100 : 0, tipo: selTipo.value, operatore: trim(cbOper.input.value) };
    };
    const api = openModal({
      title: "Incasso", color: "ochre", width: "620px",
      body: [el("div", { class: "form-grid" },
        field("Tipo di incasso", selTipo), field("Quantità", inQty), field("Importo unitario (IVA incl.)", inPrezzo),
        el("div", { class: "field" }, el("span", { text: "IVA" }), el("div", { style: { display: "flex", gap: "8px", alignItems: "center" } }, ckIva, inIva, el("span", { class: "hint", text: "%" }))),
        field("Operatore", cbOper), field("Zona / Paese", cbZona), field("Pagamento", cbPagam), field("Cliente", cbCliente)), err],
      onClose: (r) => resolve(r || null), onEnter: (a) => { const r = collect(); if (r) a.close(r); }, focus: "input[type=number]:not([style])",
      buttons: [{ label: "Esci", onClick: (a) => a.close(null) }, { label: "Inserisci", class: "primary", onClick: (a) => { const r = collect(); if (r) a.close(r); } }],
    });
  });
}
export async function flussoIncasso() {
  for (;;) {
    const r = await formIncasso();
    if (!r) break;
    try { const v = L.eseguiIncasso(r); toast(`${v.codice}: ${num(v.qta)} × ${eur(v.prezzo)} registrato`, "ok"); }
    catch (e) { await alertDialog(e.message); }
  }
}

// ============================================================ UserForm_spesa
export function formSpesa(defaults = null) {
  return new Promise((resolve) => {
    const s = S();
    const edit = !!defaults;
    const cbTipo = combo(s.tipologieSpese.map((t) => t.nome), defaults ? defaults.tipologia : "");
    const inDescr = textInput(defaults ? defaults.descrizione : "");
    const inSpesa = numInput(defaults ? defaults.spesa : "", { placeholder: "IVA inclusa" });
    const cbForn = combo(s.fornitori.map((f) => f.nome), defaults ? defaults.fornitore : "");
    const d = defaults ? parseDate(defaults.data) : new Date();
    const inData = el("input", { type: "datetime-local", value: toIso(d).slice(0, 16) });
    const ckIva = checkbox("IVA", defaults ? !!defaults.iva : false);
    const inIva = numInput(defaults && defaults.iva ? Math.round(defaults.ivaVal * 10000) / 100 : ivaPct(), { min: 0, max: 100, style: { width: "80px" } });
    inIva.disabled = !ckIva.input.checked;
    ckIva.input.addEventListener("change", () => { inIva.disabled = !ckIva.input.checked; });
    const err = el("div", { class: "error-text" });
    const fornHint = el("span", { class: "hint", text: "Selezionabile solo per tipologia \"Materiale\"" });
    const syncForn = () => { const isMat = lc(cbForn.input.value) === "" || lc(cbTipo.input.value) === "materiale"; if (lc(cbTipo.input.value) !== "materiale" && cbForn.input.value) { cbForn.input.value = ""; } cbForn.input.disabled = lc(cbTipo.input.value) !== "materiale"; return isMat; };
    cbTipo.input.addEventListener("input", syncForn);
    syncForn();
    const collect = () => {
      err.textContent = "";
      if (!trim(cbTipo.input.value)) { err.textContent = "Indicare una tipologia."; return null; }
      if (val(inSpesa.value) === 0) { err.textContent = "Indicare un valore diverso da zero."; return null; }
      if (!inData.value) { err.textContent = "Indicare una data."; return null; }
      return { tipologia: trim(cbTipo.input.value), descrizione: trim(inDescr.value), spesa: val(inSpesa.value), fornitore: trim(cbForn.input.value), data: parseDate(inData.value), iva: ckIva.input.checked, ivaVal: ckIva.input.checked ? val(inIva.value) / 100 : 0 };
    };
    const api = openModal({
      title: edit ? "Modifica spesa" : "Aggiungi spesa", color: "terracotta", width: "640px",
      body: [el("div", { class: "form-grid" },
        field("Tipologia", cbTipo), field("Importo (IVA inclusa)", inSpesa), field("Descrizione", inDescr, { cls: "span-2" }),
        field("Fornitore", el("div", {}, cbForn, fornHint)), field("Data e ora", inData),
        el("div", { class: "field" }, el("span", { text: "IVA" }), el("div", { style: { display: "flex", gap: "8px", alignItems: "center" } }, ckIva, inIva, el("span", { class: "hint", text: "%" })))), err],
      onClose: (r) => resolve(r || null), onEnter: (a) => { const r = collect(); if (r) a.close(r); },
      buttons: [{ label: "Esci", onClick: (a) => a.close(null) }, { label: edit ? "Salva" : "Inserisci", class: "primary", onClick: (a) => { const r = collect(); if (r) a.close(r); } }],
    });
  });
}
export async function flussoSpesa() {
  for (;;) {
    const r = await formSpesa();
    if (!r) break;
    L.creaSpesa(r);
    store.commit("spese");
    toast(`Spesa "${r.tipologia}" di ${eur(r.spesa)} registrata`, "ok");
    if (r.tipologia && !L.tipologiaSpesaEsiste(r.tipologia)) {
      const add = await confirmDialog(`Vuoi aggiungere la tipologia di spesa "${r.tipologia}"?`);
      if (add) {
        const diretta = await confirmDialog("Questa nuova tipologia è una spesa diretta sul prodotto venduto?", { title: "Spesa diretta?" });
        L.aggiungiTipologiaSpesa(r.tipologia, diretta); store.commit("settings");
      }
    }
    if (r.fornitore && !L.fornitoreEsiste(r.fornitore)) {
      const add = await confirmDialog(`Vuoi aggiungere il fornitore "${r.fornitore}"?`);
      if (add) { L.aggiungiFornitore(r.fornitore); store.commit("settings"); }
    }
  }
}

// ============================================================ Modifica vendita (solo campi non di magazzino)
export function formModificaVendita(v) {
  return new Promise((resolve) => {
    const s = S();
    const inPrezzo = numInput(v.prezzo, { min: 0 });
    const ckIva = checkbox("IVA", !!v.iva);
    const inIva = numInput(v.iva ? Math.round(v.ivaVal * 10000) / 100 : ivaPct(), { min: 0, max: 100, style: { width: "80px" } });
    inIva.disabled = !ckIva.input.checked;
    ckIva.input.addEventListener("change", () => { inIva.disabled = !ckIva.input.checked; });
    const cbZona = combo(s.zone, v.zona), cbPagam = combo(s.pagamenti, v.pagamento), cbCliente = combo(s.clienti, v.cliente), cbOper = combo(s.operatori, v.operatore);
    const collect = () => ({ prezzo: val(inPrezzo.value), iva: ckIva.input.checked, ivaVal: ckIva.input.checked ? val(inIva.value) / 100 : 0, zona: trim(cbZona.input.value), pagamento: trim(cbPagam.input.value), cliente: trim(cbCliente.input.value), operatore: trim(cbOper.input.value) });
    openModal({
      title: `Modifica vendita ${v.codice}`, width: "640px",
      body: [el("p", { class: "hint", text: `${fmtDateTime(v.data)} · quantità ${num(v.qta)} (la quantità non è modificabile: cancellare e reinserire la vendita)` }),
        el("div", { class: "form-grid" }, field("Prezzo unitario (IVA incl.)", inPrezzo),
          el("div", { class: "field" }, el("span", { text: "IVA" }), el("div", { style: { display: "flex", gap: "8px", alignItems: "center" } }, ckIva, inIva, el("span", { class: "hint", text: "%" }))),
          field("Operatore", cbOper), field("Zona / Paese", cbZona), field("Pagamento", cbPagam), field("Cliente", cbCliente))],
      onClose: (r) => resolve(r || null), onEnter: (a) => a.close(collect()),
      buttons: [{ label: "Annulla", onClick: (a) => a.close(null) }, { label: "Salva", class: "primary", onClick: (a) => a.close(collect()) }],
    });
  });
}
