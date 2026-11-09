// Stato dell'applicazione e persistenza del database JSON.
//
// Tre modalità, scelte automaticamente all'avvio:
//  1. "server"  - la pagina è servita da server.js: il file JSON sta sul disco, al percorso
//                 impostato in Impostazioni (API /api/db).
//  2. "fs"      - pagina statica (es. GitHub Pages) in un browser con File System Access API
//                 (Chrome/Edge): l'utente sceglie il file JSON una volta, il permesso viene
//                 ricordato e il file viene riscritto ad ogni modifica.
//                 Solo su computer: sui telefoni la scrittura continua su file non è affidabile.
//  3. "local"   - cellulari e altri browser: il database vive nella memoria del browser (IndexedDB)
//                 e si scambia con un file JSON a mano, con "Apri file" e "Salva file" nella barra
//                 in alto (ad es. tramite l'app OneDrive del telefono).

import { nowIso, debounce } from "./util.js";

const LS_DB = "roscoerp.db";
const LS_OPERATORE = "roscoerp.operatore";
const LS_READONLY = "roscoerp.readonly";

function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

/** Messaggio comprensibile quando il file del database non si riesce a leggere. */
function fileErrorMessage(e, name) {
  if (e && e.name === "NotFoundError") return `Il file "${name}" non si trova più dove era stato scelto: forse è stato spostato o rinominato, oppure OneDrive non l'ha ancora scaricato su questo PC.`;
  if (e instanceof SyntaxError) return `Il file "${name}" non è un JSON valido (forse OneDrive lo sta ancora sincronizzando: riprova tra poco).`;
  return `Impossibile leggere "${name}": ${e && e.message ? e.message : e}`;
}
const IDB_NAME = "roscoerp";
const IDB_STORE = "handles";

export function defaultSettings() {
  return {
    numDigit: 5,
    nomeNegozio: "RoscoERP",
    tipologie: [],
    fornitori: [],
    zone: [],
    pagamenti: [],
    clienti: [],
    tipologieSpese: [{ nome: "Materiale", diretta: true }],
    operatori: [],
    flags: { mostraGiacenzaZero: true, soloConPrezzo: false, spesaAutoCarico: false, ivaSuCostoCarico: false },
    ivaDefault: 22,
    tasse: {
      forzaIva: false, percIvaForzata: 0.5, aumentoPrezziNonIva: 0, regime: 1, addizionaleRegionale: false,
      scaglioniIrpef: [
        { limite: 15000, aliquota: 0.23, addRegionale: 0.0142 },
        { limite: 28000, aliquota: 0.27, addRegionale: 0.0143 },
        { limite: 55000, aliquota: 0.38, addRegionale: 0.0168 },
        { limite: 75000, aliquota: 0.41, addRegionale: 0.0172 },
        { limite: null, aliquota: 0.43, addRegionale: 0.0173 },
      ],
      minInps: 3983.73, aliqInps: 0.2448, coeffRedditivita: 0.4, aliqForfettario: 0.05, riduzioneInpsForf: 0.35,
      speseDaDedurre: 0, speseDaDetrarre: 0, correzioniNelDebito: true,
    },
    statistiche: { periodo: 30, media: false, criterio: 1, tutteLeVendite: true },
    periodo: { dataInMode: "yearStart", dataIn: null, dataEndMode: "today", dataEnd: null },
  };
}

function deepMerge(base, extra) {
  if (Array.isArray(base)) return Array.isArray(extra) ? extra : base;
  if (base && typeof base === "object") {
    const out = { ...base };
    if (extra && typeof extra === "object") {
      for (const k of Object.keys(extra)) out[k] = k in base ? deepMerge(base[k], extra[k]) : extra[k];
    }
    return out;
  }
  return extra === undefined || extra === null ? base : extra;
}

