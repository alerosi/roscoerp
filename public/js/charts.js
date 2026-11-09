// Grafici (Chart.js 4, caricato da vendor/chart.umd.js). Palette "maiolica" validata
// (ordine fisso delle tinte: identità stabile delle serie, colori non riassegnati al filtro).

import { eur, num, pct, GIORNI_BREVI } from "./util.js";

export const PALETTE = ["#2457a8", "#d2612f", "#1f8a62", "#d9a21b", "#8a56b0", "#d06a90", "#2aa3b7", "#b0522a"];
export const SEQ = ["#e4ecf8", "#c3d4ef", "#9fb9e4", "#7a9dd8", "#5680cb", "#3b68b9", "#2457a8", "#183f7e"];
const TEXT = "#5a4e46";
const GRID = "#eee6d6";

if (window.Chart) {
  Chart.defaults.font.family = '"Source Sans 3", "Segoe UI", system-ui, sans-serif';
  Chart.defaults.font.size = 12;
  Chart.defaults.color = TEXT;
  Chart.defaults.plugins.legend.labels.boxWidth = 10;
  Chart.defaults.plugins.legend.labels.boxHeight = 10;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.tooltip.backgroundColor = "#2b2420";
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
  Chart.defaults.elements.line.borderWidth = 2;
  Chart.defaults.elements.point.radius = 3;
  Chart.defaults.elements.point.hoverRadius = 6;
  Chart.defaults.elements.bar.borderRadius = 4;
  Chart.defaults.elements.bar.borderSkipped = "bottom";
  Chart.defaults.maintainAspectRatio = false;
}

const registry = new Map();
/** Crea (o sostituisce) un grafico nel canvas indicato. */
export function makeChart(canvas, config) {
  if (!window.Chart) return null;
  const old = registry.get(canvas);
  if (old) old.destroy();
  const c = new Chart(canvas, config);
  registry.set(canvas, c);
  return c;
}
export function destroyAll(root) {
  for (const [canvas, chart] of registry) {
    if (!root || root.contains(canvas) || !document.body.contains(canvas)) { chart.destroy(); registry.delete(canvas); }
  }
}

const axis = (fmt, extra = {}) => ({
  grid: { color: GRID, borderDash: [3, 3] },
  border: { display: false },
  ticks: { callback: (v) => fmt(v), maxTicksLimit: 8 },
  ...extra,
});
const xAxis = (extra = {}) => ({ grid: { display: false }, border: { color: GRID }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 14 }, ...extra });

export function colorFor(i) { return PALETTE[i % PALETTE.length]; }
export function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Grafico a linee multi-serie (serie temporali). */
export function lineChart(canvas, labels, series, { fmt = num, mediaSerie = null, fill = false, dashed = false } = {}) {
  const datasets = series.map((s, i) => {
    const c = s.colore || colorFor(i);
    return {
      label: s.nome, data: s.valori, borderColor: c, backgroundColor: fill ? hexA(c, 0.12) : c,
      tension: 0.3, fill, borderDash: dashed || s.tratteggio ? [4, 4] : undefined, borderWidth: dashed ? 1.2 : (s.spessore || 2), pointRadius: dashed ? 0 : 3,
    };
  });
  if (mediaSerie) datasets.push({ label: "Media", data: mediaSerie, borderColor: "#2b2420", backgroundColor: "#2b2420", tension: 0.3, borderWidth: 2.5, pointRadius: 3 });
  return makeChart(canvas, {
    type: "line",
    data: { labels, datasets },
    options: {
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: datasets.length > 1, position: "bottom" }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmt(c.parsed.y)}` } } },
      scales: { x: xAxis(), y: axis(fmt, { beginAtZero: true }) },
    },
  });
}

/** Barre verticali (una o più serie). */
export function barChart(canvas, labels, series, { fmt = num, stacked = false, horizontal = false, colors = null, dataLabels = false } = {}) {
  const datasets = series.map((s, i) => ({
    label: s.nome, data: s.valori,
    backgroundColor: s.colore || (colors ? colors : (series.length === 1 ? colorFor(0) : colorFor(i))),
    borderColor: "#fffdf8", borderWidth: stacked ? 2 : 0, maxBarThickness: 48,
  }));
  return makeChart(canvas, {
    type: "bar",
    data: { labels, datasets },
    options: {
      indexAxis: horizontal ? "y" : "x",
      plugins: {
        legend: { display: datasets.length > 1, position: "bottom" },
        tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmt(horizontal ? c.parsed.x : c.parsed.y)}` } },
      },
      scales: horizontal
        ? { x: axis(fmt, { beginAtZero: true, stacked }), y: { ...xAxis(), stacked, ticks: { autoSkip: false } } }
        : { x: { ...xAxis(), stacked }, y: axis(fmt, { beginAtZero: true, stacked }) },
    },
    plugins: dataLabels ? [valueLabels(fmt)] : [],
  });
}

