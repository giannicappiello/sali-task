import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useParams, useSearchParams } from "react-router-dom";
import { Bot, BriefcaseBusiness, Network, Plus, Search, ShoppingBag, Store } from "lucide-react";
import WorkspaceAccessGuard from "../../components/WorkspaceAccessGuard";
import ModuleContainerLayout from "../../components/ModuleContainerLayout";
import InfoTooltip from "../../components/InfoTooltip";
import { useDatasetTableControls, usePaginatedDataset } from "../../components/useDatasetTableControls";
import { getModuleIcon } from "../../config/moduleIcons";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabaseClient";
import CrmAIBrief from "./CrmAIBrief";
import CrmActivitiesPage from "./CrmActivitiesPage";
import CrmAnalyticsPage from "./CrmAnalyticsPage";
import { CrmB2BLifecyclePanel, CrmBeautyCustomerPanel, CrmBeautyDashboardPanel } from "./CrmBeautyDays";
import CrmOpportunityDetail from "./CrmOpportunityDetail";
import CommercialControlDashboard from "./CommercialControlDashboard";
import CrmCustomerLink from "./CrmCustomerLink";
import { CrmCustomerStatusBadge, CrmCustomerStatusDialog, CrmCustomerStatusFilter } from "./CrmCustomerStatus";
import { setCrmCustomerActive, useCrmCustomerStatus } from "./crmCustomerStatusModel";
import CrmPeriodFilter, { useCrmPeriod } from "./CrmPeriodFilter";
import { CrmPageHeader, CrmSectionNav } from "./CrmWorkspaceUI";
import { DigitalChannel, DigitalDashboard, DigitalHome, DigitalJourney } from "./DigitalCommerce";
import { crmTypeConfig, formatDate, formatMoney } from "./crmConfig";
import { loadAllRpcRows } from "./crmDataset";
import { CRM_ROUTE_ALIASES, CRM_ROUTE_CATALOG, selectAuthorizedCrmModules } from "./crmRouteCatalog";
import "./crm.css";
import "./workspace-alignment.css";

function Screen({ moduleCode, screenCode, children }) {
  return <WorkspaceAccessGuard moduleCode={moduleCode} screenCode={screenCode}>{children}</WorkspaceAccessGuard>;
}

function ErrorBox({ error, retry }) {
  return error ? <div className="crm-message error"><span>{error}</span>{retry ? <button type="button" onClick={retry}>Riprova</button> : null}</div> : null;
}

function CrmExpandableCard({ id, title, preview, children, initiallyOpen = false }) {
  return <details id={id} className="panel crm-panel crm-expandable-card" defaultOpen={initiallyOpen}>
    <summary>
      <span className="crm-expandable-heading"><strong>{title}</strong><span>{preview}</span></span>
      <span className="crm-expandable-action" aria-hidden="true"><span className="when-closed">Apri dettaglio</span><span className="when-open">Chiudi dettaglio</span></span>
    </summary>
    <div className="crm-expandable-content">{children}</div>
  </details>;
}

function CrmOverview() {
  const { hasModuleAccess } = useAuth();
  const [overview, setOverview] = useState({ name: "CRM Platform AI", description: "", icon: "briefcase", items: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data: container, error: containerError } = await supabase
      .from("workspace_moduli")
      .select("codice,nome,descrizione,icona,dipendenze_alternative")
      .eq("codice", "crm")
      .eq("attivo", true)
      .maybeSingle();

    if (containerError || !container) {
      setError(containerError?.message || "Il contenitore CRM non è presente nel catalogo Workspace.");
      setLoading(false);
      return;
    }

    const dependencies = Array.isArray(container.dipendenze_alternative)
      ? container.dipendenze_alternative.filter(Boolean)
      : [];
    let modules = [];
    if (dependencies.length) {
      const { data, error: modulesError } = await supabase
        .from("workspace_moduli")
        .select("codice,nome,descrizione,percorso,icona,attivo")
        .in("codice", dependencies)
        .eq("attivo", true);
      if (modulesError) {
        setError(modulesError.message);
        setLoading(false);
        return;
      }
      modules = data || [];
    }

    setOverview({
      name: container.nome || "CRM Platform AI",
      description: container.descrizione || "Relazioni e decisioni commerciali nel perimetro autorizzato del Workspace.",
      icon: container.icona || "briefcase",
      items: selectAuthorizedCrmModules(dependencies, modules, hasModuleAccess)
        .map((module) => ({
          code: module.codice,
          name: module.nome,
          description: module.descrizione,
          to: module.percorso,
          icon: getModuleIcon(module.icona),
        })),
    });
    setLoading(false);
  }, [hasModuleAccess]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadOverview(), 0);
    window.addEventListener("workspace:module-catalog-changed", loadOverview);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("workspace:module-catalog-changed", loadOverview);
    };
  }, [loadOverview]);

return <ModuleContainerLayout icon={getModuleIcon(overview.icon, BriefcaseBusiness)} eyebrow="Workspace" title={overview.name} description={overview.description} items={overview.items} loading={loading} error={error} onRetry={loadOverview} emptyTitle="Nessuna area CRM disponibile" emptyDescription="L’amministratore può assegnare i moduli CRM dal catalogo Workspace."><CommercialControlDashboard scope="global" embedded /></ModuleContainerLayout>;
}

function CrmDirectOverview() {
  const { hasModuleAccess } = useAuth();
  const items = [
    { code: "crm_b2b", name: "BtoB", description: "Clienti DIRECT con nome_ricerca_cf BtoB.", to: "/crm/b2b", icon: Store },
    { code: "crm_online", name: "BtoC / Online", description: "Clienti DIRECT con nome_ricerca_cf BtoC.", to: "/crm/online", icon: ShoppingBag },
  ].filter((item) => hasModuleAccess(item.code));
  return <ModuleContainerLayout icon={Network} eyebrow="CRM DIRECT" title="Clienti DIRECT" description="I clienti DIRECT sono separati automaticamente nei canali BtoB e BtoC usando il valore Mexal nome_ricerca_cf." items={items} emptyTitle="Nessun canale DIRECT disponibile" emptyDescription="L’amministratore può assegnare i moduli CRM BtoB e Online dal catalogo Workspace."><CommercialControlDashboard scope="direct" embedded /></ModuleContainerLayout>;
}

const CRM_KPI_INFO = {
  "Clienti totali": "Numero di clienti canonici dell’area CRM, indipendentemente dallo stato CRM attivo o non attivo.",
  "Clienti CRM attivi": "Clienti dell’area con stato CRM attivo, quindi inclusi nelle viste operative.",
  "Clienti CRM non attivi": "Clienti dell’area con stato CRM non attivo. Lo storico commerciale resta conservato.",
  "Clienti attivi nel periodo": "Clienti distinti con almeno un ordine o una fattura nel periodo selezionato; non coincide con lo stato CRM.",
  "Nuovi clienti": "Clienti la cui prima vendita documentata ricade nel periodo selezionato.",
  Fatturato: "Somma degli imponibili delle fatture Mexal nel periodo e nel perimetro CRM selezionati.",
  Ordinato: "Somma del valore degli ordini Workspace e Mexal inclusi nel periodo e nel perimetro selezionati.",
  "Valore medio ordine": "Valore totale degli ordini diviso per il numero di ordini del periodo selezionato.",
  "Clienti senza attività nel periodo": "Clienti senza ordini né fatture nel periodo di inattività commerciale; non indica una disattivazione CRM.",
  "Opportunità aperte": "Numero di opportunità CRM non chiuse nel perimetro corrente.",
  "Valore pipeline": "Somma del valore nominale delle opportunità comprese nella pipeline corrente.",
  "Pipeline ponderata": "Somma, per ogni opportunità, del valore moltiplicato per la probabilità di chiusura.",
  "Valore ponderato": "Somma, per ogni opportunità, del valore moltiplicato per la probabilità di chiusura.",
  "Opportunità scadute": "Opportunità aperte con data di chiusura prevista già superata.",
  Scadute: "Opportunità aperte con data di chiusura prevista già superata.",
  "Follow-up scaduti": "Attività di follow-up non completate con scadenza già superata.",
  "Fatturato nel periodo": "Somma delle fatture Mexal del cliente comprese nel periodo selezionato.",
  "Fatturato lifetime": "Somma di tutte le fatture Mexal disponibili per il cliente, senza limite di periodo.",
  "Ordinato nel periodo": "Somma degli ordini Workspace e Mexal del cliente nel periodo selezionato.",
  "Ordinato lifetime": "Somma di tutti gli ordini Workspace e Mexal disponibili per il cliente.",
  "Ultimo documento": "Data più recente tra l’ultima fattura e l’ultimo ordine disponibili per il cliente.",
};

function Kpi({ label, value, note, to }) {
  const info = CRM_KPI_INFO[label] || note || `Indicatore ${label} calcolato sul perimetro e sui filtri correnti.`;
  const content = <><span>{label}<InfoTooltip label={label} text={info} /></span><strong>{value}</strong>{note ? <small>{note}</small> : null}{to ? <em>Apri dettaglio →</em> : null}</>;
  return to ? <Link className="kpi-card crm-kpi" to={to} aria-label={`${label}: ${value}. Apri dettaglio`}>{content}</Link> : <article className="kpi-card crm-kpi">{content}</article>;
}

const ACCOUNT_COLUMNS = [
  { value: (row) => `${row.nome} ${row.source}` },
  { value: (row) => row.codice },
  { value: (row) => row.paese || "—" },
  { value: (row) => row.agente_classificazione || "—" },
  { value: (row) => row.areaLabel },
  { value: (row) => `${row.crm_active ? "Attivo" : "Non attivo"} ${row.crm_status_reason || ""}` },
  { value: (row) => formatDate(row.ultimo_ordine_il) },
  { value: (row) => `${formatMoney(row.invoice_total)} ${row.invoice_count || 0} fatture` },
  { value: (row) => `${formatMoney(row.order_total)} ${row.order_count || 0} ordini` },
  { value: (row) => formatDate(row.prossima_attivita_il) },
  { value: (row) => row.crm_active ? "Apri cliente Nuova attività Nuova opportunità Disattiva" : "Apri cliente Nuova attività Nuova opportunità Riattiva" },
];

