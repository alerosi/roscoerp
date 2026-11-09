#!/usr/bin/env node
/**
 * RoscoERP - server locale (zero dipendenze, solo Node.js >= 16).
 *
 *   node server.js            -> http://localhost:8787
 *   PORT=9000 node server.js  -> porta diversa
 *
 * Serve la webapp (cartella public/) ed espone una piccola API:
 *   GET  /api/config          -> { dbPath, exists }
 *   PUT  /api/config          -> { dbPath, mode: "load" | "create" | "copy" }
 *   GET  /api/db              -> intero database JSON
 *   PUT  /api/db              -> salva l'intero database (scrittura atomica + backup)
 *   GET  /api/backups         -> elenco backup disponibili
 *   POST /api/restore         -> { file } ripristina un backup
 *
 * Il percorso del database è salvato in config.json accanto a questo file.
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const CONFIG_FILE = path.join(ROOT, "config.json");
const DEFAULT_DB = path.join(ROOT, "data", "roscoerp.json");
const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || "127.0.0.1";
const BACKUP_DAYS = 90;

/** Data/ora locale in formato "YYYY-MM-DDTHH:MM:SS" (coerente con il frontend). */
function localIso(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

// ------------------------------------------------------------------ config
function readConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    if (cfg && typeof cfg.dbPath === "string" && cfg.dbPath.trim()) return cfg;
  } catch (e) { /* no config yet */ }
  return { dbPath: DEFAULT_DB };
}
function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8");
}
function resolveDbPath(p) {
  let out = String(p || "").trim().replace(/^"|"$/g, "");
  if (out.startsWith("~")) out = path.join(os.homedir(), out.slice(1));
  if (!path.isAbsolute(out)) out = path.join(ROOT, out);
  if (!out.toLowerCase().endsWith(".json")) out += ".json";
  return path.normalize(out);
}

// --------------------------------------------------------------- database
function emptyDb() {
  const now = localIso();
  return {
    schema: 1,
    meta: { app: "RoscoERP", createdAt: now, savedAt: now, revision: 0, nextId: { a: 1, m: 1, v: 1, s: 1 } },
    settings: null, // il frontend applica i default
    magazzino: [], movimenti: [], vendite: [], spese: [],
  };
}
function loadDb(dbPath) {
  if (!fs.existsSync(dbPath)) return null;
  const raw = fs.readFileSync(dbPath, "utf8");
  if (!raw.trim()) return emptyDb();
  return JSON.parse(raw);
}
function backupDir(dbPath) {
  return path.join(path.dirname(dbPath), "backup_" + path.basename(dbPath, ".json"));
}
function makeBackup(dbPath) {
  if (!fs.existsSync(dbPath)) return;
  const dir = backupDir(dbPath);
  fs.mkdirSync(dir, { recursive: true });
  const base = path.basename(dbPath, ".json");
  // 1) copia "ultima versione precedente" sempre aggiornata
  fs.copyFileSync(dbPath, path.join(dir, base + ".prev.json"));
  // 2) un backup al giorno (il primo salvataggio della giornata)
  const day = localIso().slice(0, 10);
  const daily = path.join(dir, `${base}.${day}.json`);
  if (!fs.existsSync(daily)) fs.copyFileSync(dbPath, daily);
  // 3) pulizia backup giornalieri più vecchi di BACKUP_DAYS
  const limit = Date.now() - BACKUP_DAYS * 86400000;
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(/\.(\d{4}-\d{2}-\d{2})\.json$/);
    if (m && new Date(m[1]).getTime() < limit) {
      try { fs.unlinkSync(path.join(dir, f)); } catch (e) { /* ignore */ }
    }
  }
}
function saveDb(dbPath, db) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  makeBackup(dbPath);
  const tmp = dbPath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1), "utf8");
  fs.renameSync(tmp, dbPath);
}

// ------------------------------------------------------------------- http
function send(res, status, body, headers = {}) {
  const isObj = body !== null && typeof body === "object" && !Buffer.isBuffer(body);
  const data = isObj ? JSON.stringify(body) : body;
  res.writeHead(status, Object.assign({
    "Content-Type": isObj ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  }, headers));
  res.end(data);
}
function readBody(req, limit = 200 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("payload troppo grande")); req.destroy(); }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split("?")[0]);
  if (rel === "/" || rel === "") rel = "/index.html";
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, "forbidden");
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, "not found");
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    fs.createReadStream(file).pipe(res);
  });
}

