// Scheda Statistiche.
//
// In alto UNA barra di filtri che vale per tutta la pagina: periodo, confronto, tipologie e se mostrare
// l'incasso o i pezzi. Sotto, sezioni tematiche; ogni grafico dice nel sottotitolo cosa mostra e se
// dipende dal periodo. I filtri sono preferenze di questo browser (localStorage): non toccano il database,
// quindi funzionano anche sul PC in sola consultazione.

import { store } from "../store.js";
import * as L from "../logic.js";
import { el, eur, eur0, num, num0, pct, fmtDate, fmtDateLong, toDay, parseDate, today, addDays, addMonths, startOfMonth, endOfMonth, startOfYear, MESI_BREVI, GIORNI_BREVI } from "../util.js";
import { dataTable, openModal, checkbox } from "../ui.js";
import { lineChart, barChart, doughnutChart, confrontoChart, heatmapHtml, destroyAll, colorFor } from "../charts.js";

// ------------------------------------------------------------------ filtri (preferenze del browser)
const LS_KEY = "roscoerp.statistiche";
const FILTRI_DEFAULT = { intervallo: "anno", dal: null, al: null, confronto: "annoPrima", misura: "valore", passo: "auto", tipologie: [] };
function leggiFiltri() {
  try { return { ...FILTRI_DEFAULT, ...JSON.parse(localStorage.getItem(LS_KEY) || "{}") }; } catch (e) { return { ...FILTRI_DEFAULT }; }
}
function salvaFiltri(f) { try { localStorage.setItem(LS_KEY, JSON.stringify(f)); } catch (e) { /* ignore */ } }

const INTERVALLI = [
  ["mese", "Questo mese"], ["mesePrec", "Mese scorso"], ["3mesi", "Ultimi 3 mesi"], ["anno", "Quest'anno"],
  ["annoPrec", "Anno scorso"], ["12mesi", "Ultimi 12 mesi"], ["tutto", "Tutto lo storico"],
  ["pannello", "Come nel Pannello di controllo"], ["custom", "Date a scelta…"],
];
const CONFRONTI = [["annoPrima", "le stesse date dell'anno prima"], ["precedente", "il periodo precedente"], ["nessuno", "nessun confronto"]];

function risolviIntervallo(f) {
  const t = today();
  switch (f.intervallo) {
    case "mese": return [startOfMonth(t), t];
    case "mesePrec": { const m = addMonths(startOfMonth(t), -1); return [m, endOfMonth(m)]; }
    case "3mesi": return [addDays(addMonths(t, -3), 1), t];
    case "12mesi": return [addDays(addMonths(t, -12), 1), t];
    case "annoPrec": return [new Date(t.getFullYear() - 1, 0, 1), new Date(t.getFullYear() - 1, 11, 31)];
    case "tutto": {
      const prima = store.db.vendite.reduce((m, v) => (v.data < m ? v.data : m), toDay(t));
      return [parseDate(prima.slice(0, 10)), t];
    }
    case "pannello": { const p = L.risolviPeriodo(); return [p.dataIn, p.dataEnd]; }
    case "custom": {
      const a = parseDate(f.dal) || startOfYear(t), b = parseDate(f.al) || t;
      return a <= b ? [a, b] : [b, a];
    }
    default: return [startOfYear(t), t];
  }
}

// stato della pagina che deve sopravvivere ai ridisegni
const ui = { tipoSort: { sortKey: "valore", sortDir: -1 }, magSort: { sortKey: "valore", sortDir: -1 } };

