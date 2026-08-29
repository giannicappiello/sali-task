import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarDays, RefreshCw, Search } from "lucide-react";
import ModuleContainerLayout from "../../components/ModuleContainerLayout";
import { supabase } from "../../lib/supabaseClient";
import { loadWorkspaceWarehouse, nonNegativeWarehouseRows, warehouseArticleType, warehouseBreakdown, warehouseRow, warehouseSummary } from "./warehouseData";
import "./warehouse.css";
import "./warehouseDashboard.css";

const TYPES = ["TOTALE", "MP", "IT", "CN", "FP", "AS", "TB", "ALTRI"];
const COLORS = ["#1769aa", "#16a36f", "#f1a11a", "#7657d5", "#db5b55", "#16a4b8", "#74849a"];
const quantityFormat = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 3 });
const costFormat = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 6 });
const currencyFormat = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });

function isoDay(value) {
  return value ? new Date(value).toISOString().slice(0, 10) : "";
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" }) : "—";
}

function stockStatus(row) {
  if (row.onHand < 0) return { label: "Giacenza negativa", tone: "empty" };
  if (row.available <= 0) return { label: "Non disponibile", tone: "empty" };
  if (row.committed > 0) return { label: "Disponibile con impegni", tone: "committed" };
  return { label: "Disponibile", tone: "available" };
}

function Donut({ title, items, valueKey, formatter }) {
  const total = items.reduce((sum, item) => sum + Math.max(0, Number(item[valueKey] || 0)), 0);
  let cursor = 0;
  const segments = items.map((item, index) => {
    const start = cursor;
    cursor += total > 0 ? Math.max(0, Number(item[valueKey] || 0)) / total * 360 : 0;
    return `${COLORS[index % COLORS.length]} ${start}deg ${cursor}deg`;
  });
  return <article className="warehouse-chart-card"><h3>{title}</h3><div className="warehouse-chart-body"><div className="warehouse-donut" style={{ background: total > 0 ? `conic-gradient(${segments.join(",")})` : "#e7edf3" }}><span>{formatter(total)}</span></div><ul>{items.map((item, index) => <li key={item.type}><i style={{ background: COLORS[index % COLORS.length] }} /><span>{item.type}</span><strong>{formatter(item[valueKey])}</strong></li>)}</ul></div></article>;
}

