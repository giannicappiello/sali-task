import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarDays, List, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import ModuleContainerLayout from "../../components/ModuleContainerLayout";
import { supabase } from "../../lib/supabaseClient";
import { loadWorkspaceWarehouse, warehouseArticleType, warehouseBreakdown, warehouseRow, warehouseSummary } from "./warehouseData";
import "./warehouseDashboard.css";

const TYPES = ["TOTALE", "MP", "IT", "CN", "FP", "AS", "TB", "ALTRI"];
const COLORS = ["#1769aa", "#16a36f", "#f1a11a", "#7657d5", "#db5b55", "#16a4b8", "#74849a"];
const quantityFormat = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 3 });
const currencyFormat = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });

function isoDay(value) {
  return value ? new Date(value).toISOString().slice(0, 10) : "";
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
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
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
  const filtered = useMemo(() => rows.filter((row) => {
    if (type !== "TOTALE" && warehouseArticleType(row.codice_articolo) !== type) return false;
    if (unit !== "TUTTE" && String(row.unita_misura || "SENZA UDM").toUpperCase() !== unit) return false;
    const day = isoDay(row.sincronizzato_il);
    if (fromDate && (!day || day < fromDate)) return false;
    if (toDate && (!day || day > toDate)) return false;
    return true;
  }), [fromDate, rows, toDate, type, unit]);
  const summary = useMemo(() => warehouseSummary(filtered), [filtered]);
  const breakdown = useMemo(() => warehouseBreakdown(filtered), [filtered]);
  const fullBreakdown = useMemo(() => warehouseBreakdown(rows), [rows]);
  const unvalued = filtered.length - summary.valuedArticles;

  return <ModuleContainerLayout icon={BarChart3} eyebrow="Modulo Workspace" title="Dashboard Magazzino" description="Resoconto quantitativo ed economico delle giacenze registrate nel database Workspace." backFallback="/home">
    <section className="warehouse-dashboard-toolbar"><div className="warehouse-dashboard-types" aria-label="Selezione rapida tipologia">{TYPES.map((item) => <button key={item} type="button" className={type === item ? "active" : ""} onClick={() => setType(item)}>{item}<span>{item === "TOTALE" ? rows.length : (fullBreakdown.byType.find((entry) => entry.type === item)?.articles || 0)}</span></button>)}</div><div className="warehouse-dashboard-actions"><Link to="/magazzino"><List size={17} />Elenco articoli</Link><button type="button" onClick={load} disabled={loading}><RefreshCw size={17} className={loading ? "warehouse-spin" : ""} />Aggiorna</button></div></section>
    <section className="warehouse-dashboard-filters"><label><span>UDM</span><select value={unit} onChange={(event) => setUnit(event.target.value)}><option value="TUTTE">Tutte le UDM</option>{units.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label><span><CalendarDays size={15} />Aggiornati dal</span><input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label><label><span><CalendarDays size={15} />Aggiornati al</span><input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label><button type="button" onClick={() => { setUnit("TUTTE"); setFromDate(""); setToDate(""); setType("TOTALE"); }}>Azzera filtri</button></section>
    {error ? <div className="warehouse-dashboard-message error" role="alert">{error}</div> : null}
    {loading ? <div className="warehouse-dashboard-message">Caricamento dashboard...</div> : null}
    {!loading && !error ? <>
      <section className="warehouse-dashboard-kpis"><article><span>Articoli</span><strong>{summary.articles}</strong><small>{summary.availableArticles} disponibili</small></article><article><span>Valore magazzino</span><strong>{currencyFormat.format(summary.stockValue)}</strong><small>Giacenza × prezzo unitario</small></article><article><span>Valore disponibile</span><strong>{currencyFormat.format(summary.availableValue)}</strong><small>Disponibilità × prezzo unitario</small></article><article><span>Senza costo</span><strong>{unvalued}</strong><small>Articoli da valorizzare</small></article></section>
      <section className="warehouse-dashboard-charts"><Donut title="Valore per tipologia" items={breakdown.byType} valueKey="value" formatter={currencyFormat.format} /><Donut title="Articoli per tipologia" items={breakdown.byType} valueKey="articles" formatter={quantityFormat.format} /></section>
      <section className="warehouse-unit-card"><header><div><strong>Quantità per unità di misura</strong><span>{breakdown.byUnit.length} UDM</span></div><small>Le quantità non vengono sommate tra UDM differenti.</small></header><div className="warehouse-unit-scroll"><table><thead><tr><th>UDM</th><th>Articoli</th><th>Giacenza</th><th>Impegnato</th><th>Disponibile</th><th>Valore</th></tr></thead><tbody>{breakdown.byUnit.map((item) => <tr key={item.unit}><td><strong>{item.unit}</strong></td><td>{item.articles}</td><td>{quantityFormat.format(item.quantity)}</td><td>{quantityFormat.format(item.committed)}</td><td>{quantityFormat.format(item.available)}</td><td><strong>{currencyFormat.format(item.value)}</strong></td></tr>)}</tbody></table></div></section>
      <p className="warehouse-dashboard-note">Le date filtrano l’ultimo aggiornamento disponibile. I confronti storici richiederanno snapshot periodici delle giacenze.</p>
    </> : null}
  </ModuleContainerLayout>;
}
