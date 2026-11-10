// Logica di dominio: porting fedele delle macro VBA (Modulo1, Modulo2, Modulo_tipo,
// Modulo_check, Modulo_statistiche, Modulo_plot, Modulo_data) con le correzioni ai bachi
// documentate in docs/ANALISI_MACRO.md.

import { store } from "./store.js";
import {
  parseDate, floorDay, toDay, toIso, nowIso, today, addDays, addMonths, addYears, startOfMonth, endOfMonth,
  startOfYear, endOfYear, startOfWeek, endOfWeek, weekdayMon, daysBetween, trim, lc, like, val, uniqueSorted, MESI_BREVI,
} from "./util.js";

const db = () => store.db;
const S = () => store.db.settings;

export const CODICI_SPECIALI = ["INCASSO", "SPEDIZIONE"];

// =============================================================== codici / tipologie
export function prefissoDiCodice(codice) {
  const n = S().numDigit;
  const c = trim(codice);
  return c.length > n ? c.slice(0, c.length - n) : c;
}
export function tipologiaDiCodice(codice) {
  const p = prefissoDiCodice(codice);
  const t = S().tipologie.find((x) => x.prefisso === p);
  return t ? t.nome : null;
}
export function tipologiaByNome(nome) {
  return S().tipologie.find((t) => lc(t.nome) === lc(nome)) || null;
}
export function findArticolo(codice) {
  const c = lc(codice);
  return db().magazzino.find((a) => lc(a.codice) === c) || null;
}
export function articoliByCodice() {
  const map = new Map();
  for (const a of db().magazzino) map.set(a.codice, a);
  return map;
}
/** Nuovo codice progressivo per la tipologia (equivalente di pref & Format(num_max+1, "00000")). */
export function prossimoCodice(tipo) {
  const t = tipologiaByNome(tipo);
  if (!t) return null;
  let max = 0;
  for (const a of db().magazzino) {
    if (lc(a.tipologia) === lc(t.nome) || a.codice.startsWith(t.prefisso)) {
      const tail = a.codice.slice(t.prefisso.length);
      if (/^\d+$/.test(tail) && a.codice.length === t.prefisso.length + S().numDigit) {
        const n = parseInt(tail, 10);
        if (n > max) max = n;
      }
    }
  }
  return t.prefisso + String(max + 1).padStart(S().numDigit, "0");
}

// =============================================================== valori derivati
/**
 * Da quando si conta il consumo: "12mesi" (default: ultimi 365 giorni, come in Excel), "mese" (dal primo
 * del mese in corso), "anno" (dal 1° gennaio), "data" (dalla data `dal`, "YYYY-MM-DD").
 */
export function inizioConsumo(modo = "12mesi", dal = null) {
  const t = today();
  if (modo === "mese") return startOfMonth(t);
  if (modo === "anno") return startOfYear(t);
  if (modo === "data") { const d = floorDay(parseDate(dal)); if (d) return d; }
  return addDays(t, -365);
}
/** Pezzi venduti per codice dalla data `dal` (default: ultimi 12 mesi). Colonna "Consumo" di Magazzino. */
export function consumoMap(dal = null) {
  const limit = dal ? floorDay(dal) : inizioConsumo();
  const m = new Map();
  for (const v of db().vendite) {
    const d = parseDate(v.data);
    if (d >= limit) m.set(v.codice, (m.get(v.codice) || 0) + (Number(v.qta) || 0));
  }
  return m;
}
export const valoreArticolo = (a) => (Number(a.giacenza) || 0) * (Number(a.costo) || 0);
export const prezzoTotVendita = (v) => (Number(v.qta) || 0) * (Number(v.prezzo) || 0);
export const costoTotVendita = (v) => (v.costo === null || v.costo === undefined) ? null : (Number(v.qta) || 0) * Number(v.costo);
export const muVendita = (v) => (v.costo ? Number(v.prezzo) / Number(v.costo) : null);
/** Netto IVA di una vendita (come nelle statistiche VBA: prezzo_tot / (1 + ivaval)). */
export const nettoVendita = (v) => prezzoTotVendita(v) / (1 + (Number(v.ivaVal) || 0));

// =============================================================== movimenti / spese
export function creaMovimento(codice, movimento, costo, fornitore, tipo, data = null) {
  const m = {
    id: store.newId("m"), data: data || nowIso(), utente: store.utente, codice,
    movimento: Number(movimento) || 0, costo: (costo === "" || costo === null || costo === undefined) ? null : Number(costo),
    fornitore: trim(fornitore), tipo,
  };
  db().movimenti.push(m);
  return m;
}
export function creaSpesa({ data, tipologia, descrizione, spesa, fornitore, iva, ivaVal }) {
  const s = {
    id: store.newId("s"), data: data ? toIso(data) : nowIso(), utente: store.utente, tipologia: trim(tipologia),
    descrizione: trim(descrizione), spesa: Number(spesa) || 0, fornitore: trim(fornitore), iva: !!iva, ivaVal: iva ? Number(ivaVal) || 0 : 0,
  };
  db().spese.push(s);
  return s;
}
export function modificaSpesa(id, patch) {
  const s = db().spese.find((x) => x.id === id);
  if (!s) throw new Error("Spesa non trovata");
  Object.assign(s, patch, { data: patch.data ? toIso(patch.data) : s.data, spesa: Number(patch.spesa) || 0, ivaVal: patch.iva ? Number(patch.ivaVal) || 0 : 0 });
  store.commit("spese");
}
export function cancellaSpesa(id) {
  const i = db().spese.findIndex((x) => x.id === id);
  if (i < 0) throw new Error("Spesa non trovata");
  db().spese.splice(i, 1);
  store.commit("spese");
}

// =============================================================== liste impostazioni
function addToList(list, value) {
  const v = trim(value);
  if (!v) return false;
  if (list.some((x) => lc(x) === lc(v))) return false;
  list.push(v);
  list.sort((a, b) => a.localeCompare(b, "it", { sensitivity: "base" }));
  return true;
}
export function fornitoreEsiste(nome) { return S().fornitori.some((f) => lc(f.nome) === lc(nome)); }
export function aggiungiFornitore(nome, extra = {}) {
  if (!trim(nome) || fornitoreEsiste(nome)) return false;
  S().fornitori.push({ nome: trim(nome), default: false, debito: 0, dataDebito: toDay(today()), ...extra });
  return true;
}
export function tipologiaSpesaEsiste(nome) { return S().tipologieSpese.some((t) => lc(t.nome) === lc(nome)); }
export function aggiungiTipologiaSpesa(nome, diretta) {
  if (!trim(nome) || tipologiaSpesaEsiste(nome)) return false;
  S().tipologieSpese.push({ nome: trim(nome), diretta: !!diretta });
  return true;
}

// =============================================================== CARICO (carica_mag)
/** Cerca un articolo con stessa tipologia+descrizione+dimensioni+decoro (confronto esatto, case-insensitive). */
export function trovaArticoloUguale(tipo, descr, dim, decoro) {
  return db().magazzino.find((a) => lc(a.tipologia) === lc(tipo) && lc(a.descrizione) === lc(descr) && lc(a.dimensioni) === lc(dim) && lc(a.decoro) === lc(decoro)) || null;
}
/** Ricerca "contiene" per la finestra Cerca/Seleziona e per la lista oggetti della vendita. */
export function cercaArticoli({ tipo = "", descr = "", dim = "", decoro = "" }, { soloDisponibili = false, soloConPrezzo = false } = {}) {
  return db().magazzino.filter((a) =>
    like(a.tipologia, tipo) && like(a.descrizione, descr) && like(a.dimensioni, dim) && like(a.decoro, decoro)
    && (!soloDisponibili || (Number(a.giacenza) || 0) > 0)
    && (!soloConPrezzo || (a.prezzo !== null && a.prezzo !== undefined && a.prezzo !== ""))
  );
}
/**
 * Esegue il carico. `dati` = { tipo, descr, dim, decoro, qty, costo (netto IVA), forn, prezzo, spesaAuto, iva, ivaVal }.
 * `decisioni` = { aggiornaCosto, aggiornaFornitore, aggiornaPrezzo } (solo se l'articolo esiste già).
 * Ritorna { articolo, nuovo, fornitoreNuovo }.
 */
