import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BarChart3, Bot, Mail, Megaphone, RefreshCw, ShoppingBag, Store, UsersRound, Workflow } from "lucide-react";
import ModuleContainerLayout from "../../components/ModuleContainerLayout";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabaseClient";
import { DATA_STATUS, DIGITAL_CONNECTIONS, connectionDataStatus, metricValue } from "./digitalConfig";
import { formatDate, formatMoney } from "./crmConfig";
import CrmPeriodFilter, { useCrmPeriod } from "./CrmPeriodFilter";

import "./digital.css";
const CHANNEL_META = Object.freeze({
  ecommerce: { title: "Ecommerce", icon: ShoppingBag, types: ["ecommerce"], moduleCode: "crm_online_ecommerce" },
  mailing: { title: "Mailing", icon: Mail, types: ["mailing"], moduleCode: "crm_online_mailing" },
  amazon: { title: "Amazon", icon: Store, types: ["amazon_seller", "amazon_ads"], moduleCode: "crm_online_amazon" },
  adv: { title: "ADV", icon: Megaphone, types: ["meta_ads", "google_ads"], moduleCode: "crm_online_adv" },
});

function StatusPill({ status }) {
  const definition = DATA_STATUS[status] || DATA_STATUS.not_available;
  return <span className={`crm-data-status ${definition.className}`}>{definition.label}</span>;
}

function DigitalKpi({ label, value, status, note, to }) {
  const content = <><span>{label}</span><strong>{value}</strong><StatusPill status={status} />{note ? <small>{note}</small> : null}{to ? <em>Apri dettaglio →</em> : null}</>;
  return to ? <Link className="crm-kpi" to={to} aria-label={`${label}: ${value}. Apri dettaglio`}>{content}</Link> : <article className="crm-kpi">{content}</article>;
}

export function DigitalHome() {
  const { hasModuleAccess } = useAuth();
  const items = [
    { code: "digital", name: "Panoramica Digital", description: "KPI aggregati e stato delle fonti.", to: "/crm/online/digital", icon: BarChart3, allowed: hasModuleAccess("crm_online") },
    { code: "ecommerce", name: "Ecommerce", description: "Clienti, ordini, prodotti e vendite del sito.", to: "/crm/online/ecommerce", icon: ShoppingBag, allowed: hasModuleAccess("crm_online_ecommerce") },
    { code: "clients", name: "Clienti Online", description: "Anagrafiche, segmenti, consensi e valore cliente.", to: "/crm/online/clienti", icon: UsersRound, allowed: hasModuleAccess("crm_online") },
    { code: "mailing", name: "Mailing", description: "Campagne, automazioni e performance newsletter.", to: "/crm/online/mailing", icon: Mail, allowed: hasModuleAccess("crm_online_mailing") },
    { code: "amazon", name: "Amazon", description: "Seller, Ads e mapping SKU senza scraping.", to: "/crm/online/amazon", icon: Store, allowed: hasModuleAccess("crm_online_amazon") },
    { code: "adv", name: "ADV", description: "Meta Ads e Google Ads.", to: "/crm/online/adv", icon: Megaphone, allowed: hasModuleAccess("crm_online_adv") },
    { code: "creators", name: "Creator / Social", description: "Collaborazioni, contenuti e ROI.", to: "/crm/online/creators", icon: UsersRound, allowed: hasModuleAccess("crm_online") },
    { code: "journey", name: "Customer Journey", description: "Eventi autorizzati e paginati.", to: "/crm/online/journey", icon: Workflow, allowed: hasModuleAccess("crm_online") },
    { code: "analytics", name: "Analisi Digital", description: "Analisi filtrata e provenienza dei dati.", to: "/crm/online/analytics", icon: BarChart3, allowed: hasModuleAccess("crm_online") },
    { code: "ai", name: "AI Digital Assistant", description: "Fatti, dati mancanti e piano con approvazione umana.", to: "/crm/online/ai", icon: Bot, allowed: hasModuleAccess("crm_ai") },
  ].filter((item) => item.allowed);
  return <ModuleContainerLayout icon={ShoppingBag} eyebrow="CRM Online" title="Digital Commerce & Marketing" description="Ecommerce, mailing, Amazon, ADV e creator in un unico perimetro autorizzato." items={items} emptyTitle="Nessuna sezione Digital disponibile" emptyDescription="Assegna i moduli CRM Online dal pannello Moduli." />;
}