function CrmDashboard({ type }) {
  const config = crmTypeConfig(type);
  const period = useCrmPeriod();
  const [data, setData] = useState({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    const [metricsResult, statusResult] = await Promise.all([
      supabase.rpc("crm_dashboard_metrics", { p_crm_type: type, p_from: period.from, p_to: period.to, p_inactivity_days: 90 }),
      supabase.rpc("crm_customer_status_counts", { p_crm_type: type }),
    ]);
    const metricsError = metricsResult.error || statusResult.error;
    if (metricsError) setError(metricsError.message); else setData({ ...(metricsResult.data || {}), crm_status: statusResult.data || {} });
    setLoading(false);
  }, [period.from, period.to, type]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const navigation = type === "conto_terzi"
    ? [["Clienti", `${config.basePath}/clienti`], ["Pipeline", `${config.basePath}/pipeline`], ["Attività", `${config.basePath}/attivita`], ["Brief", `${config.basePath}/brief`], ["Analisi", `${config.basePath}/analisi`]]
    : type === "b2b"
      ? [["Clienti", `${config.basePath}/clienti`], ["Pipeline", `${config.basePath}/pipeline`], ["Attività", `${config.basePath}/attivita`], ["Analisi", `${config.basePath}/analisi`]]
      : [["Clienti", `${config.basePath}/clienti`], ["Campagne", `${config.basePath}/campagne`], ["Creator", `${config.basePath}/creators`], ["Customer Journey", `${config.basePath}/journey`]];
  return <div className="crm-page">
    <CrmPageHeader eyebrow={config.label} title={`Dashboard ${config.label}`} description="KPI reali nel tuo ambito dati. Ordinato Workspace e fatturato Mexal restano metriche distinte." actions={<CrmPeriodFilter period={period} />}>
      <CrmSectionNav items={navigation} period={period} label={`Aree CRM ${config.label}`} />
    </CrmPageHeader>
    <ErrorBox error={error} retry={load} />
    {loading ? <div className="crm-loading">Caricamento KPI...</div> : <div className="crm-kpi-grid">
      <Kpi label="Clienti totali" value={Number(data.crm_status?.total || 0).toLocaleString("it-IT")} note="Stato CRM: tutti" to={period.withPeriod(`${config.basePath}/clienti`, { customerStatus: "all", metric: "all" })} />
      <Kpi label="Clienti CRM attivi" value={Number(data.crm_status?.active || 0).toLocaleString("it-IT")} note="Inclusi nelle viste operative" to={period.withPeriod(`${config.basePath}/clienti`, { customerStatus: "active", metric: "all" })} />
      <Kpi label="Clienti CRM non attivi" value={Number(data.crm_status?.inactive || 0).toLocaleString("it-IT")} note="Storico preservato" to={period.withPeriod(`${config.basePath}/clienti`, { customerStatus: "inactive", metric: "all" })} />
      <Kpi label="Clienti attivi nel periodo" value={Number(data.customers_with_activity || 0).toLocaleString("it-IT")} note="Almeno un ordine o una fattura" to={period.withPeriod(`${config.basePath}/clienti`, { metric: "active" })} />
      <Kpi label="Nuovi clienti" value={Number(data.new_customers || 0).toLocaleString("it-IT")} note="Prima vendita documentata nel periodo" to={period.withPeriod(`${config.basePath}/clienti`, { metric: "new" })} />
      <Kpi label="Fatturato" value={formatMoney(data.invoice_total)} note={`${data.invoice_count || 0} fatture Mexal`} to={period.withPeriod(`${config.basePath}/clienti`, { metric: "invoiced" })} />
      <Kpi label="Ordinato" value={formatMoney(data.order_total)} note={`${data.order_count || 0} ordini Workspace`} to={period.withPeriod(`${config.basePath}/clienti`, { metric: "ordered" })} />
      <Kpi label="Valore medio ordine" value={formatMoney(data.average_order_value)} note="Solo ordini Workspace nel periodo" to={period.withPeriod(`${config.basePath}/clienti`, { metric: "ordered" })} />
      <Kpi label="Clienti senza attività nel periodo" value={Number(data.inactive_customers || 0).toLocaleString("it-IT")} note="Nessun documento negli ultimi 90 giorni; non è lo stato CRM" to={period.withPeriod(`${config.basePath}/clienti`, { metric: "inactive" })} />
      <Kpi label="Opportunità aperte" value={Number(data.open_opportunities || 0).toLocaleString("it-IT")} to={period.withPeriod(`${config.basePath}/pipeline`, { status: "open" })} />
      <Kpi label="Valore pipeline" value={formatMoney(data.pipeline_value)} to={period.withPeriod(`${config.basePath}/pipeline`)} />
      <Kpi label="Pipeline ponderata" value={formatMoney(data.weighted_pipeline)} note="Valore × probabilità" to={period.withPeriod(`${config.basePath}/pipeline`)} />
      <Kpi label="Opportunità scadute" value={Number(data.overdue_opportunities || 0).toLocaleString("it-IT")} to={period.withPeriod(`${config.basePath}/pipeline`, { overdue: "1" })} />
      <Kpi label="Follow-up scaduti" value={Number(data.overdue_followups || 0).toLocaleString("it-IT")} to={period.withPeriod(`${config.basePath}/pipeline`, { followup: "overdue" })} />
    </div>}
    {!loading && !error ? <div className="crm-source-notes"><p><strong>Fatturato:</strong> {data.invoice_source_note}</p><p><strong>Ordinato:</strong> {data.order_source_note}</p></div> : null}
    {type === "b2b" ? <><CrmB2BLifecyclePanel /><CrmBeautyDashboardPanel /></> : null}
  </div>;
}

const EMPTY_ACCOUNT = { nome: "", stato: "prospect", email: "", telefono: "" };
const CRM_CUSTOMER_PAGE_SIZE = 50;

function customerRouteId(kind, value) {
  return encodeURIComponent(`${kind}:${value}`);
}

function parseCustomerRouteId(value) {
  const decoded = decodeURIComponent(value || "");
  if (decoded.startsWith("mexal:")) return { kind: "canonical", value: decoded.slice(6) };
  if (decoded.startsWith("crm:")) return { kind: "prospect", value: decoded.slice(4) };
  return { kind: "prospect", value: decoded };
}

function aggregatePurchasedProducts(lines) {
  const products = new Map();
  for (const line of lines || []) {
    const code = String(line.codice_articolo || "").trim();
    const description = String(line.descrizione || "Articolo senza descrizione").trim();
    const key = code || description;
    const current = products.get(key) || { code, description, quantity: 0, value: 0 };
    current.quantity += Number(line.quantita || 0);
    current.value += Number(line.valore_netto ?? line.valore_lordo ?? 0);
    products.set(key, current);
  }
  return [...products.values()].sort((left, right) => right.value - left.value || left.description.localeCompare(right.description));
}

function AccountsPage({ type }) {
  const config = crmTypeConfig(type);
  const period = useCrmPeriod();
  const [searchParams, setSearchParams] = useSearchParams();
  const metric = period.getParam("metric") || "all";
  const { profile, canUseModule } = useAuth();
  const canWrite = canUseModule(config.moduleCode, "scrittura");
  const [customerStatus, setCustomerStatus] = useCrmCustomerStatus("active");
  const search = searchParams.get("customerSearch") || "";
  const page = Math.max(0, Number(searchParams.get("customerPage") || 0));
  const [rows, setRows] = useState([]); const [canonicalTotal, setCanonicalTotal] = useState(0); const [prospectTotal, setProspectTotal] = useState(0);
  const [form, setForm] = useState(EMPTY_ACCOUNT); const [open, setOpen] = useState(false); const [error, setError] = useState(""); const [loading, setLoading] = useState(true);
  const [statusCustomer, setStatusCustomer] = useState(null); const [statusBusy, setStatusBusy] = useState(false);
  const updateCustomerParam = useCallback((name, value, resetPage = true) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value === null || value === undefined || value === "") next.delete(name); else next.set(name, String(value));
      if (resetPage) next.delete("customerPage");
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  const resetCustomerPage = useCallback(() => updateCustomerParam("customerPage", "", false), [updateCustomerParam]);
  const [tableRef, tableQuery] = useDatasetTableControls({ onQueryChange: resetCustomerPage });
  const { pageRows, total: filteredTotal } = usePaginatedDataset(rows, ACCOUNT_COLUMNS, tableQuery, page, CRM_CUSTOMER_PAGE_SIZE);
  const load = useCallback(async () => {
    setLoading(true);
    const term = search.trim().replaceAll(",", " ");
    const [canonicalResult, prospectResult, countryResult] = await Promise.all([
      loadAllRpcRows("crm_customer_metric_details", {
        p_crm_type: type, p_from: period.from, p_to: period.to, p_metric: metric,
        p_search: term || null, p_customer_status: customerStatus,
      }),
      metric === "all" ? loadAllRpcRows("crm_prospect_customer_details", {
        p_crm_type: type, p_search: term || null, p_customer_status: customerStatus,
      }) : Promise.resolve({ data: [], error: null }),
      supabase.rpc("crm_customer_country_catalog", { p_crm_type: type }),
    ]);
    const loadError = canonicalResult.error || prospectResult.error || countryResult.error;
    if (loadError) { setError(loadError.message); setLoading(false); return; }
    const countries = new Map((countryResult.data || []).map((row) => [row.entity_key, row.country_code]));
    const canonicalRows = (canonicalResult.data || []).map((row) => ({
      ...row, entityKey: `mexal:${row.codice_cliente}`, routeId: customerRouteId("mexal", row.codice_cliente),
      source: "Workspace/Mexal", nome: row.ragione_sociale, codice: row.codice_cliente, areaLabel: config.label,
      paese: countries.get(`mexal:${row.codice_cliente}`) || null,
      crm_active: row.crm_active !== false, opportunities: row.opportunita_count || 0,
    }));
    const prospectRows = (prospectResult.data || []).map((row) => ({
      ...row, entityKey: `crm:${row.id}`, routeId: customerRouteId("crm", row.id), source: "Prospect CRM-only",
      codice: row.email || "—", agente_classificazione: null, origine_classificazione: "crm_only", areaLabel: config.label,
      paese: countries.get(`crm:${row.id}`) || null,
      crm_active: row.crm_active !== false, opportunities: row.opportunita_count || 0,
    }));
    setRows([...canonicalRows, ...prospectRows]);
    setCanonicalTotal(canonicalRows.length);
    setProspectTotal(prospectRows.length);
    setError(""); setLoading(false);
  }, [config.label, customerStatus, metric, period.from, period.to, search, type]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 180); return () => window.clearTimeout(timer); }, [load]);

  async function save(event) {
    event.preventDefault(); if (!canWrite) return;
    const payload = { ...form, tipo: type, nome: form.nome.trim(), responsabile_id: profile.id, reparto_id: profile.reparto_ids?.[0] || profile.reparto_id || null, creato_da: profile.id, codice_cliente_mexal: null, fonte: "crm_only" };
    const { error: saveError } = await supabase.from("crm_accounts").insert(payload); if (saveError) return setError(saveError.message);
    setForm(EMPTY_ACCOUNT); setOpen(false); await load();
  }

  async function changeCustomerStatus({ active, reason }) {
    if (!statusCustomer || !canWrite) return;
    setStatusBusy(true); setError("");
    try {
      await setCrmCustomerActive({ customerKey: statusCustomer.entityKey, crmType: type, active, reason });
      setStatusCustomer(null); await load();
    } catch (statusError) { setError(statusError.message); }
    finally { setStatusBusy(false); }
  }

  const metricLabels = { all: "Tutti i clienti", active: "Attivi nel periodo", new: "Nuovi nel periodo", invoiced: "Con fatture nel periodo", ordered: "Con ordini nel periodo", inactive: "Inattivi da almeno 90 giorni" };
  const navigation = type === "conto_terzi"
    ? [["Clienti", `${config.basePath}/clienti`], ["Pipeline", `${config.basePath}/pipeline`], ["Attività", `${config.basePath}/attivita`], ["Brief", `${config.basePath}/brief`], ["Analisi", `${config.basePath}/analisi`]]
    : type === "b2b"
      ? [["Clienti", `${config.basePath}/clienti`], ["Pipeline", `${config.basePath}/pipeline`], ["Attività", `${config.basePath}/attivita`], ["Analisi", `${config.basePath}/analisi`]]
      : [["Clienti", `${config.basePath}/clienti`], ["Campagne", `${config.basePath}/campagne`], ["Creator", `${config.basePath}/creators`], ["Customer Journey", `${config.basePath}/journey`]];
  return <div className="crm-page">
    <CrmPageHeader eyebrow={config.label} title={`Clienti ${config.label}`} description={`${canonicalTotal} clienti Workspace/Mexal nel dettaglio “${metricLabels[metric] || metric}” · ${prospectTotal} prospect CRM-only.`} actions={<><CrmPeriodFilter period={period} compact />{canWrite ? <button className="primary-action crm-primary" type="button" onClick={() => setOpen(true)}><Plus size={17} />Nuovo prospect</button> : null}</>}>
      <CrmSectionNav items={navigation} period={period} label={`Navigazione ${config.label}`} />
    </CrmPageHeader>
    <div className="crm-filters"><label><Search size={16} /><input value={search} onChange={(event) => updateCustomerParam("customerSearch", event.target.value)} placeholder="Ragione sociale, agente, email o codice" /></label><CrmCustomerStatusFilter value={customerStatus} onChange={(value) => { setCustomerStatus(value); updateCustomerParam("customerPage", "", false); }} id={`customer-status-${type}`} /></div>
    <ErrorBox error={error} retry={load} />
    {loading ? <div className="crm-loading">Caricamento clienti...</div> : null}<div className="crm-table-wrap"><table ref={tableRef} data-column-controls-mode="dataset" className="crm-table crm-customer-table"><thead><tr><th>Cliente</th><th>Codice</th><th>Paese</th><th>Agente</th><th>Area CRM</th><th>Stato CRM</th><th>Ultimo ordine</th><th>Fatturato netto</th><th>Ordinato netto</th><th>Prossima attività</th><th>Azioni</th></tr></thead><tbody>{pageRows.map((row) => <tr key={row.entityKey}><td><CrmCustomerLink crmType={type} customerKey={row.entityKey} name={row.nome} period={period}><strong>{row.nome}</strong></CrmCustomerLink><span className={`crm-source-badge ${row.source === "Workspace/Mexal" ? "canonical" : "prospect"}`}>{row.source}</span></td><td>{row.codice}</td><td>{row.paese || "—"}</td><td>{row.agente_classificazione || "—"}</td><td>{config.label}</td><td><CrmCustomerStatusBadge active={row.crm_active} />{row.crm_status_reason ? <small>{row.crm_status_reason}</small> : null}</td><td>{formatDate(row.ultimo_ordine_il)}</td><td><strong>{formatMoney(row.invoice_total)}</strong><small>{row.invoice_count || 0} fatture</small></td><td><strong>{formatMoney(row.order_total)}</strong><small>{row.order_count || 0} ordini</small></td><td>{formatDate(row.prossima_attivita_il)}</td><td><details className="crm-row-actions"><summary>Azioni</summary><div><CrmCustomerLink crmType={type} customerKey={row.entityKey} name={row.nome} period={period}>Apri cliente</CrmCustomerLink><CrmCustomerLink crmType={type} customerKey={row.entityKey} name={row.nome} period={period}>Nuova attività</CrmCustomerLink><CrmCustomerLink crmType={type} customerKey={row.entityKey} name={row.nome} period={period}>Nuova opportunità</CrmCustomerLink>{canWrite ? <button type="button" className={row.crm_active ? "danger-action" : "secondary-action"} onClick={() => setStatusCustomer(row)}>{row.crm_active ? "Disattiva" : "Riattiva"}</button> : null}</div></details></td></tr>)}</tbody></table>{!loading && !pageRows.length ? <div className="crm-empty">Nessun cliente corrisponde allo stato CRM e ai filtri selezionati.</div> : null}</div>
    <div className="crm-pagination"><button type="button" disabled={page === 0} onClick={() => updateCustomerParam("customerPage", page - 1, false)}>Precedente</button><span>Pagina {page + 1} · {filteredTotal} clienti</span><button type="button" disabled={(page + 1) * CRM_CUSTOMER_PAGE_SIZE >= filteredTotal} onClick={() => updateCustomerParam("customerPage", page + 1, false)}>Successiva</button></div>
    {open ? <div className="crm-modal-backdrop"><form className="crm-modal" onSubmit={save}><h3>Nuovo prospect CRM-only {config.label}</h3><p>Il prospect resta nel layer CRM e non crea né duplica un cliente Workspace/Mexal.</p><label>Nome<input required value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></label><div className="crm-form-grid"><label>Stato<select value={form.stato} onChange={(e) => setForm({ ...form, stato: e.target.value })}><option value="prospect">Prospect</option><option value="attivo">Attivo</option></select></label><label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label><label>Telefono<input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} /></label></div><div className="crm-modal-actions"><button type="button" onClick={() => setOpen(false)}>Annulla</button><button className="primary-action crm-primary">Salva prospect</button></div></form></div> : null}
    <CrmCustomerStatusDialog customer={statusCustomer} busy={statusBusy} onClose={() => setStatusCustomer(null)} onConfirm={(change) => void changeCustomerStatus(change)} />
  </div>;
}