export function eseguiCarico(dati, decisioni = {}) {
  const qty = Number(dati.qty) || 0;
  const costo = Number(dati.costo) || 0;
  const forn = trim(dati.forn);
  const prezzo = (dati.prezzo === "" || dati.prezzo === null || dati.prezzo === undefined) ? null : Number(dati.prezzo);
  let art = trovaArticoloUguale(dati.tipo, dati.descr, dati.dim, dati.decoro);
  let nuovo = false;
  let fornitoreNuovo = false;
  if (art) {
    if (decisioni.aggiornaCosto) art.costo = costo;
    if (decisioni.aggiornaFornitore) { art.fornitore = forn; fornitoreNuovo = true; }
    if (decisioni.aggiornaPrezzo) art.prezzo = prezzo;
    art.giacenza = (Number(art.giacenza) || 0) + qty;
  } else {
    const codice = prossimoCodice(dati.tipo);
    if (!codice) throw new Error("Tipologia non valida");
    if (findArticolo(codice)) throw new Error("Codice già esistente: " + codice);
    art = {
      id: store.newId("a"), codice, tipologia: tipologiaByNome(dati.tipo).nome, descrizione: trim(dati.descr), dimensioni: trim(dati.dim),
      decoro: trim(dati.decoro), giacenza: qty, costo, fornitore: forn, prezzo,
    };
    db().magazzino.push(art);
    nuovo = true;
    fornitoreNuovo = true;
  }
  creaMovimento(art.codice, qty, art.costo, art.fornitore, "Carico");
  if (dati.spesaAuto) {
    const valSpesa = dati.iva ? art.costo * (1 + (Number(dati.ivaVal) || 0)) * qty : art.costo * qty;
    creaSpesa({ data: new Date(), tipologia: "Materiale", descrizione: "Carico Magazzino " + art.codice, spesa: valSpesa, fornitore: forn, iva: dati.iva, ivaVal: dati.ivaVal });
  }
  store.commit("magazzino");
  return { articolo: art, nuovo, fornitoreNuovo: fornitoreNuovo && forn && !fornitoreEsiste(forn) ? forn : null };
}

// =============================================================== MODIFICA ARTICOLO (modifica_mag)
export function modificaArticolo(id, dati) {
  const art = db().magazzino.find((a) => a.id === id);
  if (!art) throw new Error("Articolo non trovato");
  const qty = Number(dati.qty) || 0;
  const costo = Number(dati.costo) || 0;
  const forn = trim(dati.forn);
  if (qty !== (Number(art.giacenza) || 0)) {
    creaMovimento(art.codice, qty - (Number(art.giacenza) || 0), costo, forn, "Correzione");
  }
  // se cambia la tipologia il codice NON viene rigenerato (come in Excel): si usa "Cambia codice"
  art.tipologia = tipologiaByNome(dati.tipo) ? tipologiaByNome(dati.tipo).nome : trim(dati.tipo);
  art.descrizione = trim(dati.descr);
  art.dimensioni = trim(dati.dim);
  art.decoro = trim(dati.decoro);
  art.giacenza = qty;
  art.costo = costo;
  art.fornitore = forn;
  art.prezzo = (dati.prezzo === "" || dati.prezzo === null || dati.prezzo === undefined) ? null : Number(dati.prezzo);
  store.commit("magazzino");
  return { articolo: art, fornitoreNuovo: forn && !fornitoreEsiste(forn) ? forn : null };
}

// =============================================================== CAMBIA CODICE (modifica_code)
export function cambiaCodice(id, nuovoCodice) {
  const art = db().magazzino.find((a) => a.id === id);
  if (!art) throw new Error("Articolo non trovato");
  const nuovo = trim(nuovoCodice).toUpperCase();
  if (!nuovo) return;
  if (CODICI_SPECIALI.includes(nuovo)) throw new Error("Codice riservato");
  const dup = findArticolo(nuovo);
  if (dup && dup.id !== id) throw new Error(`Il codice ${nuovo} esiste già (${dup.tipologia} ${dup.descrizione} ${dup.decoro}). Codici duplicati non ammessi.`);
  const vecchio = art.codice;
  art.codice = nuovo;
  for (const m of db().movimenti) if (m.codice === vecchio) m.codice = nuovo;
  for (const v of db().vendite) if (v.codice === vecchio) v.codice = nuovo;
  store.commit("magazzino");
}

// =============================================================== CANCELLA CODICE (canc_code)
/** Elimina l'articolo e, come in Excel, tutti i movimenti e le vendite con quel codice. */
export function cancellaArticolo(id, { eliminaStorico = true } = {}) {
  const i = db().magazzino.findIndex((a) => a.id === id);
  if (i < 0) throw new Error("Articolo non trovato");
  const codice = db().magazzino[i].codice;
  db().magazzino.splice(i, 1);
  let nm = 0, nv = 0;
  if (eliminaStorico) {
    const before = { m: db().movimenti.length, v: db().vendite.length };
    db().movimenti = db().movimenti.filter((m) => m.codice !== codice);
    db().vendite = db().vendite.filter((v) => v.codice !== codice);
    nm = before.m - db().movimenti.length; nv = before.v - db().vendite.length;
  }
  store.commit("magazzino");
  return { codice, movimentiEliminati: nm, venditeEliminate: nv };
}

// =============================================================== VENDITA (carica_vend)
export function eseguiVendita(d) {
  const art = findArticolo(d.codice);
  if (!art) throw new Error("Articolo non trovato nel magazzino");
  const qty = Number(d.qty) || 0;
  if (qty <= 0) throw new Error("Selezionare una quantità positiva.");
  const giac = Number(art.giacenza) || 0;
  if (qty > giac) throw new Error(`Quantità richiesta non disponibile in magazzino (giacenza ${giac}).`);
  const prezzo = Number(d.prezzo);
  if (!(prezzo >= 0)) throw new Error("Indicare un prezzo di vendita positivo o nullo.");
  const v = {
    id: store.newId("v"), data: nowIso(), codice: art.codice, qta: qty, prezzo, costo: Number(art.costo) || 0,
    iva: !!d.iva, ivaVal: d.iva ? Number(d.ivaVal) || 0 : 0, cliente: trim(d.cliente), zona: trim(d.zona), pagamento: trim(d.pagam), operatore: trim(d.operatore),
  };
  db().vendite.push(v);
  art.giacenza = giac - qty;
  creaMovimento(art.codice, -qty, null, "", "Vendita", v.data);
  addToList(S().zone, v.zona); addToList(S().pagamenti, v.pagamento); addToList(S().clienti, v.cliente);
  store.commit("vendite");
  return v;
}

// =============================================================== INCASSO (carica_incasso)
export function eseguiIncasso(d) {
  const qty = Number(d.qty) || 0;
  if (qty <= 0) throw new Error("Selezionare una quantità positiva.");
  const prezzo = Number(d.prezzo);
  if (!(prezzo >= 0)) throw new Error("Indicare un incasso positivo o nullo.");
  const v = {
    id: store.newId("v"), data: nowIso(), codice: d.tipo === "Spedizione" ? "SPEDIZIONE" : "INCASSO", qta: qty, prezzo, costo: null,
    iva: !!d.iva, ivaVal: d.iva ? Number(d.ivaVal) || 0 : 0, cliente: trim(d.cliente), zona: trim(d.zona), pagamento: trim(d.pagam), operatore: trim(d.operatore || store.operatore),
  };
  db().vendite.push(v);
  addToList(S().zone, v.zona); addToList(S().pagamenti, v.pagamento); addToList(S().clienti, v.cliente);
  store.commit("vendite");
  return v;
}

