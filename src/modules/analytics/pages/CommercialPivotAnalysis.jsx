import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, FileDown, RefreshCw, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { supabase } from "../../../lib/supabaseClient";

const configs = {
  invoices: { title: "Analisi Fatture", subtitle: "Pivot avanzata sui documenti FTE, FTS e COX importati da Mexal.", table: "mexal_fatture_vendita", lines: "mexal_fatture_vendita_righe", date: "data_documento" },
  "orders-ph": { title: "Analisi Ordini PH", subtitle: "Pivot avanzata sugli ordini PH e sulle relative righe prodotto.", table: "ordini_testate", lines: "ordini_righe", date: "data_ordine" },
};
const dimensions = [
  ["year", "Anno"], ["month", "Mese"], ["year_month", "Anno / mese"], ["document_type", "Tipo documento"], ["document_number", "Numero documento"], ["date", "Data"],
  ["customer", "Cliente"], ["agent", "Agente"],
  ["status", "Stato"], ["product", "Prodotto"], ["product_code", "Codice prodotto"], ["category", "Categoria prodotto"],
  ["subcategory", "Sottocategoria prodotto"], ["warehouse_reason", "Causale magazzino"], ["warehouse", "Magazzino"],
  ["payment", "Pagamento"],
].map(([key, label]) => ({ key, label }));
const metrics = [["documents", "Numero documenti"], ["lines", "Numero righe"], ["quantity", "Quantità"], ["taxable", "Imponibile"], ["vat", "IVA"], ["total", "Totale"]].map(([key, label]) => ({ key, label }));
const dimensionLabel = (key) => dimensions.find((item) => item.key === key)?.label || key;
const metricLabel = (key) => metrics.find((item) => item.key === key)?.label || key;
const money = (value) => Number(value || 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
const text = (...values) => values.find((value) => value !== null && value !== undefined && String(value).trim()) ?? "";
const jsonValue = (json, ...keys) => keys.map((key) => json?.[key]).find((value) => value !== null && value !== undefined && String(value).trim()) ?? "";
const monthName = (value) => value ? new Date(2000, Number(value) - 1, 1).toLocaleString("it-IT", { month: "long" }) : "";
const warehouseReasonName = (header, headerJson, lineJson) => {
  const description = text(header.causale_trasporto, jsonValue(headerJson, "descr_causale", "descrizione_causale", "causale_descrizione"), jsonValue(lineJson, "descr_causale", "descrizione_causale", "causale_descrizione"));
  if (description) return description;
  const rawCode = text(jsonValue(headerJson, "id_causale", "causale"), jsonValue(lineJson, "id_causale", "causale"));
  const code = Array.isArray(rawCode) ? rawCode.flat(Infinity).at(-1) : rawCode;
  return String(code || "") === "1" ? "Vendita" : "";
};

function discountMultiplier(value) {
  return String(value || "").split("+").map((part) => Number(String(part).replace(",", ".").trim())).filter(Number.isFinite).reduce((multiplier, percentage) => multiplier * (1 - percentage / 100), 1);
}
async function loadPaged(table, configure) {
  const rows = [];
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await configure(supabase.from(table).select("*").range(from, from + 999));
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < 1000) break;
  }
  return rows;
}
async function loadByIds(table, field, ids) {
  const rows = [];
  for (let index = 0; index < ids.length; index += 500) {
    const { data, error } = await supabase.from(table).select("*").in(field, ids.slice(index, index + 500));
    if (error) throw error;
    rows.push(...(data || []));
  }
  return rows;
}
async function loadProductMap(lines) {
  const codes = [...new Set(lines.map((line) => line.codice_articolo).filter(Boolean))];
  const products = await loadByIds("prodotti", "codice", codes);
  return new Map(products.map((product) => [String(product.codice), product]));
}
function createRecords(source, headers, lines, productMap) {
  const grouped = new Map();
  lines.forEach((line) => {
    const key = source === "invoices" ? line.fattura_id : line.ordine_id;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(line);
  });
  return headers.flatMap((header) => {
    const date = header.data_documento || header.data_ordine || "";
    const children = grouped.get(header.id) || [];
    return (children.length ? children : [null]).map((line, index) => {
      const product = productMap.get(String(line?.codice_articolo || "")) || {};
      const productJson = product.json_mexal || product.dati_mexal || {};
      const headerJson = header.dati_mexal || header.trasporto_mexal || {};
      const lineJson = line?.dati_mexal || line?.dettaglio_calcolo || {};
      let taxable; let vat; let total;
      if (!line) {
        taxable = Number(header.totale_imponibile ?? header.totale ?? 0); vat = Number(header.totale_iva ?? 0); total = Number(header.totale_documento ?? header.totale ?? 0);
      } else if (source === "orders-ph") {
        taxable = Number(line.imponibile_riga ?? line.totale_riga ?? 0); vat = Number(line.iva_riga ?? 0); total = Number(line.totale_riga ?? (taxable + vat));
      } else {
        taxable = Number(line.quantita || 0) * Number(line.prezzo_unitario || 0) * discountMultiplier(line.sconto);
        vat = taxable * Number(line.aliquota_iva || 0) / 100; total = taxable + vat;
      }
      return {
        document_key: `${source}:${header.id}`, line_key: `${source}:${header.id}:${line?.id ?? index}`,
        year: String(date).slice(0, 4), month_number: String(date).slice(5, 7), month: monthName(String(date).slice(5, 7)), year_month: `${monthName(String(date).slice(5, 7))} ${String(date).slice(0, 4)}`.trim(), date,
        document_type: source === "invoices" ? `${header.sigla || ""}${header.cod_modulo || ""}` : "ORDINE PH",
        document_number: source === "invoices" ? `${header.serie || "-"}/${header.numero || "-"}` : text(header.numero_ordine_visualizzato, header.numero_ordine, "Bozza"),
        customer_code: header.codice_cliente || "", customer: text(header.ragione_sociale_cliente, header.codice_cliente),
        agent_code: header.codice_agente_mexal || "", agent: text(header.agente_nome, header.nome_agente, header.codice_agente_mexal),
        status: text(header.stato, header.stato_sincronizzazione), product_code: line?.codice_articolo || "", product: line?.descrizione || product.nome || "",
        category: text(product.categoria_mexal, product.categoria, jsonValue(productJson, "categoria", "descr_categoria", "categoria_articolo")),
        subcategory: text(product.sottocategoria_mexal, product.sottocategoria, jsonValue(productJson, "sottocategoria", "descr_sottocategoria")),
        warehouse_reason: warehouseReasonName(header, headerJson, lineJson),
        warehouse: text(jsonValue(headerJson, "id_magazzino", "magazzino", "cod_magazzino"), jsonValue(lineJson, "id_magazzino", "magazzino")),
        payment: text(header.descrizione_pagamento_mexal, header.codice_pagamento_mexal, header.id_pagamento, jsonValue(headerJson, "pagamento")),
        vat_rate: line?.aliquota_iva ?? "", quantity: Number(line?.quantita || 0), taxable, vat, total,
      };
    });
  });
}
function CheckGroup({ title, options, selected, onChange }) {
  return <div className="analytics-check-group"><h4>{title}</h4>{options.map((option) => <label key={option.key}><span>{option.label}</span><input type="checkbox" checked={selected.includes(option.key)} onChange={() => onChange(option.key)} /></label>)}</div>;
}
function ComparisonGroup({ title, options, selected, onChange, format = (value) => value }) {
  return <div className="analytics-comparison-group"><strong>{title}</strong><div>{options.map((option) => <label key={option}><input type="checkbox" checked={selected.includes(option)} onChange={() => onChange(option)} />{format(option)}</label>)}</div></div>;
}
function AnalysisChart({ pivot, metric, type }) {
  const rows = pivot.rows.map((row) => ({ label: row.name, value: pivot.columns.reduce((sum, column) => sum + Number(row.cells[column]?.[metric] || 0), 0) })).slice(0, 30);
  const max = Math.max(...rows.map((row) => row.value), 1);
  if (!rows.length) return <div className="analytics-chart-empty">Nessun dato da rappresentare.</div>;
  if (type === "line") {
    const width = 1000; const height = 330; const left = 60; const bottom = 55;
    const points = rows.map((row, index) => ({ ...row, x: left + (index * (width - left - 25)) / Math.max(rows.length - 1, 1), y: 20 + (1 - row.value / max) * (height - bottom - 20) }));
    return <div className="analytics-chart-scroll"><svg className="analytics-line-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Grafico ${metricLabel(metric)}`}><line x1={left} y1={20} x2={left} y2={height - bottom} /><line x1={left} y1={height - bottom} x2={width - 20} y2={height - bottom} /><polyline points={points.map((point) => `${point.x},${point.y}`).join(" ")} />{points.map((point) => <g key={point.label}><circle cx={point.x} cy={point.y} r="4"><title>{point.label}: {point.value}</title></circle><text x={point.x} y={height - 35} transform={`rotate(-30 ${point.x} ${height - 35})`}>{point.label.slice(0, 18)}</text></g>)}</svg></div>;
  }
  return <div className="analytics-bar-chart">{rows.map((row) => <div className="analytics-bar-row" key={row.label}><span title={row.label}>{row.label}</span><div><i style={{ width: `${Math.max((row.value / max) * 100, row.value ? 1 : 0)}%` }}></i></div><strong>{["taxable", "vat", "total"].includes(metric) ? money(row.value) : row.value.toLocaleString("it-IT")}</strong></div>)}</div>;
}

