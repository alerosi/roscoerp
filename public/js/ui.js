// Componenti UI generici: toast, finestre modali, dialoghi, tabelle ordinabili.

import { el, $, escapeHtml, sortByKey } from "./util.js";

// ------------------------------------------------------------------ toast
export function toast(msg, type = "", ms = 3200) {
  const box = $("#toasts");
  const t = el("div", { class: `toast ${type}`, text: msg });
  box.append(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; setTimeout(() => t.remove(), 300); }, ms);
}

// ------------------------------------------------------------------ modal
let modalStack = [];
/**
 * Apre una finestra modale. Ritorna { close, root, body, foot }.
 * opts: { title, color, width, body (Node|Node[]), buttons: [{label, class, onClick(api), left}], onClose, escClose=true }
 */
export function openModal(opts) {
  const body = el("div", { class: "modal-body" });
  const foot = el("div", { class: "modal-foot" });
  const left = el("div", { class: "left" });
  const root = el("div", { class: "modal-backdrop" },
    el("div", { class: `modal ${opts.color || ""}`, style: opts.width ? { "--w": opts.width } : null },
      el("div", { class: "modal-head" }, el("h3", { text: opts.title || "" }), el("button", { class: "btn ghost sm", title: "Chiudi (Esc)", onClick: () => api.close(null) }, "✕")),
      body, foot));
  const api = {
    root, body, foot,
    close(result) {
      if (!root.isConnected) return;
      root.remove();
      modalStack = modalStack.filter((m) => m !== api);
      if (opts.onClose) opts.onClose(result);
    },
    setButtons(buttons) {
      foot.innerHTML = "";
      foot.append(left);
      left.innerHTML = "";
      for (const b of buttons || []) {
        const btn = el("button", { class: `btn ${b.class || ""}`, type: "button", onClick: () => b.onClick(api) }, b.label);
        if (b.id) btn.id = b.id;
        (b.left ? left : foot).append(btn);
      }
    },
  };
  const children = Array.isArray(opts.body) ? opts.body : [opts.body];
  body.append(...children.filter(Boolean));
  api.setButtons(opts.buttons);
  $("#modals").append(root);
  modalStack.push(api);
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && opts.escClose !== false) { e.stopPropagation(); api.close(null); }
    if (e.key === "Enter" && opts.onEnter && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); opts.onEnter(api); }
  });
  setTimeout(() => {
    const first = opts.focus ? root.querySelector(opts.focus) : root.querySelector("input:not([type=checkbox]):not([type=hidden]), select, textarea, button.primary");
    (first || root.querySelector("button")).focus();
  }, 20);
  return api;
}

export function alertDialog(msg, title = "Attenzione") {
  return new Promise((resolve) => {
    openModal({ title, width: "460px", body: el("p", { html: escapeHtml(msg).replace(/\n/g, "<br>") }), onClose: () => resolve(), onEnter: (a) => a.close(), buttons: [{ label: "OK", class: "primary", onClick: (a) => a.close() }] });
  });
}
export function confirmDialog(msg, { title = "Conferma", ok = "Sì", cancel = "No", danger = false, extra = null } = {}) {
  return new Promise((resolve) => {
    let result = false;
    openModal({
      title, width: "480px", color: danger ? "terracotta" : "",
      body: [el("p", { html: escapeHtml(msg).replace(/\n/g, "<br>") }), extra],
      onClose: () => resolve(result), onEnter: (a) => { result = true; a.close(); },
      buttons: [{ label: cancel, onClick: (a) => a.close() }, { label: ok, class: danger ? "terracotta" : "primary", onClick: (a) => { result = true; a.close(); } }],
    });
  });
}
/** Equivalente di MsgBox vbYesNoCancel: risolve "yes" | "no" | "cancel". */
export function yesNoCancel(msg, title = "Conferma") {
  return new Promise((resolve) => {
    let result = "cancel";
    openModal({
      title, width: "480px", body: el("p", { html: escapeHtml(msg).replace(/\n/g, "<br>") }), onClose: () => resolve(result),
      buttons: [
        { label: "Annulla", onClick: (a) => a.close() },
        { label: "No", onClick: (a) => { result = "no"; a.close(); } },
        { label: "Sì", class: "primary", onClick: (a) => { result = "yes"; a.close(); } },
      ],
    });
  });
}
export function promptDialog(msg, def = "", { title = "Inserisci", placeholder = "" } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const input = el("input", { class: "input", type: "text", value: def, placeholder });
    openModal({
      title, width: "460px", body: [el("p", { text: msg }), input], onClose: () => resolve(result),
      onEnter: (a) => { result = input.value; a.close(); },
      buttons: [{ label: "Annulla", onClick: (a) => a.close() }, { label: "OK", class: "primary", onClick: (a) => { result = input.value; a.close(); } }],
    });
  });
}

