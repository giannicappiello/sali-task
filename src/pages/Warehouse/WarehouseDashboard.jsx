import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, CalendarDays, Info, RefreshCw, Search } from "lucide-react";
import ModuleContainerLayout from "../../components/ModuleContainerLayout";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabaseClient";
import { loadWorkspaceWarehouse } from "./warehouseData";
import "./warehouse.css";
import "./warehouseDashboard.css";

const TYPES = ["TOTALE", "MP", "IT", "MKT", "CN", "FP", "AS", "TB", "ALTRI"];
const COLORS = ["#1769aa", "#16a36f", "#f1a11a", "#7657d5", "#db5b55", "#16a4b8", "#74849a"];
const PAGE_SIZE = 100;
const quantityFormat = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 3 });
const costFormat = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 6 });
const currencyFormat = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });

function localDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" }) : "—";
}

function InfoTip({ text, label = "Spiegazione del dato" }) {
  return <span className="warehouse-info" tabIndex={0} role="img" aria-label={`${label}: ${text}`} data-tooltip={text} title={text}><Info size={14} aria-hidden="true" /></span>;
}

function stockStatus(row) {
  if (Number(row.on_hand) < 0) return { label: "Giacenza negativa", tone: "empty" };
  if (Number(row.on_hand) === 0) return { label: "Giacenza zero", tone: "empty" };
  return { label: "Disponibile", tone: "available" };
}

function Donut({ title, info, items, valueKey, labelKey, formatter }) {
  const total = items.reduce((sum, item) => sum + Math.max(0, Number(item[valueKey] || 0)), 0);
  let cursor = 0;
  const segments = items.map((item, index) => {
    const start = cursor;
    cursor += total > 0 ? Math.max(0, Number(item[valueKey] || 0)) / total * 360 : 0;
    return `${COLORS[index % COLORS.length]} ${start}deg ${cursor}deg`;
  });
  return <article className="warehouse-chart-card"><h3>{title}<InfoTip text={info} label={title} /></h3><div className="warehouse-chart-body"><div className="warehouse-donut" style={{ background: total > 0 ? `conic-gradient(${segments.join(",")})` : "#e7edf3" }}><span>{formatter(total)}</span></div><ul>{items.map((item, index) => <li key={item[labelKey]}><i style={{ background: COLORS[index % COLORS.length] }} /><span>{item[labelKey]}</span><strong>{formatter(item[valueKey])}</strong></li>)}</ul></div></article>;
}

function WarehouseKpis({ items }) {
  if (!items.length) return null;
  return <section className="warehouse-location-kpis" aria-label="Riepilogo per magazzino">{items.map((item) => <article key={item.warehouse_number}>
    <header><strong>MAG-{item.warehouse_number}<InfoTip text="Riepilogo del medesimo dataset filtrato, limitato al singolo magazzino." label={`Magazzino ${item.warehouse_number}`} /></strong><span>{item.articles} articoli</span></header>
    <dl><div><dt>Valore</dt><dd>{currencyFormat.format(item.stock_value)}</dd></div><div><dt>Descrizione</dt><dd>{item.warehouse_name || "—"}</dd></div></dl>
  </article>)}</section>;
}