function AccountDetail({ type }) {
  const { id } = useParams(); const config = crmTypeConfig(type); const period = useCrmPeriod(); const { profile, canUseModule } = useAuth();
  const canWrite = canUseModule(config.moduleCode, "scrittura");
  const [account, setAccount] = useState(null); const [metrics, setMetrics] = useState({}); const [related, setRelated] = useState({ contacts: [], opportunities: [], activities: [], briefs: [], orders: [], invoices: [], products: [], consents: [], events: [], externalOrders: [] }); const [error, setError] = useState(""); const [warning, setWarning] = useState("");
  const [commercialSnapshot, setCommercialSnapshot] = useState({}); const [journey, setJourney] = useState([]);
  const [activity, setActivity] = useState({ tipo: "telefonata", titolo: "", data_attivita: "" });
  const [statusDialogOpen, setStatusDialogOpen] = useState(false); const [statusBusy, setStatusBusy] = useState(false);
  const load = useCallback(async () => {
    setError(""); setWarning("");
    const route = parseCustomerRouteId(id);
    let current;
    if (route.kind === "canonical") {
      const canonicalResult = await supabase.from("crm_classified_customers").select("*").eq("codice_cliente", route.value).eq("area_crm", type).maybeSingle();
      if (canonicalResult.error || !canonicalResult.data) return setError(canonicalResult.error?.message || "Cliente canonico non trovato o non autorizzato.");
      const customer = canonicalResult.data;
      const countryResult = await supabase.rpc("crm_customer_country", { p_customer_code: route.value, p_crm_type: type });
      if (countryResult.error) return setError(countryResult.error.message);
      let crmExtension = null;
      if (customer.crm_account_id) {
        const extensionResult = await supabase.from("crm_accounts").select("*").eq("id", customer.crm_account_id).maybeSingle();
        if (!extensionResult.error) crmExtension = extensionResult.data;
      }
      current = { ...crmExtension, entity_kind: "canonical", entityKey: `mexal:${customer.codice_cliente}`, crm_account_id: customer.crm_account_id, nome: customer.ragione_sociale, codice_cliente_mexal: customer.codice_cliente, agente_nome: customer.agente_classificazione, area_crm: customer.area_crm, origine_classificazione: customer.origine_classificazione, modalita_classificazione: customer.modalita, stato: customer.stato_crm, crm_active: customer.crm_active !== false, crm_status_changed_at: customer.crm_status_changed_at, crm_status_reason: customer.crm_status_reason, partita_iva: customer.partita_iva, codice_fiscale: customer.codice_fiscale, indirizzo: customer.indirizzo, cap: customer.cap, citta: customer.localita, provincia: customer.provincia, paese: countryResult.data, telefono: customer.telefono, email: customer.email, valore_cliente: customer.valore_cliente };
    } else {
      const prospectResult = await supabase.from("crm_accounts").select("*").eq("id", route.value).eq("tipo", type).maybeSingle();
      if (prospectResult.error || !prospectResult.data) return setError(prospectResult.error?.message || "Prospect CRM non trovato o non autorizzato.");
      const entityKey = `crm:${prospectResult.data.id}`;
      const statusResult = await supabase.from("crm_customer_status").select("crm_active,changed_at,reason").eq("customer_key", entityKey).maybeSingle();
      if (statusResult.error) return setError(statusResult.error.message);
      current = { ...prospectResult.data, entity_kind: "prospect", entityKey, crm_account_id: prospectResult.data.id, area_crm: type, crm_active: statusResult.data?.crm_active !== false, crm_status_changed_at: statusResult.data?.changed_at || null, crm_status_reason: statusResult.data?.reason || null };
    }
    setAccount(current);
    const crmAccountId = current.crm_account_id;
    const customerCode = current.codice_cliente_mexal;
    const emptyResult = { data: [], error: null };
    if (customerCode) {
      const metricResult = await supabase.rpc("crm_customer_period_metrics", { p_customer_code: customerCode, p_crm_type: type, p_from: period.from, p_to: period.to });
      if (metricResult.error) setWarning(metricResult.error.message); else setMetrics(metricResult.data || {});
    } else setMetrics({});
    const [contactsResult, opportunitiesResult, activitiesResult, briefsResult, ordersResult, invoicesResult, externalOrdersResult, consentsResult, eventsResult] = await Promise.all([
      crmAccountId ? supabase.from("crm_contacts").select("*").eq("account_id", crmAccountId) : emptyResult,
      crmAccountId ? supabase.from("crm_opportunities").select("*,crm_opportunity_stages(nome)").eq("account_id", crmAccountId) : emptyResult,
      crmAccountId ? supabase.from("crm_activities").select("*").eq("account_id", crmAccountId).order("data_attivita", { ascending: false }) : emptyResult,
      crmAccountId ? supabase.from("crm_briefs").select("id,titolo,stato,aggiornato_il").eq("account_id", crmAccountId) : emptyResult,
      customerCode ? supabase.from("ordini_testate").select("id,numero_ordine_visualizzato,data_ordine,stato,totale_documento").eq("codice_cliente", customerCode).gte("data_ordine", period.from).lte("data_ordine", period.to).order("data_ordine", { ascending: false }).limit(50) : emptyResult,
      customerCode ? supabase.from("mexal_fatture_vendita").select("id,sigla,serie,numero,data_documento,totale_documento").eq("codice_cliente", customerCode).gte("data_documento", period.from).lte("data_documento", period.to).order("data_documento", { ascending: false }).limit(50) : emptyResult,
      type === "online" && crmAccountId ? supabase.from("crm_external_orders").select("id,external_id,ordered_at,stato,net_revenue,attribution_method").eq("account_id", crmAccountId).order("ordered_at", { ascending: false }).limit(50) : emptyResult,
      type === "online" && crmAccountId ? supabase.from("crm_marketing_consents").select("id,purpose,status,legal_basis,source,captured_at,withdrawn_at").eq("account_id", crmAccountId).order("captured_at", { ascending: false }).limit(50) : emptyResult,
      type === "online" && crmAccountId ? supabase.from("crm_customer_events").select("id,fase,avvenuto_il,fonte").eq("account_id", crmAccountId).order("avvenuto_il", { ascending: false }).limit(50) : emptyResult,
    ]);
    const failures = [contactsResult, opportunitiesResult, activitiesResult, briefsResult, ordersResult, invoicesResult, externalOrdersResult, consentsResult, eventsResult].filter((result) => result.error).map((result) => result.error.message);
    const invoiceIds = (invoicesResult.data || []).map((invoice) => invoice.id);
    const invoiceLinesResult = invoiceIds.length ? await supabase.from("mexal_fatture_vendita_righe").select("fattura_id,codice_articolo,descrizione,quantita,valore_lordo,valore_netto").in("fattura_id", invoiceIds).limit(1000) : emptyResult;
    if (invoiceLinesResult.error) failures.push(invoiceLinesResult.error.message);
    setWarning([...new Set(failures)].join(" · "));
    setRelated({ contacts: contactsResult.data || [], opportunities: opportunitiesResult.data || [], activities: activitiesResult.data || [], briefs: briefsResult.data || [], orders: ordersResult.data || [], invoices: invoicesResult.data || [], products: aggregatePurchasedProducts(invoiceLinesResult.data || []), consents: consentsResult.data || [], events: eventsResult.data || [], externalOrders: externalOrdersResult.data || [] });
    if (crmAccountId) {
      const [snapshotResult, journeyResult] = await Promise.all([
        supabase.rpc("crm_account_commercial_snapshot", { p_account_id: crmAccountId, p_from: period.from, p_to: period.to }),
        supabase.rpc("crm_account_journey", { p_account_id: crmAccountId }),
      ]);
      if (snapshotResult.error || journeyResult.error) setWarning((currentWarning) => [currentWarning, snapshotResult.error?.message, journeyResult.error?.message].filter(Boolean).join(" · "));
      setCommercialSnapshot(snapshotResult.data || {}); setJourney(journeyResult.data || []);
    } else if (customerCode) {
      const snapshotResult = await supabase.rpc("crm_canonical_commercial_snapshot", { p_customer_code: customerCode, p_crm_type: type, p_from: period.from, p_to: period.to });
      if (snapshotResult.error) setWarning((currentWarning) => [currentWarning, snapshotResult.error.message].filter(Boolean).join(" · "));
      setCommercialSnapshot(snapshotResult.data || {}); setJourney([]);
    } else { setCommercialSnapshot({}); setJourney([]); }
  }, [id, period.from, period.to, type]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  async function addActivity(event) {
    event.preventDefault(); if (!canWrite || !activity.titolo.trim()) return;
    let accountId = account.crm_account_id;
    if (!accountId && account.entity_kind === "canonical") {
      const ensured = await supabase.rpc("crm_ensure_canonical_account", { p_customer_code: account.codice_cliente_mexal, p_crm_type: type });
      if (ensured.error || !ensured.data) return setError(ensured.error?.message || "Impossibile inizializzare il layer CRM del cliente.");
      accountId = ensured.data;
    }
    let reminderId = null;
    if (activity.data_attivita) { const reminder = await supabase.from("agenda_reminder").insert({ utente_id: profile.id, titolo: activity.titolo.trim(), descrizione: `CRM ${config.label}: ${account.nome}`, deadline: activity.data_attivita.slice(0, 10), stato: "Aperto" }).select("id").single(); reminderId = reminder.data?.id || null; }
    const { error: insertError } = await supabase.from("crm_activities").insert({ ...activity, crm_tipo: type, account_id: accountId, responsabile_id: profile.id, reparto_id: account.reparto_id, reminder_id: reminderId, creato_da: profile.id });
    if (insertError) return setError(insertError.message); setActivity({ tipo: "telefonata", titolo: "", data_attivita: "" }); await load();
  }
  async function changeCustomerStatus({ active, reason }) {
    if (!canWrite || !account) return;
    setStatusBusy(true); setError("");
    try {
      await setCrmCustomerActive({ customerKey: account.entityKey, crmType: type, active, reason });
      setStatusDialogOpen(false); await load();
    } catch (statusError) { setError(statusError.message); }
    finally { setStatusBusy(false); }
  }
  if (error) return <ErrorBox error={error} retry={load} />; if (!account) return <div className="crm-loading">Caricamento cliente...</div>;
  return <div className="crm-page">
    <CrmPageHeader eyebrow={config.label} title={account.nome} description={account.codice_cliente_mexal ? `Cliente Workspace/Mexal ${account.codice_cliente_mexal}` : "Prospect CRM-only"} actions={<><Link className="secondary-action crm-secondary" to={period.withPeriod(`${config.basePath}/clienti`)}>Torna ai clienti</Link>{canWrite ? <button type="button" className={account.crm_active ? "danger-action crm-danger" : "secondary-action crm-secondary"} onClick={() => setStatusDialogOpen(true)}>{account.crm_active ? "Disattiva cliente" : "Riattiva cliente"}</button> : null}</>}>
      <div className="crm-account-status-line"><span className={`crm-source-badge ${account.entity_kind}`}>{account.entity_kind === "canonical" ? "Anagrafica canonica" : "CRM-only"}</span><CrmCustomerStatusBadge active={account.crm_active} />{account.crm_status_reason ? <span>{account.crm_status_reason}</span> : null}</div>
    </CrmPageHeader>
    {warning ? <div className="crm-message warning">Alcuni dati collegati non sono disponibili nel perimetro corrente: {warning}</div> : null}
    {account.codice_cliente_mexal ? <div className="crm-kpi-grid crm-customer-metrics">
      <Kpi label="Fatturato nel periodo" value={formatMoney(metrics.invoice_period_total)} note={`${metrics.invoice_period_count || 0} fatture Mexal`} to="#invoices" />
      <Kpi label="Fatturato lifetime" value={formatMoney(metrics.invoice_lifetime_total)} note={`${metrics.invoice_lifetime_count || 0} fatture`} to="#invoices" />
      <Kpi label="Ordinato nel periodo" value={formatMoney(metrics.order_period_total)} note={`${metrics.order_period_count || 0} ordini Workspace/Mexal`} to="#orders" />
      <Kpi label="Ordinato lifetime" value={formatMoney(metrics.order_lifetime_total)} note={`${metrics.order_lifetime_count || 0} ordini Workspace/Mexal`} to="#orders" />
      <Kpi label="Valore medio ordine" value={formatMoney(metrics.average_order_value)} note="Periodo selezionato" to="#orders" />
      <Kpi label="Ultimo documento" value={formatDate(metrics.last_invoice_date || metrics.last_order_date)} to="#invoices" />
    </div> : null}
    <div className="crm-detail-grid crm-expandable-grid">
      <CrmExpandableCard title="Anagrafica" preview={<>{account.codice_cliente_mexal || "Prospect CRM-only"}<br />{account.email || account.telefono || "Contatti non disponibili"}</>}><dl><div><dt>Codice cliente</dt><dd>{account.codice_cliente_mexal || "—"}</dd></div><div><dt>Stato CRM</dt><dd><CrmCustomerStatusBadge active={account.crm_active} /></dd></div><div><dt>Stato relazione</dt><dd>{account.stato || "—"}</dd></div><div><dt>Agente Workspace/Mexal</dt><dd>{account.agente_nome || "—"}</dd></div><div><dt>Area CRM</dt><dd>{config.label}</dd></div><div><dt>Classificazione</dt><dd>{account.origine_classificazione ? `${account.origine_classificazione} · ${account.modalita_classificazione}` : "CRM-only"}</dd></div><div><dt>Partita IVA</dt><dd>{account.partita_iva || "—"}</dd></div><div><dt>Paese / nazionalità</dt><dd>{account.paese || "—"}</dd></div><div><dt>Email</dt><dd>{account.email || "—"}</dd></div><div><dt>Telefono</dt><dd>{account.telefono || "—"}</dd></div><div><dt>Indirizzo</dt><dd>{[account.indirizzo, account.cap, account.citta, account.provincia].filter(Boolean).join(" · ") || "—"}</dd></div><div><dt>Valore CRM</dt><dd>{formatMoney(account.valore_cliente)}</dd></div></dl></CrmExpandableCard>
      <CrmExpandableCard title="AI Summary" preview={<>Sintesi su richiesta.<br />Dati limitati al perimetro autorizzato.</>}><p>La sintesi AI viene generata soltanto su richiesta dall’AI Business Assistant e nel perimetro autorizzato.</p><Link to="/crm/ai" state={{ accountId: account.crm_account_id || null, customerCode: account.codice_cliente_mexal || null, crmType: type }}>Apri AI Brief</Link></CrmExpandableCard>
    </div>
    {(account.crm_account_id || account.codice_cliente_mexal) ? <div className="crm-kpi-grid crm-account-operational-kpis">
      <Kpi label="Opportunità aperte" value={Number(commercialSnapshot.opportunities?.open_count || 0).toLocaleString("it-IT")} note={formatMoney(commercialSnapshot.opportunities?.pipeline_value)} to={period.withPeriod(`${config.basePath}/pipeline`, { status: "open" })} />
      <Kpi label="Valore ponderato" value={formatMoney(commercialSnapshot.opportunities?.weighted_value)} note="Pipeline del cliente" to={period.withPeriod(`${config.basePath}/pipeline`, { status: "open" })} />
      <Kpi label="Follow-up scaduti" value={Number(commercialSnapshot.activities?.overdue_count || 0).toLocaleString("it-IT")} note={commercialSnapshot.activities?.next_at ? `Prossimo ${formatDate(commercialSnapshot.activities.next_at)}` : "Prossimo passo mancante"} />
      {type === "b2b" ? <><Kpi label="Frequenza media ordini" value={commercialSnapshot.orders?.average_days ? `${commercialSnapshot.orders.average_days} gg` : "Non disponibile"} note={`${commercialSnapshot.orders?.lifetime_count || 0} ordini storici`} /><Kpi label="Prossimo riordino atteso" value={formatDate(commercialSnapshot.b2b?.expected_reorder_date)} note={(commercialSnapshot.b2b?.classification || "prospect").replaceAll("_", " ")} /></> : null}
    </div> : null}
    <div className="crm-tabs">
      <CrmExpandableCard title="Timeline e attività" preview={<>{related.activities[0]?.titolo || "Nessuna attività registrata"}<br />{related.activities[1]?.titolo || (type === "conto_terzi" ? "Campioni, formule, preventivi e follow-up" : "Telefonate, visite e follow-up")}</>}>{canWrite ? <form className="crm-inline-form" onSubmit={addActivity}><select aria-label="Tipo attività" value={activity.tipo} onChange={(e) => setActivity({ ...activity, tipo: e.target.value })}>{["telefonata","email","visita","videocall","presentazione","formazione","campionatura","sviluppo_formula","preventivo","follow_up"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select><input required placeholder="Titolo attività" value={activity.titolo} onChange={(e) => setActivity({ ...activity, titolo: e.target.value })} /><input aria-label="Data attività" type="datetime-local" value={activity.data_attivita} onChange={(e) => setActivity({ ...activity, data_attivita: e.target.value })} /><button className="primary-action crm-primary"><Plus size={16} />Aggiungi</button></form> : null}<ul className="crm-timeline">{related.activities.map((item) => <li key={item.id}><strong>{item.titolo}</strong><span>{item.tipo.replaceAll("_", " ")} · {formatDate(item.data_attivita)}</span></li>)}</ul>{!related.activities.length ? <p>Nessuna attività disponibile.</p> : null}</CrmExpandableCard>
      <CrmExpandableCard title="Customer journey" preview={<>{journey[0]?.title || "Nessun evento CRM"}<br />{journey[1]?.title || `${journey.length} eventi unificati`}</>}>{journey.map((item) => <div className="crm-row-card" key={`${item.event_type}-${item.entity_id}-${item.event_at}`}><strong>{item.title}</strong><span>{item.event_type.replaceAll("_", " ")} · {formatDate(item.event_at)} · {item.detail || "—"}</span></div>)}{!journey.length ? <p>Nessun evento disponibile nel perimetro autorizzato.</p> : null}</CrmExpandableCard>
      <CrmExpandableCard title="Opportunità" preview={<>{related.opportunities[0]?.titolo || "Nessuna opportunità"}<br />{related.opportunities[1]?.titolo || `${related.opportunities.length} opportunità collegate`}</>}>{related.opportunities.map((item) => <div className="crm-row-card" key={item.id}><strong>{item.titolo}</strong><span>{item.crm_opportunity_stages?.nome || "Senza fase"} · {formatMoney(item.valore)}</span></div>)}{!related.opportunities.length ? <p>Nessuna opportunità disponibile.</p> : null}</CrmExpandableCard>
      <CrmExpandableCard title="Contatti CRM" preview={<>{related.contacts[0] ? [related.contacts[0].nome, related.contacts[0].cognome].filter(Boolean).join(" ") : "Nessun contatto"}<br />{related.contacts[1] ? [related.contacts[1].nome, related.contacts[1].cognome].filter(Boolean).join(" ") : `${related.contacts.length} contatti collegati`}</>}>{related.contacts.map((item) => <div className="crm-row-card" key={item.id}><strong>{[item.nome, item.cognome].filter(Boolean).join(" ")}</strong><span>{item.ruolo || "Contatto"} · {item.email || item.telefono || "—"}</span></div>)}{!related.contacts.length ? <p>Nessun contatto CRM disponibile.</p> : null}</CrmExpandableCard>
      <CrmExpandableCard title="Brief" preview={<>{related.briefs[0]?.titolo || "Nessun brief"}<br />{related.briefs[1]?.titolo || `${related.briefs.length} brief collegati`}</>}>{related.briefs.map((item) => <div className="crm-row-card" key={item.id}><strong>{item.titolo}</strong><span>{item.stato}</span></div>)}{!related.briefs.length ? <p>Nessun brief disponibile.</p> : null}</CrmExpandableCard>
      {account.codice_cliente_mexal ? <><CrmExpandableCard id="orders" title="Ordini Workspace/Mexal" preview={<>{related.orders[0]?.numero_ordine_visualizzato || "Nessun ordine nel periodo"}<br />{related.orders[1]?.numero_ordine_visualizzato || `${related.orders.length} ordini visibili`}</>}>{related.orders.map((item) => <div className="crm-row-card" key={item.id}><strong>{item.numero_ordine_visualizzato || item.id}</strong><span>{formatDate(item.data_ordine)} · {formatMoney(item.totale_documento)} · {item.stato}</span></div>)}{!related.orders.length ? <p>Nessun ordine disponibile nel perimetro autorizzato.</p> : null}</CrmExpandableCard>
      <CrmExpandableCard id="invoices" title="Fatture Mexal" preview={<>{related.invoices[0] ? `${related.invoices[0].sigla} ${related.invoices[0].serie}/${related.invoices[0].numero}` : "Nessuna fattura nel periodo"}<br />{related.invoices[1] ? `${related.invoices[1].sigla} ${related.invoices[1].serie}/${related.invoices[1].numero}` : `${related.invoices.length} fatture visibili`}</>}>{related.invoices.map((item) => <div className="crm-row-card" key={item.id}><strong>{item.sigla} {item.serie}/{item.numero}</strong><span>{formatDate(item.data_documento)} · {formatMoney(item.totale_documento)}</span></div>)}{!related.invoices.length ? <p>Nessuna fattura disponibile nel perimetro autorizzato.</p> : null}</CrmExpandableCard>
      <CrmExpandableCard title="Prodotti acquistati" preview={<>{related.products[0]?.description || "Nessun prodotto"}<br />{related.products[1]?.description || `${related.products.length} prodotti rilevati`}</>}>{related.products.slice(0, 100).map((item) => <div className="crm-row-card" key={item.code || item.description}><strong>{item.description}</strong><span>{item.code || "Senza codice"} · Q.tà {item.quantity.toLocaleString("it-IT")} · {formatMoney(item.value)}</span></div>)}{!related.products.length ? <p>Nessun prodotto derivabile dalle fatture visibili.</p> : null}</CrmExpandableCard></> : null}
      <CrmExpandableCard title="Note e documenti" preview={<>{account.metadati?.note || "Nessuna nota CRM disponibile."}<br />Documenti nel perimetro autorizzato.</>}><p>{account.metadati?.note || "Nessuna nota CRM disponibile."}</p><p>I documenti restano nella libreria Workspace e vengono mostrati solo quando esiste un collegamento autorizzato.</p></CrmExpandableCard>
    </div>
    {type === "online" ? <><section className="panel crm-panel"><h3>Profilo acquisti ecommerce</h3><dl><div><dt>Ordini</dt><dd>{related.externalOrders.length || "Dato non disponibile"}</dd></div><div><dt>Valore totale</dt><dd>{related.externalOrders.length ? formatMoney(related.externalOrders.reduce((sum, item) => sum + Number(item.net_revenue || 0), 0)) : "Dato non disponibile"}</dd></div><div><dt>AOV</dt><dd>{related.externalOrders.length ? formatMoney(related.externalOrders.reduce((sum, item) => sum + Number(item.net_revenue || 0), 0) / related.externalOrders.length) : "Dato non disponibile"}</dd></div><div><dt>Segmenti</dt><dd>{account.segmenti?.join(", ") || "Dato non disponibile"}</dd></div></dl></section><section className="panel crm-panel"><h3>Ordini ecommerce</h3>{related.externalOrders.map((item) => <div className="crm-row-card" key={item.id}><strong>{item.external_id}</strong><span>{formatDate(item.ordered_at)} · {formatMoney(item.net_revenue)} · {item.attribution_method}</span></div>)}{!related.externalOrders.length ? <p>Dato non sincronizzato: serve il connettore ecommerce reale.</p> : null}</section><section className="panel crm-panel"><h3>Consensi marketing</h3>{related.consents.map((item) => <div className="crm-row-card" key={item.id}><strong>{item.purpose}</strong><span>{item.status} · {item.legal_basis || "base giuridica non disponibile"} · {item.source || "fonte non disponibile"}</span></div>)}{!related.consents.length ? <p>Dato non disponibile.</p> : null}</section><section className="panel crm-panel"><h3>Customer journey</h3>{related.events.map((item) => <div className="crm-row-card" key={item.id}><strong>{item.fase}</strong><span>{formatDate(item.avvenuto_il)} · {item.fonte || "unknown"}</span></div>)}{!related.events.length ? <p>Nessun evento autorizzato disponibile.</p> : null}</section></> : null}
    {type === "b2b" ? <CrmBeautyCustomerPanel customerCode={account.codice_cliente_mexal} /> : null}
    <CrmCustomerStatusDialog customer={statusDialogOpen ? account : null} busy={statusBusy} onClose={() => setStatusDialogOpen(false)} onConfirm={(change) => void changeCustomerStatus(change)} />
  </div>;
}

function Pipeline({ type }) {
  const config = crmTypeConfig(type); const period = useCrmPeriod(); const { profile, canUseModule } = useAuth(); const canWrite = canUseModule(config.moduleCode, "scrittura");
  const [pipelineParams, setPipelineParams] = useSearchParams();
  const [customerStatus, setCustomerStatus] = useCrmCustomerStatus("active");
  const [stages, setStages] = useState([]); const [items, setItems] = useState([]); const [accounts, setAccounts] = useState([]); const [customerStates, setCustomerStates] = useState({}); const [pipelineMetrics, setPipelineMetrics] = useState({}); const [customers, setCustomers] = useState([]); const [error, setError] = useState(""); const [loading, setLoading] = useState(true);
  const view = pipelineParams.get("view") === "list" ? "list" : "kanban";
  const stageFilter = pipelineParams.get("stage") || "";
  const search = pipelineParams.get("search") || "";
  const [customerSearch, setCustomerSearch] = useState("");
  const [form, setForm] = useState({ titolo: "", customer_ref: "", valore: "", probabilita: "20", chiusura_prevista: "" });
  const overdueFilter = period.getParam("overdue") === "1";
  const followupFilter = period.getParam("followup") === "overdue";
  const openFilter = period.getParam("status") === "open";
  const nextStepFilter = pipelineParams.get("nextStep") || "all";
  const updatePipelineParam = useCallback((name, value) => {
    setPipelineParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(name, value); else next.delete(name);
      return next;
    }, { replace: true });
  }, [setPipelineParams]);

  const load = useCallback(async () => {
    setLoading(true);
    const [s, o, a, customerStateResult, metricsResult] = await Promise.all([
      supabase.from("crm_opportunity_stages").select("*").eq("crm_tipo", type).eq("attiva", true).order("ordine"),
      supabase.from("crm_opportunities").select("*,crm_accounts!inner(id,nome,tipo,codice_cliente_mexal),crm_opportunity_stages(nome,finale,vinta),crm_opportunity_stage_history(changed_at),crm_activities(id,titolo,stato,data_attivita)").eq("crm_accounts.tipo", type).order("aggiornato_il", { ascending: false }).limit(1000),
      supabase.from("crm_accounts").select("id,nome,codice_cliente_mexal").eq("tipo", type).order("nome").limit(500),
      supabase.from("crm_customer_status").select("customer_key,crm_active").eq("crm_type", type),
      supabase.rpc("crm_dashboard_metrics", { p_crm_type: type, p_from: period.from, p_to: period.to, p_inactivity_days: 90 }),
    ]);
    const failure = s.error || o.error || a.error || customerStateResult.error || metricsResult.error;
    if (failure) setError(failure.message); else { setStages(s.data || []); setItems(o.data || []); setAccounts(a.data || []); setCustomerStates(Object.fromEntries((customerStateResult.data || []).map((row) => [row.customer_key, row.crm_active]))); setPipelineMetrics(metricsResult.data || {}); setError(""); }
    setLoading(false);
  }, [period.from, period.to, type]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  useEffect(() => {
    const term = customerSearch.trim();
    if (term.length < 2) return undefined;
    const timer = window.setTimeout(async () => {
      const { data, error: customerError } = await supabase.rpc("crm_customer_metric_details", {
        p_crm_type: type, p_from: period.from, p_to: period.to, p_metric: "all",
        p_search: term, p_limit: 50, p_offset: 0, p_customer_status: customerStatus,
      });
      if (customerError) setError(customerError.message); else setCustomers(data || []);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [customerSearch, customerStatus, period.from, period.to, type]);

  async function ensureAccount(customerRef) {
    if (customerRef.startsWith("crm:")) return customerRef.slice(4);
    const customerCode = customerRef.slice(6);
    const existing = accounts.find((item) => item.codice_cliente_mexal === customerCode);
    if (existing) return existing.id;
    const customer = customers.find((item) => item.codice_cliente === customerCode);
    const { data, error: accountError } = await supabase.from("crm_accounts").insert({
      tipo: type, nome: customer?.ragione_sociale || customerCode, codice_cliente_mexal: customerCode,
      stato: "prospect", fonte: "workspace_mexal", responsabile_id: profile.id,
      reparto_id: profile.reparto_ids?.[0] || profile.reparto_id || null, creato_da: profile.id,
    }).select("id").single();
    if (accountError) throw accountError;
    return data.id;
  }

  async function create(event) {
    event.preventDefault(); const first = stages[0]; if (!first || !canWrite) return;
    try {
      const accountId = await ensureAccount(form.customer_ref);
      const { error: createError } = await supabase.from("crm_opportunities").insert({
        titolo: form.titolo.trim(), account_id: accountId, valore: form.valore ? Number(form.valore) : null,
        probabilita: form.probabilita ? Number(form.probabilita) : null, chiusura_prevista: form.chiusura_prevista || null,
        stage_id: first.id, responsabile_id: profile.id, reparto_id: profile.reparto_ids?.[0] || profile.reparto_id || null, creato_da: profile.id,
      });
      if (createError) throw createError;
      setForm({ titolo: "", customer_ref: "", valore: "", probabilita: "20", chiusura_prevista: "" }); await load();
    } catch (createError) { setError(createError.message); }
  }
  async function move(id, stageId) {
    if (!canWrite) return;
    const targetStage = stages.find((stage) => stage.id === stageId);
    if (targetStage?.finale) {
      setError("Le chiusure Vinta/Persa richiedono conferma nella scheda completa dell’opportunità.");
      return;
    }
    const { error: moveError } = await supabase.rpc("crm_transition_opportunity", { p_opportunity_id: id, p_stage_id: stageId });
    if (moveError) setError(moveError.message); else await load();
  }

  const [now] = useState(() => Date.now());
  const customerMatchesStatus = (account) => {
    const customerKey = account?.codice_cliente_mexal ? `mexal:${account.codice_cliente_mexal}` : `crm:${account?.id}`;
    const customerIsActive = customerStates[customerKey] !== false;
    return customerStatus === "all" || (customerStatus === "active" ? customerIsActive : !customerIsActive);
  };
  const statusVisibleItems = items.filter((item) => customerMatchesStatus(item.crm_accounts));
  const visibleItems = statusVisibleItems.filter((item) => {
    const next = nextActivity(item);
    const matchesOpen = !openFilter || !item.crm_opportunity_stages?.finale;
    const matchesOverdue = !overdueFilter || (!item.crm_opportunity_stages?.finale && item.chiusura_prevista && new Date(item.chiusura_prevista).getTime() < now);
    const matchesFollowup = !followupFilter || (next && new Date(next.data_attivita).getTime() < now);
    const nextAt = next?.data_attivita ? new Date(next.data_attivita).getTime() : null;
    const matchesNextStep = nextStepFilter === "all"
      || (nextStepFilter === "missing" && !next)
      || (nextStepFilter === "overdue" && nextAt !== null && nextAt < now)
      || (nextStepFilter === "upcoming" && nextAt !== null && nextAt >= now);
    return (!stageFilter || item.stage_id === stageFilter) && (!search || `${item.titolo} ${item.crm_accounts?.nome}`.toLowerCase().includes(search.toLowerCase())) && matchesOpen && matchesOverdue && matchesFollowup && matchesNextStep;
  });
  function stageAge(item) {
    const changes = item.crm_opportunity_stage_history || [];
    const last = changes.reduce((latest, row) => !latest || row.changed_at > latest ? row.changed_at : latest, null);
    return Math.max(0, Math.floor((now - new Date(last || item.creato_il).getTime()) / 86400000));
  }
  function nextActivity(item) {
    return (item.crm_activities || []).filter((activity) => activity.stato !== "completata" && activity.data_attivita).sort((a, b) => a.data_attivita.localeCompare(b.data_attivita))[0];
  }

  return <div className="crm-page">
    <CrmPageHeader eyebrow={config.label} title={`Pipeline ${config.label}`} description="Snapshot corrente; il periodo resta condiviso per il contesto commerciale e i drill-down." actions={<CrmPeriodFilter period={period} compact />}>
      <CrmSectionNav items={type === "conto_terzi" ? [["Clienti", `${config.basePath}/clienti`], ["Pipeline", `${config.basePath}/pipeline`], ["Attività", `${config.basePath}/attivita`], ["Brief", `${config.basePath}/brief`], ["Analisi", `${config.basePath}/analisi`]] : [["Clienti", `${config.basePath}/clienti`], ["Pipeline", `${config.basePath}/pipeline`], ["Attività", `${config.basePath}/attivita`], ["Analisi", `${config.basePath}/analisi`]]} period={period} label={`Navigazione ${config.label}`} />
    </CrmPageHeader>
    <ErrorBox error={error} retry={load} />
    <div className="crm-kpi-grid">
      <Kpi label="Opportunità aperte" value={Number(pipelineMetrics.open_opportunities || 0).toLocaleString("it-IT")} to={period.withPeriod(`${config.basePath}/pipeline`, { status: "open" })} />
      <Kpi label="Valore pipeline" value={formatMoney(pipelineMetrics.pipeline_value)} to={period.withPeriod(`${config.basePath}/pipeline`, { status: "open" })} />
      <Kpi label="Valore ponderato" value={formatMoney(pipelineMetrics.weighted_pipeline)} note="Valore × probabilità" to={period.withPeriod(`${config.basePath}/pipeline`, { status: "open" })} />
      <Kpi label="Scadute" value={Number(pipelineMetrics.overdue_opportunities || 0).toLocaleString("it-IT")} note="Chiusura prevista superata" to={period.withPeriod(`${config.basePath}/pipeline`, { overdue: "1" })} />
    </div>
    {canWrite ? <form className="crm-card-form crm-opportunity-form" onSubmit={create}>
      <input required placeholder="Titolo opportunità" value={form.titolo} onChange={(event) => setForm({ ...form, titolo: event.target.value })} />
      <input placeholder="Cerca cliente (almeno 2 caratteri)" value={customerSearch} onChange={(event) => { setCustomerSearch(event.target.value); setCustomers([]); setForm({ ...form, customer_ref: "" }); }} />
      <select required value={form.customer_ref} onChange={(event) => setForm({ ...form, customer_ref: event.target.value })}><option value="">Cliente / prospect</option>
        {accounts.filter((account) => !account.codice_cliente_mexal).map((account) => <option key={account.id} value={`crm:${account.id}`}>{account.nome} · CRM-only</option>)}
        {customers.map((customer) => <option key={customer.codice_cliente} value={`mexal:${customer.codice_cliente}`}>{customer.ragione_sociale} · {customer.codice_cliente}</option>)}
      </select>
      <input type="number" min="0" step="0.01" placeholder="Valore" value={form.valore} onChange={(event) => setForm({ ...form, valore: event.target.value })} />
      <input type="number" min="0" max="100" placeholder="Probabilità %" value={form.probabilita} onChange={(event) => setForm({ ...form, probabilita: event.target.value })} />
      <input type="date" aria-label="Chiusura prevista" value={form.chiusura_prevista} onChange={(event) => setForm({ ...form, chiusura_prevista: event.target.value })} />
      <button className="primary-action crm-primary"><Plus size={16} />Crea opportunità</button>
    </form> : null}
    <div className="crm-filters crm-pipeline-filters"><label><Search size={16} /><input placeholder="Cerca opportunità o cliente" value={search} onChange={(event) => updatePipelineParam("search", event.target.value)} /></label><select value={stageFilter} onChange={(event) => updatePipelineParam("stage", event.target.value)}><option value="">Tutte le fasi</option>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.nome}</option>)}</select><select value={pipelineParams.get("nextStep") || "all"} onChange={(event) => updatePipelineParam("nextStep", event.target.value === "all" ? "" : event.target.value)}><option value="all">Tutti i prossimi passi</option><option value="overdue">Prossimo passo scaduto</option><option value="upcoming">Prossimo passo futuro</option><option value="missing">Prossimo passo mancante</option></select><CrmCustomerStatusFilter id={`crm-pipeline-status-${type}`} value={customerStatus} onChange={setCustomerStatus} /><div className="crm-view-toggle"><button type="button" className={view === "kanban" ? "active" : ""} onClick={() => updatePipelineParam("view", "kanban")}>Kanban</button><button type="button" className={view === "list" ? "active" : ""} onClick={() => updatePipelineParam("view", "list")}>Lista</button></div></div>
    {loading ? <div className="crm-loading">Caricamento pipeline...</div> : !visibleItems.length ? <div className="crm-empty"><strong>Nessuna opportunità nel perimetro corrente.</strong><p>Crea la prima opportunità da un cliente Workspace/Mexal o da un prospect CRM-only.</p></div> : view === "kanban" ? <div className="crm-kanban">{stages.filter((stage) => !stageFilter || stage.id === stageFilter).map((stage) => <section key={stage.id} onDragOver={(event) => event.preventDefault()} onDrop={(event) => void move(event.dataTransfer.getData("text/plain"), stage.id)}><header><strong>{stage.nome}</strong><span>{visibleItems.filter((item) => item.stage_id === stage.id).length}</span></header>{visibleItems.filter((item) => item.stage_id === stage.id).map((item) => <article draggable={canWrite} onDragStart={(event) => event.dataTransfer.setData("text/plain", item.id)} key={item.id}><Link className="crm-opportunity-link" to={period.withPeriod(`${config.basePath}/pipeline/${item.id}`)}>{item.titolo}</Link><CrmCustomerLink crmType={type} customerCode={item.crm_accounts?.codice_cliente_mexal} accountId={item.crm_accounts?.id} name={item.crm_accounts?.nome} period={period}>{item.crm_accounts?.nome}</CrmCustomerLink><small>{formatMoney(item.valore)} · {item.probabilita || 0}% · {stageAge(item)} gg nello stato</small>{nextActivity(item) ? <small>Prossima: {formatDate(nextActivity(item).data_attivita)}</small> : <small className="crm-missing-step">Nessuna prossima attività</small>}</article>)}</section>)}</div> : <div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Opportunità</th><th>Cliente</th><th>Fase</th><th>Valore</th><th>Ponderato</th><th>Giorni fase</th><th>Chiusura</th><th>Prossima attività</th></tr></thead><tbody>{visibleItems.map((item) => <tr key={item.id}><td><Link className="crm-table-link" to={period.withPeriod(`${config.basePath}/pipeline/${item.id}`)}>{item.titolo}</Link></td><td><CrmCustomerLink crmType={type} customerCode={item.crm_accounts?.codice_cliente_mexal} accountId={item.crm_accounts?.id} name={item.crm_accounts?.nome} period={period}>{item.crm_accounts?.nome}</CrmCustomerLink></td><td>{item.crm_opportunity_stages?.nome}</td><td>{formatMoney(item.valore)}</td><td>{formatMoney(Number(item.valore || 0) * Number(item.probabilita || 0) / 100)}</td><td>{stageAge(item)}</td><td>{formatDate(item.chiusura_prevista)}</td><td>{nextActivity(item)?.titolo || <span className="crm-missing-step">Mancante</span>}</td></tr>)}</tbody></table></div>}
  </div>;
}

function BriefsPage() {
  const period = useCrmPeriod(); const config = crmTypeConfig("conto_terzi");
  const { profile, canUseModule } = useAuth(); const canWrite = canUseModule("crm_conto_terzi", "scrittura");
  const [rows, setRows] = useState([]); const [accounts, setAccounts] = useState([]); const [opportunities, setOpportunities] = useState([]);
  const emptyBrief = { titolo: "", account_id: "", opportunity_id: "", obiettivo: "", brand: "", categoria: "", tipo_prodotto: "", target: "", posizionamento: "", prezzo_target: "", quantita: "", packaging: "", claim: "", mercati: "", certificazioni: "", tempistiche: "", note: "" };
  const [form, setForm] = useState(emptyBrief); const [error, setError] = useState("");
  const setField = (name, value) => setForm((current) => ({ ...current, [name]: value }));
  const load = useCallback(async () => {
    const [briefResult, accountResult, opportunityResult] = await Promise.all([
      supabase.from("crm_briefs").select("id,titolo,stato,obiettivo,target,categoria,aggiornato_il,crm_accounts(id,nome,tipo,codice_cliente_mexal)").eq("crm_tipo", "conto_terzi").order("aggiornato_il", { ascending: false }),
      supabase.from("crm_accounts").select("id,nome").eq("tipo", "conto_terzi").order("nome"),
      supabase.from("crm_opportunities").select("id,titolo,account_id,crm_accounts!inner(tipo)").eq("crm_accounts.tipo", "conto_terzi").order("aggiornato_il", { ascending: false }).limit(500),
    ]);
    const loadError = briefResult.error || accountResult.error || opportunityResult.error;
    if (loadError) setError(loadError.message); else { setRows(briefResult.data || []); setAccounts(accountResult.data || []); setOpportunities(opportunityResult.data || []); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  async function save(event) {
    event.preventDefault();
    const payload = { ...form, crm_tipo: "conto_terzi", account_id: form.account_id || null, opportunity_id: form.opportunity_id || null, prezzo_target: form.prezzo_target === "" ? null : Number(form.prezzo_target), quantita: form.quantita === "" ? null : Number(form.quantita), mercati: form.mercati.split(",").map((value) => value.trim()).filter(Boolean), certificazioni: form.certificazioni.split(",").map((value) => value.trim()).filter(Boolean), responsabile_id: profile.id, reparto_id: profile.reparto_ids?.[0] || profile.reparto_id || null, creato_da: profile.id };
    const { error: saveError } = await supabase.from("crm_briefs").insert(payload);
    if (saveError) setError(saveError.message); else { setForm(emptyBrief); await load(); }
  }
  const navigation = [["Clienti", `${config.basePath}/clienti`], ["Pipeline", `${config.basePath}/pipeline`], ["Attività", `${config.basePath}/attivita`], ["Analisi", `${config.basePath}/analisi`], ["Brief", `${config.basePath}/brief`]];
  return <div className="crm-page">
    <CrmPageHeader eyebrow="Conto Terzi" title="Brief Cliente" description="Brief strutturati collegabili a cliente, opportunità, progetto e AI Business Assistant." actions={<Link className="primary-action crm-primary" to="/crm/ai"><Bot size={17} />Apri AI Brief</Link>}><CrmSectionNav items={navigation} period={period} label="Navigazione Conto Terzi" /></CrmPageHeader>
    <ErrorBox error={error} />
    {canWrite ? <form className="crm-card-form panel crm-form-grid" onSubmit={save}>
      <input required placeholder="Titolo brief" value={form.titolo} onChange={(event) => setField("titolo", event.target.value)} />
      <select value={form.account_id} onChange={(event) => { setField("account_id", event.target.value); setField("opportunity_id", ""); }}><option value="">Cliente opzionale</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.nome}</option>)}</select>
      <select value={form.opportunity_id} onChange={(event) => setField("opportunity_id", event.target.value)}><option value="">Opportunità opzionale</option>{opportunities.filter((item) => !form.account_id || item.account_id === form.account_id).map((item) => <option key={item.id} value={item.id}>{item.titolo}</option>)}</select>
      {[['obiettivo','Obiettivo'],['brand','Brand'],['categoria','Categoria'],['tipo_prodotto','Tipo prodotto'],['target','Target'],['posizionamento','Posizionamento'],['packaging','Packaging'],['claim','Claim'],['tempistiche','Tempistiche']].map(([name,label]) => <input key={name} placeholder={label} value={form[name]} onChange={(event) => setField(name, event.target.value)} />)}
      <input type="number" min="0" step="0.01" placeholder="Prezzo target" value={form.prezzo_target} onChange={(event) => setField("prezzo_target", event.target.value)} />
      <input type="number" min="0" step="0.001" placeholder="Quantità" value={form.quantita} onChange={(event) => setField("quantita", event.target.value)} />
      <input placeholder="Mercati, separati da virgola" value={form.mercati} onChange={(event) => setField("mercati", event.target.value)} />
      <input placeholder="Certificazioni, separate da virgola" value={form.certificazioni} onChange={(event) => setField("certificazioni", event.target.value)} />
      <textarea placeholder="Note" value={form.note} onChange={(event) => setField("note", event.target.value)} />
      <button className="primary-action crm-primary"><Plus size={16} />Salva brief</button>
    </form> : null}
    <div className="crm-list-grid">{rows.map((row) => <article className="crm-list-card" key={row.id}><span>{row.stato}</span><h3>{row.titolo}</h3>{row.crm_accounts ? <CrmCustomerLink crmType="conto_terzi" customerCode={row.crm_accounts.codice_cliente_mexal} accountId={row.crm_accounts.id} name={row.crm_accounts.nome} period={period}>{row.crm_accounts.nome}</CrmCustomerLink> : <p>{row.obiettivo || "Brief non ancora associato"}</p>}<small>{row.target || row.categoria || "Dati da completare"}</small></article>)}</div>
  </div>;
}

function OnlineManager({ entity }) {
  const period = useCrmPeriod();
  const { profile, canUseModule } = useAuth(); const canWrite = canUseModule("crm_online", "scrittura"); const campaign = entity === "campaigns"; const creator = entity === "creators"; const table = campaign ? "crm_campaigns" : creator ? "crm_creators" : "crm_customer_events";
  const [rows, setRows] = useState([]); const [accounts, setAccounts] = useState([]); const [form, setForm] = useState(campaign ? { nome: "", obiettivo: "", canale: "", budget: "", stato: "bozza" } : creator ? { nome: "", piattaforma: "", profilo: "", nicchia: "", follower: "" } : { account_id: "", fase: "lead", fonte: "", consenso_riferimento: "" }); const [error, setError] = useState("");
  const load = useCallback(async () => {
    const dateColumn = entity === "journey" ? "avvenuto_il" : "creato_il";
    const rowQuery = supabase.from(table).select(entity === "journey" ? "*,crm_accounts(id,nome,tipo,codice_cliente_mexal)" : "*")
      .gte(dateColumn, period.from).lte(dateColumn, period.to + "T23:59:59.999Z")
      .order(dateColumn, { ascending: false }).limit(500);
    const [rowResult, accountResult] = await Promise.all([rowQuery, supabase.from("crm_accounts").select("id,nome").eq("tipo", "online").order("nome")]);
    const loadError = rowResult.error || accountResult.error;
    if (loadError) setError(loadError.message); else { setRows(rowResult.data || []); setAccounts(accountResult.data || []); setError(""); }
  }, [entity, period.from, period.to, table]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  async function save(e) { e.preventDefault(); const payload = campaign ? { ...form, canali: form.canale.split(",").map((value) => value.trim()).filter(Boolean), budget: form.budget ? Number(form.budget) : null, responsabile_id: profile.id, reparto_id: profile.reparto_ids?.[0] || null, creato_da: profile.id } : creator ? { ...form, follower: form.follower ? Number(form.follower) : null, responsabile_id: profile.id, reparto_id: profile.reparto_ids?.[0] || null, creato_da: profile.id } : { ...form, creato_da: profile.id }; const { error: x } = await supabase.from(table).insert(payload); if (x) setError(x.message); else { await load(); } }
  const title = campaign ? "Campaign Manager" : creator ? "Creator Management" : "Customer Journey";
  return <div className="crm-page"><CrmPageHeader eyebrow="CRM Online" title={title} description={campaign ? "Obiettivi, canali, budget e KPI senza inventare fonti dati." : creator ? "Collaborazioni, contenuti, costi e vendite attribuite." : "Eventi minimali e autorizzati; nessun tracking invasivo."} actions={<CrmPeriodFilter period={period} compact />} /><ErrorBox error={error} />{canWrite ? <form className="crm-card-form panel" onSubmit={save}>{campaign ? <><input required placeholder="Nome campagna" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /><input placeholder="Obiettivo" value={form.obiettivo} onChange={(e) => setForm({ ...form, obiettivo: e.target.value })} /><input placeholder="Canale" value={form.canale} onChange={(e) => setForm({ ...form, canale: e.target.value })} /><input type="number" placeholder="Budget" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} /></> : creator ? <><input required placeholder="Nome creator" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /><input placeholder="Piattaforma" value={form.piattaforma} onChange={(e) => setForm({ ...form, piattaforma: e.target.value })} /><input placeholder="Profilo / canale" value={form.profilo} onChange={(e) => setForm({ ...form, profilo: e.target.value })} /><input type="number" placeholder="Follower" value={form.follower} onChange={(e) => setForm({ ...form, follower: e.target.value })} /></> : <><select required value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}><option value="">Cliente online</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}</select><select value={form.fase} onChange={(e) => setForm({ ...form, fase: e.target.value })}>{["lead","visita","interesse","iscrizione","carrello","acquisto","riacquisto","recensione","loyalty"].map((v) => <option key={v}>{v}</option>)}</select><input placeholder="Fonte autorizzata" value={form.fonte} onChange={(e) => setForm({ ...form, fonte: e.target.value })} /><input placeholder="Riferimento consenso" value={form.consenso_riferimento} onChange={(e) => setForm({ ...form, consenso_riferimento: e.target.value })} /></>}<button className="primary-action crm-primary"><Plus size={16} />Aggiungi</button></form> : null}<div className="crm-list-grid">{rows.map((row) => <article className="crm-list-card" key={row.id}><span>{row.stato || row.stato_collaborazione || row.fase}</span><h3>{row.nome || row.fase}</h3>{row.crm_accounts ? <CrmCustomerLink crmType="online" customerCode={row.crm_accounts.codice_cliente_mexal} accountId={row.crm_accounts.id} name={row.crm_accounts.nome} period={period}>{row.crm_accounts.nome}</CrmCustomerLink> : <p>{row.obiettivo || row.piattaforma || row.fonte || "Informazioni da completare"}</p>}<small>{campaign ? formatMoney(row.budget) : creator ? `${row.follower || 0} follower` : formatDate(row.avvenuto_il)}</small></article>)}</div></div>;
}

