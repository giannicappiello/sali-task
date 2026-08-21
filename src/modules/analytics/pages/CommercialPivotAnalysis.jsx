import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Download, FileDown, GripVertical, RefreshCw, Search, X } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { supabase } from "../../../lib/supabaseClient";
import useBackNavigation from "../../../hooks/useBackNavigation";
import useOrdersAccess from "../../orders/pages/useOrdersAccess";
import {
  normalizeWarehouseReasonCode,
  warehouseReasonDescription,
} from "../../../../shared/mexalWarehouseReasons";

const configs = {
  invoices: {
    title: "Analisi Fatture",
    subtitle: "Pivot avanzata su tutte le varianti FT e sui documenti OCX/COX importati da Mexal.",
    table: "mexal_fatture_vendita",
    lines: "mexal_fatture_vendita_righe",
    date: "data_documento",
    columns: "id,sigla,cod_modulo,serie,numero,data_documento,codice_cliente,ragione_sociale_cliente,codice_agente_mexal,agente_nome,id_pagamento,totale_imponibile,totale_iva,totale_documento,causale_magazzino_codice,causale_magazzino_descrizione",
  },
  "orders-ph": { title: "Analisi Ordini PH", subtitle: "Pivot avanzata sugli ordini PH e sulle relative righe prodotto.", table: "ordini_testate", lines: "ordini_righe", date: "data_ordine" },
};
const dimensions = [
  ["year", "Anno"], ["month_number", "Numero mese"], ["month", "Mese"], ["year_month", "Anno / mese"], ["document_type", "Tipo documento"], ["document_number", "Numero documento"], ["date", "Data"],
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
  const description = text(header.causale_magazzino_descrizione, header.causale_trasporto, jsonValue(headerJson, "descr_causale", "descrizione_causale", "causale_descrizione"), jsonValue(lineJson, "descr_causale", "descrizione_causale", "causale_descrizione"));
  const rawCode = header.causale_magazzino_codice
    || jsonValue(headerJson, "id_causale", "causale")
    || jsonValue(lineJson, "id_causale", "causale");
  const code = normalizeWarehouseReasonCode(rawCode);
  return warehouseReasonDescription(code, description);
};