// =============================================================== CANCELLA VENDITA (canc_vend)
export function cancellaVendita(id) {
  const i = db().vendite.findIndex((v) => v.id === id);
  if (i < 0) throw new Error("Vendita non trovata");
  const v = db().vendite[i];
  if (CODICI_SPECIALI.includes(v.codice)) {
    db().vendite.splice(i, 1);
    store.commit("vendite");
    return { ripristinato: 0 };
  }
  const d = parseDate(v.data).getTime();
  const qta = Number(v.qta) || 0;
  const mi = db().movimenti.findIndex((m) => Math.abs(parseDate(m.data).getTime() - d) <= 60000 && trim(m.codice) === trim(v.codice) && (Number(m.movimento) || 0) === -qta && lc(m.tipo) === "vendita");
  if (mi < 0) throw new Error("Movimento magazzino corrispondente non trovato: la vendita non è stata cancellata.");
  const art = findArticolo(v.codice);
  if (!art) throw new Error("Articolo non trovato nel magazzino: la vendita non è stata cancellata.");
  db().vendite.splice(i, 1);
  db().movimenti.splice(mi, 1);
  art.giacenza = (Number(art.giacenza) || 0) + qta;
  store.commit("vendite");
  return { ripristinato: qta, codice: art.codice };
}
/** Modifica dei soli campi che non toccano il magazzino. */
export function modificaVendita(id, patch) {
  const v = db().vendite.find((x) => x.id === id);
  if (!v) throw new Error("Vendita non trovata");
  if (patch.prezzo !== undefined) v.prezzo = Number(patch.prezzo) || 0;
  if (patch.iva !== undefined) { v.iva = !!patch.iva; v.ivaVal = v.iva ? Number(patch.ivaVal) || 0 : 0; }
  for (const k of ["cliente", "zona", "pagamento", "operatore"]) if (patch[k] !== undefined) v[k] = trim(patch[k]);
  addToList(S().zone, v.zona); addToList(S().pagamenti, v.pagamento); addToList(S().clienti, v.cliente);
  store.commit("vendite");
}

// =============================================================== TIPOLOGIE (Modulo_tipo)
export function aggiungiTipologia(nome, prefisso) {
  nome = trim(nome); prefisso = trim(prefisso).toUpperCase();
  if (!nome || !prefisso) throw new Error("Nome e prefisso sono obbligatori");
  if (S().tipologie.some((t) => lc(t.nome) === lc(nome))) throw new Error("Tipologia già presente");
  if (S().tipologie.some((t) => lc(t.prefisso) === lc(prefisso))) throw new Error("Prefisso già presente");
  S().tipologie.push({ nome, prefisso });
  store.commit("settings");
}
export function modificaTipologia(index, nome, prefisso) {
  const t = S().tipologie[index];
  if (!t) throw new Error("Tipologia non trovata");
  nome = trim(nome); prefisso = trim(prefisso).toUpperCase();
  if (!nome || !prefisso) throw new Error("Nome e prefisso sono obbligatori");
  if (S().tipologie.some((x, i) => i !== index && lc(x.nome) === lc(nome))) throw new Error("Tipologia già presente");
  if (S().tipologie.some((x, i) => i !== index && lc(x.prefisso) === lc(prefisso))) throw new Error("Prefisso già presente");
  const n = S().numDigit;
  const vecchioPref = t.prefisso;
  const rename = (code) => {
    const c = trim(code);
    return (c.length > n && lc(c.slice(0, c.length - n)) === lc(vecchioPref)) ? prefisso + c.slice(c.length - n) : c;
  };
  if (prefisso !== vecchioPref) {
    // controllo collisioni prima di toccare i dati
    const nuovi = new Set(db().magazzino.filter((a) => rename(a.codice) !== a.codice).map((a) => rename(a.codice)));
    const collisioni = db().magazzino.filter((a) => nuovi.has(a.codice) && rename(a.codice) === a.codice);
    if (collisioni.length) throw new Error("Il nuovo prefisso genererebbe codici duplicati: " + collisioni.map((a) => a.codice).join(", "));
  }
  for (const a of db().magazzino) {
    if (lc(a.tipologia) === lc(t.nome) || rename(a.codice) !== a.codice) { a.codice = rename(a.codice); a.tipologia = nome; }
  }
  for (const m of db().movimenti) m.codice = rename(m.codice);
  for (const v of db().vendite) v.codice = rename(v.codice);
  t.nome = nome; t.prefisso = prefisso;
  store.commit("settings");
}
/** Cancella la tipologia e TUTTI gli articoli con quel prefisso, con movimenti e vendite (come canc_tipo). */
export function cancellaTipologia(index) {
  const t = S().tipologie[index];
  if (!t) throw new Error("Tipologia non trovata");
  const n = S().numDigit;
  const codici = db().magazzino.filter((a) => lc(prefissoDiCodice(a.codice)) === lc(t.prefisso) && a.codice.length === t.prefisso.length + n).map((a) => a.codice);
  const set = new Set(codici);
  db().magazzino = db().magazzino.filter((a) => !set.has(a.codice));
  db().movimenti = db().movimenti.filter((m) => !set.has(m.codice));
  db().vendite = db().vendite.filter((v) => !set.has(v.codice));
  S().tipologie.splice(index, 1);
  store.commit("settings");
  return codici.length;
}
export function articoliDiTipologia(index) {
  const t = S().tipologie[index];
  if (!t) return 0;
  const n = S().numDigit;
  return db().magazzino.filter((a) => lc(prefissoDiCodice(a.codice)) === lc(t.prefisso) && a.codice.length === t.prefisso.length + n).length;
}

// =============================================================== CHECK (check_mov) e integrità
export function checkMovimenti() {
  const map = articoliByCodice();
  const anomalie = [];
  for (const m of db().movimenti) {
    const a = map.get(m.codice);
    if (!a) anomalie.push({ tipo: "codice", movimento: m, testo: `Codice ${m.codice} non trovato nel magazzino` });
    else if (lc(m.tipo) !== "vendita" && m.costo !== null && m.costo !== undefined && Math.abs(Number(m.costo) - Number(a.costo)) > 0.005) {
      anomalie.push({ tipo: "costo", movimento: m, articolo: a, testo: `Codice ${m.codice} con costo diverso: Mov=${Number(m.costo).toFixed(2)} €, Mag=${Number(a.costo).toFixed(2)} €` });
    }
  }
  return anomalie;
}
export function correggiCostiMovimenti() {
  const map = articoliByCodice();
  let n = 0;
  for (const m of db().movimenti) {
    const a = map.get(m.codice);
    if (a && lc(m.tipo) !== "vendita" && m.costo !== null && Math.abs(Number(m.costo) - Number(a.costo)) > 0.005) { m.costo = Number(a.costo); n++; }
  }
  if (n) store.commit("movimenti");
  return n;
}
/** Verifica coerenza magazzino: giacenze vs somma movimenti, codici duplicati, vendite senza movimento. */
export function verificaIntegrita() {
  const somme = new Map();
  for (const m of db().movimenti) somme.set(m.codice, (somme.get(m.codice) || 0) + (Number(m.movimento) || 0));
  const problemi = [];
  const visti = new Map();
  for (const a of db().magazzino) {
    if (visti.has(a.codice)) problemi.push({ tipo: "duplicato", codice: a.codice, articolo: a, testo: `Codice duplicato ${a.codice}` });
    visti.set(a.codice, a);
    const s = somme.get(a.codice) || 0;
    if (Math.abs(s - (Number(a.giacenza) || 0)) > 1e-9) {
      problemi.push({ tipo: "giacenza", codice: a.codice, articolo: a, giacenza: Number(a.giacenza) || 0, movimenti: s, testo: `${a.codice}: giacenza ${a.giacenza} ma la somma dei movimenti è ${s}` });
    }
    if ((Number(a.giacenza) || 0) < 0) problemi.push({ tipo: "negativa", codice: a.codice, articolo: a, testo: `${a.codice}: giacenza negativa (${a.giacenza})` });
    if (!tipologiaDiCodice(a.codice) || lc(tipologiaDiCodice(a.codice)) !== lc(a.tipologia)) problemi.push({ tipo: "tipologia", codice: a.codice, articolo: a, testo: `${a.codice}: il prefisso del codice non corrisponde alla tipologia "${a.tipologia}"` });
  }
  for (const c of somme.keys()) if (!visti.has(c)) problemi.push({ tipo: "orfano", codice: c, testo: `Movimenti per il codice ${c} che non esiste più in magazzino` });
  const vendute = new Map();
  for (const v of db().vendite) if (!CODICI_SPECIALI.includes(v.codice)) vendute.set(v.codice, (vendute.get(v.codice) || 0) + (Number(v.qta) || 0));
  const movVend = new Map();
  for (const m of db().movimenti) if (lc(m.tipo) === "vendita") movVend.set(m.codice, (movVend.get(m.codice) || 0) - (Number(m.movimento) || 0));
  for (const [c, q] of vendute) if (Math.abs(q - (movVend.get(c) || 0)) > 1e-9) problemi.push({ tipo: "vendite", codice: c, testo: `${c}: vendute ${q} unità ma i movimenti di vendita sommano ${movVend.get(c) || 0}` });
  return problemi;
}
/** Allinea la giacenza alla somma dei movimenti creando un movimento di correzione (tracciato). */
export function allineaGiacenza(codice, aMovimenti = true) {
  const a = findArticolo(codice);
  if (!a) return;
  let s = 0;
  for (const m of db().movimenti) if (m.codice === a.codice) s += Number(m.movimento) || 0;
  if (aMovimenti) a.giacenza = s;
  else creaMovimento(a.codice, (Number(a.giacenza) || 0) - s, a.costo, a.fornitore, "Correzione");
  store.commit("magazzino");
}