export default function WarehouseDashboard() {
  const [rows, setRows] = useState([]);
  const [type, setType] = useState("TOTALE");
  const [unit, setUnit] = useState("TUTTE");
  const [warehouse, setWarehouse] = useState("TUTTI");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [query, setQuery] = useState("");
  const [stockFilter, setStockFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setRows((await loadWorkspaceWarehouse(supabase)).map(warehouseRow)); }
    catch (loadError) { setError(loadError?.message || "Dashboard Magazzino non disponibile."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const units = useMemo(() => [...new Set(rows.map((row) => String(row.unita_misura || "SENZA UDM").toUpperCase()))].sort(), [rows]);
  const warehouses = useMemo(() => [...new Set(rows.map((row) => row.warehouse))].sort(), [rows]);
  const filtered = useMemo(() => rows.filter((row) => {
    if (type !== "TOTALE" && warehouseArticleType(row.codice_articolo) !== type) return false;
    if (unit !== "TUTTE" && String(row.unita_misura || "SENZA UDM").toUpperCase() !== unit) return false;
    if (warehouse !== "TUTTI" && row.warehouse !== warehouse) return false;
    const day = isoDay(row.sincronizzato_il);
    if (fromDate && (!day || day < fromDate)) return false;
    if (toDate && (!day || day > toDate)) return false;
    return true;
  }), [fromDate, rows, toDate, type, unit, warehouse]);
  const summaryRows = useMemo(() => nonNegativeWarehouseRows(filtered), [filtered]);
  const summary = useMemo(() => warehouseSummary(summaryRows), [summaryRows]);
  const breakdown = useMemo(() => warehouseBreakdown(summaryRows), [summaryRows]);
  const fullBreakdown = useMemo(() => warehouseBreakdown(rows), [rows]);
  const unvalued = summaryRows.length - summary.valuedArticles;
  const negativeCount = filtered.length - summaryRows.length;
  const tableRows = useMemo(() => {
    const text = query.trim().toLocaleLowerCase("it-IT");
    return filtered.filter((row) => {
      if (text && !`${row.codice_articolo || ""} ${row.descrizione || ""}`.toLocaleLowerCase("it-IT").includes(text)) return false;
      if (stockFilter === "available" && row.available <= 0) return false;
      if (stockFilter === "empty" && row.available > 0) return false;
      if (stockFilter === "committed" && row.committed <= 0) return false;
      if (stockFilter === "negative" && row.onHand >= 0) return false;
      if (stockFilter === "unvalued" && row.unitCost > 0) return false;
      return true;
    });
  }, [filtered, query, stockFilter]);
  const resetFilters = () => { setUnit("TUTTE"); setWarehouse("TUTTI"); setFromDate(""); setToDate(""); setType("TOTALE"); setQuery(""); setStockFilter("all"); };

  return <ModuleContainerLayout icon={BarChart3} eyebrow="Modulo Workspace" title="Magazzino" description="Resoconto quantitativo ed economico delle giacenze registrate nel database Workspace." backFallback="/home">
    <div className="warehouse-dashboard-page">
    <section className="warehouse-dashboard-toolbar"><div className="warehouse-dashboard-types" aria-label="Selezione rapida tipologia">{TYPES.map((item) => <button key={item} type="button" className={type === item ? "active" : ""} onClick={() => setType(item)}>{item}<span>{item === "TOTALE" ? rows.length : (fullBreakdown.byType.find((entry) => entry.type === item)?.articles || 0)}</span></button>)}</div><button className="warehouse-dashboard-refresh" type="button" onClick={load} disabled={loading}><RefreshCw size={17} className={loading ? "warehouse-spin" : ""} />Aggiorna</button></section>
    <section className="warehouse-dashboard-filters"><label><span>UDM</span><select value={unit} onChange={(event) => setUnit(event.target.value)}><option value="TUTTE">Tutte le UDM</option>{units.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label><span>Magazzino</span><select value={warehouse} onChange={(event) => setWarehouse(event.target.value)}><option value="TUTTI">Tutti i magazzini</option>{warehouses.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label><span><CalendarDays size={15} />Aggiornati dal</span><input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label><label><span><CalendarDays size={15} />Aggiornati al</span><input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label><button type="button" onClick={resetFilters}>Azzera filtri</button></section>
    {error ? <div className="warehouse-dashboard-message error" role="alert">{error}</div> : null}
    {loading ? <div className="warehouse-dashboard-message">Caricamento dashboard...</div> : null}
    {!loading && !error ? <>
      <section className="warehouse-dashboard-kpis"><article><span>Articoli</span><strong>{summary.articles}</strong><small>{summary.availableArticles} disponibili</small></article><article><span>Valore magazzino</span><strong>{currencyFormat.format(summary.stockValue)}</strong><small>Giacenza × prezzo unitario</small></article><article><span>Valore disponibile</span><strong>{currencyFormat.format(summary.availableValue)}</strong><small>Disponibilità × prezzo unitario</small></article><article><span>Senza costo</span><strong>{unvalued}</strong><small>{negativeCount} negativi esclusi dai riepiloghi</small></article></section>
      <section className="warehouse-dashboard-charts"><Donut title="Valore per tipologia" items={breakdown.byType} valueKey="value" formatter={currencyFormat.format} /><Donut title="Articoli per tipologia" items={breakdown.byType} valueKey="articles" formatter={quantityFormat.format} /><Donut title="Articoli per magazzino" items={breakdown.byWarehouse} valueKey="articles" formatter={quantityFormat.format} /></section>
      <section className="warehouse-unit-card"><header><div><strong>Quantità per unità di misura</strong><span>{breakdown.byUnit.length} UDM</span></div><small>Le quantità non vengono sommate tra UDM differenti.</small></header><div className="warehouse-unit-scroll"><table><thead><tr><th>UDM</th><th>Articoli</th><th>Giacenza</th><th>Impegnato</th><th>Disponibile</th><th>Valore</th></tr></thead><tbody>{breakdown.byUnit.map((item) => <tr key={item.unit}><td><strong>{item.unit}</strong></td><td>{item.articles}</td><td>{quantityFormat.format(item.quantity)}</td><td>{quantityFormat.format(item.committed)}</td><td>{quantityFormat.format(item.available)}</td><td><strong>{currencyFormat.format(item.value)}</strong></td></tr>)}</tbody></table></div></section>
      <p className="warehouse-dashboard-note">Gli articoli con giacenza negativa restano nell’elenco ma sono esclusi da card e grafici. “Aggregato” indica che Workspace non dispone di una singola ubicazione certificata.</p>
      <section className="warehouse-search-card warehouse-dashboard-search"><label><Search size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cerca per codice o descrizione..." /></label><select value={stockFilter} onChange={(event) => setStockFilter(event.target.value)} aria-label="Filtra stato magazzino"><option value="all">Tutti gli articoli</option><option value="available">Disponibili</option><option value="committed">Con impegni</option><option value="empty">Non disponibili</option><option value="negative">Giacenza negativa</option><option value="unvalued">Costo non valorizzato</option></select></section>
      <section className="warehouse-table-card" aria-label="Elenco articoli Workspace"><header><div><strong>Elenco articoli</strong><span>{tableRows.length} risultati</span></div><small>I valori economici utilizzano il costo ultimo Mexal salvato in Workspace.</small></header>{tableRows.length === 0 ? <div className="warehouse-message">Nessun articolo corrisponde ai filtri.</div> : <div className="warehouse-table-scroll"><table><thead><tr><th>Articolo</th><th>Magazzino</th><th>UDM</th><th>Giacenza</th><th>Impegnato</th><th>Disponibile</th><th>Prezzo unitario<br /><small>(costo ultimo)</small></th><th>Totale</th><th>Totale disponibile</th><th>Stato</th><th>Aggiornato</th></tr></thead><tbody>{tableRows.map((row) => { const status = stockStatus(row); return <tr key={row.codice_articolo}><td><strong>{row.codice_articolo}</strong><small>{row.descrizione || "Descrizione non disponibile"}</small></td><td><strong>{row.warehouse}</strong></td><td>{row.unita_misura || "—"}</td><td>{quantityFormat.format(row.onHand)}</td><td>{quantityFormat.format(row.committed)}</td><td><strong>{quantityFormat.format(row.available)}</strong></td><td>{row.unitCost > 0 ? costFormat.format(row.unitCost) : <span className="warehouse-missing-cost">Da valorizzare</span>}</td><td><strong>{currencyFormat.format(row.stockValue)}</strong></td><td>{currencyFormat.format(row.availableValue)}</td><td><span className={`warehouse-status ${status.tone}`}>{status.label}</span></td><td>{formatDate(row.sincronizzato_il)}</td></tr>; })}</tbody></table></div>}</section>
    </> : null}
    </div>
  </ModuleContainerLayout>;
}