export default function CommercialPivotAnalysis({ source }) {
  const config = configs[source]; const navigate = useNavigate(); const today = new Date();
  const [from, setFrom] = useState(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`);
  const [to, setTo] = useState(new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10));
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({ customer: "", agent: "", category: "", subcategory: "", warehouse_reason: "", status: "" });
  const [rowFields, setRowFields] = useState(["customer"]); const [columnFields, setColumnFields] = useState(["year_month"]); const [valueFields, setValueFields] = useState(["total"]);
  const [comparisonYears, setComparisonYears] = useState([]);
  const [comparisonMonths, setComparisonMonths] = useState([]);
  const [sortMode, setSortMode] = useState("name");
  const [sortDirection, setSortDirection] = useState("asc");
  const [view, setView] = useState("table");
  const [chartType, setChartType] = useState("bar");
  const [chartMetric, setChartMetric] = useState("total");
  const [records, setRecords] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  async function load() {
    setLoading(true); setError("");
    try {
      const headers = await loadPaged(config.table, (query) => {
        let next = query.gte(config.date, from).lte(config.date, to).order(config.date);
        if (source === "orders-ph") next = next.eq("modulo_ordini", "ph");
        return next;
      });
      const lines = await loadByIds(config.lines, source === "invoices" ? "fattura_id" : "ordine_id", headers.map((item) => item.id));
      setRecords(createRecords(source, headers, lines, await loadProductMap(lines)));
    } catch (loadError) { setError(loadError.message || "Caricamento non riuscito."); } finally { setLoading(false); }
  }
  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
    // The source change intentionally resets the selected analysis.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);
  const filterOptions = useMemo(() => Object.fromEntries(Object.keys(filters).map((field) => [field, [...new Set(records.map((row) => String(row[field] || "")).filter(Boolean))].sort()])), [records, filters]);
  const availableYears = useMemo(() => [...new Set(records.map((row) => row.year).filter(Boolean))].sort(), [records]);
  const availableMonths = useMemo(() => [...new Set(records.map((row) => row.month_number).filter(Boolean))].sort(), [records]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return records.filter((row) =>
      !Object.entries(filters).some(([field, value]) => value && String(row[field]) !== value)
      && (!comparisonYears.length || comparisonYears.includes(row.year))
      && (!comparisonMonths.length || comparisonMonths.includes(row.month_number))
      && (!needle || Object.values(row).some((value) => String(value).toLowerCase().includes(needle)))
    );
  }, [records, search, filters, comparisonYears, comparisonMonths]);
  const valueFor = (bucket, metric) => {
    if (metric === "documents") return new Set(bucket.map((row) => row.document_key)).size;
    if (metric === "lines") return new Set(bucket.map((row) => row.line_key)).size;
    return bucket.reduce((sum, row) => sum + Number(row[metric] || 0), 0);
  };
  const groupKey = (row, fields) => fields.length ? fields.map((field) => String(row[field] || "Non indicato")).join(" / ") : "Totale";
  const pivot = useMemo(() => {
    const columns = [...new Set(filtered.map((row) => groupKey(row, columnFields)))]; const buckets = new Map();
    const calculatedMetrics = [...new Set([...valueFields, chartMetric])];
    filtered.forEach((record) => { const row = groupKey(record, rowFields); const column = groupKey(record, columnFields); const key = `${row}\u0000${column}`; if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(record); });
    const rows = [...new Set(filtered.map((row) => groupKey(row, rowFields)))].map((name) => ({ name, cells: Object.fromEntries(columns.map((column) => [column, Object.fromEntries(calculatedMetrics.map((metric) => [metric, valueFor(buckets.get(`${name}\u0000${column}`) || [], metric)]))])) }));
    const selectedMetric = valueFields[0] || "total";
    rows.sort((a, b) => {
      const left = sortMode === "name" ? a.name : columns.reduce((sum, column) => sum + Number(a.cells[column]?.[selectedMetric] || 0), 0);
      const right = sortMode === "name" ? b.name : columns.reduce((sum, column) => sum + Number(b.cells[column]?.[selectedMetric] || 0), 0);
      const result = typeof left === "string" ? left.localeCompare(right, "it", { numeric: true }) : left - right;
      return sortDirection === "asc" ? result : -result;
    });
    return { columns, rows };
  }, [filtered, rowFields, columnFields, valueFields, chartMetric, sortMode, sortDirection]);
  const toggle = (setter) => (key) => setter((list) => list.includes(key) ? list.filter((item) => item !== key) : [...list, key]);
  const formatMetric = (value, metric) => ["taxable", "vat", "total"].includes(metric) ? money(value) : Number(value || 0).toLocaleString("it-IT");
  const rowMetricTotal = (row, metric) => valueFor(filtered.filter((record) => groupKey(record, rowFields) === row.name), metric);
  const grandMetricTotal = (metric) => valueFor(filtered, metric);
  const rawRows = filtered.map((row) => Object.fromEntries([...dimensions.map(({ key, label }) => [label, row[key]]), ...metrics.slice(2).map(({ key, label }) => [label, row[key]])]));
  const pivotMatrix = [
    ["Righe", ...pivot.columns.flatMap((column) => valueFields.map((metric) => `${column} - ${metricLabel(metric)}`)), ...valueFields.map((metric) => `Totale - ${metricLabel(metric)}`)],
    ...pivot.rows.map((row) => [row.name, ...pivot.columns.flatMap((column) => valueFields.map((metric) => row.cells[column][metric])), ...valueFields.map((metric) => rowMetricTotal(row, metric))]),
    ["TOTALE GENERALE", ...pivot.columns.flatMap((column) => valueFields.map((metric) => valueFor(filtered.filter((record) => groupKey(record, columnFields) === column), metric))), ...valueFields.map(grandMetricTotal)],
  ];
  function downloadExcel() {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rawRows), "Dati grezzi"); XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(pivotMatrix), "Pivot");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Filtro", "Valore"], ["Dal", from], ["Al", to], ["Ricerca", search], ["Anni confrontati", comparisonYears.join(", ") || "Tutti"], ["Mesi confrontati", comparisonMonths.join(", ") || "Tutti"], ["Ordinamento", `${sortMode === "name" ? "Nome riga" : "Valore totale"} - ${sortDirection === "asc" ? "crescente" : "decrescente"}`], ...Object.entries(filters).map(([key, value]) => [dimensionLabel(key), value || "Tutti"]), ["Righe pivot", rowFields.map(dimensionLabel).join(", ") || "Totale"], ["Colonne pivot", columnFields.map(dimensionLabel).join(", ") || "Totale"], ["Valori pivot", valueFields.map(metricLabel).join(", ")]]), "Filtri applicati");
    XLSX.writeFile(workbook, `${source}-analisi-completa.xlsx`);
  }
  async function downloadPdf() {
    const doc = new jsPDF({ orientation: "landscape" });
    let logo = null;
    try {
      const response = await fetch("/logo.png");
      if (response.ok) {
        const blob = await response.blob();
        logo = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
      }
    } catch {
      logo = null;
    }
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    if (logo) doc.addImage(logo, "PNG", 14, 10, 30, 30);
    doc.setTextColor(45, 43, 40);
    doc.setFontSize(20);
    doc.text("Report Analisi Dati", pageWidth - 14, 23, { align: "right" });
    doc.setFontSize(11);
    doc.setTextColor(107, 100, 92);
    doc.text(`${config.title} · Periodo: ${from || "-"} - ${to || "-"}`, pageWidth - 14, 31, { align: "right" });
    doc.text(`Record analizzati: ${filtered.length.toLocaleString("it-IT")}`, pageWidth - 14, 37, { align: "right" });
    doc.setDrawColor(150, 150, 150);
    doc.setLineWidth(0.5);
    doc.line(14, 45, pageWidth - 14, 45);
    const body = [
      ...pivot.rows.map((row) => [row.name, ...pivot.columns.flatMap((column) => valueFields.map((metric) => formatMetric(row.cells[column][metric], metric))), ...valueFields.map((metric) => formatMetric(rowMetricTotal(row, metric), metric))]),
      ["TOTALE GENERALE", ...pivot.columns.flatMap((column) => valueFields.map((metric) => formatMetric(valueFor(filtered.filter((record) => groupKey(record, columnFields) === column), metric), metric))), ...valueFields.map((metric) => formatMetric(grandMetricTotal(metric), metric))],
    ];
    autoTable(doc, {
      startY: 52,
      head: [pivotMatrix[0]],
      body,
      theme: "grid",
      styles: { fontSize: 8, textColor: [45, 43, 40], lineColor: [216, 209, 203], lineWidth: 0.2, cellPadding: 2.5, overflow: "linebreak" },
      headStyles: { fillColor: [45, 43, 40], textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [247, 245, 242] },
      margin: { left: 14, right: 14, bottom: 15 },
      didDrawPage: () => {
        const currentPage = doc.internal.getCurrentPageInfo().pageNumber;
        doc.setFontSize(8);
        doc.setTextColor(107, 100, 92);
        doc.text(`Pagina ${currentPage}`, pageWidth - 14, pageHeight - 7, { align: "right" });
      },
    });
    doc.save(`report-analisi-dati-${source}.pdf`);
  }
  return <div className="commercial-analysis">
    <button className="analytics-back" type="button" onClick={() => navigate("/analisi-dati")}><ArrowLeft size={18} /> Analisi dati</button>
    <div className="page-title-row"><div><h1>{config.title}</h1><p>{config.subtitle}</p></div></div>
    <div className="panel analytics-filter-section"><h3>Filtri</h3><div className="analytics-filters">
      <label>Dal<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>Al<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      {Object.keys(filters).map((field) => <label key={field}>{dimensionLabel(field)}<select value={filters[field]} onChange={(event) => setFilters((current) => ({ ...current, [field]: event.target.value }))}><option value="">Tutti</option>{filterOptions[field]?.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>)}
      <div className="analytics-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ricerca libera totale..." /></div><button type="button" className="secondary-action" onClick={load}><RefreshCw size={17} /> Applica periodo</button>
    </div><div className="analytics-comparison-grid">
      <ComparisonGroup title="Confronta anni" options={availableYears} selected={comparisonYears} onChange={toggle(setComparisonYears)} />
      <ComparisonGroup title="Confronta mesi" options={availableMonths} selected={comparisonMonths} onChange={toggle(setComparisonMonths)} format={monthName} />
    </div><small className="analytics-comparison-help">Se non selezioni alcuna voce vengono inclusi tutti gli anni e i mesi del periodo. Puoi selezionarne più di uno per confrontarli.</small></div>
    {error && <div className="panel analytics-error">{error}</div>}
    <div className="panel analytics-config-section"><h3>Configura pivot</h3><div className="analytics-config-grid"><CheckGroup title="Righe" options={dimensions} selected={rowFields} onChange={toggle(setRowFields)} /><CheckGroup title="Colonne" options={dimensions} selected={columnFields} onChange={toggle(setColumnFields)} /><CheckGroup title="Valori" options={metrics} selected={valueFields} onChange={toggle(setValueFields)} /></div></div>
    <div className="panel analytics-result-section"><div className="analytics-export-actions"><button className="primary-action" type="button" onClick={downloadPdf} disabled={!filtered.length || !valueFields.length}><FileDown size={18} /> Esporta PDF</button><button className="secondary-action" type="button" onClick={downloadExcel} disabled={!filtered.length}><Download size={18} /> Esporta Excel completo</button></div>
      <div className="analytics-result-heading"><div><h3>Risultato analisi</h3><p>Record analizzati: {filtered.length.toLocaleString("it-IT")}</p></div><div className="analytics-result-controls">
        <label>Ordina per<select value={sortMode} onChange={(event) => setSortMode(event.target.value)}><option value="name">Nome riga</option><option value="value">Valore totale</option></select></label>
        <label>Ordine<select value={sortDirection} onChange={(event) => setSortDirection(event.target.value)}><option value="asc">Crescente</option><option value="desc">Decrescente</option></select></label>
        <div className="analytics-view-switch"><button type="button" className={view === "table" ? "active" : ""} onClick={() => setView("table")}>Tabella</button><button type="button" className={view === "chart" ? "active" : ""} onClick={() => setView("chart")}>Grafico</button></div>
      </div></div>
      {view === "chart" && <div className="analytics-chart-controls"><label>Tipo grafico<select value={chartType} onChange={(event) => setChartType(event.target.value)}><option value="bar">Barre</option><option value="line">Linee</option></select></label><label>Valore<select value={chartMetric} onChange={(event) => setChartMetric(event.target.value)}>{metrics.map((metric) => <option value={metric.key} key={metric.key}>{metric.label}</option>)}</select></label></div>}
      {view === "chart" ? <AnalysisChart pivot={pivot} metric={chartMetric} type={chartType} /> : <div className="analytics-table-wrap">{loading ? <p className="analytics-loading">Caricamento analisi...</p> : <table className="analytics-table"><thead><tr><th>Righe</th>{pivot.columns.flatMap((column) => valueFields.map((metric) => <th key={`${column}:${metric}`}>{column}<br />{metricLabel(metric)}</th>))}{valueFields.map((metric) => <th key={`total:${metric}`}>Totale<br />{metricLabel(metric)}</th>)}</tr></thead><tbody>{!pivot.rows.length && <tr><td>Nessun dato disponibile</td></tr>}{pivot.rows.map((row) => <tr key={row.name}><th>{row.name}</th>{pivot.columns.flatMap((column) => valueFields.map((metric) => <td key={`${column}:${metric}`}>{formatMetric(row.cells[column][metric], metric)}</td>))}{valueFields.map((metric) => <td key={`total:${metric}`}><strong>{formatMetric(rowMetricTotal(row, metric), metric)}</strong></td>)}</tr>)}</tbody>{!!pivot.rows.length && <tfoot><tr><th>TOTALE GENERALE</th>{pivot.columns.flatMap((column) => valueFields.map((metric) => <td key={`${column}:${metric}`}>{formatMetric(valueFor(filtered.filter((record) => groupKey(record, columnFields) === column), metric), metric)}</td>))}{valueFields.map((metric) => <td key={`grand:${metric}`}><strong>{formatMetric(grandMetricTotal(metric), metric)}</strong></td>)}</tr></tfoot>}</table>}</div>}
    </div>
  </div>;
}
