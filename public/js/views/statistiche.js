// Statistiche: tabella per tipologia + grafici del foglio Excel (Plot, Andam. Sett./Giorn./Ann.)
// e analisi aggiuntive per il negozio (KPI, trend, top articoli, ripartizioni, mappa oraria, magazzino).

import { store } from "../store.js";
import * as L from "../logic.js";
import { el, eur, eur0, num, num0, pct, fmtDate, fmtDateLong, toDay, MESI_BREVI } from "../util.js";
import { dataTable, checkbox, toast, field } from "../ui.js";
import { lineChart, barChart, doughnutChart, heatmapHtml, destroyAll, PALETTE, colorFor } from "../charts.js";

// selezione e grafici aperti restano anche cambiando scheda; i grafici si aggiornano da soli
const state = { selezione: new Set(), aperti: new Set(), sortKey: "valore", sortDir: -1 };

export function renderStatistiche(root, rerender) {
  destroyAll(root);
  const s = store.db.settings;
  const st = s.statistiche;
  const { dataIn, dataEnd } = L.risolviPeriodo();
  const tab = L.statisticheTipologie(dataIn, dataEnd);
  // le opzioni dei grafici si ricordano nel database; su un PC in sola consultazione restano solo in memoria
  const save = () => { if (!(store.mode === "fs" && store.readOnly)) store.commit("settings"); };

  // ---------------------------------------------------------------- tabella per tipologia
  const wrap = el("div", { class: "table-wrap", style: { maxHeight: "420px" } });
  const drawTab = () => {
    wrap.innerHTML = "";
    wrap.append(dataTable([
      { key: "_s", label: "", sortable: false, render: (r) => { const c = el("input", { type: "checkbox" }); c.checked = state.selezione.has(r.tipologia); c.addEventListener("click", (e) => e.stopPropagation()); c.addEventListener("change", () => { if (c.checked) state.selezione.add(r.tipologia); else state.selezione.delete(r.tipologia); aggiornaAndamento(); }); return c; } },
      { key: "tipologia", label: "Tipologia" },
      { key: "qta", label: "Q.tà tot.", num: true, render: (r) => num(r.qta) },
      { key: "valore", label: "Valore tot. (netto IVA)", num: true, render: (r) => eur(r.valore) },
      { key: "medio", label: "Valore medio", num: true, render: (r) => eur(r.medio) },
    ], tab, state, { rowKey: (r) => r.tipologia, onRowClick: (r) => { if (state.selezione.has(r.tipologia)) state.selezione.delete(r.tipologia); else state.selezione.add(r.tipologia); drawTab(); aggiornaAndamento(); }, onSort: drawTab }));
  };

  // ---------------------------------------------------------------- grafici del foglio Statistiche
  // Un grafico per tipo, aggiornato da solo a ogni cambio di tipologie spuntate o di opzioni.
  const plotsBox = el("div", { id: "plots" });
  const ORDINE = ["andamento", "sett", "giorn", "ann"];
  const cards = {};
  const periodoTxt = `dal ${fmtDateLong(dataIn)} al ${fmtDateLong(dataEnd)}`;

  const chiudi = (kind) => {
    if (cards[kind]) { destroyAll(cards[kind]); cards[kind].remove(); delete cards[kind]; }
    state.aperti.delete(kind);
    drawBottoni();
  };
  /** Crea o sostituisce il riquadro del grafico `kind`; `build(canvas)` lo disegna, oppure si passa `messaggio`. */
  const mostra = (kind, titolo, sottotitolo, build, messaggio) => {
    const canvas = el("canvas");
    const nuova = el("div", { class: "card plot-card" },
      el("div", { class: "card-title" }, el("div", {}, el("h3", { text: titolo }), sottotitolo ? el("div", { class: "hint", text: sottotitolo }) : null),
        el("div", { class: "toolbar" }, el("button", { class: "btn xs", onClick: () => window.print() }, "PDF / Stampa"), el("button", { class: "btn xs danger", title: "Chiudi questo grafico", onClick: () => { if (kind === "andamento") { state.selezione.clear(); drawTab(); } chiudi(kind); } }, "✕"))),
      messaggio ? el("p", { class: "muted", text: messaggio }) : el("div", { class: "chart-box tall" }, canvas));
    const vecchia = cards[kind];
    if (vecchia) { destroyAll(vecchia); vecchia.replaceWith(nuova); }
    else {
      const dopo = ORDINE.slice(ORDINE.indexOf(kind) + 1).map((k) => cards[k]).find(Boolean);
      plotsBox.insertBefore(nuova, dopo || null);
    }
    cards[kind] = nuova;
    if (!messaggio) build(canvas);
  };

  const aggiornaAndamento = () => {
    const tipologie = Array.from(state.selezione);
    if (st.criterio !== 3 && !tipologie.length) { chiudi("andamento"); return; }
    const crit = st.criterio === 1 ? "Quantità vendute" : st.criterio === 2 ? "Valore venduto (€, netto IVA)" : "Incassi totali (€, netto IVA)";
    const passo = st.periodo === 1 ? "giornaliero" : st.periodo === 7 ? "settimanale" : "mensile";
    const chi = st.criterio === 3 ? "tutte le vendite e gli incassi" : tipologie.join(", ");
    const res = L.serieTemporali({ dataIn, dataEnd, periodo: st.periodo, criterio: st.criterio, tipologie, media: st.media });
    if (!res) { mostra("andamento", `Andamento nel tempo · ${crit}`, null, null, `Il periodo ${periodoTxt} è troppo breve per il passo ${passo}: scegli un passo più corto (G o S) o allarga il periodo nel Pannello di controllo.`); return; }
    const fmt = st.criterio === 1 ? num0 : eur;
    const labels = res.labels.map((d) => res.periodo >= 30 ? `${MESI_BREVI[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` : fmtDate(d).slice(0, 5));
    mostra("andamento", `Andamento nel tempo · ${crit}`, `${chi} · passo ${passo} ${periodoTxt}${res.media ? " · in nero la media delle tipologie" : ""}`,
      (canvas) => lineChart(canvas, labels, res.series, { fmt, mediaSerie: res.media, dashed: !!res.media }));
  };
  const periodoLabel = () => (st.tutteLeVendite ? "su tutte le vendite" : periodoTxt);
  const DISTRIB = {
    sett: () => {
      const r = L.andamentoSettimanale({ dataIn, dataEnd, tutte: st.tutteLeVendite });
      if (!r.totale) return mostra("sett", "Vendite per giorno della settimana", null, null, "Nessuna vendita nel periodo.");
      mostra("sett", "Vendite per giorno della settimana", `Quota dell'incasso netto, ${periodoLabel()} (totale ${eur(r.totale)})`, (c) => barChart(c, r.labels, [{ nome: "Quota", valori: r.valori }], { fmt: pct, dataLabels: true }));
    },
    giorn: () => {
      const r = L.andamentoGiornaliero({ dataIn, dataEnd, tutte: st.tutteLeVendite });
      if (!r.totale) return mostra("giorn", "Vendite per ora del giorno", null, null, "Nessuna vendita nel periodo.");
      mostra("giorn", "Vendite per ora del giorno", `Quota dell'incasso netto, ${periodoLabel()}`, (c) => barChart(c, r.labels, [{ nome: "Quota", valori: r.valori }], { fmt: pct, dataLabels: true }));
    },
    ann: () => {
      const r = L.andamentoAnnuale({ dataIn, dataEnd, tutte: st.tutteLeVendite });
      if (!r.series.length) return mostra("ann", "Confronto tra anni", null, null, "Nessuna vendita nel periodo.");
      mostra("ann", "Confronto tra anni", `Incassi netti per mese in migliaia di euro, una serie per anno, ${periodoLabel()}`, (c) => barChart(c, r.labels, r.series, { fmt: (v) => num(v) + " K€" }));
    },
  };
  const aggiornaDistribuzioni = () => { for (const k of state.aperti) DISTRIB[k](); };

  // ---- comandi
  const passoBox = el("div", { class: "btn-group" });
  const drawPasso = () => {
    passoBox.innerHTML = "";
    for (const [v, label, t] of [[1, "Giorno", "giornaliero"], [7, "Settimana", "settimanale"], [30, "Mese", "mensile"]]) {
      passoBox.append(el("button", { class: "btn" + (st.periodo === v ? " active" : ""), title: `Un punto del grafico per ogni ${label.toLowerCase()} (passo ${t})`, onClick: () => { st.periodo = v; save(); drawPasso(); aggiornaAndamento(); } }, label));
    }
  };
  const radio = (v, label) => { const r = el("input", { type: "radio", name: "criterio" }); r.checked = st.criterio === v; r.addEventListener("change", () => { st.criterio = v; save(); aggiornaAndamento(); }); return el("label", { class: "check" }, r, el("span", { text: label })); };
  const ckMedia = checkbox("Media delle tipologie", !!st.media); ckMedia.input.addEventListener("change", () => { st.media = ckMedia.input.checked; save(); aggiornaAndamento(); });
  const ckTutte = checkbox("Su tutto lo storico", !!st.tutteLeVendite); ckTutte.input.addEventListener("change", () => { st.tutteLeVendite = ckTutte.input.checked; save(); aggiornaDistribuzioni(); });
  const bottoniBox = el("div", { class: "btn-group" });
  const drawBottoni = () => {
    bottoniBox.innerHTML = "";
    for (const [k, label] of [["sett", "Giorno della settimana"], ["giorn", "Ora del giorno"], ["ann", "Confronto anni"]]) {
      bottoniBox.append(el("button", { class: "btn" + (state.aperti.has(k) ? " active" : ""), onClick: () => { if (state.aperti.has(k)) chiudi(k); else { state.aperti.add(k); DISTRIB[k](); drawBottoni(); cards[k].scrollIntoView({ behavior: "smooth", block: "nearest" }); } } }, label));
    }
  };

  const riga = (titolo, ...figli) => el("div", { class: "stat-ctrl" }, el("div", { class: "stat-ctrl-title", text: titolo }), el("div", { class: "toolbar", style: { gap: "12px" } }, ...figli));
  const controls = el("div", { class: "card" },
    riga("Andamento nel tempo delle tipologie spuntate", el("span", { class: "muted small", text: "Un punto ogni:" }), passoBox, radio(1, "Quantità"), radio(2, "Valore"), radio(3, "Incassi totali"), ckMedia),
    el("p", { class: "hint", text: "Spunta una o più tipologie nella tabella: il grafico compare sotto e si aggiorna da solo. «Incassi totali» non richiede tipologie (vendite più incassi e spedizioni). Il periodo è quello scelto nel Pannello di controllo." }),
    riga("Come si distribuiscono le vendite", bottoniBox, ckTutte),
    el("p", { class: "hint", text: "Ogni pulsante apre o chiude il suo grafico. «Su tutto lo storico» usa tutte le vendite invece del solo periodo del Pannello." }),
  );

  root.append(
    el("div", { class: "page-head" }, el("div", {}, el("h2", { text: "Statistiche" }), el("p", { text: `Vendite per tipologia ${periodoTxt} (valori netti IVA). Il periodo si cambia nel Pannello di controllo.` }))),
    el("div", { class: "grid grid-stat" }, el("div", {}, wrap), controls),
    plotsBox,
  );
  drawTab(); drawPasso(); drawBottoni();
  requestAnimationFrame(() => { aggiornaAndamento(); aggiornaDistribuzioni(); });

  // ---------------------------------------------------------------- analisi negozio
  renderAnalisi(root, dataIn, dataEnd);
}

