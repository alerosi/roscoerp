// Statistiche: tabella per tipologia + grafici del foglio Excel (Plot, Andam. Sett./Giorn./Ann.)
// e analisi aggiuntive per il negozio (KPI, trend, top articoli, ripartizioni, mappa oraria, magazzino).

import { store } from "../store.js";
import * as L from "../logic.js";
import { el, eur, eur0, num, num0, pct, fmtDate, fmtDateLong, toDay, MESI_BREVI } from "../util.js";
import { dataTable, checkbox, toast, field } from "../ui.js";
import { lineChart, barChart, doughnutChart, heatmapHtml, destroyAll, PALETTE, colorFor } from "../charts.js";

const state = { selezione: new Set(), plots: [], sortKey: "valore", sortDir: -1 };

export function renderStatistiche(root, rerender) {
  destroyAll(root);
  const s = store.db.settings;
  const st = s.statistiche;
  const { dataIn, dataEnd } = L.risolviPeriodo();
  const tab = L.statisticheTipologie(dataIn, dataEnd);
  const save = () => store.commit("settings");

  // ---------------------------------------------------------------- tabella per tipologia
  const wrap = el("div", { class: "table-wrap", style: { maxHeight: "420px" } });
  const drawTab = () => {
    wrap.innerHTML = "";
    wrap.append(dataTable([
      { key: "_s", label: "", sortable: false, render: (r) => { const c = el("input", { type: "checkbox" }); c.checked = state.selezione.has(r.tipologia); c.addEventListener("click", (e) => e.stopPropagation()); c.addEventListener("change", () => { if (c.checked) state.selezione.add(r.tipologia); else state.selezione.delete(r.tipologia); }); return c; } },
      { key: "tipologia", label: "Tipologia" },
      { key: "qta", label: "Q.tà tot.", num: true, render: (r) => num(r.qta) },
      { key: "valore", label: "Valore tot. (netto IVA)", num: true, render: (r) => eur(r.valore) },
      { key: "medio", label: "Valore medio", num: true, render: (r) => eur(r.medio) },
    ], tab, state, { rowKey: (r) => r.tipologia, onRowClick: (r) => { if (state.selezione.has(r.tipologia)) state.selezione.delete(r.tipologia); else state.selezione.add(r.tipologia); drawTab(); }, onSort: drawTab }));
  };
  drawTab();

  // ---------------------------------------------------------------- controlli plot (come il foglio Statistiche)
  const periodoBtn = (v, label) => el("button", { class: "btn" + (st.periodo === v ? " active" : ""), onClick: () => { st.periodo = v; save(); rerender(); }, title: `Periodo di aggregazione: ${label}` }, label);
  const radio = (v, label) => { const r = el("input", { type: "radio", name: "criterio" }); r.checked = st.criterio === v; r.addEventListener("change", () => { st.criterio = v; save(); }); return el("label", { class: "check" }, r, el("span", { text: label })); };
  const ckMedia = checkbox("Media", !!st.media); ckMedia.input.addEventListener("change", () => { st.media = ckMedia.input.checked; save(); });
  const ckTutte = checkbox("Tutte le vendite", !!st.tutteLeVendite); ckTutte.input.addEventListener("change", () => { st.tutteLeVendite = ckTutte.input.checked; save(); });
  const plotsBox = el("div", { id: "plots" });

  const addPlot = (titolo, sottotitolo, build) => {
    const canvas = el("canvas");
    const card = el("div", { class: "card plot-card" }, el("div", { class: "card-title" }, el("div", {}, el("h3", { text: titolo }), sottotitolo ? el("div", { class: "hint", text: sottotitolo }) : null),
      el("div", { class: "toolbar" }, el("button", { class: "btn xs", onClick: () => window.print() }, "PDF / Stampa"), el("button", { class: "btn xs danger", onClick: () => { destroyAll(card); card.remove(); } }, "✕"))),
      el("div", { class: "chart-box tall" }, canvas));
    plotsBox.prepend(card);
    build(canvas, card);
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  const periodoLabel = st.tutteLeVendite ? "su tutte le vendite" : `dal ${fmtDateLong(dataIn)} al ${fmtDateLong(dataEnd)}`;

  const plot = () => {
    const tipologie = Array.from(state.selezione);
    if (st.criterio !== 3 && !tipologie.length) return toast("Selezionare almeno una tipologia nella tabella.", "warn");
    const res = L.serieTemporali({ dataIn, dataEnd, periodo: st.periodo, criterio: st.criterio, tipologie, media: st.media });
    if (!res) return toast("Periodo troppo breve per il passo scelto.", "warn");
    const fmt = st.criterio === 1 ? num0 : eur;
    const labels = res.labels.map((d) => res.periodo >= 30 ? `${MESI_BREVI[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` : fmtDate(d).slice(0, 5));
    const crit = st.criterio === 1 ? "Quantità" : st.criterio === 2 ? "Valore (€, netto IVA)" : "Incassi totali (€, netto IVA)";
    addPlot(`Statistiche · ${crit}`, `Passo ${st.periodo === 1 ? "giornaliero" : st.periodo === 7 ? "settimanale" : "mensile"} dal ${fmtDateLong(dataIn)} al ${fmtDateLong(dataEnd)}${res.media ? " · media delle tipologie in nero" : ""}`,
      (canvas) => lineChart(canvas, labels, res.series, { fmt, mediaSerie: res.media, dashed: !!res.media }));
  };
  const plotSett = () => {
    const r = L.andamentoSettimanale({ dataIn, dataEnd, tutte: st.tutteLeVendite });
    if (!r.totale) return toast("Nessuna vendita nel periodo.", "warn");
    addPlot("Andamento settimanale", `Quota dell'incasso netto per giorno della settimana, ${periodoLabel} (totale ${eur(r.totale)})`, (c) => barChart(c, r.labels, [{ nome: "Quota", valori: r.valori }], { fmt: pct, dataLabels: true }));
  };
  const plotGiorn = () => {
    const r = L.andamentoGiornaliero({ dataIn, dataEnd, tutte: st.tutteLeVendite });
    if (!r.totale) return toast("Nessuna vendita nel periodo.", "warn");
    addPlot("Andamento giornaliero", `Quota dell'incasso netto per ora del giorno, ${periodoLabel}`, (c) => barChart(c, r.labels, [{ nome: "Quota", valori: r.valori }], { fmt: pct, dataLabels: true }));
  };
  const plotAnn = () => {
    const r = L.andamentoAnnuale({ dataIn, dataEnd, tutte: st.tutteLeVendite });
    if (!r.series.length) return toast("Nessuna vendita nel periodo.", "warn");
    addPlot("Andamento annuale", `Incassi netti per mese in migliaia di euro, una serie per anno, ${periodoLabel}`, (c) => barChart(c, r.labels, r.series, { fmt: (v) => num(v) + " K€" }));
  };

  const controls = el("div", { class: "card" },
    el("div", { class: "toolbar", style: { gap: "14px" } },
      el("button", { class: "btn primary", onClick: plot }, "Plot"),
      el("span", { class: "muted small", text: "Periodo:" }), el("div", { class: "btn-group" }, periodoBtn(1, "G"), periodoBtn(7, "S"), periodoBtn(30, "M")),
      ckMedia, radio(1, "Quantità"), radio(2, "Valore"), radio(3, "Incassi totali"),
      el("span", { style: { flex: 1 } }),
      el("button", { class: "btn", onClick: plotSett }, "Andam. Sett."), el("button", { class: "btn", onClick: plotGiorn }, "Andam. Giorn."), el("button", { class: "btn", onClick: plotAnn }, "Andam. Ann."), ckTutte,
      el("button", { class: "btn danger sm", onClick: () => { destroyAll(plotsBox); plotsBox.innerHTML = ""; } }, "Canc. grafici")),
    el("p", { class: "hint", style: { marginTop: "8px" }, text: "Spunta le tipologie nella tabella e premi Plot per l'andamento nel tempo (periodo del pannello di controllo). \"Media\" traccia la media delle tipologie selezionate. \"Tutte le vendite\" estende gli andamenti settimanale/giornaliero/annuale all'intero storico." }),
  );

  root.append(
    el("div", { class: "page-head" }, el("div", {}, el("h2", { text: "Statistiche" }), el("p", { text: `Vendite per tipologia dal ${fmtDateLong(dataIn)} al ${fmtDateLong(dataEnd)} (valori netti IVA)` }))),
    el("div", { class: "grid grid-stat" }, el("div", {}, wrap), controls),
    plotsBox,
  );

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