export function DigitalDashboard({ analytics = false }) {
  const { hasModuleAccess } = useAuth();
  const period = useCrmPeriod();
  const [channel, setChannel] = useState("");
  const [marketplace, setMarketplace] = useState("");
  const [data, setData] = useState(null);
  const [connections, setConnections] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    const window = { from: period.from, to: period.to };
    const [dashboard, connectionResult] = await Promise.all([
      supabase.rpc("crm_digital_dashboard", { target_from: window.from, target_to: window.to, target_channel: channel || null, target_marketplace: marketplace || null }),
      supabase.from("crm_external_connections").select("id,tipo,nome,provider,stato,abilitata,ultimo_sync_il,ultimo_errore,marketplace_ids"),
    ]);
    const loadError = dashboard.error || connectionResult.error;
    if (loadError) setError(loadError.message); else { setData(dashboard.data); setConnections(connectionResult.data || []); }
    setLoading(false);
  }, [channel, marketplace, period.from, period.to]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const dataStatus = data?.dataStatus || "not_available";
  const availableChannels = DIGITAL_CONNECTIONS.filter((item) => hasModuleAccess(item.moduleCode));
  const marketplaces = [...new Set(connections.flatMap((item) => item.marketplace_ids || []))];
  const drilldown = (path, metric) => period.withPeriod(path, { ...(channel ? { channel } : {}), ...(marketplace ? { marketplace } : {}), metric });
  return <div className="crm-page">
    <div className="crm-toolbar"><div><span className="crm-eyebrow">{analytics ? "Analisi Digital" : "Panoramica Digital"}</span><h2>{analytics ? "Performance multicanale" : "Digital Commerce Dashboard"}</h2><p>I valori assenti restano esplicitamente non disponibili; nessuno zero sostitutivo.</p></div><Link className="secondary-action crm-secondary" to={period.withPeriod("/crm/online")}>Aree Digital</Link></div>
    <div className="crm-digital-filters"><CrmPeriodFilter period={period} compact /><label>Canale<select value={channel} onChange={(event) => setChannel(event.target.value)}><option value="">Tutti gli autorizzati</option>{availableChannels.map((item) => <option key={item.type} value={item.type}>{item.label}</option>)}</select></label><label>Marketplace<select value={marketplace} onChange={(event) => setMarketplace(event.target.value)}><option value="">Tutti</option>{marketplaces.map((item) => <option key={item}>{item}</option>)}</select></label><button type="button" className="secondary-action crm-secondary" onClick={() => void load()}><RefreshCw size={16} />Aggiorna</button></div>
    {error ? <div className="crm-message error">{error}</div> : null}
    {loading ? <div className="crm-loading">Calcolo aggregati server-side...</div> : <div className="crm-kpi-grid">
      <DigitalKpi label="Revenue" value={metricValue(data?.revenue, formatMoney)} status={dataStatus} to={data?.revenue == null ? "" : drilldown("/crm/online/ecommerce", "revenue")} />
      <DigitalKpi label="Ordini" value={metricValue(data?.orders)} status={dataStatus} to={data?.orders == null ? "" : drilldown("/crm/online/ecommerce", "orders")} />
      <DigitalKpi label="Clienti identificati" value={metricValue(data?.customers)} status={dataStatus} note="Solo match autorizzati" to={data?.customers == null ? "" : drilldown("/crm/online/clienti", "identified")} />
      <DigitalKpi label="AOV" value={metricValue(data?.aov, formatMoney)} status={dataStatus} to={data?.aov == null ? "" : drilldown("/crm/online/ecommerce", "aov")} />
      <DigitalKpi label="Marketing spend" value={metricValue(data?.marketingSpend, formatMoney)} status={data?.marketingSpend == null ? "not_available" : "available"} to={data?.marketingSpend == null ? "" : drilldown("/crm/online/adv", "spend")} />
      <DigitalKpi label="ROAS" value={metricValue(data?.roas, (value) => `${Number(value).toFixed(2)}×`)} status={data?.roas == null ? "not_available" : "available"} to={data?.roas == null ? "" : drilldown("/crm/online/adv", "roas")} />
      <DigitalKpi label="LTV" value="Dato non disponibile" status="not_available" note="Richiede storico clienti e ordini del provider reale" />
      <DigitalKpi label="Conversion rate" value="Dato non disponibile" status="not_available" note="Richiede sessioni e checkout autorizzati" />
    </div>}
    <section className="panel crm-panel"><h3>Stato fonti</h3><div className="crm-connection-grid">{availableChannels.map((definition) => { const connection = connections.find((item) => item.tipo === definition.type); return <article key={definition.type}><div><strong>{definition.label}</strong><StatusPill status={connectionDataStatus(connection)} /></div><p>{connection?.provider || definition.sourceNeeded}</p><small>{connection?.ultimo_sync_il ? `Ultimo sync ${new Date(connection.ultimo_sync_il).toLocaleString("it-IT")}` : "Nessuna sincronizzazione disponibile"}</small></article>; })}</div></section>
  </div>;
}