function renderAnalisi(root, dataIn, dataEnd) {
  const A = L.analisiNegozio(dataIn, dataEnd);
  const k = A.kpi;
  const delta = (cur, prev, fmt) => {
    if (!prev) return el("div", { class: "kpi-delta", text: "periodo precedente: n.d." });
    const d = (cur - prev) / prev;
    return el("div", { class: `kpi-delta ${d >= 0 ? "up" : "down"}`, text: `${d >= 0 ? "▲" : "▼"} ${pct(Math.abs(d))} vs ${A.giorni} gg precedenti (${fmt(prev)})` });
  };
  const kpi = (label, value, extra) => el("div", { class: "card kpi" }, el("div", { class: "kpi-label", text: label }), el("div", { class: "kpi-value", text: value }), extra || null);
  const kpis = el("div", { class: "grid grid-kpi" },
    kpi("Incasso netto", eur0(k.ricavi), delta(k.ricavi, k.ricaviPrec, eur0)),
    kpi("Scontrini", num0(k.scontrini), delta(k.scontrini, k.scontriniPrec, num0)),
    kpi("Scontrino medio", eur(k.scontrinoMedio), delta(k.scontrinoMedio, k.scontrinoMedioPrec, eur)),
    kpi("Pezzi venduti", num0(k.pezzi), delta(k.pezzi, k.pezziPrec, num0)),
    kpi("Margine lordo articoli", eur0(k.margine), el("div", { class: "kpi-delta", text: `${pct(k.marginePct)} del venduto · costo ${eur0(k.costo)}` })),
    kpi("Valore magazzino", eur0(A.valoreMag), el("div", { class: "kpi-delta", text: `${num0(A.pezziMag)} pezzi · ${A.lenti.length} codici fermi da 12 mesi` })),
  );
  const chart = (title, sub, cls = "") => { const c = el("canvas"); const card = el("div", { class: "card" }, el("div", { class: "card-title" }, el("div", {}, el("h3", { text: title }), sub ? el("div", { class: "hint", text: sub }) : null)), el("div", { class: `chart-box ${cls}` }, c)); return { card, canvas: c }; };

  const trend = chart("Incassi mensili", "Netto IVA, ultimi 12 mesi rispetto allo stesso mese dell'anno precedente");
  const tipi = chart("Vendite per tipologia", "Quota dell'incasso netto nel periodo");
  const top = chart("Top 10 articoli", "Per incasso netto nel periodo", "tall");
  const oper = chart("Per operatore", "Incasso netto nel periodo", "short");
  const pag = chart("Per metodo di pagamento", "Incasso netto nel periodo", "short");
  const zone = chart("Per zona / paese", "Incasso netto nel periodo", "short");
  const mag = chart("Magazzino per tipologia", "Valore a costo della giacenza attuale e consumo degli ultimi 12 mesi", "tall");
  const heatCard = el("div", { class: "card" }, el("div", { class: "card-title" }, el("div", {}, el("h3", { text: "Quando si vende" }), el("div", { class: "hint", text: "Incasso netto per giorno della settimana e ora (più scuro = più incasso)" }))), el("div", { class: "heat-wrap", html: heatmapHtml(A.heat) }));
  const lentiCard = el("div", { class: "card" }, el("div", { class: "card-title" }, el("div", {}, el("h3", { text: "Articoli fermi" }), el("div", { class: "hint", text: "In giacenza ma senza vendite negli ultimi 12 mesi, per valore immobilizzato" }))),
    A.lenti.length ? el("div", { class: "table-wrap", style: { maxHeight: "300px" } }, dataTable([{ key: "codice", label: "Codice", cls: "mono" }, { key: "tipologia", label: "Tipologia" }, { key: "descrizione", label: "Descrizione" }, { key: "decoro", label: "Decoro" }, { key: "giacenza", label: "Giac.", num: true }, { key: "valore", label: "Valore", num: true, render: (r) => eur(r.valore) }], A.lenti.slice(0, 50), {})) : el("p", { class: "muted", text: "Nessun articolo fermo." }));
  const esauritiCard = el("div", { class: "card" }, el("div", { class: "card-title" }, el("div", {}, el("h3", { text: "Da riordinare" }), el("div", { class: "hint", text: "Giacenza zero ma venduti almeno 3 volte negli ultimi 12 mesi" }))),
    A.esauriti.length ? el("div", { class: "table-wrap", style: { maxHeight: "300px" } }, dataTable([{ key: "codice", label: "Codice", cls: "mono" }, { key: "tipologia", label: "Tipologia" }, { key: "descrizione", label: "Descrizione" }, { key: "decoro", label: "Decoro" }, { key: "consumo", label: "Venduti 12 m", num: true }, { key: "fornitore", label: "Fornitore" }], A.esauriti.slice(0, 50), {})) : el("p", { class: "muted", text: "Nessun articolo esaurito con vendite recenti." }));

  root.append(
    el("div", { class: "page-head", style: { marginTop: "30px" } }, el("div", {}, el("h2", { text: "Analisi del negozio" }), el("p", { text: `Indicatori per il periodo ${toDay(dataIn)} → ${toDay(dataEnd)}; il confronto è con i ${A.giorni} giorni precedenti.` }))),
    kpis,
    el("div", { class: "grid grid-2", style: { marginTop: "18px" } }, trend.card, tipi.card),
    el("div", { class: "grid grid-2", style: { marginTop: "18px" } }, top.card, mag.card),
    el("div", { class: "grid grid-3", style: { marginTop: "18px" } }, oper.card, pag.card, zone.card),
    el("div", { class: "grid grid-2", style: { marginTop: "18px" } }, heatCard, lentiCard),
    el("div", { class: "grid", style: { marginTop: "18px" } }, esauritiCard),
  );
  requestAnimationFrame(() => {
    lineChart(trend.canvas, A.mensile.map((m) => m.label), [{ nome: "Ultimi 12 mesi", valori: A.mensile.map((m) => Math.round(m.valore)) }, { nome: "Anno precedente", valori: A.mensile.map((m) => Math.round(m.precedente)) }], { fmt: eur0, fill: true });
    doughnutChart(tipi.canvas, A.perTipo.map((t) => ({ nome: t.tipologia, valore: t.valore })));
    barChart(top.canvas, A.top.map((t) => t.nome.length > 48 ? t.nome.slice(0, 46) + "…" : t.nome), [{ nome: "Incasso netto", valori: A.top.map((t) => Math.round(t.valore)) }], { fmt: eur0, horizontal: true });
    barChart(oper.canvas, A.perOperatore.map((x) => x.nome), [{ nome: "Incasso", valori: A.perOperatore.map((x) => Math.round(x.valore)) }], { fmt: eur0 });
    barChart(pag.canvas, A.perPagamento.map((x) => x.nome), [{ nome: "Incasso", valori: A.perPagamento.map((x) => Math.round(x.valore)) }], { fmt: eur0 });
    barChart(zone.canvas, A.perZona.slice(0, 8).map((x) => x.nome), [{ nome: "Incasso", valori: A.perZona.slice(0, 8).map((x) => Math.round(x.valore)) }], { fmt: eur0 });
    const mp = A.magPerTipo.slice(0, 12);
    barChart(mag.canvas, mp.map((x) => x.tipologia), [{ nome: "Valore giacenza (€)", valori: mp.map((x) => Math.round(x.valore)) }], { fmt: eur0, horizontal: true });
  });
}