// =============================================================== PERIODO (Modulo_data)
export function risolviPeriodo() {
  const p = S().periodo;
  const t = today();
  const resolve = (mode, fixed, fallback) => {
    switch (mode) {
      case "today": return t;
      case "weekStart": return startOfWeek(t);
      case "monthStart": return startOfMonth(t);
      case "yearStart": return startOfYear(t);
      default: { const d = fixed ? floorDay(parseDate(fixed)) : null; return d || fallback; }
    }
  };
  const dataIn = resolve(p.dataInMode, p.dataIn, startOfYear(t));
  const dataEnd = resolve(p.dataEndMode, p.dataEnd, t);
  return { dataIn, dataEnd };
}
function setPeriodo(dataIn, dataEnd) {
  const t = today();
  const p = S().periodo;
  const set = (key, d) => {
    d = floorDay(d);
    if (d.getTime() === t.getTime()) { p[key + "Mode"] = "today"; p[key] = toDay(d); }
    else { p[key + "Mode"] = "fixed"; p[key] = toDay(d); }
  };
  if (dataIn) set("dataIn", dataIn);
  if (dataEnd) set("dataEnd", dataEnd);
  store.commit("periodo");
}
export const periodo = {
  oggi() { const p = S().periodo; p.dataInMode = "today"; p.dataEndMode = "today"; p.dataIn = p.dataEnd = toDay(today()); store.commit("periodo"); },
  settimana() { const p = S().periodo; p.dataInMode = "weekStart"; p.dataEndMode = "today"; store.commit("periodo"); },
  mese() { const p = S().periodo; p.dataInMode = "monthStart"; p.dataEndMode = "today"; store.commit("periodo"); },
  anno() { const p = S().periodo; p.dataInMode = "yearStart"; p.dataEndMode = "today"; store.commit("periodo"); },
  giornoPiu() {
    const { dataIn, dataEnd } = risolviPeriodo(); const t = today();
    const a = addDays(dataIn, 1), b = addDays(dataEnd, 1);
    setPeriodo(a <= t ? a : dataIn, b <= t ? b : dataEnd);
  },
  giornoMeno() { const { dataIn, dataEnd } = risolviPeriodo(); setPeriodo(addDays(dataIn, -1), addDays(dataEnd, -1)); },
  settPiu() {
    const { dataIn, dataEnd } = risolviPeriodo(); const t = today();
    const a = addDays(dataIn, 7);
    if (a > t) return;
    const b = addDays(dataEnd, 7);
    if (b >= t) return periodo.settimana();
    setPeriodo(a, b);
  },
  settMeno() {
    const { dataIn, dataEnd } = risolviPeriodo(); const t = today();
    if (dataEnd >= t) setPeriodo(addDays(startOfWeek(t), -7), addDays(endOfWeek(t), -7));
    else setPeriodo(addDays(dataIn, -7), addDays(dataEnd, -7));
  },
  mesePiu() {
    const { dataIn, dataEnd } = risolviPeriodo(); const t = today();
    const a = addMonths(dataIn, 1);
    if (a > t) return;
    const b = (dataEnd.getTime() === endOfMonth(dataEnd).getTime()) ? endOfMonth(addMonths(startOfMonth(dataEnd), 1)) : addMonths(dataEnd, 1);
    if (b >= t) return periodo.mese();
    setPeriodo(a, b);
  },
  meseMeno() {
    const { dataIn, dataEnd } = risolviPeriodo(); const t = today();
    if (dataEnd >= t) { const m = addMonths(startOfMonth(t), -1); setPeriodo(m, endOfMonth(m)); }
    else {
      const a = addMonths(dataIn, -1);
      const b = (dataEnd.getTime() === endOfMonth(dataEnd).getTime()) ? endOfMonth(addMonths(startOfMonth(dataEnd), -1)) : addMonths(dataEnd, -1);
      setPeriodo(a, b);
    }
  },
  annoPiu() {
    const { dataIn, dataEnd } = risolviPeriodo(); const t = today();
    const a = addYears(dataIn, 1);
    if (a > t) return;
    const b = addYears(dataEnd, 1);
    if (b >= t) return periodo.anno();
    setPeriodo(a, b);
  },
  annoMeno() {
    const { dataIn, dataEnd } = risolviPeriodo(); const t = today();
    if (dataEnd >= t) { const y = t.getFullYear() - 1; setPeriodo(new Date(y, 0, 1), new Date(y, 11, 31)); }
    else setPeriodo(addYears(dataIn, -1), addYears(dataEnd, -1));
  },
  setDataIn(d) { if (d) setPeriodo(d, null); },
  setDataEnd(d) { if (d) setPeriodo(null, d); },
};

// =============================================================== CONTO ECONOMICO (aggiorna)
/**
 * Porting di Modulo2.aggiorna. Differenze volute rispetto al VBA:
 *  - i cicli su spese e movimenti filtrano per data invece di assumere l'ordine cronologico
 *    (in Excel le spese inserite con data retroattiva venivano saltate nel calcolo dei debiti);
 *  - i movimenti di tipo "Correzione" entrano nel debito verso il fornitore solo se l'opzione
 *    tasse.correzioniNelDebito è attiva (default: attiva, come in Excel).
 */
