import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Search, UsersRound } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabaseClient";
import { useDatasetTableControls, usePaginatedDataset, useResetPageCallback } from "../../components/useDatasetTableControls";
import CrmCustomerLink from "./CrmCustomerLink";
import { CrmCustomerStatusBadge, CrmCustomerStatusFilter } from "./CrmCustomerStatus";
import { useCrmCustomerStatus } from "./crmCustomerStatusModel";
import { loadAllQueryRows } from "./crmDataset";
import CrmPeriodFilter, { useCrmPeriod } from "./CrmPeriodFilter";
import { formatMoney } from "./crmConfig";
import "./customer-classification.css";

const PAGE_SIZE = 50;
const AREA_OPTIONS = [["conto_terzi", "PRIVATE"], ["b2b", "DIRECT · BtoB"], ["online", "DIRECT · BtoC"]];
const EMPTY_SALES = { totals: {}, categories: [], subcategories: [] };

function areaLabel(value) {
  return AREA_OPTIONS.find(([area]) => area === value)?.[1] || value || "—";
}

const CLASSIFICATION_COLUMNS = [
  { value: (row) => `${row.ragione_sociale} ${row.codice_cliente}` },
  { value: (row) => areaLabel(row.area_crm) },
  { value: (row) => formatMoney(row.invoice_net) },
  { value: (row) => formatMoney(row.order_net) },
  { value: (row) => row.crm_active !== false ? "Attivo" : "Non attivo" },
];

function DistributionChart({ rows }) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const direct = rows.slice(1).reduce((sum, row) => sum + row.count, 0);
  const privateShare = total ? Math.round((rows[0].count / total) * 100) : 0;
  const max = Math.max(1, ...rows.map((row) => row.count));
  return <div className="crm-classification-charts" aria-label="Distribuzione globale clienti CRM">
    <article className="crm-chart-card">
      <div className="crm-pie" style={{ "--private-share": `${privateShare}%` }} role="img" aria-label={`PRIVATE ${rows[0].count}, DIRECT ${direct}`}><span>{total}</span><small>clienti</small></div>
      <div><h3>PRIVATE / DIRECT</h3><p><i className="private" />PRIVATE <strong>{rows[0].count}</strong></p><p><i className="direct" />DIRECT <strong>{direct}</strong></p></div>
    </article>
    <article className="crm-chart-card crm-bar-chart"><h3>Canali CRM</h3>{rows.map((row) => <div className={`crm-bar-row ${row.key}`} key={row.key}><span>{row.label}</span><div><i style={{ width: `${(row.count / max) * 100}%` }} /></div><strong>{row.count}</strong></div>)}</article>
  </div>;
}

function formatPieces(value) {
  return Number(value || 0).toLocaleString("it-IT", { maximumFractionDigits: 2 });
}

function SalesDistributionChart({ title, description, rows, showCategory = false }) {
  const max = Math.max(1, ...rows.flatMap((row) => [Math.abs(Number(row.invoice_amount || 0)), Math.abs(Number(row.order_amount || 0))]));
  return <article className="crm-chart-card crm-sales-distribution"><div className="crm-sales-chart-heading"><div><h3>{title}</h3><p>{description}</p></div><div className="crm-sales-legend"><span><i className="invoice" />Fatturato Mexal</span><span><i className="order" />Ordinato Workspace</span></div></div>
    <div className="crm-sales-chart-body">{rows.map((row) => <div className="crm-sales-chart-row" key={`${row.category || ""}:${row.label}`}>
      <div className="crm-sales-chart-label"><strong>{row.label}</strong>{showCategory ? <small>{row.category}</small> : null}</div>
      <div className="crm-sales-paired-bars">
        <div title={`Fatturato ${formatMoney(row.invoice_amount)} · ${formatPieces(row.invoice_pieces)} pezzi`}><i className="invoice" style={{ width: `${Math.max(1, (Math.abs(Number(row.invoice_amount || 0)) / max) * 100)}%` }} /><span>{formatMoney(row.invoice_amount)}</span></div>
        <div title={`Ordinato ${formatMoney(row.order_amount)} · ${formatPieces(row.order_pieces)} pezzi`}><i className="order" style={{ width: `${Math.max(1, (Math.abs(Number(row.order_amount || 0)) / max) * 100)}%` }} /><span>{formatMoney(row.order_amount)}</span></div>
      </div>
      <small className="crm-sales-pieces">{formatPieces(row.invoice_pieces)} fatt. · {formatPieces(row.order_pieces)} ord.</small>
    </div>)}{!rows.length ? <div className="crm-empty">Nessuna vendita nel periodo selezionato.</div> : null}</div>
  </article>;
}