/** Completa un database letto da file con tutti i campi obbligatori. */
export function normalizeDb(raw) {
  const db = raw && typeof raw === "object" ? raw : {};
  db.schema = db.schema || 1;
  db.meta = Object.assign({ app: "RoscoERP", createdAt: nowIso(), savedAt: null, revision: 0 }, db.meta || {});
  db.meta.nextId = Object.assign({ a: 1, m: 1, v: 1, s: 1 }, db.meta.nextId || {});
  db.settings = deepMerge(defaultSettings(), db.settings || {});
  for (const k of ["magazzino", "movimenti", "vendite", "spese"]) if (!Array.isArray(db[k])) db[k] = [];
  // id mancanti
  const prefixes = { magazzino: "a", movimenti: "m", vendite: "v", spese: "s" };
  for (const [coll, p] of Object.entries(prefixes)) {
    let max = db.meta.nextId[p] || 1;
    for (const row of db[coll]) {
      if (row.id) {
        const n = parseInt(String(row.id).replace(/^[a-z]+/, ""), 10);
        if (Number.isFinite(n) && n >= max) max = n + 1;
      }
    }
    for (const row of db[coll]) if (!row.id) row.id = p + (max++);
    db.meta.nextId[p] = max;
  }
  for (const a of db.magazzino) {
    a.giacenza = Number(a.giacenza) || 0;
    a.costo = Number(a.costo) || 0;
    a.prezzo = a.prezzo === "" || a.prezzo === null || a.prezzo === undefined || isNaN(a.prezzo) ? null : Number(a.prezzo);
    for (const k of ["codice", "tipologia", "descrizione", "dimensioni", "decoro", "fornitore"]) a[k] = a[k] == null ? "" : String(a[k]).trim();
  }
  return db;
}