export function DigitalChannel({ channel }) {
  const definition = CHANNEL_META[channel];
  const period = useCrmPeriod();
  const [connections, setConnections] = useState([]);
  const [orders, setOrders] = useState([]);
  const [metrics, setMetrics] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    const connectionResult = await supabase.from("crm_external_connections").select("id,tipo,nome,provider,stato,abilitata,ultimo_sync_il,prossima_run_il,ultimo_errore,marketplace_ids").in("tipo", definition.types);
    if (connectionResult.error) return setError(connectionResult.error.message);
    const ids = (connectionResult.data || []).map((item) => item.id);
    setConnections(connectionResult.data || []);
    if (!ids.length) { setOrders([]); setMetrics([]); setMappings([]); return; }
    const requests = [supabase.from("crm_external_metrics").select("id,metric_date,channel,marketplace,impressions,clicks,spend,revenue,orders,conversions,attribution_method").in("connection_id", ids).gte("metric_date", period.from).lte("metric_date", period.to).order("metric_date", { ascending: false }).range(page * 50, page * 50 + 49)];
    if (["ecommerce", "amazon"].includes(channel)) requests.push(supabase.from("crm_external_orders").select("id,external_id,marketplace,stato,ordered_at,net_revenue,attribution_method").in("connection_id", ids).gte("ordered_at", period.from).lte("ordered_at", period.to + "T23:59:59.999Z").order("ordered_at", { ascending: false }).range(page * 50, page * 50 + 49));
    if (channel === "amazon") requests.push(supabase.from("crm_product_mappings").select("id,marketplace,external_sku,asin,codice_mexal,status,prodotti(nome,codice)").in("connection_id", ids).order("aggiornato_il", { ascending: false }).limit(100));
    const results = await Promise.all(requests); const failure = results.find((item) => item.error)?.error;
    if (failure) setError(failure.message); else { setMetrics(results[0].data || []); setOrders(results[1]?.data || []); setMappings(channel === "amazon" ? results[2]?.data || [] : []); }
  }, [channel, definition.types, page, period.from, period.to]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const Icon = definition.icon;
  const sourceDefinitions = DIGITAL_CONNECTIONS.filter((item) => definition.types.includes(item.type));
  return <div className="crm-page"><div className="crm-toolbar"><div><span className="crm-eyebrow"><Icon size={16} /> CRM Online</span><h2>{definition.title}</h2><p>Layer provider-agnostic: nessuna azione esterna automatica.</p></div><div className="crm-toolbar-actions"><CrmPeriodFilter period={period} compact /><Link className="secondary-action crm-secondary" to="/settings/crm-digital">Configura in Impostazioni</Link></div></div>
    {error ? <div className="crm-message error">{error}</div> : null}
    <div className="crm-connection-grid">{sourceDefinitions.map((source) => { const current = connections.find((item) => item.tipo === source.type); return <article key={source.type}><div><strong>{source.label}</strong><StatusPill status={connectionDataStatus(current)} /></div><p>{current?.provider || "Provider non identificato"}</p><small>{current?.ultimo_errore || source.sourceNeeded}</small></article>; })}</div>
    <section className="panel crm-panel"><h3>Metriche disponibili</h3><div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Data</th><th>Canale</th><th>Marketplace</th><th>Spend</th><th>Revenue</th><th>Ordini</th><th>Attribuzione</th></tr></thead><tbody>{metrics.map((row) => <tr key={row.id}><td>{formatDate(row.metric_date)}</td><td>{row.channel}</td><td>{row.marketplace || "—"}</td><td>{metricValue(row.spend, formatMoney)}</td><td>{metricValue(row.revenue, formatMoney)}</td><td>{metricValue(row.orders)}</td><td>{row.attribution_method}</td></tr>)}</tbody></table>{!metrics.length ? <div className="crm-empty">Dato non sincronizzato: configura il provider reale e avvia una sincronizzazione autorizzata.</div> : null}</div></section>
    {orders.length || ["ecommerce", "amazon"].includes(channel) ? <section className="panel crm-panel"><h3>Ordini</h3><div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Ordine</th><th>Data</th><th>Marketplace</th><th>Stato</th><th>Revenue netta</th><th>Attribuzione</th></tr></thead><tbody>{orders.map((row) => <tr key={row.id}><td>{row.external_id}</td><td>{formatDate(row.ordered_at)}</td><td>{row.marketplace || "Sito"}</td><td>{row.stato || "—"}</td><td>{metricValue(row.net_revenue, formatMoney)}</td><td>{row.attribution_method}</td></tr>)}</tbody></table>{!orders.length ? <div className="crm-empty">Nessun ordine sincronizzato.</div> : null}</div></section> : null}
    {channel === "amazon" ? <section className="panel crm-panel"><h3>Mapping Amazon ↔ Prodotti Workspace/Mexal</h3><div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Marketplace</th><th>SKU</th><th>ASIN</th><th>Prodotto</th><th>Stato</th></tr></thead><tbody>{mappings.map((row) => <tr key={row.id}><td>{row.marketplace || "—"}</td><td>{row.external_sku}</td><td>{row.asin || "—"}</td><td>{row.prodotti?.nome || row.codice_mexal || "Non mappato"}</td><td><StatusPill status={row.status === "matched" ? "available" : row.status === "probable" ? "partial" : "not_available"} /></td></tr>)}</tbody></table>{!mappings.length ? <div className="crm-empty">Nessun mapping disponibile; non viene creato un secondo catalogo prodotti.</div> : null}</div></section> : null}
    <div className="crm-pagination"><button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Precedente</button><span>Pagina {page + 1}</span><button type="button" disabled={metrics.length < 50 && orders.length < 50} onClick={() => setPage((value) => value + 1)}>Successiva</button></div>
  </div>;
}

