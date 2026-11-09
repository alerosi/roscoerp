// Pannello di controllo: azioni rapide, periodo, Conto Economico (porting del foglio omonimo).

import { store } from "../store.js";
import * as L from "../logic.js";
import { flussoCarico, flussoVendita, flussoIncasso, flussoSpesa } from "../forms.js";
import { el, eur, pct, num, fmtDate, fmtDateLong, toDay, parseDate, fmtDateTime } from "../util.js";
import { dataTable } from "../ui.js";

export function renderPannello(root, rerender) {
  const { dataIn, dataEnd } = L.risolviPeriodo();
  const ce = L.contoEconomico(dataIn, dataEnd);
  const P = L.periodo;
  const act = (fn) => async () => { await fn(); rerender(); };

  const tiles = el("div", { class: "action-tiles" },
    el("button", { class: "action-tile c3", onClick: act(flussoCarico) }, el("span", { class: "t", text: "Carico a Magazzino" }), el("span", { class: "d", text: "Nuovi pezzi o riassortimento, con codice automatico" })),
    el("button", { class: "action-tile c1", onClick: act(flussoVendita) }, el("span", { class: "t", text: "Vendita Diretta" }), el("span", { class: "d", text: "Scarica dal magazzino e registra l'incasso" })),
    el("button", { class: "action-tile c4", onClick: act(flussoIncasso) }, el("span", { class: "t", text: "Incasso" }), el("span", { class: "d", text: "Spedizioni e incassi generici senza articolo" })),
    el("button", { class: "action-tile c2", onClick: act(flussoSpesa) }, el("span", { class: "t", text: "Aggiungi Spesa" }), el("span", { class: "d", text: "Affitto, utenze, materiale, imballi…" })),
  );

  const stepper = (label, minus, plus) => el("div", { class: "stepper" }, el("button", { class: "btn", onClick: act(minus), title: `${label} precedente` }, "−"), el("span", { text: label }), el("button", { class: "btn", onClick: act(plus), title: `${label} successivo` }, "+"));
  const dIn = el("input", { type: "date", value: toDay(dataIn), onChange: (e) => { if (e.target.value) { P.setDataIn(parseDate(e.target.value)); rerender(); } } });
  const dEnd = el("input", { type: "date", value: toDay(dataEnd), onChange: (e) => { if (e.target.value) { P.setDataEnd(parseDate(e.target.value)); rerender(); } } });
  const periodBar = el("div", { class: "period-bar" },
    el("div", { class: "btn-group" },
      el("button", { class: "btn", onClick: act(P.oggi) }, "Oggi"), el("button", { class: "btn", onClick: act(P.settimana) }, "Sett."),
      el("button", { class: "btn", onClick: act(P.mese) }, "Mese"), el("button", { class: "btn", onClick: act(P.anno) }, "Anno")),
    stepper("Giorno", P.giornoMeno, P.giornoPiu), stepper("Sett.", P.settMeno, P.settPiu), stepper("Mese", P.meseMeno, P.mesePiu), stepper("Anno", P.annoMeno, P.annoPiu),
    el("div", { class: "dates" }, el("span", { class: "muted small", text: "Da" }), dIn, el("span", { class: "muted small", text: "a" }), dEnd),
  );

  const row = (label, v, p, cls = "") => el("tr", { class: cls }, el("td", { text: label }), el("td", { class: "v " + (v < 0 ? "neg" : ""), text: eur(v) }), el("td", { class: "p", text: p ?? "" }));
  const ceTable = el("table", { class: "ce" },
    row("Ricavi", ce.ricavi, ""),
    row("Costo del venduto", ce.cogs, ce.ricavi ? pct(ce.cogs / ce.ricavi) : ""),
    row("Gross Margin (Margine Lordo)", ce.gross, ce.ricavi ? pct(ce.gross / ce.ricavi) + " dei ricavi" : "", "total"),
    row("SG&A (Spese generali)", ce.sga, ce.ricavi ? pct(ce.sga / ce.ricavi) : ""),
    row("EBITDA (Margine Operativo)", ce.ebitda, ce.ricavi ? pct(ce.ebitda / ce.ricavi) + " dei ricavi" : "", "total"),
    row("Stima Tasse", ce.tasse, ce.ebitda ? pct(ce.tasse / ce.ebitda) + " dell'EBITDA" : ""),
    row("Utile", ce.utile, ce.ricavi ? pct(ce.utile / ce.ricavi) + " dei ricavi" : "", "total final"),
  );
  const stat = (label, v) => el("div", { class: "stat-row" }, el("span", { text: label }), el("b", { text: v }));
  const side = el("div", { class: "card" },
    el("div", { class: "card-title" }, el("h3", { text: "Patrimonio e IVA" })),
    stat("Valore magazzino iniziale", eur(ce.magIn)), stat("Valore magazzino finale", eur(ce.magEnd)),
    stat("Debito fornitori iniziale", eur(ce.debIn)), stat("Debito fornitori finale", eur(ce.debEnd)),
    stat("% IVA vendite", ce.percIva === null ? "—" : pct(ce.percIva)), stat("% non IVA vendite", ce.percNonIva === null ? "—" : pct(ce.percNonIva)),
    stat("Imponibile", eur(ce.imponibile)), stat("Credito IVA", eur(ce.creditoIva)),
    el("p", { class: "hint", style: { marginTop: "10px" }, text: `Valore magazzino oggi: ${eur(ce.valmagOggi)} · regime ${store.db.settings.tasse.regime === 2 ? "forfettario" : "ordinario semplificato"}` }),
  );
  const debiti = el("div", { class: "card" },
    el("div", { class: "card-title" }, el("h3", { text: "Debiti verso fornitori" })),
    ce.debitiFornitori.length ? el("div", { class: "table-wrap", style: { maxHeight: "260px" } }, dataTable([
      { key: "fornitore", label: "Fornitore" }, { key: "iniziale", label: "Iniziale", num: true, render: (r) => eur(r.iniziale) }, { key: "finale", label: "Finale", num: true, render: (r) => eur(r.finale) },
    ], ce.debitiFornitori, { sortKey: "finale", sortDir: -1 })) : el("p", { class: "muted", text: "Nessun fornitore configurato." }),
  );

  // ultime operazioni
  const ultime = [
    ...store.db.vendite.slice(-6).map((v) => ({ data: v.data, tipo: L.CODICI_SPECIALI.includes(v.codice) ? "Incasso" : "Vendita", testo: `${v.codice} × ${num(v.qta)} · ${eur(L.prezzoTotVendita(v))}`, chi: v.operatore })),
    ...store.db.movimenti.filter((m) => m.tipo !== "Vendita").slice(-4).map((m) => ({ data: m.data, tipo: m.tipo, testo: `${m.codice} ${m.movimento > 0 ? "+" : ""}${num(m.movimento)}`, chi: m.utente })),
    ...store.db.spese.slice(-3).map((s) => ({ data: s.data, tipo: "Spesa", testo: `${s.tipologia} · ${eur(s.spesa)} ${s.descrizione ? "· " + s.descrizione : ""}`, chi: s.utente })),
  ].sort((a, b) => String(b.data).localeCompare(String(a.data))).slice(0, 8);
  const recent = el("div", { class: "card" },
    el("div", { class: "card-title" }, el("h3", { text: "Ultime operazioni" })),
    ultime.length ? el("div", {}, ultime.map((u) => el("div", { class: "stat-row" }, el("span", {}, el("span", { class: `tag ${u.tipo.toLowerCase()}`, text: u.tipo }), " ", u.testo), el("span", { class: "muted small nowrap", text: `${fmtDateTime(u.data)}${u.chi ? " · " + u.chi : ""}` })))) : el("p", { class: "muted", text: "Nessuna operazione registrata." }),
  );

  root.append(
    el("div", { class: "page-head" }, el("div", {}, el("h2", { text: "Pannello di controllo" }), el("p", { text: `Periodo dal ${fmtDateLong(dataIn)} al ${fmtDateLong(dataEnd)}` }))),
    tiles,
    el("div", { class: "card", style: { marginTop: "18px" } }, periodBar),
    el("div", { class: "grid grid-ce", style: { marginTop: "18px" } },
      el("div", { class: "card accent" }, el("div", { class: "card-title" }, el("h3", { text: "Conto Economico" }), el("span", { class: "muted small", text: `${fmtDate(dataIn)} – ${fmtDate(dataEnd)}` })), ceTable),
      side,
    ),
    el("div", { class: "grid grid-2", style: { marginTop: "18px" } }, debiti, recent),
  );
}
