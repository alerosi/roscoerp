// Test della logica di dominio (node --test tests/). Simula il browser quanto basta per importare i moduli.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.window = { addEventListener() {}, showOpenFilePicker: undefined };
globalThis.document = { addEventListener() {}, visibilityState: "visible" };
Object.defineProperty(globalThis, "navigator", { value: { sendBeacon() { return true; } }, configurable: true });
globalThis.fetch = async () => { throw new Error("no server"); };

const { store, normalizeDb } = await import("../public/js/store.js");
const L = await import("../public/js/logic.js");

function loadDb() {
  const raw = JSON.parse(fs.readFileSync(path.join(here, "..", "data", "roscoerp.json"), "utf8"));
  store.db = normalizeDb(raw);
  store.mode = "local";
  store.saveDebounced = () => {};
  store.operatore = "Test";
}

test("il database importato è coerente (giacenze = somma movimenti, nessun duplicato)", () => {
  loadDb();
  const problemi = L.verificaIntegrita();
  assert.deepEqual(problemi.filter((p) => p.tipo !== "tipologia"), [], JSON.stringify(problemi.slice(0, 3)));
});

test("conto economico 2026 coincide con il foglio Excel (calcolato il 6/11/2026)", () => {
  loadDb();
  const ce = L.contoEconomico(new Date(2026, 0, 1), new Date(2026, 10, 6));
  const close = (a, b, eps = 0.02) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
  close(ce.ricavi, 57337.137704917914);
  close(ce.cogs, -28790.09);
  close(ce.sga, -13860.063934426227);
  close(ce.ebitda, 14686.983770491686);
  close(ce.tasse, -5778.45114580822, 0.05);
  close(ce.magIn, 36473.5);
  close(ce.magEnd, 35324.8);
  close(ce.debIn, 72152.67868852461);
  close(ce.debEnd, 95457.97868852472);
  close(ce.imponibile, 10413.08, 0.05);
  close(ce.creditoIva, -7052.0963934426145);
  close(ce.percIva, 0.8643340021604744, 1e-9);
});

test("carico nuovo articolo, vendita, cancellazione vendita e cancellazione codice", () => {
  loadDb();
  const nArt = store.db.magazzino.length, nMov = store.db.movimenti.length, nVen = store.db.vendite.length;
  const r = L.eseguiCarico({ tipo: "Piatto", descr: "TEST", dim: "99", decoro: "TEST DECORO", qty: 3, costo: 10, forn: "Gialletti", prezzo: 25, spesaAuto: false, iva: false, ivaVal: 0 });
  assert.ok(r.nuovo);
  assert.match(r.articolo.codice, /^PIA\d{5}$/);
  assert.equal(store.db.magazzino.length, nArt + 1);
  assert.equal(store.db.movimenti.length, nMov + 1);
  assert.equal(r.articolo.giacenza, 3);
  // ricarico dello stesso articolo: nessun nuovo codice
  const r2 = L.eseguiCarico({ tipo: "Piatto", descr: "test", dim: "99", decoro: "test decoro", qty: 2, costo: 10, forn: "Gialletti", prezzo: 25 }, {});
  assert.equal(r2.nuovo, false);
  assert.equal(r2.articolo.giacenza, 5);
  // vendita
  const v = L.eseguiVendita({ codice: r.articolo.codice, qty: 4, prezzo: 25, iva: true, ivaVal: 0.22, zona: "Italia", pagam: "Contanti", cliente: "", operatore: "Test" });
  assert.equal(r.articolo.giacenza, 1);
  assert.equal(store.db.vendite.length, nVen + 1);
  assert.throws(() => L.eseguiVendita({ codice: r.articolo.codice, qty: 2, prezzo: 25 }), /non disponibile/);
  assert.deepEqual(L.verificaIntegrita().filter((p) => p.tipo !== "tipologia"), []);
  // cancellazione vendita: la quantità torna in magazzino e il movimento sparisce
  const res = L.cancellaVendita(v.id);
  assert.equal(res.ripristinato, 4);
  assert.equal(r.articolo.giacenza, 5);
  assert.equal(store.db.vendite.length, nVen);
  assert.deepEqual(L.verificaIntegrita().filter((p) => p.tipo !== "tipologia"), []);
  // modifica articolo con correzione giacenza
  L.modificaArticolo(r.articolo.id, { tipo: "Piatto", descr: "TEST", dim: "99", decoro: "TEST DECORO", qty: 2, costo: 10, forn: "Gialletti", prezzo: 25 });
  assert.equal(store.db.movimenti.at(-1).tipo, "Correzione");
  assert.equal(store.db.movimenti.at(-1).movimento, -3);
  // cambio codice duplicato rifiutato
  assert.throws(() => L.cambiaCodice(r.articolo.id, "PIA00041"), /esiste già/);
  // cancellazione codice elimina anche lo storico
  const del = L.cancellaArticolo(r.articolo.id);
  assert.equal(del.movimentiEliminati, 3);
  assert.equal(store.db.magazzino.length, nArt);
  assert.equal(store.db.movimenti.length, nMov);
});

test("incasso e spese con tipologia nuova", () => {
  loadDb();
  const v = L.eseguiIncasso({ qty: 1, prezzo: 15, tipo: "Spedizione", iva: true, ivaVal: 0.22, zona: "Francia", pagam: "", cliente: "" });
  assert.equal(v.codice, "SPEDIZIONE");
  assert.equal(L.cancellaVendita(v.id).ripristinato, 0);
  const s = L.creaSpesa({ data: new Date(2026, 5, 1, 10, 0), tipologia: "Pubblicità", descrizione: "volantini", spesa: 122, fornitore: "", iva: true, ivaVal: 0.22 });
  assert.equal(s.ivaVal, 0.22);
  assert.ok(L.aggiungiTipologiaSpesa("Pubblicità", false));
  const ce = L.contoEconomico(new Date(2026, 5, 1), new Date(2026, 5, 30));
  assert.ok(Math.abs(ce.speseIndirTot - 100) < 0.01 || ce.speseIndirTot > 100, "la spesa netta (100) entra nelle spese generali");
});

