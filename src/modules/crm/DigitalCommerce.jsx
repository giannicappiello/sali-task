import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Mail, Megaphone, RefreshCw, ShoppingBag, Store } from "lucide-react";
import WorkspaceModuleContainer from "../../pages/Modules/WorkspaceModuleContainer";
import { useDatasetTableControls, usePaginatedDataset, useResetPageCallback } from "../../components/useDatasetTableControls";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabaseClient";
import { DATA_STATUS, DIGITAL_CONNECTIONS, connectionDataStatus, metricValue } from "./digitalConfig";
import { formatDate, formatMoney } from "./crmConfig";
import CrmCustomerLink from "./CrmCustomerLink";
import CrmPeriodFilter, { useCrmPeriod } from "./CrmPeriodFilter";
import { loadAllQueryRows } from "./crmDataset";
import { digitalConnectionsService } from '../integrations/services/digitalConnectionsService';

import MailingOverview from "./MailingOverview";
import { fulfillmentBucket } from "./digitalSalesDayModel.js";
import DigitalSalesDays from "./DigitalSalesDays";
import DigitalChannelKpis from "./DigitalChannelKpis";
import { scopeDigitalChannelSales } from "./digitalChannelKpiModel.js";
import { customerDisplayName } from "./customerIdentity";
import AmazonReconcileDialog from "./AmazonReconcileDialog";
import { reconcileDigitalLines, importedProductsWithMappings } from "./digitalProductReconciliation.js";
import { marketplaceLabel } from "./marketplaceLabel.js";
import "./digital.css";
const CHANNEL_META = Object.freeze({
  ecommerce: { title: "Ecommerce", icon: ShoppingBag, types: ["ecommerce"], moduleCode: "crm_online_ecommerce" },
  mailing: { title: "Mailing", icon: Mail, types: ["mailing"], moduleCode: "crm_online_mailing" },
  amazon: { title: "Amazon", icon: Store, types: ["amazon_seller", "amazon_ads"], moduleCode: "crm_online_amazon" },
  adv: { title: "ADV", icon: Megaphone, types: ["meta_ads", "google_ads"], moduleCode: "crm_online_adv" },
});

const DIGITAL_PAGE_SIZE = 50;
const METRIC_COLUMNS = [
  { value: (row) => formatDate(row.metric_date) },
  { value: (row) => row.channel },
  { value: (row) => marketplaceLabel(row.marketplace) },
  { value: (row) => formatMoney(row.spend) },
  { value: (row) => formatMoney(row.revenue) },
  { value: (row) => row.orders },
  { value: (row) => row.attribution_method },
];
const JOURNEY_COLUMNS = [
  { value: (row) => row.crm_accounts?.nome || "Identità non collegata" },
  { value: (row) => row.fase },
  { value: (row) => new Date(row.avvenuto_il).toLocaleString("it-IT") },
  { value: (row) => row.fonte || "unknown" },
  { value: (row) => row.consenso_riferimento || "Non richiesto / non disponibile" },
];
function StatusPill({ status }) {
  const definition = DATA_STATUS[status] || DATA_STATUS.not_available;
  return <span className={`crm-data-status ${definition.className}`}>{definition.label}</span>;
}

export function DigitalHome() {
  return <WorkspaceModuleContainer configuredModuleCode="crm_online" openInitialScreen />;
}

export { default as DigitalDashboard } from "./DigitalCommercialDashboard";