// ------------------------------------------------------------------ campi form
export function field(label, input, { hint = null, cls = "" } = {}) {
  return el("label", { class: `field ${cls}` }, el("span", { text: label }), input, hint ? el("span", { class: "hint", text: hint }) : null);
}
export function textInput(value = "", attrs = {}) { return el("input", { type: "text", value: value ?? "", ...attrs }); }
export function numInput(value = "", attrs = {}) { return el("input", { type: "number", step: "any", value: value === null || value === undefined ? "" : value, ...attrs }); }
export function checkbox(label, checked = false, attrs = {}) {
  const input = el("input", { type: "checkbox", ...attrs });
  input.checked = !!checked;
  const wrap = el("label", { class: "check" }, input, el("span", { text: label }));
  wrap.input = input;
  return wrap;
}
export function select(options, value = "", attrs = {}) {
  const s = el("select", attrs);
  for (const o of options) {
    const opt = typeof o === "string" ? { value: o, label: o } : o;
    s.append(el("option", { value: opt.value, text: opt.label }));
  }
  if (value !== undefined && value !== null) s.value = value;
  return s;
}
/** Campo testo con suggerimenti (ComboBox editabile). */
let dlCounter = 0;
export function combo(options, value = "", attrs = {}) {
  const id = "dl" + (++dlCounter);
  const input = el("input", { type: "text", list: id, value: value ?? "", autocomplete: "off", ...attrs });
  const dl = el("datalist", { id });
  for (const o of options) dl.append(el("option", { value: o }));
  const wrap = el("div", { style: { display: "contents" } }, input, dl);
  wrap.input = input;
  return wrap;
}
/** Lista a selezione singola (ListBox). onChange(valore|null). */
export function listbox(items, selected = "", onChange = null, { height = "230px" } = {}) {
  const box = el("div", { class: "listbox", style: { maxHeight: height }, tabindex: "0" });
  let current = selected || "";
  const render = () => {
    box.innerHTML = "";
    for (const it of items) {
      const row = el("div", { class: "item" + (it === current ? " selected" : ""), text: it, onClick: () => { current = it === current ? "" : it; render(); if (onChange) onChange(current || null); } });
      box.append(row);
    }
  };
  render();
  box.getValue = () => current || null;
  box.setValue = (v) => { current = v || ""; render(); };
  box.clear = () => { current = ""; render(); };
  return box;
}

// ------------------------------------------------------------------ tabella
/**
 * Tabella ordinabile. columns: [{ key, label, cls, render(row), sortValue(row), num }]
 * state: { sortKey, sortDir } (mutato), opts: { rowKey, onRowClick, selectedKey, rowClass, limit }
 */
export function dataTable(columns, rows, state, opts = {}) {
  const sortKey = state.sortKey;
  const dir = state.sortDir || 1;
  let sorted = rows;
  if (sortKey) {
    const col = columns.find((c) => c.key === sortKey);
    const getter = col && col.sortValue ? col.sortValue : (r) => r[sortKey];
    sorted = sortByKey(rows, getter, dir);
  }
  const limit = opts.limit && sorted.length > opts.limit ? opts.limit : null;
  const shown = limit ? sorted.slice(0, limit) : sorted;
  const thead = el("thead", {}, el("tr", {}, columns.map((c) => el("th", {
    class: `${c.num ? "num" : ""} ${c.cls || ""} ${sortKey === c.key ? "sorted" + (dir < 0 ? " desc" : "") : ""}`,
    onClick: c.sortable === false ? null : () => { if (state.sortKey === c.key) state.sortDir = -(state.sortDir || 1); else { state.sortKey = c.key; state.sortDir = 1; } if (opts.onSort) opts.onSort(); },
    title: c.sortable === false ? "" : "Ordina",
  }, c.label))));
  const tbody = el("tbody");
  const frag = document.createDocumentFragment();
  for (const r of shown) {
    const key = opts.rowKey ? opts.rowKey(r) : undefined;
    const tr = el("tr", { class: `${opts.selectedKey !== undefined && key === opts.selectedKey ? "selected" : ""} ${opts.rowClass ? opts.rowClass(r) : ""}`, onClick: opts.onRowClick ? (e) => opts.onRowClick(r, e) : null, onDblclick: opts.onRowDblClick ? (e) => opts.onRowDblClick(r, e) : null });
    if (key !== undefined) tr.dataset.key = key;
    for (const c of columns) {
      const v = c.render ? c.render(r) : r[c.key];
      tr.append(el("td", { class: `${c.num ? "num" : ""} ${c.cls || ""}` }, v === null || v === undefined ? "" : v));
    }
    frag.append(tr);
  }
  tbody.append(frag);
  const table = el("table", { class: "data" }, thead, tbody);
  table.shownCount = shown.length;
  table.totalCount = sorted.length;
  table.truncated = !!limit;
  return table;
}
