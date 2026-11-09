// Funzioni di utilità: date, formattazione, DOM.

export const MESI = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
export const MESI_BREVI = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];
export const GIORNI_BREVI = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

const pad = (n) => String(n).padStart(2, "0");

/** Data odierna a mezzanotte (ora locale). */
export function today() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Converte una stringa ISO locale ("2024-03-01T13:10:00" o "2024-03-01") in Date locale. */
export function parseDate(s) {
  if (s instanceof Date) return s;
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) { const d = new Date(s); return isNaN(d) ? null : d; }
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}

/** Date -> "YYYY-MM-DD" */
export function toDay(d) {
  d = parseDate(d);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** Date -> "YYYY-MM-DDTHH:MM:SS" (ora locale, senza fuso) */
export function toIso(d) {
  d = parseDate(d);
  return `${toDay(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
export function nowIso() { return toIso(new Date()); }

/** Mezzanotte del giorno della data (equivalente di FLOOR(data,1) in VBA). */
export function floorDay(d) {
  d = parseDate(d);
  if (!d) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
export function addDays(d, n) {
  const r = new Date(parseDate(d));
  r.setDate(r.getDate() + n);
  return r;
}
export function addMonths(d, n) {
  const r = new Date(parseDate(d));
  const day = r.getDate();
  r.setDate(1);
  r.setMonth(r.getMonth() + n);
  const last = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(day, last));
  return r;
}
export function addYears(d, n) { return addMonths(d, 12 * n); }
export function startOfMonth(d) { d = parseDate(d); return new Date(d.getFullYear(), d.getMonth(), 1); }
export function endOfMonth(d) { d = parseDate(d); return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
export function startOfYear(d) { d = parseDate(d); return new Date(d.getFullYear(), 0, 1); }
export function endOfYear(d) { d = parseDate(d); return new Date(d.getFullYear(), 11, 31); }
/** Lunedì della settimana (weekday ISO). */
export function startOfWeek(d) {
  d = floorDay(d);
  const wd = (d.getDay() + 6) % 7; // 0 = lunedì
  return addDays(d, -wd);
}
export function endOfWeek(d) { return addDays(startOfWeek(d), 6); }
/** Giorno della settimana con lunedì = 0 ... domenica = 6 */
export function weekdayMon(d) { return (parseDate(d).getDay() + 6) % 7; }
export function daysBetween(a, b) { return Math.round((floorDay(b) - floorDay(a)) / 86400000); }
export function sameDay(a, b) { return toDay(a) === toDay(b); }
export function isoWeek(d) {
  d = floorDay(d);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
}

// ------------------------------------------------------------- formatting
const fmtEur = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtEur0 = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtNum = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });
const fmtNum0 = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 });
const fmtPct = new Intl.NumberFormat("it-IT", { style: "percent", maximumFractionDigits: 1 });

export const eur = (v) => (v === null || v === undefined || v === "" || isNaN(v)) ? "" : fmtEur.format(+v);
export const eur0 = (v) => (v === null || v === undefined || v === "" || isNaN(v)) ? "" : fmtEur0.format(+v);
export const num = (v) => (v === null || v === undefined || v === "" || isNaN(v)) ? "" : fmtNum.format(+v);
export const num0 = (v) => (v === null || v === undefined || v === "" || isNaN(v)) ? "" : fmtNum0.format(+v);
export const pct = (v) => (v === null || v === undefined || v === "" || isNaN(v)) ? "" : fmtPct.format(+v);
export function fmtDate(d) {
  d = parseDate(d);
  return d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` : "";
}
export function fmtDateTime(d) {
  d = parseDate(d);
  return d ? `${fmtDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}` : "";
}
export function fmtDateLong(d) {
  d = parseDate(d);
  return d ? `${d.getDate()} ${MESI_BREVI[d.getMonth()].toLowerCase()} ${d.getFullYear()}` : "";
}

/** Converte testo numerico in numero (accetta virgola decimale). Equivalente di Val(). */
export function val(s) {
  if (typeof s === "number") return s;
  if (s === null || s === undefined) return 0;
  const t = String(s).trim().replace(/\s/g, "").replace(/\./g, (m, i, str) => (str.indexOf(",") > -1 ? "" : m)).replace(",", ".");
  const n = parseFloat(t);
  return isNaN(n) ? 0 : n;
}
export const trim = (s) => (s === null || s === undefined) ? "" : String(s).trim();
export const lc = (s) => trim(s).toLowerCase();
/** Match "contiene", case-insensitive (equivalente di LCase(a) Like "*" & LCase(b) & "*"). */
export const like = (a, b) => lc(a).includes(lc(b));
export const round2 = (v) => Math.round((+v + Number.EPSILON) * 100) / 100;

// -------------------------------------------------------------------- DOM
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "style" && typeof v === "object") { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith("--")) node.style.setProperty(sk, sv); else node.style[sk] = sv; } }
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (v === true) node.setAttribute(k, "");
    else node.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
export function downloadText(filename, text, mime = "application/json") {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
export function uniqueSorted(arr) {
  return Array.from(new Set(arr.map(trim).filter(Boolean))).sort((a, b) => a.localeCompare(b, "it", { sensitivity: "base" }));
}
export function sortByKey(arr, key, dir = 1) {
  return arr.slice().sort((a, b) => {
    const va = typeof key === "function" ? key(a) : a[key];
    const vb = typeof key === "function" ? key(b) : b[key];
    if (va === vb) return 0;
    if (va === null || va === undefined || va === "") return 1;
    if (vb === null || vb === undefined || vb === "") return -1;
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
    return String(va).localeCompare(String(vb), "it", { numeric: true, sensitivity: "base" }) * dir;
  });
}