export function DigitalChannel({ channel }) {
  const definition = CHANNEL_META[channel];
  const period = useCrmPeriod();
  const [connections, setConnections] = useState([]);
  const [orders, setOrders] = useState([]);
  const [lines, setLines] = useState([]);
  const loadVersion = useRef(0);
  const [metrics, setMetrics] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [reconciling,setReconciling] = useState(null);
  const [products, setProducts] = useState([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState('');
  const stopImport = useRef(false);
  const { isAdmin } = useAuth();
  const [metricPage, setMetricPage] = useState(0);
  const [salesLoading, setSalesLoading] = useState(true);
  const [error, setError] = useState("");
  const resetMetricPage = useResetPageCallback(setMetricPage);
  const [metricTableRef, metricQuery] = useDatasetTableControls({ onQueryChange: resetMetricPage });
  const { pageRows: metricRows, total: metricTotal } = usePaginatedDataset(metrics, METRIC_COLUMNS, metricQuery, metricPage, DIGITAL_PAGE_SIZE);
  const load = useCallback(async (isCancelled = () => false) => {
    const version = ++loadVersion.current;
    setSalesLoading(true); setError("");
    const connectionResult = await supabase.from("crm_external_connections").select("id,tipo,nome,provider,provider_code,stato,abilitata,ultimo_sync_il,prossima_run_il,ultimo_errore,marketplace_ids,import_state").in("tipo", definition.types);
    if (version !== loadVersion.current || isCancelled()) return;
    if (connectionResult.error) { setSalesLoading(false); return setError(connectionResult.error.message); }
    const ids = (connectionResult.data || []).map((item) => item.id);
    setConnections(connectionResult.data || []);
    if (!ids.length) { setOrders([]); setLines([]); setMetrics([]); setMappings([]); setProducts([]); setSalesLoading(false); return; }
    const requests = [["ecommerce", "amazon", "mailing"].includes(channel) ? Promise.resolve({ data: [], error: null }) : loadAllQueryRows((from, to) => supabase.from("crm_external_metrics").select("id,metric_date,channel,marketplace,impressions,clicks,spend,revenue,orders,conversions,attribution_method").in("connection_id", ids).gte("metric_date", period.from).lte("metric_date", period.to).order("metric_date", { ascending: false }).range(from, to))];
    if (["ecommerce", "amazon"].includes(channel)) requests.push(loadAllQueryRows((from, to) => supabase.from("crm_external_orders").select("id,connection_id,account_id,external_id,marketplace,stato,ordered_at,fulfilled_at,currency,gross_revenue,net_revenue,attribution_method,raw_summary,cox_status,cox_reference,cox_error,crm_accounts(id,nome,codice_cliente_mexal,metadati)").in("connection_id", ids).gte("ordered_at", period.from).lte("ordered_at", period.to + "T23:59:59.999Z").order("ordered_at", { ascending: false }).order("id").range(from, to)));
    if (["ecommerce", "amazon"].includes(channel)) requests.push(loadAllQueryRows((from, to) => supabase.from("crm_product_mappings").select("id,connection_id,marketplace,external_sku,asin,product_id,codice_mexal,status,prodotti(nome,codice,codice_mexal)").in("connection_id", ids).order("aggiornato_il", { ascending: false }).range(from, to)));
    if (["ecommerce", "amazon"].includes(channel)) requests.push(loadAllQueryRows((from, to) => supabase.from('crm_external_order_lines').select('id,order_id,external_line_id,external_sku,asin,product_id,quantity,unit_price,line_revenue,metadati,crm_external_orders!inner(connection_id,ordered_at)').in('crm_external_orders.connection_id', ids).gte('crm_external_orders.ordered_at', period.from).lte('crm_external_orders.ordered_at', period.to + 'T23:59:59.999Z').order('id').range(from, to)));
    const results = await Promise.all(requests);
    if (version !== loadVersion.current || isCancelled()) return; const failure = results.find((item) => item.error)?.error;
    setSalesLoading(false);
    if (failure) setError(failure.message); else { setMetrics(results[0].data || []); setOrders((results[1]?.data || []).map(row => ({ ...row, customerName: row.crm_accounts ? customerDisplayName(row.crm_accounts) : row.raw_summary?.customer_name }))); setLines(['ecommerce', 'amazon'].includes(channel) ? results.at(-1)?.data || [] : []); setMappings(["ecommerce", "amazon"].includes(channel) ? results[2]?.data || [] : []); }
    if (['ecommerce', 'amazon'].includes(channel)) {
      const imported = await loadAllQueryRows((from, to) => supabase.from('crm_external_products').select('id,connection_id,nome,external_sku,asin,marketplace,price,currency,stock,assets,product_id').in('connection_id', ids).order('nome').order('id').range(from, to));
      if (version !== loadVersion.current || isCancelled()) return;
      if (imported.error) setError(imported.error.message); else setProducts(imported.data || []);
    }
  }, [channel, definition.types, period.from, period.to]);
  useEffect(() => { let active = true; const timer = window.setTimeout(() => void load(() => !active), 0); return () => { active = false; window.clearTimeout(timer); }; }, [load]);
  const sales = useMemo(() => scopeDigitalChannelSales(channel, connections, orders, reconcileDigitalLines(orders,lines,mappings)), [channel, connections, orders, lines, mappings]);
  const fulfilledOrders = useMemo(() => sales.orders.filter(o => fulfillmentBucket(o) === "fulfilled" && (channel !== "amazon" || o.fulfilled_at)), [sales.orders, channel]);
  const waitingOrders = useMemo(() => sales.orders.filter(o => fulfillmentBucket(o) === "waiting"), [sales.orders]);
  const undatedOrders = useMemo(() => channel === "amazon" ? sales.orders.filter(o => fulfillmentBucket(o) === "fulfilled" && !o.fulfilled_at) : [], [sales.orders, channel]);
  const catalogProducts = useMemo(()=>importedProductsWithMappings(products,mappings),[products,mappings]);
  const Icon = definition.icon;
  const sourceDefinitions = DIGITAL_CONNECTIONS.filter((item) => definition.types.includes(item.type));
  async function importData(shipmentDatesOnly = false) {
    setImporting(true); setError(''); stopImport.current = false;
    let importError = '';
    try {
      for (const connection of connections.filter((c) => c.abilitata && ['amazon_sp_api', 'woocommerce', 'mailchimp'].includes(c.provider_code))) {
        if (stopImport.current) break;
        const result = await digitalConnectionsService.syncAll(connection.id, { shipmentDatesOnly, shouldStop: () => stopImport.current, onProgress: (p) => {
          setProgress(p.resource === 'amazon_shipments' ? 'Date evasione Amazon: '+(p.reports || 0)+' report acquisiti. '+(p.recordsRead || 0)+' spedizioni elaborate in questa pagina.' : p.resource === 'amazon_cox' ? `COX Amazon: ${p.cox?.emitted || 0} emessi, ${p.cox?.failed || 0} da verificare in questa pagina.` : p.retryAfterMs ? `Limite temporaneo del provider. Ripresa automatica tra ${Math.ceil(p.retryAfterMs / 1000)} secondi.` : `${connection.nome}: ${p.counts?.orders || 0} ordini, ${p.counts?.products || 0} prodotti, ${p.counts?.customers || 0} clienti elaborati.`);
          if (p.retryAfterMs || p.resource === 'products') void load();
        } });
        setProgress(result.paused ? 'Importazione sospesa. Premi Importa dati per riprendere.' : 'Importazione completata.');
      }
    } catch (e) { importError = `${e.message} La pagina non completata verrà riprovata alla prossima importazione.`; }
    finally { setImporting(false); await load(); if (importError) setError(importError); }
  }
  return <div className="crm-page"><div className="crm-toolbar"><div><span className="crm-eyebrow"><Icon size={16} /> CRM Online</span><h2>{definition.title}</h2><p>Sincronizzazione dati dei canali collegati.</p></div><div className="crm-toolbar-actions"><CrmPeriodFilter period={period} compact /><Link className="secondary-action crm-secondary" to="/settings/crm-digital">Configura in Impostazioni</Link></div></div>
    {error ? <div className="crm-message error">{error}</div> : null}
    {['amazon', 'ecommerce', 'mailing'].includes(channel) ? <section className="panel crm-panel"><h3>Importazione dati</h3><p>{channel === "mailing" ? "Importa contatti, consensi e report degli invii Mailchimp. Le pagine completate sono salvate e l’importazione può essere ripresa." : "Dopo la prima importazione acquisisce solo gli ordini nuovi o modificati dall’ultimo aggiornamento riuscito. Aggiorna anche i prodotti modificati e i materiali disponibili; le pagine completate sono salvate."}</p>{isAdmin() ? <button type="button" className="secondary-action crm-secondary" disabled={importing || !connections.some((c) => c.abilitata && ['amazon_sp_api', 'woocommerce', 'mailchimp'].includes(c.provider_code))} onClick={() => void importData(false)}><RefreshCw size={16} />{importing ? 'Importazione in corso…' : 'Importa dati'}</button> : null}{channel === "amazon" && isAdmin() ? <button type="button" className="secondary-action crm-secondary" disabled={importing} onClick={() => void importData(true)}>Aggiorna date evasione</button> : null}{importing ? <button type="button" onClick={() => { stopImport.current = true; }}>Sospendi dopo questa pagina</button> : null}<p role="status" aria-live="polite">{progress}</p>{channel === 'amazon' ? <small>Primo caricamento: ultimi due anni. Poi solo ordini nuovi o modificati nei marketplace configurati. Clienti, rimborsi, commissioni e Ads dipendono dai permessi disponibili. Gli importi non forniti restano non disponibili.</small> : null}</section> : null}
    <div className="crm-connection-grid">{sourceDefinitions.map((source) => { const current = connections.find((item) => item.tipo === source.type); return <article key={source.type}><div><strong>{source.label}</strong><StatusPill status={connectionDataStatus(current)} /></div><p>{current?.provider || "Provider non identificato"}</p><small>{current?.ultimo_errore || source.sourceNeeded}</small></article>; })}</div>
    {["ecommerce", "amazon"].includes(channel) ? <DigitalChannelKpis key={`kpis:${channel}:${period.from}:${period.to}`} orders={sales.orders} lines={sales.lines} channelLabel={definition.title} period={period} loading={salesLoading} error={error}/> : null}
    {["ecommerce", "amazon"].includes(channel) ? <><DigitalSalesDays title="Ordini evasi" collapsible orders={fulfilledOrders} loading={salesLoading} showCox={channel === "amazon"} /><DigitalSalesDays title="Ordini da evadere" collapsible orders={waitingOrders} loading={salesLoading} includeWaitingInTotals showAvailableWaitingAmounts />{undatedOrders.length ? <details className="panel crm-panel crm-catalog-disclosure"><summary>Evasi in attesa della data Amazon · {undatedOrders.length}</summary><p>Questi ordini sono conservati e restano esclusi dai totali finché Amazon non fornisce la data effettiva di evasione.</p><DigitalSalesDays orders={undatedOrders} title="Data di evasione da verificare" showCox /></details> : null}</> : channel === "mailing" ? <MailingOverview connections={connections} period={period}/> : <section className="panel crm-panel"><h3>Metriche disponibili</h3><div className="crm-table-wrap"><table ref={metricTableRef} data-column-controls-mode="dataset" className="crm-table"><thead><tr><th>Data</th><th>Canale</th><th>Marketplace</th><th>Spend</th><th>Revenue</th><th>Ordini</th><th>Attribuzione</th></tr></thead><tbody>{metricRows.map((row) => <tr key={row.id}><td>{formatDate(row.metric_date)}</td><td>{row.channel}</td><td>{marketplaceLabel(row.marketplace)}</td><td>{metricValue(row.spend, formatMoney)}</td><td>{metricValue(row.revenue, formatMoney)}</td><td>{metricValue(row.orders)}</td><td>{row.attribution_method}</td></tr>)}</tbody></table>{!metricRows.length ? <div className="crm-empty">Dato non sincronizzato: configura il provider reale e avvia una sincronizzazione autorizzata.</div> : null}</div><div className="crm-pagination"><button type="button" disabled={metricPage === 0} onClick={() => setMetricPage((value) => value - 1)}>Precedente</button><span>Pagina {metricPage + 1} · {metricTotal} righe</span><button type="button" disabled={(metricPage + 1) * DIGITAL_PAGE_SIZE >= metricTotal} onClick={() => setMetricPage((value) => value + 1)}>Successiva</button></div></section>}
    {['amazon', 'ecommerce'].includes(channel) ? <details className="panel crm-panel crm-catalog-disclosure"><summary>Prodotti importati · {products.length}</summary><div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Prodotto</th><th>SKU / ASIN</th><th>Marketplace</th><th>Prezzo</th><th>Materiali</th><th>Collegamento catalogo</th><th>Azioni</th></tr></thead><tbody>{catalogProducts.map((p) => <tr key={p.id}><td>{p.nome}</td><td>{p.external_sku || '—'}{p.asin ? ` / ${p.asin}` : ''}</td><td>{marketplaceLabel(p.marketplace)}</td><td>{p.price == null ? 'Dato non disponibile' : p.currency ? new Intl.NumberFormat('it-IT', { style: 'currency', currency: p.currency }).format(p.price) : Number(p.price).toLocaleString('it-IT', { minimumFractionDigits: 2 })}</td><td>{(p.assets || []).map((a, i) => <span key={`${a.url}:${i}`}><a href={a.url} target="_blank" rel="noopener noreferrer">{a.name || (a.type === 'image' ? 'Immagine' : 'Documento')}</a>{' '}</span>)}</td><td>{p.mapping.product_id ? [p.mapping.codice_mexal,p.mapping.prodotti?.nome].filter(Boolean).join(' · ') || 'Collegato' : 'Da verificare'}</td>{<td><button type="button" className="secondary-action" title={!p.external_sku ? 'SKU mancante nella fonte: necessario per la riconciliazione' : undefined} disabled={!isAdmin() || !p.external_sku} onClick={()=>setReconciling(p.mapping)} aria-label={`Riconcilia prodotto importato ${p.external_sku}`}>Riconcilia</button></td>}</tr>)}</tbody></table>{!products.length ? <div className="crm-empty">Nessun prodotto importato. Avvia Importa dati per acquisire il catalogo della fonte.</div> : null}</div></details> : null}
    {channel === "amazon" ? <details className="panel crm-panel crm-catalog-disclosure"><summary>Mapping Amazon ↔ Prodotti Workspace/Mexal</summary><div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Marketplace</th><th>SKU</th><th>ASIN</th><th>Prodotto</th><th>Stato</th><th>Azioni</th></tr></thead><tbody>{mappings.map((row) => <tr key={row.id}><td>{marketplaceLabel(row.marketplace)}</td><td>{row.external_sku}</td><td>{row.asin || "—"}</td><td>{row.prodotti?.nome || row.codice_mexal || "Non mappato"}</td><td><StatusPill status={row.status === "matched" ? "available" : row.status === "probable" ? "partial" : "not_available"} /></td><td><button type="button" className="secondary-action" disabled={!isAdmin()} onClick={()=>setReconciling(row)} aria-label={`Riconcilia SKU ${row.external_sku}`}>Riconcilia</button></td></tr>)}</tbody></table>{!mappings.length ? <div className="crm-empty">Nessun mapping disponibile; non viene creato un secondo catalogo prodotti.</div> : null}</div></details> : null}
    {reconciling ? <AmazonReconcileDialog channelLabel={definition.title} key={reconciling.id || `${reconciling.connection_id}:${reconciling.marketplace}:${reconciling.external_sku}`} mapping={reconciling} onClose={()=>setReconciling(null)} onSaved={async()=>{setReconciling(null);await load();}}/> : null}
  </div>;
}

export function DigitalJourney() {
  const period = useCrmPeriod();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(0, Number(searchParams.get("journeyPage") || 0));
  const phase = searchParams.get("journeyPhase") || "";
  const [rows, setRows] = useState([]); const [error, setError] = useState("");
  const updateJourneyParam = useCallback((name, value, resetPage = true) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value === null || value === undefined || value === "") next.delete(name); else next.set(name, String(value));
      if (resetPage) next.delete("journeyPage");
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  const resetJourneyPage = useCallback(() => updateJourneyParam("journeyPage", "", false), [updateJourneyParam]);
  const [tableRef, tableQuery] = useDatasetTableControls({ onQueryChange: resetJourneyPage });
  const { pageRows, total } = usePaginatedDataset(rows, JOURNEY_COLUMNS, tableQuery, page, DIGITAL_PAGE_SIZE);
  const load = useCallback(async () => {
    const result = await loadAllQueryRows((from, to) => {
      let query = supabase.from("crm_customer_events").select("id,fase,avvenuto_il,fonte,consenso_riferimento,crm_accounts(id,nome,codice_cliente_mexal)").gte("avvenuto_il", period.from).lte("avvenuto_il", period.to + "T23:59:59.999Z").order("avvenuto_il", { ascending: false }).range(from, to);
      if (phase) query = query.eq("fase", phase);
      return query;
    });
    if (result.error) setError(result.error.message); else { setRows(result.data || []); setError(""); }
  }, [period.from, period.to, phase]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const phases = useMemo(() => ["session","product_view","lead","newsletter_signup","email_sent","email_open","email_click","add_to_cart","checkout_started","purchase","repeat_purchase","ad_click","creator_touch","review","return","refund","loyalty"], []);
  return <div className="crm-page"><div className="crm-toolbar"><div><h2>Customer Journey</h2><p>Solo eventi realmente disponibili, minimizzati e filtrati server-side.</p></div><div className="crm-toolbar-actions"><CrmPeriodFilter period={period} compact /><label>Evento<select value={phase} onChange={(event) => updateJourneyParam("journeyPhase", event.target.value)}><option value="">Tutti</option>{phases.map((item) => <option key={item}>{item}</option>)}</select></label></div></div>{error ? <div className="crm-message error">{error}</div> : null}<div className="crm-table-wrap"><table ref={tableRef} data-column-controls-mode="dataset" className="crm-table"><thead><tr><th>Cliente</th><th>Evento</th><th>Data</th><th>Fonte</th><th>Consenso</th></tr></thead><tbody>{pageRows.map((row) => <tr key={row.id}><td>{row.crm_accounts ? <CrmCustomerLink crmType="online" customerCode={row.crm_accounts.codice_cliente_mexal} accountId={row.crm_accounts.id} name={row.crm_accounts.nome} period={period}>{row.crm_accounts.nome}</CrmCustomerLink> : "Identità non collegata"}</td><td>{row.fase}</td><td>{new Date(row.avvenuto_il).toLocaleString("it-IT")}</td><td>{row.fonte || "unknown"}</td><td>{row.consenso_riferimento || "Non richiesto / non disponibile"}</td></tr>)}</tbody></table>{!pageRows.length ? <div className="crm-empty">Nessun evento autorizzato disponibile.</div> : null}</div><div className="crm-pagination"><button type="button" disabled={page === 0} onClick={() => updateJourneyParam("journeyPage", page - 1, false)}>Precedente</button><span>Pagina {page + 1} · {total} eventi</span><button type="button" disabled={(page + 1) * DIGITAL_PAGE_SIZE >= total} onClick={() => updateJourneyParam("journeyPage", page + 1, false)}>Successiva</button></div></div>;
}