// ------------------------------------------------------------------ piccoli componenti
const sezione = (titolo, descrizione) => el("div", { class: "stat-section" }, el("h2", { text: titolo }), descrizione ? el("p", { text: descrizione }) : null);
function riquadro(titolo, sottotitolo, contenuto, strumenti = null) {
  return el("div", { class: "card" },
    el("div", { class: "card-title" }, el("div", {}, el("h3", { text: titolo }), sottotitolo ? el("div", { class: "hint", text: sottotitolo }) : null), strumenti),
    contenuto);
}
function grafico(titolo, sottotitolo, altezza = "", strumenti = null) {
  const canvas = el("canvas");
  const box = el("div", { class: `chart-box ${altezza}` }, canvas);
  return { card: riquadro(titolo, sottotitolo, box, strumenti), canvas, box };
}
const vuoto = (testo) => el("p", { class: "muted", style: { padding: "20px 0" }, text: testo });
function variazione(cur, prec, fmt) {
  if (prec === null || prec === undefined) return null;
  if (!prec) return el("div", { class: "kpi-delta", text: `confronto: ${fmt(prec)}` });
  const d = (cur - prec) / prec;
  return el("div", { class: `kpi-delta ${d >= 0 ? "up" : "down"}`, text: `${d >= 0 ? "▲" : "▼"} ${pct(Math.abs(d))} rispetto a ${fmt(prec)}` });
}
const kpi = (label, valore, extra, titolo = "") => el("div", { class: "card kpi", title: titolo }, el("div", { class: "kpi-label", text: label }), el("div", { class: "kpi-value", text: valore }), extra || null);
const segmenti = (opzioni, valore, onChange) => el("div", { class: "btn-group" },
  opzioni.map(([v, label, title]) => el("button", { class: "btn" + (v === valore ? " active" : ""), title: title || "", onClick: () => onChange(v) }, label)));