/** Barre per il periodo scelto + linea tratteggiata per il periodo di confronto (se c'è). */
export function confrontoChart(canvas, labels, valori, valoriPrec, { fmt = num, nome = "Periodo scelto", nomePrec = "Confronto" } = {}) {
  const datasets = [{ type: "bar", label: nome, data: valori, backgroundColor: colorFor(0), maxBarThickness: 40, order: 2 }];
  if (valoriPrec) datasets.push({ type: "line", label: nomePrec, data: valoriPrec, borderColor: "#a3968a", backgroundColor: "#a3968a", borderDash: [5, 4], borderWidth: 2, pointRadius: 2, tension: 0.3, order: 1 });
  return makeChart(canvas, {
    type: "bar",
    data: { labels, datasets },
    options: {
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: !!valoriPrec, position: "bottom" }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmt(c.parsed.y)}` } } },
      scales: { x: xAxis(), y: axis(fmt, { beginAtZero: true }) },
    },
  });
}

/** Plugin minimale per etichette valore sopra le barre (solo quando richiesto). */
function valueLabels(fmt) {
  return {
    id: "valueLabels",
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      ctx.save();
      ctx.font = "600 11px 'Source Sans 3', sans-serif";
      ctx.fillStyle = TEXT;
      ctx.textAlign = "center";
      chart.data.datasets.forEach((ds, di) => {
        const meta = chart.getDatasetMeta(di);
        if (meta.hidden) return;
        meta.data.forEach((bar, i) => {
          const v = ds.data[i];
          if (v === null || v === undefined || v === 0) return;
          ctx.fillText(fmt(v), bar.x, bar.y - 4);
        });
      });
      ctx.restore();
    },
  };
}

/** Ciambella per ripartizioni (max 6 fette + "Altro"). */
export function doughnutChart(canvas, items, { fmt = eur, max = 6 } = {}) {
  const sorted = items.slice().sort((a, b) => b.valore - a.valore);
  const head = sorted.slice(0, max);
  const tail = sorted.slice(max);
  if (tail.length) head.push({ nome: "Altro", valore: tail.reduce((a, b) => a + b.valore, 0) });
  const total = head.reduce((a, b) => a + b.valore, 0) || 1;
  return makeChart(canvas, {
    type: "doughnut",
    data: { labels: head.map((h) => h.nome), datasets: [{ data: head.map((h) => h.valore), backgroundColor: head.map((_, i) => i === max ? "#b8aca0" : colorFor(i)), borderColor: "#fffdf8", borderWidth: 2 }] },
    options: {
      cutout: "62%",
      plugins: {
        legend: { position: "right", labels: { generateLabels: (c) => c.data.labels.map((l, i) => ({ text: `${l}  ${pct(c.data.datasets[0].data[i] / total)}`, fillStyle: c.data.datasets[0].backgroundColor[i], strokeStyle: "transparent", pointStyle: "circle", index: i })) } },
        tooltip: { callbacks: { label: (c) => ` ${c.label}: ${fmt(c.parsed)} (${pct(c.parsed / total)})` } },
      },
    },
  });
}

/** Mappa di calore giorno × ora in HTML (griglia), valori in €. */
export function heatmapHtml(heat) {
  const hours = Array.from({ length: 15 }, (_, i) => i + 7); // 7..21
  let max = 0;
  for (const row of heat) for (const h of hours) max = Math.max(max, row[h] || 0);
  const parts = ['<div class="heat">', '<div></div>'];
  for (const h of hours) parts.push(`<div class="h">${h}</div>`);
  heat.forEach((row, d) => {
    parts.push(`<div class="r">${GIORNI_BREVI[d]}</div>`);
    for (const h of hours) {
      const v = row[h] || 0;
      const k = max ? Math.min(7, Math.floor((v / max) * 7.999)) : 0;
      parts.push(`<div class="c" style="background:${v ? SEQ[k] : "#f6f1e8"}" data-tip="${GIORNI_BREVI[d]} ${h}:00 · ${eur(v)}"></div>`);
    }
  });
  parts.push("</div>");
  return parts.join("");
}