export function contoEconomico(dataIn, dataEnd) {
  const s = S(); const T = s.tasse;
  const D = db();
  dataIn = floorDay(dataIn); dataEnd = floorDay(dataEnd);
  const dataInAnno = startOfYear(dataIn);
  const ivaBase = 0.22;
  const forzaIva = !!T.forzaIva;
  const percIvaForz = Number(T.percIvaForzata) || 0;
  const aumPrezzi = Number(T.aumentoPrezziNonIva) || 0;

  // valore magazzino oggi e ricostruzione a ritroso tramite i movimenti (costo attuale dell'articolo)
  const costi = new Map();
  let valmag = 0;
  for (const a of D.magazzino) { costi.set(a.codice, Number(a.costo) || 0); valmag += valoreArticolo(a); }
  let valmagEnd = valmag, valmagIn = valmag, valmagInAnno = valmag;
  for (const m of D.movimenti) {
    const c = costi.get(m.codice);
    if (c === undefined) continue;
    const d = floorDay(m.data);
    const delta = (Number(m.movimento) || 0) * c;
    if (d > dataEnd) { valmagEnd -= delta; valmagIn -= delta; valmagInAnno -= delta; }
    else if (d >= dataIn) { valmagIn -= delta; valmagInAnno -= delta; }
    else if (d >= dataInAnno) { valmagInAnno -= delta; }
  }

  // ricavi
  let ricaviTot = 0, ricavi = 0, ricaviPrec = 0, ricaviPrecTot = 0, ricaviNonIva = 0, costiNonIva = 0, ricaviPrecNonIva = 0, costiPrecNonIva = 0;
  let creditoIva = 0;
  for (const v of D.vendite) {
    let prezzo = prezzoTotVendita(v);
    let iva;
    if (forzaIva) { iva = ivaBase * percIvaForz; if (!v.iva) prezzo *= (1 + aumPrezzi); }
    else iva = v.iva ? (Number(v.ivaVal) || 0) : 0;
    const d = floorDay(v.data);
    const netto = prezzo / (1 + iva);
    const costoTot = costoTotVendita(v) || 0;
    if (d >= dataIn && d <= dataEnd) {
      ricaviTot += netto;
      if (iva > 0 || v.iva) { ricavi += netto; creditoIva -= prezzo * iva / (1 + iva); }
      if (!v.iva) { ricaviNonIva += netto; costiNonIva += costoTot; }
    }
    if (d >= dataInAnno && d < dataIn) {
      ricaviPrecTot += netto;
      if (iva > 0 || v.iva) ricaviPrec += netto;
      if (!v.iva) { ricaviPrecNonIva += netto; costiPrecNonIva += costoTot; }
    }
  }

  // spese dirette / indirette
  const dirette = new Set(s.tipologieSpese.filter((t) => t.diretta).map((t) => t.nome));
  let speseDir = 0, speseIndir = 0, speseDirTot = 0, speseIndirTot = 0, speseDirPrec = 0, speseIndirPrec = 0;
  for (const sp of D.spese) {
    const iva = sp.iva ? (Number(sp.ivaVal) || 0) : 0;
    const d = floorDay(sp.data);
    const netto = (Number(sp.spesa) || 0) / (1 + iva);
    const dir = dirette.has(sp.tipologia);
    if (d >= dataIn && d <= dataEnd) {
      if (dir) speseDirTot += netto; else speseIndirTot += netto;
      if (iva > 0) { if (dir) speseDir += netto; else speseIndir += netto; creditoIva += (Number(sp.spesa) || 0) * iva / (1 + iva); }
    }
    if (d >= dataInAnno && d < dataIn) { if (dir) speseDirPrec += netto; else speseIndirPrec += netto; }
  }

  // debiti verso fornitori: debito alla data di riferimento +/- carichi (a costo) - pagamenti (spese)
  const debitoAlla = (f, data) => {
    const dataDeb = floorDay(parseDate(f.dataDebito) || today());
    let debito = Number(f.debito) || 0;
    const nome = lc(f.nome);
    const inRange = (d, a, b) => d >= a && d < b; // [a, b)
    for (const sp of D.spese) {
      if (lc(sp.fornitore) !== nome) continue;
      const d = floorDay(sp.data);
      const iva = sp.iva ? (Number(sp.ivaVal) || 0) : 0;
      const netto = (Number(sp.spesa) || 0) / (1 + iva);
      if (data > dataDeb && inRange(d, dataDeb, data)) debito -= netto;
      else if (data < dataDeb && inRange(d, data, dataDeb)) debito += netto;
    }
    const conCorrezioni = T.correzioniNelDebito !== false;
    for (const m of D.movimenti) {
      if (lc(m.fornitore) !== nome) continue;
      const tipoM = lc(m.tipo);
      if (tipoM === "vendita" || (tipoM === "correzione" && !conCorrezioni)) continue;
      const d = floorDay(m.data);
      const valore = (Number(m.costo) || 0) * (Number(m.movimento) || 0);
      if (data > dataDeb && inRange(d, dataDeb, data)) debito += valore;
      else if (data < dataDeb && inRange(d, data, dataDeb)) debito -= valore;
    }
    return debito;
  };
  let debIn = 0, debEnd = 0, debInAnno = 0;
  const debitiFornitori = [];
  for (const f of s.fornitori) {
    const dIn = debitoAlla(f, dataIn);
    const dEnd = debitoAlla(f, addDays(dataEnd, 1)); // "<= data_end" nel VBA
    const dAnno = debitoAlla(f, dataInAnno);
    debIn += dIn; debEnd += dEnd; debInAnno += dAnno;
    debitiFornitori.push({ fornitore: f.nome, iniziale: dIn, finale: dEnd });
  }

  let percIva, percIvaPrec;
  if (forzaIva) { percIva = percIvaForz; percIvaPrec = percIvaForz; }
  else { percIva = ricaviTot ? ricavi / ricaviTot : null; percIvaPrec = ricaviPrecTot ? ricaviPrec / ricaviPrecTot : null; }

  // tasse
  let tasse = 0, imponibile = 0, imponibilePrec = 0;
  const giorni = daysBetween(dataIn, dataEnd) + 1;
  const giorniPrec = daysBetween(dataInAnno, dataIn);
  const cogsVal = speseDirTot - (valmagEnd - valmagIn) + (debEnd - debIn);
  const cogsPrec = speseDirPrec - (valmagIn - valmagInAnno) + (debIn - debInAnno);
  if (Number(T.regime) === 1) {
    if (forzaIva) {
      imponibilePrec = (ricaviPrec - cogsPrec - speseIndirPrec) * (percIvaPrec || 0);
      imponibile = (ricaviTot - cogsVal - speseIndirTot) * (percIva || 0);
    } else {
      imponibilePrec = ricaviPrec - ricaviPrecNonIva - (cogsPrec - costiPrecNonIva) - speseIndirPrec;
      imponibile = ricaviTot - ricaviNonIva - (cogsVal - costiNonIva) - speseIndirTot;
    }
    if (imponibilePrec < 0) imponibilePrec = 0;
    if (imponibile < 0) imponibile = 0;
    const dedPrec = (Number(T.speseDaDedurre) || 0) * giorniPrec / 365;
    let ded = (Number(T.speseDaDedurre) || 0) * giorni / 365;
    imponibilePrec -= dedPrec;
    if (imponibilePrec < 0) { ded -= imponibilePrec; imponibilePrec = 0; }
    imponibile -= ded;
    if (imponibile < 0) imponibile = 0;
    const tab = T.scaglioniIrpef || [];
    const addReg = T.addizionaleRegionale;
    const aliq = (r) => (Number(r.aliquota) || 0) + (addReg ? (Number(r.addRegionale) || 0) : 0);
    // scaglioni: l'imponibile del periodo si somma a quello già maturato nell'anno
    let valore = 0, ii = 0;
    while (valore < imponibilePrec && ii < tab.length) {
      if (tab[ii].limite == null || imponibilePrec <= tab[ii].limite) valore = imponibilePrec;
      else { valore = tab[ii].limite; ii++; }
    }
    const totale = imponibile + imponibilePrec;
    while (valore < totale && ii < tab.length) {
      if (tab[ii].limite == null || totale <= tab[ii].limite) { tasse += (totale - valore) * aliq(tab[ii]); valore = totale; }
      else { tasse += (tab[ii].limite - valore) * aliq(tab[ii]); valore = tab[ii].limite; ii++; }
    }
    const minInps = (Number(T.minInps) || 0) * giorni / 365;
    let inps = imponibile * (Number(T.aliqInps) || 0);
    if (inps < minInps) inps = minInps;
    tasse += inps;
    tasse -= (Number(T.speseDaDetrarre) || 0) * giorni / 365;
    if (tasse < 0) tasse = 0;
  } else if (Number(T.regime) === 2) {
    imponibile = ricaviTot * (percIva || 0) * (Number(T.coeffRedditivita) || 0);
    const minInps = (Number(T.minInps) || 0) * giorni / 365;
    let inps = imponibile * (Number(T.aliqInps) || 0);
    if (inps < minInps) inps = minInps;
    inps *= (1 - (Number(T.riduzioneInpsForf) || 0));
    tasse += inps;
    tasse += imponibile * (Number(T.aliqForfettario) || 0);
  }

  const cogs = -cogsVal;
  const gross = ricaviTot + cogs;
  const sga = -speseIndirTot;
  const ebitda = gross + sga;
  const utile = ebitda - tasse;
  return {
    dataIn, dataEnd, ricavi: ricaviTot, cogs, gross, sga, ebitda, tasse: -tasse, utile, imponibile, creditoIva,
    magIn: valmagIn, magEnd: valmagEnd, debIn, debEnd, percIva, percNonIva: percIva === null ? null : 1 - percIva,
    speseDirTot, speseIndirTot, debitiFornitori, valmagOggi: valmag,
  };
}