const tronca = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// ------------------------------------------------------------------ pagina
export function renderStatistiche(root, rerender) {
  destroyAll(root);
  const f = leggiFiltri();
  const aggiorna = (patch) => { Object.assign(f, patch); salvaFiltri(f); rerender(); };
  const tipologieValide = new Set(store.db.settings.tipologie.map((t) => t.nome));
  f.tipologie = (f.tipologie || []).filter((t) => tipologieValide.has(t));
  const [dataIn, dataEnd] = risolviIntervallo(f);
  const confronto = f.intervallo === "tutto" ? "nessuno" : f.confronto;
  const S = L.statisticheNegozio({ dataIn, dataEnd, confronto, tipologie: f.tipologie, passo: f.passo });
  const M = L.statisticheMagazzino(f.tipologie);
  const qta = f.misura === "qta";
  const fmtM = qta ? num0 : eur0;
  const chiave = qta ? "qta" : "valore";
  const nomeMisura = qta ? "Pezzi venduti" : "Incasso netto";
  const periodoTxt = `dal ${fmtDateLong(S.dataIn)} al ${fmtDateLong(S.dataEnd)}`;
  const confTxt = S.confronto ? `${fmtDateLong(S.confronto.dataIn)} – ${fmtDateLong(S.confronto.dataEnd)}` : null;
  const filtroTxt = f.tipologie.length ? `solo ${f.tipologie.join(", ")}` : "tutte le tipologie";

  root.append(
    el("div", { class: "page-head" }, el("div", {},
      el("h2", { text: "Statistiche" }),
      el("p", { text: "Scegli qui sotto periodo, confronto e tipologie: valgono per tutti i numeri e i grafici della pagina. Importi netti IVA." }))),
    barraFiltri(f, aggiorna, S, periodoTxt, confTxt, filtroTxt),
  );
  const disegni = []; // i grafici si disegnano dopo che la pagina è nel documento

  // ================================================================ 1. riepilogo
  const P = S.kpiPrec, K = S.kpi;
  root.append(sezione("Riepilogo", `${periodoTxt} (${S.giorni} giorni)` + (confTxt ? `, con la variazione rispetto a ${confTxt}.` : ".") + (f.tipologie.length ? ` Contano solo le vendite di: ${f.tipologie.join(", ")}.` : "")));
  root.append(el("div", { class: "grid grid-kpi4" },
    kpi("Incasso netto", eur0(K.ricavi), variazione(K.ricavi, P && P.ricavi, eur0), "Totale venduto, IVA esclusa (compresi incassi vari e spedizioni se non c'è un filtro per tipologia)"),
    kpi("Scontrini", num0(K.scontrini), variazione(K.scontrini, P && P.scontrini, num0), "Vendite registrate nello stesso minuto dallo stesso operatore = uno scontrino"),
    kpi("Scontrino medio", eur(K.scontrinoMedio), variazione(K.scontrinoMedio, P && P.scontrinoMedio, eur)),
    kpi("Pezzi venduti", num0(K.pezzi), variazione(K.pezzi, P && P.pezzi, num0)),
    kpi("Pezzi per scontrino", num(Math.round(K.pezziPerScontrino * 100) / 100), variazione(K.pezziPerScontrino, P && P.pezziPerScontrino, (v) => num(Math.round(v * 100) / 100))),
    kpi("Margine lordo", eur0(K.margine), el("div", { class: "kpi-delta", text: `${pct(K.marginePct)} del venduto` + (P ? ` (prima ${pct(P.marginePct)})` : "") }), "Incasso degli articoli meno il loro costo d'acquisto"),
    kpi("Giorni con vendite", num0(K.giorniVendita), variazione(K.giorniVendita, P && P.giorniVendita, num0)),
    kpi("Incasso medio al giorno", eur0(K.mediaGiorno), variazione(K.mediaGiorno, P && P.mediaGiorno, eur0), "Incasso diviso per i giorni in cui si è venduto qualcosa"),
  ));

  // ================================================================ 2. andamento
  root.append(sezione("Andamento", "Come vanno le vendite nel tempo."));
  const passi = [["auto", `Auto (${S.passo})`, "Sceglie il passo in base alla durata del periodo"], ["giorno", "Giorno"], ["settimana", "Settimana"], ["mese", "Mese"]];
  const nomePasso = { giorno: "giorno", settimana: "settimana (da lunedì)", mese: "mese" }[S.passo];
  const tempo = grafico(`${nomeMisura} nel tempo`,
    `Barre: ${periodoTxt}, un valore per ogni ${nomePasso}.` + (confTxt ? ` Linea tratteggiata: ${confTxt}, allineato alle stesse date.` : ""),
    "tall", el("div", { class: "toolbar" }, el("span", { class: "muted small", text: "Un valore ogni:" }), segmenti(passi, f.passo, (v) => aggiorna({ passo: v }))));
  root.append(el("div", { class: "grid" }, tempo.card));
  const etichettaPasso = (d) => (S.passo === "mese" ? `${MESI_BREVI[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` : fmtDate(d).slice(0, 5));
  disegni.push(() => confrontoChart(tempo.canvas, S.serie.labels.map(etichettaPasso), qta ? S.serie.pezzi : S.serie.ricavi.map(Math.round),
    S.confronto ? (qta ? S.serie.pezziPrec : S.serie.ricaviPrec.map(Math.round)) : null,
    { fmt: fmtM, nome: periodoTxt, nomePrec: confTxt || "" }));

  const annoCorr = today().getFullYear();
  const coloreAnno = (anno) => (anno === annoCorr ? colorFor(0) : anno === annoCorr - 1 ? colorFor(1) : anno === annoCorr - 2 ? colorFor(3) : "#c9bdb0");
  const prog = grafico("Progressivo dall'inizio dell'anno", `${nomeMisura} accumulato da gennaio, anno per anno: si vede se quest'anno si è avanti o indietro. Tutto lo storico, non dipende dal periodo scelto.`, "");
  const anni = grafico("Mese per mese, anno per anno", `${nomeMisura} di ogni mese, una barra per anno. Tutto lo storico, non dipende dal periodo scelto.`, "");
  root.append(el("div", { class: "grid grid-2", style: { marginTop: "18px" } }, prog.card, anni.card));
  disegni.push(() => lineChart(prog.canvas, MESI_BREVI, S.progressivo.map((p) => ({ nome: String(p.anno), valori: p[chiave].map((x) => (x === null ? null : Math.round(x))), colore: coloreAnno(p.anno), spessore: p.anno === annoCorr ? 3 : 2 })), { fmt: fmtM }));
  disegni.push(() => barChart(anni.canvas, MESI_BREVI, S.anni.slice(-4).map((a) => ({ nome: String(a.anno), valori: a[chiave].map(Math.round), colore: coloreAnno(a.anno) })), { fmt: fmtM }));

  // ================================================================ 3. cosa si vende
  root.append(sezione("Cosa si vende", `${periodoTxt}. Clic su una riga della tabella per vedere tutta la pagina solo per quella tipologia (di nuovo clic per tornare a tutte).`));
  const tabTipi = el("div", { class: "table-wrap", style: { maxHeight: "440px" } });
  const disegnaTabTipi = () => {
    tabTipi.innerHTML = "";
    if (!S.perTipo.length) { tabTipi.append(vuoto("Nessuna vendita nel periodo.")); return; }
    tabTipi.append(dataTable([
      { key: "tipologia", label: "Tipologia" },
      { key: "qta", label: "Pezzi", num: true, render: (r) => num0(r.qta) },
      { key: "valore", label: "Incasso", num: true, render: (r) => eur(r.valore) },
      { key: "quota", label: "Quota", num: true, render: (r) => pct(r.quota) },
      { key: "prezzoMedio", label: "Prezzo medio", num: true, render: (r) => eur(r.prezzoMedio) },
      { key: "marginePct", label: "Margine", num: true, render: (r) => pct(r.marginePct) },
      ...(S.confronto ? [{ key: "variazione", label: "Var. incasso", num: true, sortValue: (r) => (r.variazione === null ? -Infinity : r.variazione),
        render: (r) => (r.variazione === null ? el("span", { class: "muted", text: r.valore ? "nuova" : "" }) : el("span", { class: r.variazione >= 0 ? "pos" : "neg", text: `${r.variazione >= 0 ? "+" : "−"}${pct(Math.abs(r.variazione))}` })) }] : []),
    ], S.perTipo, ui.tipoSort, {
      rowKey: (r) => r.tipologia,
      selectedKey: f.tipologie.length === 1 ? f.tipologie[0] : undefined,
      onRowClick: (r) => aggiorna({ tipologie: f.tipologie.length === 1 && f.tipologie[0] === r.tipologia ? [] : [r.tipologia] }),
      onSort: disegnaTabTipi,
    }));
  };
  disegnaTabTipi();
  root.append(riquadro("Vendite per tipologia", `Pezzi, incasso, quota sul totale, prezzo medio per pezzo e margine sul costo d'acquisto` + (confTxt ? `; la variazione è rispetto a ${confTxt}.` : "."), tabTipi));

  const quota = grafico("Quota per tipologia", `${nomeMisura}: le 6 tipologie principali, le altre insieme.`, "");
  const margine = grafico("Margine per tipologia", "Quanto resta del prezzo netto dopo il costo d'acquisto (le 10 tipologie che incassano di più).", "");
  root.append(el("div", { class: "grid grid-2", style: { marginTop: "18px" } }, quota.card, margine.card));
  if (S.perTipo.length) {
    disegni.push(() => doughnutChart(quota.canvas, S.perTipo.map((t) => ({ nome: t.tipologia, valore: t[chiave] })), { fmt: fmtM }));
    const top10 = S.perTipo.slice(0, 10);
    disegni.push(() => barChart(margine.canvas, top10.map((t) => t.tipologia), [{ nome: "Margine", valori: top10.map((t) => Math.round(t.marginePct * 1000) / 1000) }], { fmt: pct, horizontal: true, colors: top10.map(() => colorFor(2)) }));
  } else { quota.box.replaceWith(vuoto("Nessuna vendita nel periodo.")); margine.box.replaceWith(vuoto("Nessuna vendita nel periodo.")); }

  const topArt = S.perArticolo.slice().sort((a, b) => b[chiave] - a[chiave]).slice(0, 10);
  const topDec = S.perDecoro.slice().sort((a, b) => b[chiave] - a[chiave]).slice(0, 10);
  const gArt = grafico("Articoli più venduti", `I 10 articoli con più ${qta ? "pezzi venduti" : "incasso"} nel periodo.`, "tall");
  const gDec = grafico("Decori più venduti", `I 10 decori con più ${qta ? "pezzi venduti" : "incasso"} nel periodo, sommando tutti gli articoli con quel decoro.`, "tall");
  root.append(el("div", { class: "grid grid-2", style: { marginTop: "18px" } }, gArt.card, gDec.card));
  if (topArt.length) disegni.push(() => barChart(gArt.canvas, topArt.map((a) => tronca(`${a.nome} · ${a.descr}`, 44)), [{ nome: nomeMisura, valori: topArt.map((a) => Math.round(a[chiave])) }], { fmt: fmtM, horizontal: true }));
  else gArt.box.replaceWith(vuoto("Nessuna vendita nel periodo."));
  if (topDec.length) disegni.push(() => barChart(gDec.canvas, topDec.map((d) => tronca(d.nome, 30)), [{ nome: nomeMisura, valori: topDec.map((d) => Math.round(d[chiave])) }], { fmt: fmtM, horizontal: true, colors: topDec.map(() => colorFor(1)) }));
  else gDec.box.replaceWith(vuoto("Nessun decoro venduto nel periodo."));

  // ================================================================ 4. quando si vende
  root.append(sezione("Quando si vende", `${periodoTxt}. Utile per orari di apertura e turni.`));
  const gSett = grafico("Giorno della settimana", `${nomeMisura} medio in un giorno di apertura (tra parentesi quanti giorni con vendite ci sono stati nel periodo).`, "");
  const gOre = grafico("Ora del giorno", `${nomeMisura} totale per fascia oraria, sommando tutti i giorni del periodo.`, "");
  root.append(el("div", { class: "grid grid-2" }, gSett.card, gOre.card));
  disegni.push(() => barChart(gSett.canvas, S.settimana.map((s, i) => `${GIORNI_BREVI[i]} (${s.giorni})`), [{ nome: `${nomeMisura} medio`, valori: S.settimana.map((s) => (s.giorni ? Math.round(s[chiave] / s.giorni * (qta ? 10 : 1)) / (qta ? 10 : 1) : 0)) }], { fmt: qta ? num : eur0, dataLabels: true }));
  const oreConDati = S.ore.valore.map((v, h) => (v || S.ore.qta[h] ? h : null)).filter((h) => h !== null);
  if (oreConDati.length) {
    const h0 = Math.min(...oreConDati), h1 = Math.max(...oreConDati);
    const ore = Array.from({ length: h1 - h0 + 1 }, (_, i) => h0 + i);
    disegni.push(() => barChart(gOre.canvas, ore.map((h) => `${h}-${h + 1}`), [{ nome: nomeMisura, valori: ore.map((h) => Math.round(S.ore[chiave][h])) }], { fmt: fmtM, colors: ore.map(() => colorFor(6)) }));
  } else gOre.box.replaceWith(vuoto("Nessuna vendita nel periodo."));
  root.append(el("div", { class: "grid", style: { marginTop: "18px" } },
    riquadro("Giorno e ora insieme", "Incasso netto per giorno della settimana e ora: più scuro = più incasso. Passa sopra un quadratino per il valore.", el("div", { class: "heat-wrap stat-heat", html: heatmapHtml(S.heat) }))));

  // ================================================================ 5. cassa e operatori
  root.append(sezione("Cassa e operatori", `${periodoTxt}.`));
  const gFasce = grafico("Importo degli scontrini", "Quanti scontrini per fascia di importo (netto IVA). Uno scontrino = vendite registrate nello stesso minuto dallo stesso operatore.", "");
  const gOper = grafico("Per operatore", `${nomeMisura} registrato da ciascun operatore.`, "");
  const cards5 = [gFasce.card, gOper.card];
  const conDati = (lista) => lista.some((x) => !x.nome.startsWith("(non indicat"));
  const gPag = conDati(S.perPagamento) ? grafico("Per metodo di pagamento", `${nomeMisura} per metodo di pagamento.`, "short") : null;
  const gZona = conDati(S.perZona) ? grafico("Per zona / paese del cliente", `${nomeMisura} per zona (le 8 principali).`, "short") : null;
  if (gPag) cards5.push(gPag.card);
  if (gZona) cards5.push(gZona.card);
  root.append(el("div", { class: `grid ${cards5.length > 2 ? "grid-3" : "grid-2"}` }, ...cards5));
  if (!gPag || !gZona) root.append(el("p", { class: "hint", style: { marginTop: "8px" }, text: `${[!gPag && "Metodo di pagamento", !gZona && "zona del cliente"].filter(Boolean).join(" e ")}: non sono compilati nelle vendite, quindi i grafici relativi non compaiono. Compariranno da soli quando si inizierà a indicarli nella finestra di vendita.` }));
  disegni.push(() => barChart(gFasce.canvas, S.fasce.labels, [{ nome: "Scontrini", valori: S.fasce.valori }], { fmt: num0, dataLabels: true, colors: S.fasce.labels.map(() => colorFor(4)) }));
  const ordina = (lista) => lista.slice().sort((a, b) => b[chiave] - a[chiave]);
  const op = ordina(S.perOperatore);
  if (op.length) disegni.push(() => barChart(gOper.canvas, op.map((x) => x.nome), [{ nome: nomeMisura, valori: op.map((x) => Math.round(x[chiave])) }], { fmt: fmtM }));
  else gOper.box.replaceWith(vuoto("Nessuna vendita nel periodo."));
  if (gPag) { const l = ordina(S.perPagamento); disegni.push(() => barChart(gPag.canvas, l.map((x) => x.nome), [{ nome: nomeMisura, valori: l.map((x) => Math.round(x[chiave])) }], { fmt: fmtM })); }
  if (gZona) { const l = ordina(S.perZona).slice(0, 8); disegni.push(() => barChart(gZona.canvas, l.map((x) => x.nome), [{ nome: nomeMisura, valori: l.map((x) => Math.round(x[chiave])) }], { fmt: fmtM })); }

  // ================================================================ 6. magazzino oggi
  root.append(sezione("Magazzino oggi", "Situazione attuale della merce: non dipende dal periodo scelto" + (f.tipologie.length ? `; solo ${f.tipologie.join(", ")}.` : ".") + " «Venduti 12 mesi» conta i pezzi venduti nell'ultimo anno."));
  root.append(el("div", { class: "grid grid-kpi4" },
    kpi("Valore a costo", eur0(M.valore), null, "Giacenza × costo d'acquisto"),
    kpi("Pezzi in giacenza", num0(M.pezzi)),
    kpi("Codici disponibili", num0(M.codici), null, "Articoli con almeno un pezzo"),
    kpi("Fermi da 12 mesi", num0(M.fermi.length), el("div", { class: "kpi-delta", text: `${eur0(M.valoreFermi)} di merce ferma` }), "Articoli in giacenza senza vendite nell'ultimo anno"),
  ));
  const tabMag = el("div", { class: "table-wrap", style: { maxHeight: "440px" } });
  const disegnaTabMag = () => {
    tabMag.innerHTML = "";
    tabMag.append(dataTable([
      { key: "tipologia", label: "Tipologia" },
      { key: "pezzi", label: "Pezzi", num: true, render: (r) => num0(r.pezzi) },
      { key: "valore", label: "Valore a costo", num: true, render: (r) => eur0(r.valore) },
      { key: "venduti12", label: "Venduti 12 mesi", num: true, render: (r) => num0(r.venduti12) },
      { key: "mesiScorta", label: "Mesi di scorta", num: true, sortValue: (r) => (r.mesiScorta === null ? Infinity : r.mesiScorta),
        render: (r) => (r.mesiScorta === null ? el("span", { class: "muted", text: r.pezzi ? "nessuna vendita" : "" }) : el("span", { class: r.mesiScorta < 2 ? "neg" : r.mesiScorta > 24 ? "warn-txt" : "", text: num(Math.round(r.mesiScorta * 10) / 10) })) },
    ], M.perTipo, ui.magSort, { onSort: disegnaTabMag }));
  };
  disegnaTabMag();
  root.append(el("div", { class: "grid", style: { marginTop: "18px" } }, riquadro("Magazzino per tipologia",
    "«Mesi di scorta» = per quanti mesi basta la merce al ritmo di vendita dell'ultimo anno: in rosso sotto i 2 mesi (da riordinare presto), in ocra oltre i 24 (troppa merce).", tabMag)));
  const tabFermi = M.fermi.length
    ? el("div", { class: "table-wrap", style: { maxHeight: "320px" } }, dataTable([{ key: "codice", label: "Codice", cls: "mono" }, { key: "tipologia", label: "Tipologia" }, { key: "descrizione", label: "Descrizione" }, { key: "decoro", label: "Decoro" }, { key: "giacenza", label: "Pezzi", num: true }, { key: "valore", label: "Valore", num: true, render: (r) => eur(r.valore) }], M.fermi.slice(0, 100), {}))
    : vuoto("Nessun articolo fermo.");
  const tabRiordino = M.daRiordinare.length
    ? el("div", { class: "table-wrap", style: { maxHeight: "320px" } }, dataTable([{ key: "codice", label: "Codice", cls: "mono" }, { key: "tipologia", label: "Tipologia" }, { key: "descrizione", label: "Descrizione" }, { key: "decoro", label: "Decoro" }, { key: "venduti12", label: "Venduti 12 m", num: true }, { key: "fornitore", label: "Fornitore" }], M.daRiordinare.slice(0, 100), {}))
    : vuoto("Nessun articolo esaurito con vendite recenti.");
  root.append(el("div", { class: "grid grid-2", style: { marginTop: "18px" } },
    riquadro("Articoli fermi", "In giacenza ma senza vendite nell'ultimo anno, dal valore più alto (i primi 100).", tabFermi),
    riquadro("Da riordinare", "Esauriti ma venduti almeno 3 volte nell'ultimo anno (i primi 100).", tabRiordino)));

  requestAnimationFrame(() => { for (const d of disegni) { try { d(); } catch (e) { console.error(e); } } });
}