// ----------------------------------------------------------------- IndexedDB (handle del file)
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const r = tx.objectStore(IDB_STORE).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbSet(key, value) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Telefono o tablet: niente scrittura continua su file, si usa "Apri file / Salva file". */
export function isMobile() {
  if (navigator.userAgentData && typeof navigator.userAgentData.mobile === "boolean" && navigator.userAgentData.mobile) return true;
  const ua = navigator.userAgent || "";
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
  // iPadOS si presenta come Mac: lo riconosce il touch
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

/** Nome del file salvato dal telefono: sempre lo stesso, così in OneDrive si sostituisce il precedente. */
export const LOCAL_FILE_NAME = "roscoerp.json";

// --------------------------------------------------------------------------------- Store
class Store {
  constructor() {
    this.db = null;
    this.mode = null;          // "server" | "fs" | "local"
    this.dbPath = "";          // percorso (server) o nome file (fs)
    this.fileHandle = null;    // modalità fs
    this.status = "idle";      // idle | saving | saved | error | conflict
    this.lastError = null;
    this.listeners = new Set();
    this.statusListeners = new Set();
    this.operatore = localStorage.getItem(LS_OPERATORE) || "";
    this.saveDebounced = debounce(() => this.save(), 300);
    this.dirty = false;
    this.serverInfo = null;
    this.readOnly = lsGet(LS_READONLY) === "1"; // vale solo per questo browser (modalità fs)
    this.fileLastModified = null;
    this.loadError = null;
    // modalità local: da quale file vengono i dati e se ci sono modifiche non ancora salvate su file
    this.localInfo = { fileName: "", fileSavedAt: null, openedAt: null, exportedAt: null, unsaved: false };
  }

  // ---- eventi
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  onStatus(fn) { this.statusListeners.add(fn); return () => this.statusListeners.delete(fn); }
  notify(what) { for (const fn of this.listeners) fn(what); }
  setStatus(s, err = null) { this.status = s; this.lastError = err; for (const fn of this.statusListeners) fn(s, err); }

  setOperatore(nome) { this.operatore = nome || ""; localStorage.setItem(LS_OPERATORE, this.operatore); this.notify("operatore"); }
  get utente() { return this.operatore || (this.serverInfo && this.serverInfo.user) || "web"; }

  newId(prefix) {
    const n = this.db.meta.nextId[prefix] || 1;
    this.db.meta.nextId[prefix] = n + 1;
    return prefix + n;
  }

  /** Da chiamare dopo ogni modifica: notifica la UI e programma il salvataggio. */
  commit(what = "db") {
    if (this.mode === "fs" && this.readOnly) {
      // sola consultazione: la modifica non viene salvata, si torna ai dati del file
      this.loadFromHandle().catch((e) => console.error(e)).then(() => this.notify("readonlyBlocked"));
      return;
    }
    this.dirty = true;
    if (this.mode === "local" && !this.localInfo.unsaved) { this.localInfo.unsaved = true; this.saveLocalInfo(); }
    this.notify(what);
    this.saveDebounced();
  }

  // ---- caricamento
  async init() {
    // 1) server locale?
    try {
      const r = await fetch("/api/config", { cache: "no-store" });
      if (r.ok) {
        const cfg = await r.json();
        this.mode = "server";
        this.dbPath = cfg.dbPath;
        this.serverInfo = cfg;
        await this.loadFromServer();
        return;
      }
    } catch (e) { /* non servito da server.js */ }
    // 2) File System Access API (solo computer)
    if (window.showOpenFilePicker && !isMobile()) {
      this.mode = "fs";
      const handle = await idbGet("dbFile").catch(() => null);
      if (handle) {
        this.fileHandle = handle;
        this.dbPath = handle.name;
        // Con "Consenti a ogni visita" (Chrome/Edge) il permesso è già concesso e il file si rilegge da
        // solo; altrimenti va richiesto con un clic: la UI mostra il pulsante "Riapri il database".
        const perm = await handle.queryPermission({ mode: this.permMode }).catch(() => "prompt");
        this.db = null;
        if (perm === "granted") {
          try { await this.loadFromHandle(); }
          catch (e) { this.loadError = fileErrorMessage(e, handle.name); this.db = null; }
        }
        return;
      }
      this.db = null; // la UI chiede di scegliere/creare il file
      return;
    }
    // 3) memoria del browser (IndexedDB; i dati di versioni precedenti in localStorage vengono spostati)
    this.mode = "local";
    this.dbPath = "memoria del browser";
    this.localInfo = Object.assign(this.localInfo, await idbGet("localInfo").catch(() => null) || {});
    let data = await idbGet("db").catch(() => null);
    if (!data) {
      const raw = localStorage.getItem(LS_DB);
      if (raw) {
        data = JSON.parse(raw);
        await idbSet("db", data);
        localStorage.removeItem(LS_DB);
      }
    }
    // senza dati la UI propone "Apri file" o "Inizia da zero"
    this.db = data ? normalizeDb(data) : null;
  }

  // ---- modalità local: scambio con un file JSON
  saveLocalInfo() {
    if (typeof indexedDB === "undefined") return Promise.resolve();
    return idbSet("localInfo", { ...this.localInfo }).catch((e) => console.error(e));
  }

  /** Legge un File scelto dall'utente e lo controlla, senza ancora sostituire i dati. */
  async readDbFile(file) {
    const text = await file.text();
    let obj;
    try { obj = JSON.parse(text); } catch (e) { throw new Error(`Il file "${file.name}" non è un file JSON valido.`); }
    if (!obj || !Array.isArray(obj.magazzino)) throw new Error(`Il file "${file.name}" non sembra un database RoscoERP.`);
    return obj;
  }

  /** Modalità local: sostituisce i dati del browser con quelli del file aperto. */
  async openLocalFile(file, obj) {
    this.db = normalizeDb(obj);
    this.localInfo = { fileName: file.name, fileSavedAt: this.db.meta.savedAt || null, openedAt: nowIso(), exportedAt: null, unsaved: false };
    await this.save(true);
    await this.saveLocalInfo();
    this.notify("load");
  }

  /** Modalità local: database vuoto, da riempire e poi salvare su file. */
  async startEmptyLocal() {
    this.db = normalizeDb({});
    this.localInfo = { fileName: "", fileSavedAt: null, openedAt: nowIso(), exportedAt: null, unsaved: true };
    await this.save(true);
    await this.saveLocalInfo();
    this.notify("load");
  }

  /**
   * Salva i dati in un file JSON. Sul telefono apre il menu "Condividi" (da lì si sceglie OneDrive o
   * "Salva in File"); dove non è disponibile scarica il file. Ritorna "shared" | "downloaded" | "cancelled".
   */
  async saveToFile() {
    if (!this.db) return "cancelled";
    this.db.meta.savedAt = nowIso();
    const text = JSON.stringify(this.db);
    const name = LOCAL_FILE_NAME;
    let how = "downloaded";
    const file = typeof File === "function" ? new File([text], name, { type: "application/json" }) : null;
    if (file && isMobile() && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        how = "shared";
      } catch (e) {
        if (e.name === "AbortError") return "cancelled";
        throw e;
      }
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }
    this.localInfo.exportedAt = this.db.meta.savedAt;
    this.localInfo.unsaved = false;
    if (!this.localInfo.fileName) this.localInfo.fileName = name;
    if (this.mode === "local") { await this.save(true); await this.saveLocalInfo(); }
    this.notify("localFile");
    return how;
  }

  async loadFromServer() {
    const r = await fetch("/api/db", { cache: "no-store" });
    if (!r.ok) throw new Error("Impossibile leggere il database: " + r.status);
    this.db = normalizeDb(await r.json());
    this.baseRevision = this.db.meta.revision || 0;
    this.notify("load");
    await this.save(true); // salvataggio all'apertura (come richiesto)
  }

  async setServerPath(dbPath, mode) {
    const r = await fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dbPath, mode }) });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(body.error || "Errore"); e.body = body; throw e; }
    this.dbPath = body.dbPath;
    if (mode === "copy") {
      // il nuovo file è una copia di quello corrente: riallinea la revisione e salva lo stato in memoria
      this.baseRevision = undefined;
      await this.save(true, true);
      await this.loadFromServer();
    } else {
      await this.loadFromServer();
    }
    const cfg = await fetch("/api/config", { cache: "no-store" }).then((x) => x.json()).catch(() => null);
    if (cfg) this.serverInfo = cfg;
    return body;
  }

  // ---- modalità fs
  async pickFile(create = false) {
    let handle;
    if (create) {
      handle = await window.showSaveFilePicker({ suggestedName: "roscoerp.json", types: [{ description: "Database RoscoERP", accept: { "application/json": [".json"] } }] });
    } else {
      [handle] = await window.showOpenFilePicker({ types: [{ description: "Database RoscoERP", accept: { "application/json": [".json"] } }], multiple: false });
    }
    this.fileHandle = handle;
    this.dbPath = handle.name;
    await idbSet("dbFile", handle);
    if (create) {
      this.db = normalizeDb({});
      await this.save(true);
      this.notify("load");
    } else {
      await this.loadFromHandle();
    }
  }
  async reopenHandle() {
    const perm = await this.fileHandle.requestPermission({ mode: this.permMode });
    if (perm !== "granted") throw new Error("Permesso negato");
    this.loadError = null;
    try { await this.loadFromHandle(); }
    catch (e) { this.loadError = fileErrorMessage(e, this.fileHandle.name); throw new Error(this.loadError); }
  }
  async loadFromHandle() {
    const file = await this.fileHandle.getFile();
    const text = await file.text();
    this.db = normalizeDb(text.trim() ? JSON.parse(text) : {});
    this.fileLastModified = file.lastModified;
    this.loadError = null;
    this.dirty = false;
    this.notify("load");
    if (this.readOnly) this.setStatus("readonly");
    else await this.save(true);
  }

  // ---- sola consultazione (modalità fs): questo PC legge il file e non lo scrive mai
  get permMode() { return this.readOnly ? "read" : "readwrite"; }
  setReadOnly(v) {
    this.readOnly = !!v;
    try { localStorage.setItem(LS_READONLY, this.readOnly ? "1" : "0"); } catch (e) { /* ignore */ }
    this.notify("readonly");
    if (this.db) this.setStatus(this.readOnly ? "readonly" : "saved");
  }
  /** Rilegge il file se è cambiato dall'ultima lettura (sola consultazione). Ritorna true se ha ricaricato. */
  async refreshIfChanged() {
    if (this.mode !== "fs" || !this.readOnly || !this.fileHandle || !this.db) return false;
    try {
      if (await this.fileHandle.queryPermission({ mode: "read" }) !== "granted") return false;
      const file = await this.fileHandle.getFile();
      if (file.lastModified === this.fileLastModified) return false;
      await this.loadFromHandle();
      return true;
    } catch (e) { console.warn("Rilettura del file non riuscita", e); return false; }
  }

  /** Sostituisce il database corrente con uno importato (file JSON caricato dall'utente). */
  async replaceDb(obj) {
    this.db = normalizeDb(obj);
    this.baseRevision = undefined;
    if (this.mode === "local") { this.localInfo.unsaved = true; await this.saveLocalInfo(); }
    this.notify("load");
    await this.save(true, true);
  }

  // ---- salvataggio
  async save(immediate = false, force = false) {
    if (!this.db) return;
    if (this.mode === "fs" && this.readOnly) { this.dirty = false; this.setStatus("readonly"); return false; }
    this.setStatus("saving");
    try {
      this.db.meta.savedAt = nowIso();
      if (this.mode === "server") {
        const payload = { ...this.db, meta: { ...this.db.meta, baseRevision: this.baseRevision } };
        const r = await fetch("/api/db" + (force ? "?force=1" : ""), {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        });
        if (r.status === 409) {
          const b = await r.json().catch(() => ({}));
          this.setStatus("conflict", b);
          return false;
        }
        if (!r.ok) throw new Error("Salvataggio fallito: " + r.status);
        const b = await r.json();
        this.db.meta.revision = b.revision;
        this.baseRevision = b.revision;
      } else if (this.mode === "fs") {
        if (!this.fileHandle) return false;
        const w = await this.fileHandle.createWritable();
        await w.write(JSON.stringify(this.db, null, 1));
        await w.close();
      } else if (typeof indexedDB !== "undefined") {
        await idbSet("db", this.db);
      } else {
        localStorage.setItem(LS_DB, JSON.stringify(this.db)); // ambienti senza IndexedDB (test)
      }
      this.dirty = false;
      this.setStatus("saved");
      return true;
    } catch (e) {
      console.error(e);
      this.setStatus("error", e);
      return false;
    }
  }

  /**
   * Salvataggio "best effort" alla chiusura della pagina. Il browser consente in chiusura solo
   * richieste piccole (~64 KB), quindi con database grandi ci si affida al salvataggio immediato
   * fatto ad ogni modifica (vedi commit) e a quello eseguito quando la pagina passa in secondo piano.
   */
  flushOnClose() {
    if (!this.db) return;
    if (this.mode === "server") {
      if (!this.dirty) return;
      const payload = JSON.stringify({ ...this.db, meta: { ...this.db.meta, baseRevision: this.baseRevision, savedAt: nowIso() } });
      if (payload.length < 60000) { try { navigator.sendBeacon("/api/db", new Blob([payload], { type: "application/json" })); } catch (e) { /* ignore */ } }
    } else if (this.mode === "local") {
      if (this.dirty) this.save(true); // IndexedDB è asincrono: di norma il salvataggio è già avvenuto
    }
  }

  exportJson() { return JSON.stringify(this.db, null, 1); }
}

export const store = new Store();
window.addEventListener("pagehide", () => store.flushOnClose());
window.addEventListener("beforeunload", () => store.flushOnClose());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && store.dirty) store.save(true);
  // sola consultazione: tornando sulla pagina si rilegge il file se il PC principale l'ha cambiato
  if (document.visibilityState === "visible") store.refreshIfChanged();
});