// =============================================================== STATISTICHE (agg_stat)
export function statisticheTipologie(dataIn, dataEnd) {
  dataIn = floorDay(dataIn); const limite = addDays(floorDay(dataEnd), 1);
  const map = new Map();
  for (const v of db().vendite) {
    const d = parseDate(v.data);
    if (d < dataIn || d >= limite) continue;
    const tipo = tipologiaDiCodice(v.codice);
    if (!tipo) continue;
    const r = map.get(tipo) || { tipologia: tipo, qta: 0, valore: 0 };
    r.qta += Number(v.qta) || 0;
    r.valore += nettoVendita(v);
    map.set(tipo, r);
  }
  return Array.from(map.values()).map((r) => ({ ...r, medio: r.qta ? r.valore / r.qta : 0 })).sort((a, b) => b.valore - a.valore);
}

// =============================================================== PLOT (Modulo_plot)
/** Serie temporali per tipologia (plot). criterio: 1 quantità, 2 valore, 3 incassi totali. */
export function serieTemporali({ dataIn, dataEnd, periodo: per, criterio, tipologie, media }) {
  dataIn = floorDay(dataIn); dataEnd = floorDay(dataEnd);
  const timeline = [];
  let d = dataIn;
  let tipoPeriodo = 0;
  const fine = addDays(dataEnd, per);
  let guard = 0;
  while (d <= fine && guard++ < 5000) {
    timeline.push(d);
    if (dataIn.getDate() === 1 && per === 30) { tipoPeriodo = 1; d = addMonths(startOfMonth(d), 1); }
    else if (dataIn.getDate() === 1 && per === 365) { tipoPeriodo = 2; d = addYears(d, 1); }
    else d = addDays(d, per);
  }
  if (timeline.length <= 1) return null;
  const labels = timeline.slice(0, -1);
  const bucketOf = (date) => {
    // indice i tale che timeline[i] <= date < timeline[i+1]
    let lo = 0, hi = timeline.length - 1;
    if (date < timeline[0] || date >= timeline[hi]) return -1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (date >= timeline[mid]) lo = mid; else hi = mid; }
    return lo;
  };
  const series = [];
  const target = criterio === 3 ? ["Incassi totali"] : tipologie;
  for (const tipologia of target) {
    const valori = new Array(labels.length).fill(0);
    for (const v of db().vendite) {
      const i = bucketOf(parseDate(v.data));
      if (i < 0) continue;
      if (criterio === 3) valori[i] += nettoVendita(v);
      else {
        if (tipologiaDiCodice(v.codice) !== tipologia) continue;
        if (criterio === 1) valori[i] += Number(v.qta) || 0;
        else valori[i] += (Number(v.prezzo) || 0) / (1 + (Number(v.ivaVal) || 0)); // come nel VBA: prezzo unitario netto
      }
    }
    series.push({ nome: tipologia, valori });
  }
  let mediaSerie = null;
  if (media && criterio !== 3 && series.length > 1) {
    mediaSerie = labels.map((_, i) => series.reduce((acc, s) => acc + s.valori[i], 0) / series.length);
  }
  return { labels, series, media: mediaSerie, tipoPeriodo, periodo: per };
}
/** Andamento settimanale: % del valore netto per giorno della settimana. */
export function andamentoSettimanale({ dataIn, dataEnd, tutte }) {
  const valori = new Array(7).fill(0);
  let tot = 0;
  const a = floorDay(dataIn), b = addDays(floorDay(dataEnd), 1);
  for (const v of db().vendite) {
    const d = parseDate(v.data);
    if (!tutte && (d < a || d >= b)) continue;
    const n = nettoVendita(v);
    valori[weekdayMon(d)] += n; tot += n;
  }
  return { labels: ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"], valori: valori.map((x) => (tot ? x / tot : 0)), assoluti: valori, totale: tot };
}
/** Andamento giornaliero: % del valore netto per fascia oraria. */
export function andamentoGiornaliero({ dataIn, dataEnd, tutte }) {
  const labels = ["<8:00", "8:00", "9:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", ">20:00"];
  const valori = new Array(labels.length).fill(0);
  let tot = 0;
  const a = floorDay(dataIn), b = addDays(floorDay(dataEnd), 1);
  for (const v of db().vendite) {
    const d = parseDate(v.data);
    if (!tutte && (d < a || d >= b)) continue;
    const ora = Math.round(d.getHours() + d.getMinutes() / 60);
    let i = 0, oraI = 7;
    while (ora > oraI && i < labels.length - 1) { i++; oraI++; }
    const n = nettoVendita(v);
    valori[i] += n; tot += n;
  }
  return { labels, valori: valori.map((x) => (tot ? x / tot : 0)), assoluti: valori, totale: tot };
}
/** Andamento annuale: incassi netti (K€) per mese, una serie per anno. */
export function andamentoAnnuale({ dataIn, dataEnd, tutte }) {
  const a = floorDay(dataIn), b = addDays(floorDay(dataEnd), 1);
  const anni = new Map();
  for (const v of db().vendite) {
    const d = parseDate(v.data);
    if (!tutte && (d < a || d >= b)) continue;
    const y = d.getFullYear();
    if (!anni.has(y)) anni.set(y, new Array(12).fill(0));
    anni.get(y)[d.getMonth()] += nettoVendita(v);
  }
  const years = Array.from(anni.keys()).sort();
  return { labels: MESI_BREVI, series: years.map((y) => ({ nome: String(y), valori: anni.get(y).map((x) => Math.round(x / 100) / 10) })) };
}

// =============================================================== ANALISI AGGIUNTIVE (dashboard negozio)
export function analisiNegozio(dataIn, dataEnd) {
  const a = floorDay(dataIn), b = addDays(floorDay(dataEnd), 1);
  const giorni = daysBetween(a, dataEnd) + 1;
  const aPrec = addDays(a, -giorni), bPrec = a;
  const D = db();
  const arts = articoliByCodice();
  const kpi = { ricavi: 0, pezzi: 0, scontrini: 0, margine: 0, costo: 0, ricaviPrec: 0, pezziPrec: 0, scontriniPrec: 0, incassiExtra: 0 };
  const perTipo = new Map(), perArticolo = new Map(), perOperatore = new Map(), perPagamento = new Map(), perZona = new Map(), perGiorno = new Map();
  const heat = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const scontriniSet = new Set(), scontriniPrecSet = new Set();
  for (const v of D.vendite) {
    const d = parseDate(v.data);
    const netto = nettoVendita(v);
    const chiaveScontrino = toIso(d).slice(0, 16) + "|" + (v.operatore || "");
    if (d >= aPrec && d < bPrec) { kpi.ricaviPrec += netto; kpi.pezziPrec += CODICI_SPECIALI.includes(v.codice) ? 0 : Number(v.qta) || 0; scontriniPrecSet.add(chiaveScontrino); }
    if (d < a || d >= b) continue;
    kpi.ricavi += netto; scontriniSet.add(chiaveScontrino);
    const dayKey = toDay(d);
    perGiorno.set(dayKey, (perGiorno.get(dayKey) || 0) + netto);
    heat[weekdayMon(d)][d.getHours()] += netto;
    perOperatore.set(v.operatore || "(n.d.)", (perOperatore.get(v.operatore || "(n.d.)") || 0) + netto);
    perPagamento.set(v.pagamento || "(n.d.)", (perPagamento.get(v.pagamento || "(n.d.)") || 0) + netto);
    perZona.set(v.zona || "(n.d.)", (perZona.get(v.zona || "(n.d.)") || 0) + netto);
    if (CODICI_SPECIALI.includes(v.codice)) { kpi.incassiExtra += netto; continue; }
    kpi.pezzi += Number(v.qta) || 0;
    const costo = costoTotVendita(v) || 0;
    kpi.costo += costo;
    const tipo = tipologiaDiCodice(v.codice) || "(altro)";
    const t = perTipo.get(tipo) || { tipologia: tipo, valore: 0, qta: 0, margine: 0 };
    t.valore += netto; t.qta += Number(v.qta) || 0; t.margine += netto - costo; perTipo.set(tipo, t);
    const art = arts.get(v.codice);
    const nome = art ? `${art.codice} · ${[art.tipologia, art.descrizione, art.dimensioni, art.decoro].filter(Boolean).join(" ")}` : v.codice;
    const pa = perArticolo.get(v.codice) || { codice: v.codice, nome, valore: 0, qta: 0 };
    pa.valore += netto; pa.qta += Number(v.qta) || 0; perArticolo.set(v.codice, pa);
  }
  kpi.scontrini = scontriniSet.size; kpi.scontriniPrec = scontriniPrecSet.size;
  kpi.margine = kpi.ricavi - kpi.incassiExtra - kpi.costo;
  kpi.scontrinoMedio = kpi.scontrini ? kpi.ricavi / kpi.scontrini : 0;
  kpi.scontrinoMedioPrec = kpi.scontriniPrec ? kpi.ricaviPrec / kpi.scontriniPrec : 0;
  kpi.marginePct = (kpi.ricavi - kpi.incassiExtra) ? kpi.margine / (kpi.ricavi - kpi.incassiExtra) : 0;
  // magazzino
  const consumo = consumoMap();
  let valoreMag = 0, pezziMag = 0;
  const magPerTipo = new Map();
  const lenti = [], esauriti = [];
  for (const art of D.magazzino) {
    const g = Number(art.giacenza) || 0; const val = valoreArticolo(art);
    valoreMag += val; pezziMag += g;
    const t = magPerTipo.get(art.tipologia) || { tipologia: art.tipologia, valore: 0, pezzi: 0, consumo: 0 };
    t.valore += val; t.pezzi += g; t.consumo += consumo.get(art.codice) || 0; magPerTipo.set(art.tipologia, t);
    const c = consumo.get(art.codice) || 0;
    if (g > 0 && c === 0) lenti.push({ ...art, valore: val, consumo: c });
    if (g === 0 && c >= 3) esauriti.push({ ...art, consumo: c });
  }
  lenti.sort((x, y) => y.valore - x.valore);
  esauriti.sort((x, y) => y.consumo - x.consumo);
  // serie giornaliera/mensile dei ricavi (netti) ultimi 12 mesi + anno precedente
  const mensile = [];
  const start = startOfMonth(addMonths(floorDay(dataEnd), -11));
  for (let i = 0; i < 12; i++) {
    const m = addMonths(start, i);
    mensile.push({ mese: m, label: `${MESI_BREVI[m.getMonth()]} ${String(m.getFullYear()).slice(2)}`, valore: 0, precedente: 0 });
  }
  for (const v of D.vendite) {
    const d = parseDate(v.data);
    const netto = nettoVendita(v);
    for (const r of mensile) {
      if (d.getFullYear() === r.mese.getFullYear() && d.getMonth() === r.mese.getMonth()) { r.valore += netto; break; }
      if (d.getFullYear() === r.mese.getFullYear() - 1 && d.getMonth() === r.mese.getMonth()) { r.precedente += netto; break; }
    }
  }
  const top = Array.from(perArticolo.values()).sort((x, y) => y.valore - x.valore).slice(0, 10);
  const tipi = Array.from(perTipo.values()).sort((x, y) => y.valore - x.valore);
  return {
    kpi, giorni, perTipo: tipi, top, perOperatore: mapToSorted(perOperatore), perPagamento: mapToSorted(perPagamento), perZona: mapToSorted(perZona),
    perGiorno, heat, valoreMag, pezziMag, magPerTipo: Array.from(magPerTipo.values()).sort((x, y) => y.valore - x.valore), lenti, esauriti, mensile,
  };
}
function mapToSorted(m) { return Array.from(m.entries()).map(([nome, valore]) => ({ nome, valore })).sort((a, b) => b.valore - a.valore); }

// =============================================================== SCHEDA STATISTICHE
// Tutti i numeri della scheda in un solo passaggio sulle vendite, per un periodo scelto, un periodo
// di confronto e un eventuale filtro per tipologie. Gli importi sono netti IVA.

/** Periodo di confronto: "annoPrima" (stesse date un anno prima) o "precedente" (stessa durata, subito prima). */
export function periodoConfronto(dataIn, dataEnd, tipo) {
  const a = floorDay(dataIn), b = floorDay(dataEnd);
  if (tipo === "annoPrima") return { dataIn: addYears(a, -1), dataEnd: addYears(b, -1), versoCorrente: (d) => addYears(d, 1) };
  if (tipo === "precedente") {
    if (a.getDate() === 1) {
      // periodo che parte dal primo del mese: si sposta di mesi interi (ottobre -> settembre, 1-9 nov -> 1-9 ott;
      // dal 1° gennaio: l'anno prima)
      const mesi = a.getMonth() === 0 ? 12 : (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth() + 1;
      const fineMese = b.getTime() === endOfMonth(b).getTime();
      return { dataIn: addMonths(a, -mesi), dataEnd: fineMese ? endOfMonth(addMonths(startOfMonth(b), -mesi)) : addMonths(b, -mesi), versoCorrente: (d) => addMonths(d, mesi) };
    }
    const g = daysBetween(a, b) + 1;
    return { dataIn: addDays(a, -g), dataEnd: addDays(b, -g), versoCorrente: (d) => addDays(d, g) };
  }
  return null;
}
/** Passo del grafico nel tempo adatto alla durata del periodo. */
export function passoAuto(dataIn, dataEnd) {
  const g = daysBetween(dataIn, dataEnd) + 1;
  return g <= 45 ? "giorno" : g <= 200 ? "settimana" : "mese";
}
const inizioPasso = (d, passo) => (passo === "giorno" ? floorDay(d) : passo === "settimana" ? startOfWeek(d) : startOfMonth(d));
const passoSuccessivo = (d, passo) => (passo === "giorno" ? addDays(d, 1) : passo === "settimana" ? addDays(d, 7) : addMonths(d, 1));
/** Limiti superiori (€, netti) delle fasce di importo degli scontrini; l'ultima fascia è "oltre". */
export const FASCE_SCONTRINO = [20, 40, 70, 120, 250];

export function statisticheNegozio({ dataIn, dataEnd, confronto = "annoPrima", tipologie = [], passo = "auto" }) {
  const a = floorDay(dataIn), fine = floorDay(dataEnd), b = addDays(fine, 1);
  const conf = periodoConfronto(a, fine, confronto);
  const ca = conf ? conf.dataIn : null, cb = conf ? addDays(conf.dataEnd, 1) : null;
  const filtro = tipologie && tipologie.length ? new Set(tipologie) : null;
  const arts = articoliByCodice();
  const passoEff = passo === "auto" ? passoAuto(a, fine) : passo;

  // passi del grafico nel tempo
  const passi = [];
  for (let d = inizioPasso(a, passoEff), g = 0; d <= fine && g < 2000; d = passoSuccessivo(d, passoEff), g++) passi.push(d);
  const indicePasso = (d) => {
    if (d < a || d >= b) return -1;
    let lo = 0, hi = passi.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (passi[mid] <= d) lo = mid; else hi = mid - 1; }
    return lo;
  };
  const vuoto = () => new Array(passi.length).fill(0);
  const serie = { ricavi: vuoto(), pezzi: vuoto(), ricaviPrec: vuoto(), pezziPrec: vuoto() };

  const nuovoTot = () => ({ ricavi: 0, ricaviArticoli: 0, pezzi: 0, costo: 0, scontrini: new Map(), giorni: new Set() });
  const cur = nuovoTot(), prec = nuovoTot();
  const perTipo = new Map(), perArticolo = new Map(), perDecoro = new Map(), perOperatore = new Map(), perPagamento = new Map(), perZona = new Map();
  const settimana = Array.from({ length: 7 }, () => ({ valore: 0, qta: 0, giorni: new Set() }));
  const ore = { valore: new Array(24).fill(0), qta: new Array(24).fill(0) };
  const heat = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const anni = new Map(); // anno -> { valore[12], qta[12] } su tutto lo storico
  const somma = (m, k, valore, qta) => { const r = m.get(k) || { nome: k, valore: 0, qta: 0 }; r.valore += valore; r.qta += qta; m.set(k, r); return r; };

  for (const v of db().vendite) {
    const d = parseDate(v.data);
    if (!d) continue;
    const speciale = CODICI_SPECIALI.includes(v.codice);
    const tipo = speciale ? null : (tipologiaDiCodice(v.codice) || "(altro)");
    if (filtro && (speciale || !filtro.has(tipo))) continue;
    const netto = nettoVendita(v);
    const qta = speciale ? 0 : Number(v.qta) || 0;
    const costo = speciale ? 0 : costoTotVendita(v) || 0;
    const anno = d.getFullYear();
    if (!anni.has(anno)) anni.set(anno, { valore: new Array(12).fill(0), qta: new Array(12).fill(0) });
    anni.get(anno).valore[d.getMonth()] += netto; anni.get(anno).qta[d.getMonth()] += qta;

    const scontrino = toIso(d).slice(0, 16) + "|" + (v.operatore || "");
    const accumula = (t) => {
      t.ricavi += netto; t.pezzi += qta; t.costo += costo;
      if (!speciale) t.ricaviArticoli += netto;
      t.scontrini.set(scontrino, (t.scontrini.get(scontrino) || 0) + netto);
      t.giorni.add(toDay(d));
    };
    if (conf && d >= ca && d < cb) {
      accumula(prec);
      const i = indicePasso(conf.versoCorrente(d));
      if (i >= 0) { serie.ricaviPrec[i] += netto; serie.pezziPrec[i] += qta; }
      if (tipo) { const t = perTipo.get(tipo) || nuovaTipo(tipo); t.valorePrec += netto; t.qtaPrec += qta; perTipo.set(tipo, t); }
    }
    if (d < a || d >= b) continue;
    accumula(cur);
    const i = indicePasso(d);
    if (i >= 0) { serie.ricavi[i] += netto; serie.pezzi[i] += qta; }
    const wd = weekdayMon(d), h = d.getHours();
    settimana[wd].valore += netto; settimana[wd].qta += qta; settimana[wd].giorni.add(toDay(d));
    ore.valore[h] += netto; ore.qta[h] += qta;
    heat[wd][h] += netto;
    somma(perOperatore, v.operatore || "(non indicato)", netto, qta);
    somma(perPagamento, v.pagamento || "(non indicato)", netto, qta);
    somma(perZona, v.zona || "(non indicata)", netto, qta);
    if (!tipo) continue;
    const t = perTipo.get(tipo) || nuovaTipo(tipo);
    t.valore += netto; t.qta += qta; t.costo += costo; perTipo.set(tipo, t);
    const art = arts.get(v.codice);
    const pa = somma(perArticolo, v.codice, netto, qta);
    if (!pa.descr) pa.descr = art ? [art.tipologia, art.descrizione, art.dimensioni, art.decoro].filter(Boolean).join(" ") : "(articolo eliminato)";
    if (art && art.decoro) somma(perDecoro, art.decoro, netto, qta);
  }

  const riepilogo = (t) => {
    const sc = t.scontrini.size, gg = t.giorni.size;
    const margine = t.ricaviArticoli - t.costo;
    return {
      ricavi: t.ricavi, pezzi: t.pezzi, scontrini: sc, scontrinoMedio: sc ? t.ricavi / sc : 0,
      pezziPerScontrino: sc ? t.pezzi / sc : 0, margine, marginePct: t.ricaviArticoli ? margine / t.ricaviArticoli : 0,
      giorniVendita: gg, mediaGiorno: gg ? t.ricavi / gg : 0,
    };
  };
  const totTipi = Array.from(perTipo.values()).reduce((s, t) => s + t.valore, 0);
  const tipi = Array.from(perTipo.values()).filter((t) => t.valore || t.qta || t.valorePrec).map((t) => ({
    ...t, margine: t.valore - t.costo, marginePct: t.valore ? (t.valore - t.costo) / t.valore : 0,
    prezzoMedio: t.qta ? t.valore / t.qta : 0, quota: totTipi ? t.valore / totTipi : 0,
    variazione: t.valorePrec ? (t.valore - t.valorePrec) / t.valorePrec : null,
  })).sort((x, y) => y.valore - x.valore);

  const fasce = new Array(FASCE_SCONTRINO.length + 1).fill(0);
  for (const imp of cur.scontrini.values()) {
    let k = FASCE_SCONTRINO.findIndex((lim) => imp < lim);
    if (k < 0) k = FASCE_SCONTRINO.length;
    fasce[k]++;
  }
  const fasceLabels = FASCE_SCONTRINO.map((lim, i) => (i === 0 ? `sotto ${lim} €` : `${FASCE_SCONTRINO[i - 1]}-${lim} €`)).concat(`oltre ${FASCE_SCONTRINO[FASCE_SCONTRINO.length - 1]} €`);

  // progressivo dall'inizio dell'anno (ultimi 3 anni), fino al mese corrente per l'anno in corso
  const t0 = today();
  const anniOrd = Array.from(anni.keys()).sort();
  const progressivo = anniOrd.slice(-3).map((y) => {
    let acc = 0, accQ = 0;
    const r = anni.get(y);
    const valore = [], qta = [];
    for (let m = 0; m < 12; m++) {
      if (y === t0.getFullYear() && m > t0.getMonth()) { valore.push(null); qta.push(null); continue; }
      acc += r.valore[m]; accQ += r.qta[m];
      valore.push(acc); qta.push(accQ);
    }
    return { anno: y, valore, qta };
  });

  return {
    dataIn: a, dataEnd: fine, giorni: daysBetween(a, fine) + 1, passo: passoEff,
    confronto: conf ? { dataIn: conf.dataIn, dataEnd: conf.dataEnd } : null,
    kpi: riepilogo(cur), kpiPrec: conf ? riepilogo(prec) : null,
    serie: { labels: passi, ...serie },
    perTipo: tipi,
    perArticolo: Array.from(perArticolo.values()),
    perDecoro: Array.from(perDecoro.values()),
    perOperatore: Array.from(perOperatore.values()),
    perPagamento: Array.from(perPagamento.values()),
    perZona: Array.from(perZona.values()),
    settimana: settimana.map((s) => ({ valore: s.valore, qta: s.qta, giorni: s.giorni.size })),
    ore, heat,
    fasce: { labels: fasceLabels, valori: fasce },
    anni: anniOrd.map((y) => ({ anno: y, ...anni.get(y) })),
    progressivo,
  };
}
function nuovaTipo(tipologia) { return { tipologia, valore: 0, qta: 0, costo: 0, valorePrec: 0, qtaPrec: 0 }; }

/** Situazione del magazzino oggi (non dipende dal periodo), eventualmente per alcune tipologie. */
export function statisticheMagazzino(tipologie = []) {
  const filtro = tipologie && tipologie.length ? new Set(tipologie) : null;
  const consumo = consumoMap(); // pezzi venduti negli ultimi 12 mesi per codice
  const perTipo = new Map();
  let valore = 0, pezzi = 0, codici = 0;
  const fermi = [], daRiordinare = [];
  for (const art of db().magazzino) {
    if (filtro && !filtro.has(art.tipologia)) continue;
    const g = Number(art.giacenza) || 0, val = valoreArticolo(art), c = consumo.get(art.codice) || 0;
    valore += val; pezzi += g; if (g > 0) codici++;
    const t = perTipo.get(art.tipologia) || { tipologia: art.tipologia, valore: 0, pezzi: 0, venduti12: 0 };
    t.valore += val; t.pezzi += g; t.venduti12 += c; perTipo.set(art.tipologia, t);
    if (g > 0 && c === 0) fermi.push({ ...art, valore: val });
    if (g === 0 && c >= 3) daRiordinare.push({ ...art, venduti12: c });
  }
  const tipi = Array.from(perTipo.values()).filter((t) => t.pezzi || t.venduti12)
    .map((t) => ({ ...t, mesiScorta: t.venduti12 ? t.pezzi / (t.venduti12 / 12) : null }))
    .sort((x, y) => y.valore - x.valore);
  fermi.sort((x, y) => y.valore - x.valore);
  daRiordinare.sort((x, y) => y.venduti12 - x.venduti12);
  return { valore, pezzi, codici, perTipo: tipi, fermi, valoreFermi: fermi.reduce((s, x) => s + x.valore, 0), daRiordinare };
}

export { uniqueSorted, val };