function renderCrmView(route) {
  switch (route.view) {
    case "overview": return <CrmOverview />;
    case "direct-overview": return <CrmDirectOverview />;
    case "dashboard": return route.type === "conto_terzi" ? <CommercialControlDashboard scope="private" /> : <CrmDashboard type={route.type} />;
    case "accounts": return <AccountsPage type={route.type} />;
    case "account": return <AccountDetail type={route.type} />;
    case "pipeline": return <Pipeline type={route.type} />;
    case "opportunity": return <CrmOpportunityDetail type={route.type} />;
    case "activities": return <CrmActivitiesPage type={route.type} />;
    case "analytics": return <CrmAnalyticsPage type={route.type} />;
    case "briefs": return <BriefsPage />;
    case "online-home": return <DigitalHome />;
    case "digital-dashboard": return <DigitalDashboard />;
    case "digital-channel": return <DigitalChannel channel={route.channel} />;
    case "online-manager": return <OnlineManager entity={route.entity} />;
    case "digital-journey": return <DigitalJourney />;
    case "digital-analytics": return <DigitalDashboard analytics />;
    case "ai": return <CrmAIBrief />;
    default: return null;
  }
}

function catalogRouteElement(route) {
  return <Screen moduleCode={route.moduleCode} screenCode={route.screenCode}>{renderCrmView(route)}</Screen>;
}

export default function CrmModule() {
  return <Routes>
    {CRM_ROUTE_CATALOG.map((route) => route.index
      ? <Route key={route.screenCode} index element={catalogRouteElement(route)} />
      : <Route key={route.screenCode} path={route.path} element={catalogRouteElement(route)} />)}
    {CRM_ROUTE_ALIASES.map((alias) => <Route key={alias.path} path={alias.path} element={<Navigate to={alias.to} replace />} />)}
    <Route path="*" element={<Navigate to="/crm" replace />} />
  </Routes>;
}
