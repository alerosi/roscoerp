// Tasse: parametri del foglio "Tasse" usati dal Conto Economico per la stima delle imposte.

import { store } from "../store.js";
import * as L from "../logic.js";
import { el, eur, pct, val } from "../util.js";
import { field, numInput, checkbox, toast } from "../ui.js";

export function renderTasse(root, rerender) {
  const T = store.db.settings.tasse;
  const save = () => { store.commit("settings"); };
  const { dataIn, dataEnd } = L.risolviPeriodo();
  const ce = L.contoEconomico(dataIn, dataEnd);

  const pctInput = (key, { min = 0, max = 100 } = {}) => numInput(Math.round((Number(T[key]) || 0) * 10000) / 100, { min, max, step: "0.01", onChange: (e) => { T[key] = val(e.target.value) / 100; save(); rerender(); } });
  const eurInput = (key) => numInput(T[key] ?? 0, { min: 0, step: "0.01", onChange: (e) => { T[key] = val(e.target.value); save(); rerender(); } });

  const ckForza = checkbox("Forza IVA", !!T.forzaIva);
  ckForza.input.addEventListener("change", () => { T.forzaIva = ckForza.input.checked; save(); rerender(); });
  const inIvaForz = pctInput("percIvaForzata");
  const inNonIva = numInput(Math.round((1 - (Number(T.percIvaForzata) || 0)) * 10000) / 100, { min: 0, max: 100, step: "0.01", onChange: (e) => { T.percIvaForzata = 1 - val(e.target.value) / 100; save(); rerender(); } });
  const inAum = pctInput("aumentoPrezziNonIva");
  for (const i of [inIvaForz, inNonIva, inAum]) i.disabled = !T.forzaIva;

  const regime = (v, label, hint) => { const r = el("input", { type: "radio", name: "regime" }); r.checked = Number(T.regime) === v; r.addEventListener("change", () => { T.regime = v; save(); rerender(); }); return el("label", { class: "check", style: { alignItems: "flex-start" } }, r, el("span", {}, el("b", { text: label }), el("div", { class: "hint", text: hint }))); };
  const ckCorr = checkbox("Le correzioni di giacenza modificano il debito verso il fornitore", T.correzioniNelDebito !== false);
  ckCorr.input.addEventListener("change", () => { T.correzioniNelDebito = ckCorr.input.checked; save(); rerender(); });
  const ckAdd = checkbox("Applica addizionale regionale", !!T.addizionaleRegionale);
  ckAdd.input.addEventListener("change", () => { T.addizionaleRegionale = ckAdd.input.checked; save(); rerender(); });

  const scaglioni = el("table", { class: "data" }, el("thead", {}, el("tr", {}, el("th", { text: "Fino a (€)" }), el("th", { text: "IRPEF" }), el("th", { text: "Add. regionale" }), el("th"))),
    el("tbody", {}, T.scaglioniIrpef.map((r, i) => el("tr", {},
      el("td", {}, numInput(r.limite ?? "", { placeholder: "oltre", min: 0, onChange: (e) => { r.limite = e.target.value === "" ? null : val(e.target.value); save(); } })),
      el("td", {}, numInput(Math.round(r.aliquota * 10000) / 100, { min: 0, max: 100, step: "0.01", onChange: (e) => { r.aliquota = val(e.target.value) / 100; save(); rerender(); } })),
      el("td", {}, numInput(Math.round((r.addRegionale || 0) * 10000) / 100, { min: 0, max: 100, step: "0.01", onChange: (e) => { r.addRegionale = val(e.target.value) / 100; save(); rerender(); } })),
      el("td", { class: "actions" }, el("button", { class: "btn xs danger", onClick: () => { T.scaglioniIrpef.splice(i, 1); save(); rerender(); } }, "✕"))))));

  root.append(
    el("div", { class: "page-head" }, el("div", {}, el("h2", { text: "Tasse" }), el("p", { text: "Parametri per la stima delle imposte nel Conto Economico. Le percentuali si inseriscono come numeri interi (22 = 22%)." }))),
    el("div", { class: "grid grid-2" },
      el("div", { class: "card" }, el("div", { class: "card-title" }, el("h3", { text: "IVA" })),
        el("div", { style: { display: "grid", gap: "12px" } }, ckForza,
          el("div", { class: "form-grid" }, field("% IVA forzata", inIvaForz), field("% non IVA forzata", inNonIva), field("Aumento prezzi senza IVA (%)", inAum)),
          el("p", { class: "hint", text: "Con \"Forza IVA\" i ricavi vengono ripartiti con la percentuale indicata invece che con il flag IVA delle singole vendite; l'aumento prezzi si applica alle vendite senza IVA." }),
          el("div", { class: "stat-row" }, el("span", { text: "% IVA vendite nel periodo" }), el("b", { text: ce.percIva === null ? "—" : pct(ce.percIva) })),
          el("div", { class: "stat-row" }, el("span", { text: "Credito IVA nel periodo" }), el("b", { text: eur(ce.creditoIva) })))),
      el("div", { class: "card" }, el("div", { class: "card-title" }, el("h3", { text: "Regime fiscale" })),
        el("div", { style: { display: "grid", gap: "12px" } },
          regime(1, "Regime ordinario semplificato", "IRPEF a scaglioni + INPS con minimale; spese deducibili e detraibili"),
          regime(2, "Regime forfettario (lim. fatturato ≤ 85 K€)", "Imponibile = ricavi IVA × coefficiente di redditività; imposta sostitutiva + INPS ridotta"),
          el("div", {}, ckCorr, el("div", { class: "hint", style: { marginLeft: "24px" }, text: "Come in Excel: una correzione di −3 pezzi a 24 € riduce il debito verso il fornitore di 72 €. Disattivare se le correzioni sono rotture o errori di conteggio e non acquisti sbagliati." })),
          el("div", { class: "stat-row" }, el("span", { text: "Imponibile stimato nel periodo" }), el("b", { text: eur(ce.imponibile) })),
          el("div", { class: "stat-row" }, el("span", { text: "Stima tasse nel periodo" }), el("b", { text: eur(-ce.tasse) }))))),
    el("div", { class: "grid grid-2", style: { marginTop: "18px" } },
      el("div", { class: "card" }, el("div", { class: "card-title" }, el("h3", { text: "Scaglioni IRPEF" }), el("button", { class: "btn sm", onClick: () => { T.scaglioniIrpef.push({ limite: null, aliquota: 0, addRegionale: 0 }); save(); rerender(); } }, "＋ scaglione")),
        ckAdd, el("div", { class: "table-wrap", style: { marginTop: "10px", maxHeight: "none" } }, scaglioni),
        el("p", { class: "hint", text: "L'ultimo scaglione con limite vuoto si applica oltre il precedente. L'imponibile del periodo si somma a quello già maturato dall'inizio dell'anno." })),
      el("div", { class: "card" }, el("div", { class: "card-title" }, el("h3", { text: "INPS e parametri" })),
        el("div", { class: "form-grid" },
          field("Contributo minimo INPS (€/anno)", eurInput("minInps")), field("Aliquota INPS (%)", pctInput("aliqInps")),
          field("Coeff. redditività (%)", pctInput("coeffRedditivita"), { hint: "codice ATECO 47.78.36" }), field("Aliquota regime forfettario (%)", pctInput("aliqForfettario"), { hint: "5% per i primi 5 anni di attività, poi 15%" }),
          field("Riduzione INPS regime forf. (%)", pctInput("riduzioneInpsForf")),
          field("Spese da dedurre (€/anno)", eurInput("speseDaDedurre"), { hint: "solo regime ordinario" }), field("Spese da detrarre (€/anno)", eurInput("speseDaDetrarre"), { hint: "solo regime ordinario" })))),
  );
}