test("rinomina prefisso tipologia aggiorna codici, movimenti e vendite", () => {
  loadDb();
  const i = store.db.settings.tipologie.findIndex((t) => t.prefisso === "TAP");
  const before = store.db.magazzino.filter((a) => a.codice.startsWith("TAP")).length;
  assert.ok(before > 0);
  L.modificaTipologia(i, "Tappo", "TPP");
  assert.equal(store.db.magazzino.filter((a) => a.codice.startsWith("TAP0")).length, 0);
  assert.equal(store.db.magazzino.filter((a) => a.codice.startsWith("TPP")).length, before);
  assert.equal(store.db.movimenti.filter((m) => m.codice.startsWith("TAP0")).length, 0);
  assert.equal(store.db.vendite.filter((v) => v.codice.startsWith("TAP0")).length, 0);
  assert.deepEqual(L.verificaIntegrita().filter((p) => p.tipo !== "tipologia"), []);
});

test("statistiche e serie temporali", () => {
  loadDb();
  const tab = L.statisticheTipologie(new Date(2026, 0, 1), new Date(2026, 10, 8));
  assert.ok(tab.length > 5);
  assert.ok(tab[0].valore >= tab[1].valore);
  const serie = L.serieTemporali({ dataIn: new Date(2026, 0, 1), dataEnd: new Date(2026, 10, 8), periodo: 30, criterio: 1, tipologie: [tab[0].tipologia, tab[1].tipologia], media: true });
  assert.equal(serie.labels.length, 11);
  assert.equal(serie.series.length, 2);
  assert.equal(serie.media.length, 11);
  const sett = L.andamentoSettimanale({ dataIn: new Date(2026, 0, 1), dataEnd: new Date(2026, 10, 8), tutte: true });
  assert.ok(Math.abs(sett.valori.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  const A = L.analisiNegozio(new Date(2026, 0, 1), new Date(2026, 10, 8));
  assert.ok(A.kpi.ricavi > 0 && A.top.length === 10 && A.mensile.length === 12);
});

test("scheda Statistiche: i totali quadrano tra loro e con l'analisi esistente", () => {
  loadDb();
  const dataIn = new Date(2026, 0, 1), dataEnd = new Date(2026, 10, 8);
  const close = (x, y, msg) => assert.ok(Math.abs(x - y) < 0.01, `${msg}: ${x} vs ${y}`);
  const S = L.statisticheNegozio({ dataIn, dataEnd, confronto: "annoPrima" });
  const A = L.analisiNegozio(dataIn, dataEnd);
  close(S.kpi.ricavi, A.kpi.ricavi, "incasso uguale all'analisi esistente");
  assert.equal(S.kpi.pezzi, A.kpi.pezzi);
  assert.equal(S.kpi.scontrini, A.kpi.scontrini);
  assert.equal(S.passo, "mese");
  close(S.serie.ricavi.reduce((a, b) => a + b, 0), S.kpi.ricavi, "serie nel tempo = incasso");
  close(S.settimana.reduce((a, b) => a + b.valore, 0), S.kpi.ricavi, "giorni della settimana = incasso");
  close(S.ore.valore.reduce((a, b) => a + b, 0), S.kpi.ricavi, "ore = incasso");
  assert.equal(S.fasce.valori.reduce((a, b) => a + b, 0), S.kpi.scontrini);
  close(S.perTipo.reduce((a, t) => a + t.valore, 0), S.kpi.ricavi - A.kpi.incassiExtra, "tipologie = incasso articoli");
  // il confronto con l'anno prima coincide con le statistiche calcolate direttamente su quel periodo
  const P = L.statisticheNegozio({ dataIn: new Date(2025, 0, 1), dataEnd: new Date(2025, 10, 8), confronto: "nessuno" });
  close(S.kpiPrec.ricavi, P.kpi.ricavi, "confronto anno prima");
  close(S.serie.ricaviPrec.reduce((a, b) => a + b, 0), P.kpi.ricavi, "serie del confronto");
  // filtro per tipologia: solo quella tipologia, nessun incasso speciale
  const tipo = S.perTipo[0].tipologia;
  const F = L.statisticheNegozio({ dataIn, dataEnd, confronto: "nessuno", tipologie: [tipo] });
  assert.equal(F.perTipo.length, 1);
  close(F.kpi.ricavi, S.perTipo[0].valore, "filtro tipologia");
  assert.equal(F.kpiPrec, null);
  // magazzino: il valore totale coincide con l'analisi esistente
  close(L.statisticheMagazzino().valore, A.valoreMag, "valore magazzino");
});

test("navigazione del periodo", () => {
  loadDb();
  L.periodo.mese();
  let p = L.risolviPeriodo();
  assert.equal(p.dataIn.getDate(), 1);
  L.periodo.meseMeno();
  p = L.risolviPeriodo();
  assert.equal(p.dataIn.getDate(), 1);
  assert.ok(p.dataEnd < new Date());
  L.periodo.anno();
  L.periodo.annoMeno();
  p = L.risolviPeriodo();
  assert.equal(p.dataIn.getFullYear(), new Date().getFullYear() - 1);
  assert.equal(p.dataEnd.getMonth(), 11);
  assert.equal(p.dataEnd.getDate(), 31);
});