export default function CustomerClassificationPanel() {
  const { isAdminUser } = useAuth();
  const period = useCrmPeriod();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(() => Math.max(0, Number(searchParams.get("classification_page") || 0)));
  const [search, setSearch] = useState(() => searchParams.get("classification_search") || "");
  const [macro, setMacro] = useState(() => searchParams.get("classification_macro") || "");
  const [area, setArea] = useState(() => searchParams.get("classification_area") || "");
  const [customerStatus, setCustomerStatus] = useCrmCustomerStatus("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sales, setSales] = useState(EMPTY_SALES);
  const [lastUpdated, setLastUpdated] = useState(null);
  const loadingRef = useRef(false);
  const resetPage = useResetPageCallback(setPage);
  const [tableRef, tableQuery] = useDatasetTableControls({ onQueryChange: resetPage });
  const { pageRows, total } = usePaginatedDataset(rows, CLASSIFICATION_COLUMNS, tableQuery, page, PAGE_SIZE);

  const load = useCallback(async (silent = false) => {
    if (!isAdminUser || loadingRef.current) return;
    loadingRef.current = true;
    if (!silent) setLoading(true);
    setError("");
    const [result, salesResult] = await Promise.all([loadAllQueryRows((from, to) => {
      let query = supabase.from("crm_customer_classification_catalog")
        .select("codice_cliente,ragione_sociale,area_crm,attivo_mexal,crm_active")
        .order("ragione_sociale");
      if (macro === "private") query = query.eq("area_crm", "conto_terzi");
      if (macro === "direct") query = query.in("area_crm", ["b2b", "online"]);
      if (area) query = query.eq("area_crm", area);
      if (customerStatus === "active") query = query.eq("crm_active", true);
      if (customerStatus === "inactive") query = query.eq("crm_active", false);
      if (search.trim()) {
        const term = search.trim().replaceAll(",", " ");
        query = query.or(`codice_cliente.ilike.%${term}%,ragione_sociale.ilike.%${term}%`);
      }
      return query.range(from, to);
    }), supabase.rpc("crm_global_sales_distribution", {
      p_from: period.from,
      p_to: period.to,
      p_macro: macro || null,
      p_area: area || null,
      p_customer_status: customerStatus,
      p_search: search.trim() || null,
    })]);
    const loadError = result.error || salesResult.error;
    if (loadError) setError(loadError.message);
    else {
      const salesData = salesResult.data || EMPTY_SALES;
      const customerSales = new Map((salesData.customers || []).map((customer) => [customer.codice_cliente, customer]));
      setRows((result.data || []).map((customer) => ({ ...customer, ...(customerSales.get(customer.codice_cliente) || {}) })));
      setSales(salesData);
      setLastUpdated(new Date());
    }
    loadingRef.current = false;
    setLoading(false);
  }, [area, customerStatus, isAdminUser, macro, period.from, period.to, search]);

  useEffect(() => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      const values = { classification_search: search, classification_macro: macro, classification_area: area, classification_page: page ? String(page) : "" };
      Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
      return next;
    }, { replace: true });
  }, [area, macro, page, search, setSearchParams]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 180); return () => window.clearTimeout(timer); }, [load]);

  const distribution = useMemo(() => AREA_OPTIONS.map(([value, label], index) => ({ key: index === 0 ? "private" : value, label, count: rows.filter((row) => row.area_crm === value).length })), [rows]);
  const salesTotals = sales.totals || {};
  if (!isAdminUser) return null;

  return <section className="crm-panel crm-classification" aria-labelledby="crm-classification-title">
    <div className="crm-toolbar"><div><span className="crm-eyebrow"><UsersRound size={16} /> Dashboard globale CRM</span><h2 id="crm-classification-title">Parco clienti Workspace</h2><p>Solo clienti Mexal attivi, classificati dai campi cod_alternativo e nome_ricerca_cf.</p>{lastUpdated ? <small className="crm-auto-refresh" aria-live="polite">Ultimo aggiornamento manuale {lastUpdated.toLocaleTimeString("it-IT")}</small> : null}</div><button className="secondary-action" type="button" onClick={() => void load(false)} disabled={loading}><RefreshCw size={17} />Aggiorna</button></div>
    <div className="crm-classification-kpis"><button type="button" className="kpi-card" onClick={() => { setMacro(""); setArea(""); setPage(0); }}><div><span>Clienti filtrati</span><strong>{total}</strong><p>intero dataset</p></div></button>{distribution.map((item) => <button type="button" className="kpi-card" key={item.key} onClick={() => { setMacro(item.key === "private" ? "private" : "direct"); setArea(item.key === "private" ? "conto_terzi" : item.key); setPage(0); }}><div><span>{item.label}</span><strong>{item.count}</strong><p>apri elenco filtrato</p></div></button>)}</div>
    <DistributionChart rows={distribution} />
    <section className="crm-commercial-dashboard" aria-labelledby="crm-commercial-title">
      <div className="crm-toolbar crm-commercial-heading"><div><span className="crm-eyebrow">Vendite globali</span><h2 id="crm-commercial-title">Fatturato e ordinato per prodotto</h2><p>Fatturato dalle fatture Mexal; ordinato dagli ordini Workspace. Importi e pezzi restano distinti.</p></div><CrmPeriodFilter period={period} compact /></div>
      <div className="crm-commercial-kpis">
        <article className="kpi-card"><span>Fatturato</span><strong>{formatMoney(salesTotals.invoice_total)}</strong><p>{Number(salesTotals.invoice_count || 0).toLocaleString("it-IT")} fatture Mexal</p></article>
        <article className="kpi-card"><span>Ordinato</span><strong>{formatMoney(salesTotals.order_total)}</strong><p>ordini Workspace</p></article>
        <article className="kpi-card"><span>Numero ordini</span><strong>{Number(salesTotals.order_count || 0).toLocaleString("it-IT")}</strong><p>nel periodo selezionato</p></article>
        <article className="kpi-card"><span>Pezzi fatturati</span><strong>{formatPieces(salesTotals.invoice_pieces)}</strong><p>righe fattura Mexal</p></article>
        <article className="kpi-card"><span>Pezzi ordinati</span><strong>{formatPieces(salesTotals.order_pieces)}</strong><p>righe ordine Workspace</p></article>
      </div>
      <div className="crm-sales-charts">
        <SalesDistributionChart title="Distribuzione per categoria" description="Prime 12 categorie per valore commerciale." rows={sales.categories || []} />
        <SalesDistributionChart title="Distribuzione per sottocategoria" description="Prime 16 sottocategorie per valore commerciale." rows={sales.subcategories || []} showCategory />
      </div>
    </section>
    <div className="crm-filters crm-classification-filters">
      <label><Search size={17} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Codice cliente o ragione sociale" /></label>
      <select aria-label="Filtra blocco CRM" value={macro} onChange={(event) => { setMacro(event.target.value); setArea(""); setPage(0); }}><option value="">PRIVATE e DIRECT</option><option value="private">PRIVATE</option><option value="direct">DIRECT</option></select>
      <select aria-label="Filtra canale CRM" value={area} onChange={(event) => { setArea(event.target.value); setMacro(event.target.value === "conto_terzi" ? "private" : event.target.value ? "direct" : ""); setPage(0); }}><option value="">Tutti i canali</option>{AREA_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
      <CrmCustomerStatusFilter value={customerStatus} onChange={(value) => { setCustomerStatus(value); setPage(0); }} id="classification-customer-status" />
    </div>
    {error ? <div className="crm-message error" role="alert"><span>{error}</span><button type="button" onClick={() => void load()}>Riprova</button></div> : null}
    <div className="crm-table-wrap"><table ref={tableRef} data-column-controls-mode="dataset" className="crm-table crm-classification-table"><thead><tr><th>Cliente</th><th>CRM</th><th>Fatturato netto</th><th>Ordinato netto</th><th>Stato CRM</th></tr></thead><tbody>{pageRows.map((row) => <tr key={row.codice_cliente}><td><CrmCustomerLink crmType={row.area_crm} customerCode={row.codice_cliente} name={row.ragione_sociale}><strong>{row.ragione_sociale}</strong></CrmCustomerLink><small>{row.codice_cliente}</small></td><td><span className={`status-badge crm-area-${row.area_crm}`}>{areaLabel(row.area_crm)}</span></td><td><strong>{formatMoney(row.invoice_net)}</strong></td><td><strong>{formatMoney(row.order_net)}</strong></td><td><CrmCustomerStatusBadge active={row.crm_active !== false} /></td></tr>)}</tbody></table>{loading ? <div className="crm-loading">Caricamento clienti...</div> : null}{!loading && !pageRows.length ? <div className="crm-empty">Nessun cliente corrisponde ai filtri.</div> : null}</div>
    <div className="crm-pagination"><button type="button" disabled={page === 0 || loading} onClick={() => setPage((value) => value - 1)}>Precedente</button><span>Pagina {page + 1} · {total} clienti</span><button type="button" disabled={(page + 1) * PAGE_SIZE >= total || loading} onClick={() => setPage((value) => value + 1)}>Successiva</button></div>
  </section>;
}