// ------------------------------------------------------------------ barra dei filtri
function barraFiltri(f, aggiorna, S, periodoTxt, confTxt, filtroTxt) {
  const selPeriodo = el("select", { onChange: (e) => aggiorna({ intervallo: e.target.value }) },
    INTERVALLI.map(([v, label]) => el("option", { value: v, text: label })));
  selPeriodo.value = f.intervallo;
  const date = f.intervallo === "custom" ? el("div", { class: "toolbar" },
    el("span", { class: "muted small", text: "dal" }), el("input", { type: "date", value: toDay(S.dataIn), onChange: (e) => e.target.value && aggiorna({ dal: e.target.value }) }),
    el("span", { class: "muted small", text: "al" }), el("input", { type: "date", value: toDay(S.dataEnd), onChange: (e) => e.target.value && aggiorna({ al: e.target.value }) })) : null;
  const selConf = el("select", { onChange: (e) => aggiorna({ confronto: e.target.value }), disabled: f.intervallo === "tutto" ? true : null },
    CONFRONTI.map(([v, label]) => el("option", { value: v, text: label })));
  selConf.value = f.intervallo === "tutto" ? "nessuno" : f.confronto;
  const btnTipi = el("button", { class: "btn" + (f.tipologie.length ? " primary" : ""), onClick: () => scegliTipologie(f, aggiorna) },
    f.tipologie.length ? tronca(`${f.tipologie.length === 1 ? "" : f.tipologie.length + ": "}${f.tipologie.join(", ")}`, 40) : "Tutte", " ▾");
  const campo = (etichetta, ...input) => el("div", { class: "stat-filter" }, el("span", { class: "stat-filter-label", text: etichetta }), el("div", { class: "toolbar" }, ...input));
  return el("div", { class: "card stat-filters" },
    el("div", { class: "stat-filter-row" },
      campo("Periodo", selPeriodo, date),
      campo("Confronta con", selConf),
      campo("Tipologie", btnTipi, f.tipologie.length ? el("button", { class: "btn sm ghost", title: "Torna a tutte le tipologie", onClick: () => aggiorna({ tipologie: [] }) }, "✕ tutte") : null),
      campo("Mostra", segmenti([["valore", "Incasso €"], ["qta", "Pezzi"]], f.misura, (v) => aggiorna({ misura: v })))),
    el("div", { class: "stat-filter-summary" },
      el("b", { text: periodoTxt }), ` (${S.giorni} giorni) · ${confTxt ? "confronto con " + confTxt : "senza confronto"} · ${filtroTxt}`,
      f.intervallo === "tutto" ? el("span", { class: "muted", text: " · con tutto lo storico non c'è un periodo con cui confrontare" }) : null));
}

function scegliTipologie(f, aggiorna) {
  const scelte = new Set(f.tipologie);
  const nomi = store.db.settings.tipologie.map((t) => t.nome).sort((a, b) => a.localeCompare(b, "it"));
  const lista = el("div", { class: "tipi-grid" });
  const disegna = () => {
    lista.innerHTML = "";
    for (const n of nomi) {
      const c = checkbox(n, scelte.has(n));
      c.input.addEventListener("change", () => { if (c.input.checked) scelte.add(n); else scelte.delete(n); });
      lista.append(c);
    }
  };
  disegna();
  openModal({
    title: "Quali tipologie guardare?", width: "640px",
    body: [el("p", { class: "hint", text: "Tutta la pagina mostrerà solo le vendite e il magazzino delle tipologie spuntate. Nessuna spunta = tutte." }), lista],
    buttons: [
      { label: "Togli tutte le spunte", left: true, onClick: () => { scelte.clear(); disegna(); } },
      { label: "Annulla", onClick: (a) => a.close() },
      { label: "Applica", class: "primary", onClick: (a) => { a.close(); aggiorna({ tipologie: Array.from(scelte) }); } },
    ],
  });
}