export default function WarehouseDashboard() {
  const { dataScope } = useAuth();
  const [data, setData] = useState({ rows: [], summary: {}, breakdown: {}, totalRows: 0, availableDates: [] });
  const [type, setType] = useState("TOTALE");
  const [unit, setUnit] = useState("TUTTE");
  const [warehouse, setWarehouse] = useState("TUTTI");
  const [asOfDate, setAsOfDate] = useState(localDay());
  const [query, setQuery] = useState("");
  const [stockFilter, setStockFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [catalog, setCatalog] = useState({ types: {}, warehouses: [], units: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestSequence = useRef(0);

  const filters = useMemo(() => ({ asOfDate, warehouse, type, unit, query, stockFilter, page, pageSize: PAGE_SIZE }), [asOfDate, page, query, stockFilter, type, unit, warehouse]);
  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    const controller = new AbortController();
    setLoading(true); setError("");
    try {
      const result = await loadWorkspaceWarehouse(supabase, filters, { signal: controller.signal });
      if (sequence !== requestSequence.current) return;
      setData(result);
      if (warehouse === "TUTTI" && type === "TOTALE" && unit === "TUTTE" && !query && stockFilter === "all") {
        setCatalog({
          types: Object.fromEntries((result.breakdown?.byType || []).map((item) => [item.article_type, Number(item.articles)])),
          warehouses: result.breakdown?.byWarehouse || [],
          units: result.breakdown?.byUnit || [],
        });
      }
    } catch (loadError) {
      if (loadError?.name !== "AbortError" && sequence === requestSequence.current) setError(loadError?.message || "Dashboard Magazzino non disponibile.");
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [filters, query, stockFilter, type, unit, warehouse]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), query ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [load, query]);

  const summary = data.summary || {};
  const breakdown = data.breakdown || {};
  const pages = Math.max(1, Math.ceil(Number(data.totalRows || 0) / PAGE_SIZE));
  const resetFilters = () => { setUnit("TUTTE"); setWarehouse("TUTTI"); setAsOfDate(localDay()); setType("TOTALE"); setQuery(""); setStockFilter("all"); setPage(1); };

  const customerScoped = Boolean(dataScope?.customerCode) || data.customerScoped === true;

  return <ModuleContainerLayout icon={BarChart3} eyebrow="Modulo Workspace" title="Magazzino" description={customerScoped ? "Giacenze inventariali storiche degli articoli collegati al cliente." : "Giacenze inventariali storiche per articolo e singolo magazzino."} backFallback="/home">
    <div className="warehouse-dashboard-page">
      <section className="warehouse-dashboard-toolbar"><div className="warehouse-dashboard-types" aria-label="Selezione rapida tipologia">{TYPES.map((item) => <button key={item} type="button" className={type === item ? "active" : ""} onClick={() => { setPage(1); setType(item); }}>{item}<span>{item === "TOTALE" ? Object.values(catalog.types).reduce((sum, value) => sum + value, 0) : (catalog.types[item] || 0)}</span></button>)}</div><button className="warehouse-dashboard-refresh" type="button" onClick={load} disabled={loading}><RefreshCw size={17} className={loading ? "warehouse-spin" : ""} />Aggiorna</button></section>
      <section className="warehouse-dashboard-filters"><label><span><CalendarDays size={15} />Giacenza al giorno</span><input type="date" max={localDay()} value={asOfDate} onChange={(event) => { setPage(1); setAsOfDate(event.target.value); }} /></label><label><span>UDM</span><select value={unit} onChange={(event) => { setPage(1); setUnit(event.target.value); }}><option value="TUTTE">Tutte le UDM</option>{catalog.units.map((item) => <option key={item.unit_of_measure} value={item.unit_of_measure}>{item.unit_of_measure}</option>)}</select></label>{!customerScoped && <label><span>Magazzino</span><select value={warehouse} onChange={(event) => { setPage(1); setWarehouse(event.target.value); }}><option value="TUTTI">Tutti i magazzini</option>{catalog.warehouses.map((item) => <option key={item.warehouse_number} value={`MAG-${item.warehouse_number}`}>MAG-{item.warehouse_number}{item.warehouse_name ? ` · ${item.warehouse_name}` : ""}</option>)}</select></label>}<button type="button" onClick={resetFilters}>Azzera filtri</button></section>
      <section className="warehouse-search-card warehouse-dashboard-search"><label><Search size={19} /><input value={query} onChange={(event) => { setPage(1); setQuery(event.target.value); }} placeholder="Cerca per codice o descrizione..." /></label><select value={stockFilter} onChange={(event) => { setPage(1); setStockFilter(event.target.value); }} aria-label="Filtra stato magazzino"><option value="all">Tutte le giacenze</option><option value="positive">Giacenza positiva</option><option value="zero">Giacenza zero</option><option value="negative">Giacenza negativa</option><option value="unvalued">Costo non valorizzato</option></select></section>
      {error ? <div className="warehouse-dashboard-message error" role="alert">{error}</div> : null}
      {loading ? <div className="warehouse-dashboard-message">Caricamento giacenza storica...</div> : null}
      {!loading && !error && !data.snapshotAvailable ? <div className="warehouse-dashboard-message" role="status"><strong>Nessuno snapshot inventariale certificato per il {new Date(`${asOfDate}T12:00:00`).toLocaleDateString("it-IT")}.</strong><br />Date disponibili: {(data.availableDates || []).join(", ") || "nessuna"}. `sincronizzato_il` non viene utilizzato come data inventariale.</div> : null}
      {!loading && !error && data.snapshotAvailable ? <>
        <p className="warehouse-last-update">Giacenza al <strong>{new Date(`${asOfDate}T12:00:00`).toLocaleDateString("it-IT")}</strong> · Ultimo aggiornamento: <strong>{formatDate(data.lastUpdated)}</strong></p>
        <section className="warehouse-dashboard-kpis">
          <article><span>Articoli<InfoTip text={customerScoped ? "Numero di codici articolo distinti collegati al cliente nel dataset filtrato." : "Numero di codici articolo distinti nel dataset filtrato per data, magazzino, tipologia, UDM, ricerca e stato giacenza."} label="Articoli" /></span><strong>{quantityFormat.format(summary.articles || 0)}</strong><small>{customerScoped ? "Articoli collegati al cliente" : `${quantityFormat.format(summary.locations || 0)} righe articolo-magazzino`}</small></article>
          <article><span>Valore magazzino<InfoTip text="Somma di giacenza × costo ultimo per tutte le righe filtrate con giacenza positiva. Le giacenze negative e zero contribuiscono 0 €." label="Valore magazzino" /></span><strong>{currencyFormat.format(summary.stockValue || 0)}</strong><small>Stesso dataset della tabella e dei grafici</small></article>
          <article><span>Articoli con giacenza negativa<InfoTip text="Numero di codici articolo distinti con almeno una giacenza negativa nel dataset filtrato. Restano visibili, ma sono esclusi dalla valorizzazione." label="Articoli con giacenza negativa" /></span><strong>{quantityFormat.format(summary.negativeArticles || 0)}</strong><small>Visibili nell’elenco · valore escluso</small></article>
          <article><span>Articoli senza costo<InfoTip text="Numero di codici articolo distinti con costo ultimo Mexal assente o uguale a zero nel dataset filtrato." label="Articoli senza costo" /></span><strong>{quantityFormat.format(summary.unvaluedArticles || 0)}</strong><small>Non valorizzabili economicamente</small></article>
        </section>
        {!customerScoped && <WarehouseKpis items={breakdown.byWarehouse || []} />}
        <section className="warehouse-dashboard-charts"><Donut title="Valore per tipologia" info="Ripartizione del valore positivo per tipologia articolo, calcolata server-side sullo stesso dataset filtrato della tabella." items={breakdown.byType || []} valueKey="stock_value" labelKey="article_type" formatter={currencyFormat.format} /><Donut title="Articoli per tipologia" info="Codici articolo distinti per tipologia nel dataset filtrato." items={breakdown.byType || []} valueKey="articles" labelKey="article_type" formatter={quantityFormat.format} />{!customerScoped && <Donut title="Articoli per magazzino" info="Codici articolo distinti per singolo magazzino; con Tutti ogni magazzino resta separato." items={(breakdown.byWarehouse || []).map((item) => ({ ...item, label: `MAG-${item.warehouse_number}` }))} valueKey="articles" labelKey="label" formatter={quantityFormat.format} />}</section>
        <section className="warehouse-unit-card"><header><div><strong>Quantità per unità di misura</strong><InfoTip text="Raggruppamento server-side delle quantità del dataset filtrato. UDM diverse non vengono mai sommate tra loro." label="Quantità per unità di misura" /><span>{(breakdown.byUnit || []).length} UDM</span></div><small>Le quantità non vengono sommate tra UDM differenti.</small></header><div className="warehouse-unit-scroll"><table><thead><tr><th>UDM</th><th>Articoli</th><th>Giacenza</th><th>Valore</th></tr></thead><tbody>{(breakdown.byUnit || []).map((item) => <tr key={item.unit_of_measure}><td><strong>{item.unit_of_measure}</strong></td><td>{quantityFormat.format(item.articles)}</td><td>{quantityFormat.format(item.quantity)}</td><td><strong>{currencyFormat.format(item.stock_value)}</strong></td></tr>)}</tbody></table></div></section>
        <p className="warehouse-dashboard-note">{customerScoped ? "Ogni riga rappresenta un articolo collegato al cliente. Le giacenze negative restano consultabili e valgono zero esclusivamente nelle valorizzazioni economiche." : "Ogni riga rappresenta Articolo + Magazzino. Le giacenze negative restano consultabili e valgono zero esclusivamente nelle valorizzazioni economiche."}</p>
        <section className="warehouse-table-card" aria-label={customerScoped ? "Elenco giacenze per articolo" : "Elenco giacenze per articolo e magazzino"}><header><div><strong>Elenco giacenze</strong><span>{quantityFormat.format(data.totalRows || 0)} risultati</span></div><small>Data inventariale: {asOfDate} · Ultimo aggiornamento separato dalla competenza.</small></header><div className="warehouse-table-scroll"><table><thead><tr><th>Articolo</th>{!customerScoped && <th>Magazzino</th>}<th>UDM</th><th>Giacenza</th><th>Impegnato</th><th>Disponibile</th><th>Costo ultimo</th><th>Valore</th><th>Stato</th><th>Ultimo aggiornamento</th></tr></thead><tbody>{data.rows.map((row) => { const status = stockStatus(row); return <tr key={customerScoped ? row.article_code : `${row.article_code}:${row.warehouse_number}`}><td><strong>{row.article_code}</strong><small>{row.description || "Descrizione non disponibile"}</small></td>{!customerScoped && <td><strong>MAG-{row.warehouse_number}</strong>{row.warehouse_name ? <small>{row.warehouse_name}</small> : null}</td>}<td>{row.unit_of_measure}</td><td>{quantityFormat.format(row.on_hand)}</td><td>{row.committed === null ? "—" : quantityFormat.format(row.committed)}</td><td>{row.available === null ? "—" : quantityFormat.format(row.available)}</td><td>{Number(row.unit_cost) > 0 ? costFormat.format(row.unit_cost) : <span className="warehouse-missing-cost">Da valorizzare</span>}</td><td><strong>{currencyFormat.format(row.stock_value)}</strong></td><td><span className={`warehouse-status ${status.tone}`}>{status.label}</span></td><td>{formatDate(row.captured_at)}</td></tr>; })}</tbody></table></div><footer className="warehouse-pagination"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Precedente</button><span>Pagina {page} di {pages}</span><button type="button" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>Successiva</button></footer></section>
      </> : null}
    </div>
  </ModuleContainerLayout>;
}
