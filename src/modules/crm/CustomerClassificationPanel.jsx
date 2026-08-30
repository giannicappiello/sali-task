import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Search, UsersRound } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabaseClient";
import { useDatasetTableControls, usePaginatedDataset, useResetPageCallback } from "../../components/useDatasetTableControls";
import CrmCustomerLink from "./CrmCustomerLink";
import { CrmCustomerStatusBadge, CrmCustomerStatusFilter } from "./CrmCustomerStatus";
import { useCrmCustomerStatus } from "./crmCustomerStatusModel";
import { loadAllQueryRows } from "./crmDataset";
import "./customer-classification.css";

const PAGE_SIZE = 50;
const AREA_OPTIONS = [["conto_terzi", "PRIVATE"], ["b2b", "DIRECT · BtoB"], ["online", "DIRECT · BtoC"]];

function areaLabel(value) {
  return AREA_OPTIONS.find(([area]) => area === value)?.[1] || value || "—";
}

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString("it-IT") : "—";
}

const CLASSIFICATION_COLUMNS = [
  { value: (row) => `${row.ragione_sociale} ${row.codice_cliente}` },
  { value: (row) => row.cod_alternativo || "—" },
  { value: (row) => row.nome_ricerca_cf || "—" },
  { value: (row) => areaLabel(row.area_crm) },
  { value: (row) => formatDateTime(row.classificata_il) },
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

export default function CustomerClassificationPanel() {
  const { isAdminUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(() => Math.max(0, Number(searchParams.get("classification_page") || 0)));
  const [search, setSearch] = useState(() => searchParams.get("classification_search") || "");
  const [macro, setMacro] = useState(() => searchParams.get("classification_macro") || "");
  const [area, setArea] = useState(() => searchParams.get("classification_area") || "");
  const [customerStatus, setCustomerStatus] = useCrmCustomerStatus("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const resetPage = useResetPageCallback(setPage);
  const [tableRef, tableQuery] = useDatasetTableControls({ onQueryChange: resetPage });
  const { pageRows, total } = usePaginatedDataset(rows, CLASSIFICATION_COLUMNS, tableQuery, page, PAGE_SIZE);

  const load = useCallback(async () => {
    if (!isAdminUser) return;
    setLoading(true); setError("");
    const result = await loadAllQueryRows((from, to) => {
      let query = supabase.from("crm_customer_classification_catalog")
        .select("codice_cliente,ragione_sociale,cod_alternativo,nome_ricerca_cf,area_crm,origine_classificazione,classificata_il,attivo_mexal,crm_active")
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
    });
    if (result.error) setError(result.error.message); else setRows(result.data || []);
    setLoading(false);
  }, [area, customerStatus, isAdminUser, macro, search]);

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
  if (!isAdminUser) return null;

  return <section className="crm-panel crm-classification" aria-labelledby="crm-classification-title">
    <div className="crm-toolbar"><div><span className="crm-eyebrow"><UsersRound size={16} /> Dashboard globale CRM</span><h2 id="crm-classification-title">Parco clienti Workspace</h2><p>Solo clienti Mexal attivi, classificati dai campi cod_alternativo e nome_ricerca_cf.</p></div><button className="secondary-action" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={17} />Aggiorna</button></div>
    <div className="crm-classification-kpis"><button type="button" className="kpi-card" onClick={() => { setMacro(""); setArea(""); setPage(0); }}><div><span>Clienti filtrati</span><strong>{total}</strong><p>intero dataset</p></div></button>{distribution.map((item) => <button type="button" className="kpi-card" key={item.key} onClick={() => { setMacro(item.key === "private" ? "private" : "direct"); setArea(item.key === "private" ? "conto_terzi" : item.key); setPage(0); }}><div><span>{item.label}</span><strong>{item.count}</strong><p>apri elenco filtrato</p></div></button>)}</div>
    <DistributionChart rows={distribution} />
    <div className="crm-filters crm-classification-filters">
      <label><Search size={17} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Codice cliente o ragione sociale" /></label>
      <select aria-label="Filtra blocco CRM" value={macro} onChange={(event) => { setMacro(event.target.value); setArea(""); setPage(0); }}><option value="">PRIVATE e DIRECT</option><option value="private">PRIVATE</option><option value="direct">DIRECT</option></select>
      <select aria-label="Filtra canale CRM" value={area} onChange={(event) => { setArea(event.target.value); setMacro(event.target.value === "conto_terzi" ? "private" : event.target.value ? "direct" : ""); setPage(0); }}><option value="">Tutti i canali</option>{AREA_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
      <CrmCustomerStatusFilter value={customerStatus} onChange={(value) => { setCustomerStatus(value); setPage(0); }} id="classification-customer-status" />
    </div>
    {error ? <div className="crm-message error" role="alert"><span>{error}</span><button type="button" onClick={() => void load()}>Riprova</button></div> : null}
    <div className="crm-table-wrap"><table ref={tableRef} data-column-controls-mode="dataset" className="crm-table crm-classification-table"><thead><tr><th>Cliente</th><th>Cod. alternativo</th><th>Nome ricerca</th><th>CRM</th><th>Ultima classificazione</th><th>Stato CRM</th></tr></thead><tbody>{pageRows.map((row) => <tr key={row.codice_cliente}><td><CrmCustomerLink crmType={row.area_crm} customerCode={row.codice_cliente} name={row.ragione_sociale}><strong>{row.ragione_sociale}</strong></CrmCustomerLink><small>{row.codice_cliente}</small></td><td><strong>{row.cod_alternativo || "—"}</strong></td><td><strong>{row.nome_ricerca_cf || "—"}</strong></td><td><span className={`status-badge crm-area-${row.area_crm}`}>{areaLabel(row.area_crm)}</span></td><td>{formatDateTime(row.classificata_il)}</td><td><CrmCustomerStatusBadge active={row.crm_active !== false} /></td></tr>)}</tbody></table>{loading ? <div className="crm-loading">Caricamento classificazioni...</div> : null}{!loading && !pageRows.length ? <div className="crm-empty">Nessun cliente corrisponde ai filtri.</div> : null}</div>
    <div className="crm-pagination"><button type="button" disabled={page === 0 || loading} onClick={() => setPage((value) => value - 1)}>Precedente</button><span>Pagina {page + 1} · {total} clienti</span><button type="button" disabled={(page + 1) * PAGE_SIZE >= total || loading} onClick={() => setPage((value) => value + 1)}>Successiva</button></div>
  </section>;
}