function discountMultiplier(value) {
  return String(value || "").split("+").map((part) => Number(String(part).replace(",", ".").trim())).filter(Number.isFinite).reduce((multiplier, percentage) => multiplier * (1 - percentage / 100), 1);
}
async function loadPaged(table, configure, columns = "*") {
  const rows = [];
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await configure(supabase.from(table).select(columns).range(from, from + 999));
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
function PivotField({ field, type, onDragStart, onRemove }) {
  const label = type === "metric" ? metricLabel(field) : dimensionLabel(field);
  return <div className={`pivot-field-chip ${type}`} draggable onDragStart={(event) => onDragStart(event, field, type)}>
    <GripVertical size={15} /><span>{label}</span>
    {onRemove && <button type="button" aria-label={`Rimuovi ${label}`} onClick={() => onRemove(field)}><X size={14} /></button>}
  </div>;
}
function PivotDropZone({ title, hint, type, fields, onDropField, onDragStart, onRemove }) {
  const [active, setActive] = useState(false);
  return <section
    className={`pivot-drop-zone ${active ? "drag-active" : ""}`}
    onDragOver={(event) => { event.preventDefault(); setActive(true); }}
    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setActive(false); }}
    onDrop={(event) => { event.preventDefault(); setActive(false); onDropField(event, type); }}
  >
    <header><strong>{title}</strong><small>{hint}</small></header>
    <div className="pivot-drop-fields">
      {!fields.length && <span className="pivot-drop-placeholder">Trascina qui un campo</span>}
      {fields.map((field, index) => <div className="pivot-field-slot" key={field} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); setActive(false); onDropField(event, type, index); }}><PivotField field={field} type={type === "values" ? "metric" : "dimension"} onDragStart={onDragStart} onRemove={onRemove} /></div>)}
    </div>
  </section>;
}
function PivotFieldPalette({ usedDimensions, usedMetrics, onDragStart }) {
  return <aside className="pivot-field-palette">
    <div><h3>Campi pivot</h3><p>Trascina i campi nelle aree Righe, Colonne e Valori.</p></div>
    <div className="pivot-field-list"><h4>Dimensioni</h4>{dimensions.map((field) => <div className={usedDimensions.includes(field.key) ? "used" : ""} key={field.key}><PivotField field={field.key} type="dimension" onDragStart={onDragStart} /></div>)}</div>
    <div className="pivot-field-list"><h4>Valori</h4>{metrics.map((field) => <div className={usedMetrics.includes(field.key) ? "used" : ""} key={field.key}><PivotField field={field.key} type="metric" onDragStart={onDragStart} /></div>)}</div>
  </aside>;
}
function MobileFieldSelector({ title, hint, type, fields, options, onAdd, onRemove, onMove }) {
  const [selected, setSelected] = useState("");
  const available = options.filter((option) => !fields.includes(option.key));
  return <section className="mobile-pivot-zone">
    <header><strong>{title}</strong><small>{hint}</small></header>
    <div className="mobile-pivot-add">
      <select value={selected} onChange={(event) => setSelected(event.target.value)}>
        <option value="">Scegli un campo…</option>
        {available.map((option) => <option value={option.key} key={option.key}>{option.label}</option>)}
      </select>
      <button type="button" className="secondary-action" disabled={!selected} onClick={() => { onAdd(selected, type); setSelected(""); }}>Aggiungi</button>
    </div>
    <div className="mobile-pivot-fields">
      {!fields.length && <span>Nessun campo selezionato</span>}
      {fields.map((field, index) => <div key={field}>
        <strong>{type === "values" ? metricLabel(field) : dimensionLabel(field)}</strong>
        <div>
          <button type="button" disabled={index === 0} aria-label={`Sposta su ${field}`} onClick={() => onMove(type, index, -1)}>↑</button>
          <button type="button" disabled={index === fields.length - 1} aria-label={`Sposta giù ${field}`} onClick={() => onMove(type, index, 1)}>↓</button>
          <button type="button" aria-label={`Rimuovi ${field}`} onClick={() => onRemove(field)}><X size={15} /></button>
        </div>
      </div>)}
    </div>
  </section>;
}
function ComparisonGroup({ title, options, selected, onChange, format = (value) => value }) {
  return <div className="analytics-comparison-group"><strong>{title}</strong><div>{options.map((option) => <label key={option}><input type="checkbox" checked={selected.includes(option)} onChange={() => onChange(option)} />{format(option)}</label>)}</div></div>;
}
function AnalysisChart({ pivot, metric, type }) {
  const rows = pivot.rows.map((row) => ({ label: row.name, value: Number(row.totals?.[metric] || 0) })).slice(0, 30);
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
  const config = configs[source]; const goBack = useBackNavigation("/analisi-dati"); const today = new Date();
  const { loading: accessLoading, canAccessOrders, visibleAgents } = useOrdersAccess(source === "orders-ph" ? "ph" : "prof");
  const chartExportRef = useRef(null);
  const [from, setFrom] = useState(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`);
  const [to, setTo] = useState(new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10));
  const [search, setSearch] = useState("");
  const [filterFields, setFilterFields] = useState(["customer", "agent", "category", "subcategory", "warehouse_reason", "status"]);
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
      if (!canAccessOrders) {
        setRecords([]);
        return;
      }
      if (Array.isArray(visibleAgents) && visibleAgents.length === 0) {
        setRecords([]);
        return;
      }
      const headers = await loadPaged(config.table, (query) => {
        let next = query.gte(config.date, from).lte(config.date, to).order(config.date);
        if (source === "orders-ph") next = next.eq("modulo_ordini", "ph");
        if (Array.isArray(visibleAgents)) next = next.in("codice_agente_mexal", visibleAgents);
        return next;
      }, config.columns);
      const lines = await loadByIds(config.lines, source === "invoices" ? "fattura_id" : "ordine_id", headers.map((item) => item.id));
      setRecords(createRecords(source, headers, lines, await loadProductMap(lines)));
    } catch (loadError) { setError(loadError.message || "Caricamento non riuscito."); } finally { setLoading(false); }
  }
  useEffect(() => {
    if (accessLoading) return undefined;
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
    // The source change intentionally resets the selected analysis.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, accessLoading, canAccessOrders, Array.isArray(visibleAgents) ? visibleAgents.join(",") : "all"]);
  useEffect(() => {
    if (!valueFields.includes(chartMetric)) setChartMetric(valueFields[0] || "");
  }, [valueFields, chartMetric]);
  const filterOptions = useMemo(() => Object.fromEntries(filterFields.map((field) => [field, [...new Set(records.map((row) => String(row[field] || "")).filter(Boolean))].sort((a, b) => a.localeCompare(b, "it", { numeric: true }))])), [records, filterFields]);
  const availableYears = useMemo(() => [...new Set(records.map((row) => row.year).filter(Boolean))].sort(), [records]);
  const availableMonths = useMemo(() => [...new Set(records.map((row) => row.month_number).filter(Boolean))].sort(), [records]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return records.filter((row) =>
      !filterFields.some((field) => filters[field] && String(row[field]) !== filters[field])
      && (!comparisonYears.length || comparisonYears.includes(row.year))
      && (!comparisonMonths.length || comparisonMonths.includes(row.month_number))
      && (!needle || Object.values(row).some((value) => String(value).toLowerCase().includes(needle)))
    );
  }, [records, search, filters, filterFields, comparisonYears, comparisonMonths]);
  const valueFor = (bucket, metric) => {
    if (metric === "documents") return new Set(bucket.map((row) => row.document_key)).size;
    if (metric === "lines") return new Set(bucket.map((row) => row.line_key)).size;
    return bucket.reduce((sum, row) => sum + Number(row[metric] || 0), 0);
  };
  const groupKey = (row, fields) => fields.length ? fields.map((field) => String(row[field] || "Non indicato")).join(" / ") : "Totale";
  const pivot = useMemo(() => {
    const columns = []; const columnNames = new Set(); const rowNames = []; const knownRows = new Set();
    const buckets = new Map(); const rowBuckets = new Map(); const columnBuckets = new Map();
    const calculatedMetrics = [...new Set([...valueFields, chartMetric])];
    filtered.forEach((record) => {
      const row = groupKey(record, rowFields); const column = groupKey(record, columnFields); const key = `${row}\u0000${column}`;
      if (!knownRows.has(row)) { knownRows.add(row); rowNames.push(row); }
      if (!columnNames.has(column)) { columnNames.add(column); columns.push(column); }
      if (!buckets.has(key)) buckets.set(key, []);
      if (!rowBuckets.has(row)) rowBuckets.set(row, []);
      if (!columnBuckets.has(column)) columnBuckets.set(column, []);
      buckets.get(key).push(record); rowBuckets.get(row).push(record); columnBuckets.get(column).push(record);
    });
    const calculate = (bucket) => Object.fromEntries(calculatedMetrics.map((metric) => [metric, valueFor(bucket || [], metric)]));
    const columnTotals = Object.fromEntries(columns.map((column) => [column, calculate(columnBuckets.get(column))]));
    const grandTotals = calculate(filtered);
    const rows = rowNames.map((name) => ({
      name,
      cells: Object.fromEntries(columns.map((column) => [column, calculate(buckets.get(`${name}\u0000${column}`))])),
      totals: calculate(rowBuckets.get(name)),
    }));
    const selectedMetric = valueFields[0] || "total";
    rows.sort((a, b) => {
      const [sortType, sortColumn, sortMetric] = sortMode.split("\u0001");
      const left = sortType === "cell"
        ? Number(a.cells[sortColumn]?.[sortMetric] || 0)
        : sortType === "total"
          ? Number(a.totals?.[sortMetric || selectedMetric] || 0)
          : a.name;
      const right = sortType === "cell"
        ? Number(b.cells[sortColumn]?.[sortMetric] || 0)
        : sortType === "total"
          ? Number(b.totals?.[sortMetric || selectedMetric] || 0)
          : b.name;
      const result = typeof left === "string" ? left.localeCompare(right, "it", { numeric: true }) : left - right;
      return sortDirection === "asc" ? result : -result;
    });
    return { columns, rows, columnTotals, grandTotals };
  }, [filtered, rowFields, columnFields, valueFields, chartMetric, sortMode, sortDirection]);
  const toggle = (setter) => (key) => setter((list) => list.includes(key) ? list.filter((item) => item !== key) : [...list, key]);
  const selectSort = (key) => {
    if (sortMode === key) setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else { setSortMode(key); setSortDirection("asc"); }
  };
  const sortIndicator = (key) => sortMode === key ? (sortDirection === "asc" ? " ▲" : " ▼") : "";
  const formatMetric = (value, metric) => ["taxable", "vat", "total"].includes(metric) ? money(value) : Number(value || 0).toLocaleString("it-IT");
  const rowMetricTotal = (row, metric) => Number(row.totals?.[metric] || 0);
  const grandMetricTotal = (metric) => Number(pivot.grandTotals?.[metric] || 0);
  const rawRows = filtered.map((row) => Object.fromEntries([...dimensions.map(({ key, label }) => [label, row[key]]), ...metrics.slice(2).map(({ key, label }) => [label, row[key]])]));
  const pivotMatrix = [
    ["Righe", ...pivot.columns.flatMap((column) => valueFields.map((metric) => `${column} - ${metricLabel(metric)}`)), ...valueFields.map((metric) => `Totale - ${metricLabel(metric)}`)],
    ...pivot.rows.map((row) => [row.name, ...pivot.columns.flatMap((column) => valueFields.map((metric) => row.cells[column][metric])), ...valueFields.map((metric) => rowMetricTotal(row, metric))]),
    ["TOTALE GENERALE", ...pivot.columns.flatMap((column) => valueFields.map((metric) => pivot.columnTotals[column]?.[metric] || 0)), ...valueFields.map(grandMetricTotal)],
  ];
  function startFieldDrag(event, field, type) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-workspace-pivot", JSON.stringify({ field, type }));
    event.dataTransfer.setData("text/plain", field);
  }
  function dropField(event, target, targetIndex) {
    let payload;
    try { payload = JSON.parse(event.dataTransfer.getData("application/x-workspace-pivot")); } catch { return; }
    if (!payload?.field) return;
    const expectsMetric = target === "values";
    if ((expectsMetric && payload.type !== "metric") || (!expectsMetric && payload.type !== "dimension")) return;
    if (payload.type === "metric") {
      setValueFields((current) => {
        const next = current.filter((field) => field !== payload.field);
        next.splice(targetIndex ?? next.length, 0, payload.field);
        return next;
      });
      return;
    }
    if (target === "filters") {
      setFilterFields((current) => {
        const next = current.filter((field) => field !== payload.field);
        next.splice(targetIndex ?? next.length, 0, payload.field);
        return next;
      });
      setFilters((current) => ({ ...current, [payload.field]: current[payload.field] || "" }));
      return;
    }
    setRowFields((current) => {
      const next = current.filter((field) => field !== payload.field);
      if (target === "rows") next.splice(targetIndex ?? next.length, 0, payload.field);
      return next;
    });
    setColumnFields((current) => {
      const next = current.filter((field) => field !== payload.field);
      if (target === "columns") next.splice(targetIndex ?? next.length, 0, payload.field);
      return next;
    });
  }
  function resetPivot() {
    setRowFields(["customer"]);
    setColumnFields(["year_month"]);
    setValueFields(["total"]);
  }
  function removeFilterField(field) {
    setFilterFields((current) => current.filter((item) => item !== field));
    setFilters((current) => ({ ...current, [field]: "" }));
  }
  function addMobileField(field, target) {
    if (!field) return;
    if (target === "filters") {
      setFilterFields((current) => current.includes(field) ? current : [...current, field]);
      setFilters((current) => ({ ...current, [field]: current[field] || "" }));
      return;
    }
    if (target === "values") {
      setValueFields((current) => current.includes(field) ? current : [...current, field]);
      return;
    }
    setRowFields((current) => target === "rows" ? [...current.filter((item) => item !== field), field] : current.filter((item) => item !== field));
    setColumnFields((current) => target === "columns" ? [...current.filter((item) => item !== field), field] : current.filter((item) => item !== field));
  }
  function moveMobileField(target, index, direction) {
    const setter = target === "filters" ? setFilterFields : target === "rows" ? setRowFields : target === "columns" ? setColumnFields : setValueFields;
    setter((current) => {
      const next = [...current]; const destination = index + direction;
      if (destination < 0 || destination >= next.length) return current;
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
  }
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
    if (view === "chart" && chartExportRef.current && chartMetric) {
      const { default: html2canvas } = await import("html2canvas");
      const chartElement = chartExportRef.current;
      const canvas = await html2canvas(chartElement, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        width: chartElement.scrollWidth,
        height: chartElement.scrollHeight,
        windowWidth: chartElement.scrollWidth,
      });
      const image = canvas.toDataURL("image/png");
      const availableWidth = pageWidth - 28;
      const availableHeight = pageHeight - 66;
      const ratio = Math.min(availableWidth / canvas.width, availableHeight / canvas.height);
      const imageWidth = canvas.width * ratio;
      const imageHeight = canvas.height * ratio;
      doc.setFontSize(10);
      doc.setTextColor(107, 100, 92);
      doc.text(`${metricLabel(chartMetric)} · Grafico ${chartType === "line" ? "a linee" : "a barre"}`, 14, 51);
      doc.addImage(image, "PNG", 14, 57, imageWidth, imageHeight);
      doc.setFontSize(8);
      doc.text("Pagina 1", pageWidth - 14, pageHeight - 7, { align: "right" });
      doc.save(`report-analisi-dati-${source}-grafico.pdf`);
      return;
    }
    const body = [
      ...pivot.rows.map((row) => [row.name, ...pivot.columns.flatMap((column) => valueFields.map((metric) => formatMetric(row.cells[column][metric], metric))), ...valueFields.map((metric) => formatMetric(rowMetricTotal(row, metric), metric))]),
      ["TOTALE GENERALE", ...pivot.columns.flatMap((column) => valueFields.map((metric) => formatMetric(pivot.columnTotals[column]?.[metric] || 0, metric))), ...valueFields.map((metric) => formatMetric(grandMetricTotal(metric), metric))],
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
  return <div className="commercial-analysis commercial-analysis-fullscreen">
    <button className="analytics-back" type="button" onClick={goBack}><ArrowLeft size={18} /> Analisi dati</button>
    <div className="analytics-workspace-header"><div><h1>{config.title}</h1><p>{config.subtitle}</p></div></div>
    <div className="panel analytics-filter-section analytics-top-filters"><h3>Filtri analisi</h3>
      <div className="desktop-pivot-controls"><PivotDropZone title="Campi filtro" hint="Trascina qui le dimensioni da usare come filtri" type="filters" fields={filterFields} onDropField={dropField} onDragStart={startFieldDrag} onRemove={removeFilterField} /></div>
      <div className="mobile-pivot-controls"><MobileFieldSelector title="Campi filtro" hint="Scegli i filtri da visualizzare" type="filters" fields={filterFields} options={dimensions} onAdd={addMobileField} onMove={moveMobileField} onRemove={removeFilterField} /></div>
      <div className="analytics-filters">
      <label>Dal<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>Al<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      {filterFields.map((field) => <label key={field}>{dimensionLabel(field)}<select value={filters[field] || ""} onChange={(event) => setFilters((current) => ({ ...current, [field]: event.target.value }))}><option value="">Tutti</option>{filterOptions[field]?.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>)}
      <div className="analytics-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ricerca libera totale..." /></div><button type="button" className="secondary-action" onClick={load}><RefreshCw size={17} /> Applica periodo</button>
    </div><div className="analytics-comparison-grid">
      <ComparisonGroup title="Confronta anni" options={availableYears} selected={comparisonYears} onChange={toggle(setComparisonYears)} />
      <ComparisonGroup title="Confronta mesi" options={availableMonths} selected={comparisonMonths} onChange={toggle(setComparisonMonths)} format={monthName} />
    </div><small className="analytics-comparison-help">Se non selezioni alcuna voce vengono inclusi tutti gli anni e i mesi del periodo. Puoi selezionarne più di uno per confrontarli.</small></div>
    {error && <div className="panel analytics-error">{error}</div>}
    <div className="analytics-pivot-workspace">
      <PivotFieldPalette usedDimensions={[...filterFields, ...rowFields, ...columnFields]} usedMetrics={valueFields} onDragStart={startFieldDrag} />
      <main className="pivot-builder-main">
        <div className="panel pivot-layout-panel"><div className="analytics-section-title"><div><h3>Struttura tabella pivot</h3><p className="desktop-pivot-controls">Trascina i campi per organizzare righe, colonne e valori.</p><p className="mobile-pivot-controls">Scegli e ordina i campi con i comandi touch.</p></div><button type="button" className="secondary-action" onClick={resetPivot}>Ripristina</button></div><div className="pivot-drop-grid desktop-pivot-controls">
          <PivotDropZone title="Righe" hint="Raggruppamenti verticali" type="rows" fields={rowFields} onDropField={dropField} onDragStart={startFieldDrag} onRemove={(field) => setRowFields((current) => current.filter((item) => item !== field))} />
          <PivotDropZone title="Colonne" hint="Raggruppamenti orizzontali" type="columns" fields={columnFields} onDropField={dropField} onDragStart={startFieldDrag} onRemove={(field) => setColumnFields((current) => current.filter((item) => item !== field))} />
          <PivotDropZone title="Valori" hint="Misure da calcolare" type="values" fields={valueFields} onDropField={dropField} onDragStart={startFieldDrag} onRemove={(field) => setValueFields((current) => current.filter((item) => item !== field))} />
        </div><div className="mobile-pivot-controls mobile-pivot-config">
          <MobileFieldSelector title="Righe" hint="Raggruppamenti verticali" type="rows" fields={rowFields} options={dimensions} onAdd={addMobileField} onMove={moveMobileField} onRemove={(field) => setRowFields((current) => current.filter((item) => item !== field))} />
          <MobileFieldSelector title="Colonne" hint="Raggruppamenti orizzontali" type="columns" fields={columnFields} options={dimensions} onAdd={addMobileField} onMove={moveMobileField} onRemove={(field) => setColumnFields((current) => current.filter((item) => item !== field))} />
          <MobileFieldSelector title="Valori" hint="Misure da calcolare" type="values" fields={valueFields} options={metrics} onAdd={addMobileField} onMove={moveMobileField} onRemove={(field) => setValueFields((current) => current.filter((item) => item !== field))} />
        </div></div>
    <div className="panel analytics-result-section"><div className="analytics-export-actions"><button className="primary-action" type="button" onClick={downloadPdf} disabled={!filtered.length || !valueFields.length}><FileDown size={18} /> Esporta PDF</button><button className="secondary-action" type="button" onClick={downloadExcel} disabled={!filtered.length}><Download size={18} /> Esporta Excel completo</button></div>
      <div className="analytics-result-heading"><div><h3>Risultato analisi</h3><p>Record analizzati: {filtered.length.toLocaleString("it-IT")} · Clicca su ogni intestazione per ordinare</p></div><div className="analytics-result-controls">
        <div className="analytics-view-switch"><button type="button" className={view === "table" ? "active" : ""} onClick={() => setView("table")}>Tabella</button><button type="button" className={view === "chart" ? "active" : ""} onClick={() => setView("chart")}>Grafico</button></div>
      </div></div>
      {view === "chart" && <div className="analytics-chart-controls"><label>Tipo grafico<select value={chartType} onChange={(event) => setChartType(event.target.value)}><option value="bar">Barre</option><option value="line">Linee</option></select></label><label>Valore della pivot<select value={chartMetric} onChange={(event) => setChartMetric(event.target.value)} disabled={!valueFields.length}>{valueFields.map((metric) => <option value={metric} key={metric}>{metricLabel(metric)}</option>)}</select></label></div>}
      {view === "chart" ? <div className="analytics-chart-export" ref={chartExportRef}>{chartMetric ? <AnalysisChart pivot={pivot} metric={chartMetric} type={chartType} /> : <div className="analytics-chart-empty">Trascina almeno un campo nell’area Valori.</div>}</div> : <div className="analytics-table-wrap">{loading ? <p className="analytics-loading">Caricamento analisi...</p> : <table className="analytics-table"><thead><tr><th><button type="button" className="pivot-sort-button" onClick={() => selectSort("name")}>Righe{sortIndicator("name")}</button></th>{pivot.columns.flatMap((column) => valueFields.map((metric) => { const key = `cell\u0001${column}\u0001${metric}`; return <th key={`${column}:${metric}`}><button type="button" className="pivot-sort-button" onClick={() => selectSort(key)}>{column}<br />{metricLabel(metric)}{sortIndicator(key)}</button></th>; }))}{valueFields.map((metric) => { const key = `total\u0001\u0001${metric}`; return <th key={`total:${metric}`}><button type="button" className="pivot-sort-button" onClick={() => selectSort(key)}>Totale<br />{metricLabel(metric)}{sortIndicator(key)}</button></th>; })}</tr></thead><tbody>{!pivot.rows.length && <tr><td>Nessun dato disponibile</td></tr>}{pivot.rows.map((row) => <tr key={row.name}><th>{row.name}</th>{pivot.columns.flatMap((column) => valueFields.map((metric) => <td key={`${column}:${metric}`}>{formatMetric(row.cells[column][metric], metric)}</td>))}{valueFields.map((metric) => <td key={`total:${metric}`}><strong>{formatMetric(rowMetricTotal(row, metric), metric)}</strong></td>)}</tr>)}</tbody>{!!pivot.rows.length && <tfoot><tr><th>TOTALE GENERALE</th>{pivot.columns.flatMap((column) => valueFields.map((metric) => <td key={`${column}:${metric}`}>{formatMetric(pivot.columnTotals[column]?.[metric] || 0, metric)}</td>))}{valueFields.map((metric) => <td key={`grand:${metric}`}><strong>{formatMetric(grandMetricTotal(metric), metric)}</strong></td>)}</tr></tfoot>}</table>}</div>}
    </div>
      </main>
    </div>
  </div>;
}