export function DigitalJourney() {
  const period = useCrmPeriod();
  const [rows, setRows] = useState([]); const [page, setPage] = useState(0); const [phase, setPhase] = useState(""); const [error, setError] = useState("");
  const load = useCallback(async () => { let query = supabase.from("crm_customer_events").select("id,fase,avvenuto_il,fonte,consenso_riferimento,crm_accounts(nome)").gte("avvenuto_il", period.from).lte("avvenuto_il", period.to + "T23:59:59.999Z").order("avvenuto_il", { ascending: false }).range(page * 50, page * 50 + 49); if (phase) query = query.eq("fase", phase); const { data, error: loadError } = await query; if (loadError) setError(loadError.message); else { setRows(data || []); setError(""); } }, [page, period.from, period.to, phase]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const phases = useMemo(() => ["session","product_view","lead","newsletter_signup","email_sent","email_open","email_click","add_to_cart","checkout_started","purchase","repeat_purchase","ad_click","creator_touch","review","return","refund","loyalty"], []);
  return <div className="crm-page"><div className="crm-toolbar"><div><h2>Customer Journey</h2><p>Solo eventi realmente disponibili, minimizzati e filtrati server-side.</p></div><div className="crm-toolbar-actions"><CrmPeriodFilter period={period} compact /><label>Evento<select value={phase} onChange={(event) => { setPhase(event.target.value); setPage(0); }}><option value="">Tutti</option>{phases.map((item) => <option key={item}>{item}</option>)}</select></label></div></div>{error ? <div className="crm-message error">{error}</div> : null}<div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Cliente</th><th>Evento</th><th>Data</th><th>Fonte</th><th>Consenso</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.crm_accounts?.nome || "Identità non collegata"}</td><td>{row.fase}</td><td>{new Date(row.avvenuto_il).toLocaleString("it-IT")}</td><td>{row.fonte || "unknown"}</td><td>{row.consenso_riferimento || "Non richiesto / non disponibile"}</td></tr>)}</tbody></table>{!rows.length ? <div className="crm-empty">Nessun evento autorizzato disponibile.</div> : null}</div><div className="crm-pagination"><button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Precedente</button><span>Pagina {page + 1}</span><button type="button" disabled={rows.length < 50} onClick={() => setPage((value) => value + 1)}>Successiva</button></div></div>;
}