let config = readConfig();

async function handleApi(req, res, url) {
  const dbPath = resolveDbPath(config.dbPath);
  if (url.pathname === "/api/config") {
    if (req.method === "GET") {
      return send(res, 200, { dbPath, exists: fs.existsSync(dbPath), backupDir: backupDir(dbPath), host: os.hostname(), user: os.userInfo().username });
    }
    if (req.method === "PUT") {
      const body = JSON.parse(await readBody(req) || "{}");
      const newPath = resolveDbPath(body.dbPath);
      const mode = body.mode || "load";
      const exists = fs.existsSync(newPath);
      if (mode === "load" && !exists) {
        return send(res, 404, { error: "file non trovato", dbPath: newPath, exists: false });
      }
      if (!exists) {
        fs.mkdirSync(path.dirname(newPath), { recursive: true });
        if (mode === "copy" && fs.existsSync(dbPath)) fs.copyFileSync(dbPath, newPath);
        else fs.writeFileSync(newPath, JSON.stringify(emptyDb(), null, 1), "utf8");
      }
      config = { dbPath: newPath };
      writeConfig(config);
      return send(res, 200, { dbPath: newPath, exists: true, created: !exists });
    }
  }
  if (url.pathname === "/api/db") {
    if (req.method === "GET") {
      let db = loadDb(dbPath);
      if (!db) {
        db = emptyDb();
        saveDb(dbPath, db); // il file non esiste: parte da zero e lo crea
      }
      return send(res, 200, db);
    }
    if (req.method === "PUT" || req.method === "POST") {
      const raw = await readBody(req);
      let db;
      try { db = JSON.parse(raw); } catch (e) { return send(res, 400, { error: "JSON non valido" }); }
      if (!db || typeof db !== "object" || !Array.isArray(db.magazzino)) {
        return send(res, 400, { error: "struttura database non valida" });
      }
      // controllo di concorrenza ottimistico: la revisione sul disco deve essere quella da cui il client è partito
      const current = loadDb(dbPath);
      const diskRev = current && current.meta ? Number(current.meta.revision || 0) : 0;
      const baseRev = Number(db.meta && db.meta.baseRevision);
      if (current && Number.isFinite(baseRev) && baseRev !== diskRev && !url.searchParams.has("force")) {
        return send(res, 409, { error: "Il database su disco è stato modificato da un'altra sessione.", diskRevision: diskRev, baseRevision: baseRev });
      }
      db.meta = db.meta || {};
      db.meta.revision = diskRev + 1;
      db.meta.savedAt = localIso();
      delete db.meta.baseRevision;
      saveDb(dbPath, db);
      return send(res, 200, { ok: true, revision: db.meta.revision, savedAt: db.meta.savedAt, dbPath });
    }
  }
  if (url.pathname === "/api/backups" && req.method === "GET") {
    const dir = backupDir(dbPath);
    if (!fs.existsSync(dir)) return send(res, 200, { dir, files: [] });
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { file: f, size: st.size, mtime: st.mtime.toISOString() };
    }).sort((a, b) => b.mtime.localeCompare(a.mtime));
    return send(res, 200, { dir, files });
  }
  if (url.pathname === "/api/restore" && req.method === "POST") {
    const body = JSON.parse(await readBody(req) || "{}");
    const file = path.basename(String(body.file || ""));
    const src = path.join(backupDir(dbPath), file);
    if (!file || !fs.existsSync(src)) return send(res, 404, { error: "backup non trovato" });
    const db = JSON.parse(fs.readFileSync(src, "utf8"));
    saveDb(dbPath, db);
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: "not found" });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    return serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: String(err && err.message || err) });
  }
});

server.listen(PORT, HOST, () => {
  const dbPath = resolveDbPath(config.dbPath);
  console.log(`RoscoERP in ascolto su http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  console.log(`Database: ${dbPath} ${fs.existsSync(dbPath) ? "(trovato)" : "(verrà creato al primo avvio)"}`);
  console.log("Premi Ctrl+C per uscire.");
});
