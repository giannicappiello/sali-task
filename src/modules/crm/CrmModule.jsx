import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useParams } from "react-router-dom";
import { Bot, BriefcaseBusiness, Plus, Search } from "lucide-react";
import WorkspaceAccessGuard from "../../components/WorkspaceAccessGuard";
import ModuleContainerLayout from "../../components/ModuleContainerLayout";
import { getModuleIcon } from "../../config/moduleIcons";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabaseClient";
import CrmAIBrief from "./CrmAIBrief";
import CustomerClassificationPanel from "./CustomerClassificationPanel";
import { DigitalChannel, DigitalDashboard, DigitalHome, DigitalJourney } from "./DigitalCommerce";
import { crmTypeConfig, formatDate, formatMoney } from "./crmConfig";
import { CRM_ROUTE_ALIASES, CRM_ROUTE_CATALOG, selectAuthorizedCrmModules } from "./crmRouteCatalog";
import "./crm.css";
import "./workspace-alignment.css";

function Screen({ moduleCode, screenCode, children }) {
  return <WorkspaceAccessGuard moduleCode={moduleCode} screenCode={screenCode}>{children}</WorkspaceAccessGuard>;
}

function ErrorBox({ error, retry }) {
  return error ? <div className="crm-message error"><span>{error}</span>{retry ? <button type="button" onClick={retry}>Riprova</button> : null}</div> : null;
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

return <ModuleContainerLayout icon={getModuleIcon(overview.icon, BriefcaseBusiness)} eyebrow="Workspace" title={overview.name} description={overview.description} items={overview.items} loading={loading} error={error} onRetry={loadOverview} emptyTitle="Nessuna area CRM disponibile" emptyDescription="L’amministratore può assegnare i moduli CRM dal catalogo Workspace."><CustomerClassificationPanel /></ModuleContainerLayout>;
}

function Kpi({ label, value, note }) {
  return <article className="kpi-card crm-kpi"><span>{label}</span><strong>{value}</strong>{note ? <small>{note}</small> : null}</article>;
}

function CrmDashboard({ type }) {
  const config = crmTypeConfig(type);
  const [data, setData] = useState({ accounts: [], opportunities: [], activities: [], briefs: [], campaigns: [], creators: [] });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState("90");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    const since = new Date(Date.now() - Number(days) * 86400000).toISOString();
    const queries = [
      supabase.from("crm_accounts").select("id,stato,valore_cliente,creato_il,prossima_attivita_il").eq("tipo", type).gte("creato_il", since),
      supabase.from("crm_opportunities").select("id,valore,stage_id,chiusura_prevista,crm_opportunity_stages(finale,vinta),crm_accounts!inner(tipo)").eq("crm_accounts.tipo", type),
      supabase.from("crm_activities").select("id,stato,data_attivita").eq("crm_tipo", type),
      supabase.from("crm_briefs").select("id,stato").eq("crm_tipo", type),
    ];
    if (type === "online") queries.push(supabase.from("crm_campaigns").select("id,stato,budget,data_fine"), supabase.from("crm_creators").select("id,costi,vendite_attribuite"));
    const results = await Promise.all(queries);
    const failure = results.find((result) => result.error)?.error;
    if (failure) setError(failure.message);
    else setData({ accounts: results[0].data || [], opportunities: results[1].data || [], activities: results[2].data || [], briefs: results[3].data || [], campaigns: results[4]?.data || [], creators: results[5]?.data || [] });
    setLoading(false);
  }, [days, type]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const [now] = useState(() => Date.now());
  const openOpportunities = data.opportunities.filter((item) => !item.crm_opportunity_stages?.finale);
  const pipelineValue = openOpportunities.reduce((sum, item) => sum + Number(item.valore || 0), 0);
  const overdue = data.activities.filter((item) => item.stato !== "completata" && item.data_attivita && new Date(item.data_attivita).getTime() < now).length;
  const activeCampaigns = data.campaigns.filter((item) => item.stato === "attiva").length;
  const navigation = type === "conto_terzi"
    ? [["Clienti", `${config.basePath}/clienti`], ["Pipeline", `${config.basePath}/pipeline`], ["Brief", `${config.basePath}/brief`]]
    : type === "b2b"
      ? [["Clienti", `${config.basePath}/clienti`], ["Pipeline", `${config.basePath}/pipeline`]]
      : [["Clienti", `${config.basePath}/clienti`], ["Campagne", `${config.basePath}/campagne`], ["Creator", `${config.basePath}/creators`], ["Customer Journey", `${config.basePath}/journey`]];
  return <div className="crm-page">
    <div className="crm-toolbar"><div><h2>Dashboard {config.label}</h2><p>I valori riflettono soltanto i record compresi nel tuo ambito dati.</p></div><label>Intervallo<select value={days} onChange={(event) => setDays(event.target.value)}><option value="30">30 giorni</option><option value="90">90 giorni</option><option value="365">12 mesi</option></select></label></div>
    <nav className="crm-quick-nav" aria-label={`Aree CRM ${config.label}`}>{navigation.map(([label, to]) => <Link key={to} to={to}>{label}</Link>)}</nav>
    <ErrorBox error={error} retry={load} />
    {loading ? <div className="crm-loading">Caricamento KPI...</div> : <div className="crm-kpi-grid">
      <Kpi label={type === "online" ? "Clienti ecommerce" : "Clienti attivi"} value={data.accounts.filter((item) => item.stato === "attivo" || item.stato === "cliente_attivo").length} />
      <Kpi label="Nuovi clienti / prospect" value={data.accounts.length} note={`Ultimi ${days} giorni`} />
      <Kpi label="Opportunità aperte" value={openOpportunities.length} />
      <Kpi label="Valore pipeline" value={formatMoney(pipelineValue)} />
      <Kpi label="Brief aperti" value={data.briefs.filter((item) => !["archiviato", "trasformato_in_progetto"].includes(item.stato)).length} />
      <Kpi label="Follow-up scaduti" value={overdue} />
      {type === "online" ? <><Kpi label="Campagne attive" value={activeCampaigns} /><Kpi label="ROAS" value="Dato non disponibile" note="Richiede connettore ADV autorizzato" /><Kpi label="CAC / LTV" value="Dato non disponibile" note="Richiede costi marketing ed ecommerce" /></> : null}
      {type === "b2b" ? <><Kpi label="Fatturato" value="Dato da Mexal" note="Disponibile nelle schede collegate" /><Kpi label="Clienti senza riordino" value="Dato non disponibile" note="Richiede soglia temporale configurata" /></> : null}
    </div>}
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
  const { profile, canUseModule } = useAuth();
  const canWrite = canUseModule(config.moduleCode, "scrittura");
  const [rows, setRows] = useState([]); const [search, setSearch] = useState(""); const [status, setStatus] = useState(""); const [page, setPage] = useState(0); const [canonicalTotal, setCanonicalTotal] = useState(0); const [prospectTotal, setProspectTotal] = useState(0);
  const [form, setForm] = useState(EMPTY_ACCOUNT); const [open, setOpen] = useState(false); const [error, setError] = useState("");
  const load = useCallback(async () => {
    const term = search.trim().replaceAll(",", " ");
    let canonicalQuery = supabase
      .from("crm_classified_customers")
      .select("codice_cliente,ragione_sociale,agente_classificazione,area_crm,origine_classificazione,modalita,attivo_mexal,stato_crm,valore_cliente,ultima_attivita_il,prossima_attivita_il,opportunita_count,ultimo_ordine_il,fatturato")
      .eq("area_crm", type)
      .order("ragione_sociale")
      .range(page * CRM_CUSTOMER_PAGE_SIZE, page * CRM_CUSTOMER_PAGE_SIZE + CRM_CUSTOMER_PAGE_SIZE - 1);
    let prospectQuery = supabase
      .from("crm_accounts")
      .select("id,nome,stato,stato_relazione,valore_cliente,email,telefono,ultima_attivita_il,prossima_attivita_il,crm_opportunities(count)", { count: "exact" })
      .eq("tipo", type)
      .is("codice_cliente_mexal", null)
      .order("aggiornato_il", { ascending: false })
      .limit(CRM_CUSTOMER_PAGE_SIZE);
    if (term) {
      canonicalQuery = canonicalQuery.or(`ragione_sociale.ilike.%${term}%,codice_cliente.ilike.%${term}%,agente_classificazione.ilike.%${term}%`);
      prospectQuery = prospectQuery.or(`nome.ilike.%${term}%,email.ilike.%${term}%`);
    }
    if (status) prospectQuery = prospectQuery.eq("stato", status);
    const canonicalCountQuery = supabase.from("crm_customer_classifications")
      .select("codice_cliente", { count: "exact", head: true })
      .eq("area_crm", type);
    const [canonicalResult, canonicalCountResult, prospectResult] = await Promise.all([canonicalQuery, canonicalCountQuery, prospectQuery]);
    const loadError = canonicalResult.error || canonicalCountResult.error || prospectResult.error;
    if (loadError) return setError(loadError.message);
    const canonicalRows = (canonicalResult.data || []).map((row) => ({
      ...row,
      entityKey: `mexal:${row.codice_cliente}`,
      routeId: customerRouteId("mexal", row.codice_cliente),
      source: "Workspace/Mexal",
      nome: row.ragione_sociale,
      codice: row.codice_cliente,
      stato: row.stato_crm || (row.attivo_mexal ? "attivo" : "inattivo"),
      opportunities: row.opportunita_count || 0,
    }));
    const prospectRows = (prospectResult.data || []).map((row) => ({
      ...row,
      entityKey: `crm:${row.id}`,
      routeId: customerRouteId("crm", row.id),
      source: "Prospect CRM-only",
      codice: row.email || "—",
      agente_classificazione: null,
      area_crm: type,
      origine_classificazione: "crm_only",
      opportunities: row.crm_opportunities?.[0]?.count || 0,
    }));
    setRows([...canonicalRows, ...(page === 0 ? prospectRows : [])].filter((row) => !status || row.stato === status));
    setCanonicalTotal(canonicalCountResult.count || 0);
    setProspectTotal(prospectResult.count || 0);
    setError("");
  }, [page, search, status, type]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 180); return () => window.clearTimeout(timer); }, [load]);
  async function save(event) {
    event.preventDefault(); if (!canWrite) return;
    const payload = { ...form, tipo: type, nome: form.nome.trim(), responsabile_id: profile.id, reparto_id: profile.reparto_ids?.[0] || profile.reparto_id || null, creato_da: profile.id, codice_cliente_mexal: null, fonte: "crm_only" };
    const { error: saveError } = await supabase.from("crm_accounts").insert(payload); if (saveError) return setError(saveError.message);
    setForm(EMPTY_ACCOUNT); setOpen(false); await load();
  }
  return <div className="crm-page"><div className="crm-toolbar"><div><h2>Clienti {config.label}</h2><p>{canonicalTotal} clienti Workspace/Mexal · {prospectTotal} prospect CRM-only nel perimetro autorizzato.</p></div>{canWrite ? <button className="primary-action crm-primary" type="button" onClick={() => setOpen(true)}><Plus size={17} />Nuovo prospect</button> : null}</div>
    <div className="crm-filters"><label><Search size={16} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Ragione sociale, agente, email o codice" /></label><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); }}><option value="">Tutti gli stati</option><option value="prospect">Prospect</option><option value="attivo">Attivo</option><option value="inattivo">Inattivo</option></select></div>
    <ErrorBox error={error} retry={load} />
    <div className="crm-table-wrap"><table className="crm-table crm-customer-table"><thead><tr><th>Cliente</th><th>Agente</th><th>Area / origine</th><th>Stato CRM</th><th>Ultimo ordine</th>{type === "b2b" ? <th>Fatturato</th> : null}<th>Ultima attività</th><th>Prossima attività</th><th>Opportunità</th></tr></thead><tbody>{rows.map((row) => <tr key={row.entityKey}><td><Link to={`${config.basePath}/clienti/${row.routeId}`}><strong>{row.nome}</strong><small>{row.codice}</small></Link><span className={`crm-source-badge ${row.source === "Workspace/Mexal" ? "canonical" : "prospect"}`}>{row.source}</span></td><td>{row.agente_classificazione || "—"}</td><td><strong>{config.label}</strong><small>{row.origine_classificazione}</small></td><td><span className="crm-status">{row.stato}</span></td><td>{formatDate(row.ultimo_ordine_il)}</td>{type === "b2b" ? <td>{formatMoney(row.fatturato)}</td> : null}<td>{formatDate(row.ultima_attivita_il)}</td><td>{formatDate(row.prossima_attivita_il)}</td><td>{row.opportunities}</td></tr>)}</tbody></table>{!rows.length ? <div className="crm-empty">Nessun cliente canonico o prospect CRM-only visibile con i filtri correnti.</div> : null}</div>
    <div className="crm-pagination"><button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Precedente</button><span>Pagina {page + 1} · {canonicalTotal} clienti canonici</span><button type="button" disabled={(page + 1) * CRM_CUSTOMER_PAGE_SIZE >= canonicalTotal} onClick={() => setPage((value) => value + 1)}>Successiva</button></div>
    {open ? <div className="crm-modal-backdrop"><form className="crm-modal" onSubmit={save}><h3>Nuovo prospect CRM-only {config.label}</h3><p>Il prospect resta nel layer CRM e non crea né duplica un cliente Workspace/Mexal.</p><label>Nome<input required value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></label><div className="crm-form-grid"><label>Stato<select value={form.stato} onChange={(e) => setForm({ ...form, stato: e.target.value })}><option value="prospect">Prospect</option><option value="attivo">Attivo</option></select></label><label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label><label>Telefono<input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} /></label></div><div className="crm-modal-actions"><button type="button" onClick={() => setOpen(false)}>Annulla</button><button className="primary-action crm-primary">Salva prospect</button></div></form></div> : null}
  </div>;
}

function AccountDetail({ type }) {
  const { id } = useParams(); const config = crmTypeConfig(type); const { profile, canUseModule } = useAuth();
  const canWrite = canUseModule(config.moduleCode, "scrittura");
  const [account, setAccount] = useState(null); const [related, setRelated] = useState({ contacts: [], opportunities: [], activities: [], briefs: [], orders: [], invoices: [], products: [], consents: [], events: [], externalOrders: [] }); const [error, setError] = useState(""); const [warning, setWarning] = useState("");
  const [activity, setActivity] = useState({ tipo: "telefonata", titolo: "", data_attivita: "" });
  const load = useCallback(async () => {
    setError(""); setWarning("");
    const route = parseCustomerRouteId(id);
    let current;
    if (route.kind === "canonical") {
      const canonicalResult = await supabase.from("crm_classified_customers").select("*").eq("codice_cliente", route.value).eq("area_crm", type).maybeSingle();
      if (canonicalResult.error || !canonicalResult.data) return setError(canonicalResult.error?.message || "Cliente canonico non trovato o non autorizzato.");
      const customer = canonicalResult.data;
      let crmExtension = null;
      if (customer.crm_account_id) {
        const extensionResult = await supabase.from("crm_accounts").select("*").eq("id", customer.crm_account_id).maybeSingle();
        if (!extensionResult.error) crmExtension = extensionResult.data;
      }
      current = { ...crmExtension, entity_kind: "canonical", crm_account_id: customer.crm_account_id, nome: customer.ragione_sociale, codice_cliente_mexal: customer.codice_cliente, agente_nome: customer.agente_classificazione, area_crm: customer.area_crm, origine_classificazione: customer.origine_classificazione, modalita_classificazione: customer.modalita, stato: customer.stato_crm || (customer.attivo_mexal ? "attivo" : "inattivo"), partita_iva: customer.partita_iva, codice_fiscale: customer.codice_fiscale, indirizzo: customer.indirizzo, cap: customer.cap, citta: customer.localita, provincia: customer.provincia, telefono: customer.telefono, email: customer.email, valore_cliente: customer.valore_cliente };
    } else {
      const prospectResult = await supabase.from("crm_accounts").select("*").eq("id", route.value).eq("tipo", type).maybeSingle();
      if (prospectResult.error || !prospectResult.data) return setError(prospectResult.error?.message || "Prospect CRM non trovato o non autorizzato.");
      current = { ...prospectResult.data, entity_kind: "prospect", crm_account_id: prospectResult.data.id, area_crm: type };
    }
    setAccount(current);
    const crmAccountId = current.crm_account_id;
    const customerCode = current.codice_cliente_mexal;
    const emptyResult = { data: [], error: null };
    const [contactsResult, opportunitiesResult, activitiesResult, briefsResult, ordersResult, invoicesResult, externalOrdersResult, consentsResult, eventsResult] = await Promise.all([
      crmAccountId ? supabase.from("crm_contacts").select("*").eq("account_id", crmAccountId) : emptyResult,
      crmAccountId ? supabase.from("crm_opportunities").select("*,crm_opportunity_stages(nome)").eq("account_id", crmAccountId) : emptyResult,
      crmAccountId ? supabase.from("crm_activities").select("*").eq("account_id", crmAccountId).order("data_attivita", { ascending: false }) : emptyResult,
      crmAccountId ? supabase.from("crm_briefs").select("id,titolo,stato,aggiornato_il").eq("account_id", crmAccountId) : emptyResult,
      customerCode ? supabase.from("ordini_testate").select("id,numero_ordine_visualizzato,data_ordine,stato,totale_documento").eq("codice_cliente", customerCode).order("data_ordine", { ascending: false }).limit(50) : emptyResult,
      customerCode ? supabase.from("mexal_fatture_vendita").select("id,sigla,serie,numero,data_documento,totale_documento").eq("codice_cliente", customerCode).order("data_documento", { ascending: false }).limit(50) : emptyResult,
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
  }, [id, type]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  async function addActivity(event) {
    event.preventDefault(); if (!canWrite || !activity.titolo.trim()) return;
    if (!account.crm_account_id) return setError("Le attività richiedono un layer CRM già collegato; il cliente Mexal non viene duplicato automaticamente.");
    let reminderId = null;
    if (activity.data_attivita) { const reminder = await supabase.from("agenda_reminder").insert({ utente_id: profile.id, titolo: activity.titolo.trim(), descrizione: `CRM ${config.label}: ${account.nome}`, deadline: activity.data_attivita.slice(0, 10), stato: "Aperto" }).select("id").single(); reminderId = reminder.data?.id || null; }
    const { error: insertError } = await supabase.from("crm_activities").insert({ ...activity, crm_tipo: type, account_id: account.crm_account_id, responsabile_id: profile.id, reparto_id: account.reparto_id, reminder_id: reminderId, creato_da: profile.id });
    if (insertError) return setError(insertError.message); setActivity({ tipo: "telefonata", titolo: "", data_attivita: "" }); await load();
  }
  if (error) return <ErrorBox error={error} retry={load} />; if (!account) return <div className="crm-loading">Caricamento cliente...</div>;
  return <div className="crm-page">
    <div className="crm-toolbar"><div><span className="crm-eyebrow">{config.label}</span><h2>{account.nome}</h2><p>{account.codice_cliente_mexal ? `Cliente Workspace/Mexal ${account.codice_cliente_mexal}` : "Prospect CRM-only"}</p><span className={`crm-source-badge ${account.entity_kind}`}>{account.entity_kind === "canonical" ? "Anagrafica canonica" : "CRM-only"}</span></div><Link className="secondary-action crm-secondary" to={`${config.basePath}/clienti`}>Torna ai clienti</Link></div>
    {warning ? <div className="crm-message warning">Alcuni dati collegati non sono disponibili nel perimetro corrente: {warning}</div> : null}
    <div className="crm-detail-grid">
      <section className="panel crm-panel"><h3>Anagrafica</h3><dl><div><dt>Codice cliente</dt><dd>{account.codice_cliente_mexal || "—"}</dd></div><div><dt>Stato</dt><dd>{account.stato}</dd></div><div><dt>Agente Workspace/Mexal</dt><dd>{account.agente_nome || "—"}</dd></div><div><dt>Area CRM</dt><dd>{config.label}</dd></div><div><dt>Classificazione</dt><dd>{account.origine_classificazione ? `${account.origine_classificazione} · ${account.modalita_classificazione}` : "CRM-only"}</dd></div><div><dt>Partita IVA</dt><dd>{account.partita_iva || "—"}</dd></div><div><dt>Email</dt><dd>{account.email || "—"}</dd></div><div><dt>Telefono</dt><dd>{account.telefono || "—"}</dd></div><div><dt>Indirizzo</dt><dd>{[account.indirizzo, account.cap, account.citta, account.provincia].filter(Boolean).join(" · ") || "—"}</dd></div><div><dt>Valore CRM</dt><dd>{formatMoney(account.valore_cliente)}</dd></div></dl></section>
      <section className="panel crm-panel"><h3>AI Summary</h3><p>La sintesi AI viene generata soltanto su richiesta dall’AI Business Assistant e nel perimetro autorizzato.</p><Link to="/crm/ai" state={{ accountId: account.crm_account_id || null, customerCode: account.codice_cliente_mexal || null, crmType: type }}>Apri AI Brief</Link></section>
    </div>
    <div className="crm-tabs">
      <section className="panel crm-panel"><h3>Timeline e attività</h3>{canWrite && account.crm_account_id ? <form className="crm-inline-form" onSubmit={addActivity}><select value={activity.tipo} onChange={(e) => setActivity({ ...activity, tipo: e.target.value })}>{["telefonata","email","visita","videocall","presentazione","formazione","campionatura","follow_up"].map((value) => <option key={value}>{value}</option>)}</select><input required placeholder="Titolo attività" value={activity.titolo} onChange={(e) => setActivity({ ...activity, titolo: e.target.value })} /><input type="datetime-local" value={activity.data_attivita} onChange={(e) => setActivity({ ...activity, data_attivita: e.target.value })} /><button className="primary-action crm-primary"><Plus size={16} />Aggiungi</button></form> : account.entity_kind === "canonical" ? <p>Le attività compaiono quando esiste un layer CRM collegato, senza duplicare il cliente Mexal.</p> : null}<ul className="crm-timeline">{related.activities.map((item) => <li key={item.id}><strong>{item.titolo}</strong><span>{item.tipo} · {formatDate(item.data_attivita)}</span></li>)}</ul>{!related.activities.length ? <p>Nessuna attività disponibile.</p> : null}</section>
      <section className="panel crm-panel"><h3>Opportunità</h3>{related.opportunities.map((item) => <div className="crm-row-card" key={item.id}><strong>{item.titolo}</strong><span>{item.crm_opportunity_stages?.nome || "Senza fase"} · {formatMoney(item.valore)}</span></div>)}{!related.opportunities.length ? <p>Nessuna opportunità disponibile.</p> : null}</section>
      <section className="panel crm-panel"><h3>Attività e contatti CRM</h3>{related.contacts.map((item) => <div className="crm-row-card" key={item.id}><strong>{[item.nome, item.cognome].filter(Boolean).join(" ")}</strong><span>{item.ruolo || "Contatto"} · {item.email || item.telefono || "—"}</span></div>)}{!related.contacts.length ? <p>Nessun contatto CRM disponibile.</p> : null}</section>
      <section className="panel crm-panel"><h3>Brief</h3>{related.briefs.map((item) => <div className="crm-row-card" key={item.id}><strong>{item.titolo}</strong><span>{item.stato}</span></div>)}{!related.briefs.length ? <p>Nessun brief disponibile.</p> : null}</section>
      {account.codice_cliente_mexal ? <><section className="panel crm-panel"><h3>Ordini Workspace/Mexal</h3>{related.orders.map((item) => <div className="crm-row-card" key={item.id}><strong>{item.numero_ordine_visualizzato || item.id}</strong><span>{formatDate(item.data_ordine)} · {formatMoney(item.totale_documento)} · {item.stato}</span></div>)}{!related.orders.length ? <p>Nessun ordine disponibile nel perimetro autorizzato.</p> : null}</section>
      <section className="panel crm-panel"><h3>Fatture Mexal</h3>{related.invoices.map((item) => <div className="crm-row-card" key={item.id}><strong>{item.sigla} {item.serie}/{item.numero}</strong><span>{formatDate(item.data_documento)} · {formatMoney(item.totale_documento)}</span></div>)}{!related.invoices.length ? <p>Nessuna fattura disponibile nel perimetro autorizzato.</p> : null}</section>
      <section className="panel crm-panel"><h3>Prodotti acquistati</h3>{related.products.slice(0, 100).map((item) => <div className="crm-row-card" key={item.code || item.description}><strong>{item.description}</strong><span>{item.code || "Senza codice"} · Q.tà {item.quantity.toLocaleString("it-IT")} · {formatMoney(item.value)}</span></div>)}{!related.products.length ? <p>Nessun prodotto derivabile dalle fatture visibili.</p> : null}</section></> : null}
      <section className="panel crm-panel"><h3>Note e documenti</h3><p>{account.metadati?.note || "Nessuna nota CRM disponibile."}</p><p>I documenti restano nella libreria Workspace e vengono mostrati solo quando esiste un collegamento autorizzato.</p></section>
    </div>
    {type === "online" ? <><section className="panel crm-panel"><h3>Profilo acquisti ecommerce</h3><dl><div><dt>Ordini</dt><dd>{related.externalOrders.length || "Dato non disponibile"}</dd></div><div><dt>Valore totale</dt><dd>{related.externalOrders.length ? formatMoney(related.externalOrders.reduce((sum, item) => sum + Number(item.net_revenue || 0), 0)) : "Dato non disponibile"}</dd></div><div><dt>AOV</dt><dd>{related.externalOrders.length ? formatMoney(related.externalOrders.reduce((sum, item) => sum + Number(item.net_revenue || 0), 0) / related.externalOrders.length) : "Dato non disponibile"}</dd></div><div><dt>Segmenti</dt><dd>{account.segmenti?.join(", ") || "Dato non disponibile"}</dd></div></dl></section><section className="panel crm-panel"><h3>Ordini ecommerce</h3>{related.externalOrders.map((item) => <div className="crm-row-card" key={item.id}><strong>{item.external_id}</strong><span>{formatDate(item.ordered_at)} · {formatMoney(item.net_revenue)} · {item.attribution_method}</span></div>)}{!related.externalOrders.length ? <p>Dato non sincronizzato: serve il connettore ecommerce reale.</p> : null}</section><section className="panel crm-panel"><h3>Consensi marketing</h3>{related.consents.map((item) => <div className="crm-row-card" key={item.id}><strong>{item.purpose}</strong><span>{item.status} · {item.legal_basis || "base giuridica non disponibile"} · {item.source || "fonte non disponibile"}</span></div>)}{!related.consents.length ? <p>Dato non disponibile.</p> : null}</section><section className="panel crm-panel"><h3>Customer journey</h3>{related.events.map((item) => <div className="crm-row-card" key={item.id}><strong>{item.fase}</strong><span>{formatDate(item.avvenuto_il)} · {item.fonte || "unknown"}</span></div>)}{!related.events.length ? <p>Nessun evento autorizzato disponibile.</p> : null}</section></> : null}
  </div>;
}

function Pipeline({ type }) {
  const config = crmTypeConfig(type); const { profile, canUseModule } = useAuth(); const canWrite = canUseModule(config.moduleCode, "scrittura");
  const [stages, setStages] = useState([]); const [items, setItems] = useState([]); const [accounts, setAccounts] = useState([]); const [error, setError] = useState("");
  const [form, setForm] = useState({ titolo: "", account_id: "", valore: "" });
  const load = useCallback(async () => { const [s, o, a] = await Promise.all([supabase.from("crm_opportunity_stages").select("*").eq("crm_tipo", type).eq("attiva", true).order("ordine"), supabase.from("crm_opportunities").select("*,crm_accounts!inner(nome,tipo)").eq("crm_accounts.tipo", type), supabase.from("crm_accounts").select("id,nome").eq("tipo", type).order("nome")]); const failure = s.error || o.error || a.error; if (failure) setError(failure.message); else { setStages(s.data || []); setItems(o.data || []); setAccounts(a.data || []); } }, [type]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  async function create(event) { event.preventDefault(); const first = stages[0]; if (!first) return; const { error: e } = await supabase.from("crm_opportunities").insert({ ...form, valore: form.valore ? Number(form.valore) : null, stage_id: first.id, responsabile_id: profile.id, reparto_id: profile.reparto_ids?.[0] || null, creato_da: profile.id }); if (e) setError(e.message); else { setForm({ titolo: "", account_id: "", valore: "" }); await load(); } }
  async function move(id, stageId) { if (!canWrite) return; const { error: e } = await supabase.from("crm_opportunities").update({ stage_id: stageId }).eq("id", id); if (e) setError(e.message); else await load(); }
  return <div className="crm-page"><div className="crm-toolbar"><div><h2>Pipeline {config.label}</h2><p>Le fasi sono configurate nel database e non nel componente.</p></div></div><ErrorBox error={error} retry={load} />{canWrite ? <form className="crm-inline-form" onSubmit={create}><input required placeholder="Titolo opportunità" value={form.titolo} onChange={(e) => setForm({ ...form, titolo: e.target.value })} /><select required value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}><option value="">Cliente</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}</select><input type="number" min="0" step="0.01" placeholder="Valore" value={form.valore} onChange={(e) => setForm({ ...form, valore: e.target.value })} /><button className="primary-action crm-primary"><Plus size={16} />Crea</button></form> : null}<div className="crm-kanban">{stages.map((stage) => <section key={stage.id} onDragOver={(e) => e.preventDefault()} onDrop={(e) => void move(e.dataTransfer.getData("text/plain"), stage.id)}><header><strong>{stage.nome}</strong><span>{items.filter((item) => item.stage_id === stage.id).length}</span></header>{items.filter((item) => item.stage_id === stage.id).map((item) => <article draggable={canWrite} onDragStart={(e) => e.dataTransfer.setData("text/plain", item.id)} key={item.id}><strong>{item.titolo}</strong><span>{item.crm_accounts?.nome}</span><small>{formatMoney(item.valore)}</small></article>)}</section>)}</div></div>;
}

function BriefsPage() {
  const { profile, canUseModule } = useAuth(); const canWrite = canUseModule("crm_conto_terzi", "scrittura"); const [rows, setRows] = useState([]); const [accounts, setAccounts] = useState([]); const [form, setForm] = useState({ titolo: "", account_id: "", obiettivo: "", target: "", categoria: "" }); const [error, setError] = useState("");
  const load = useCallback(async () => { const [b, a] = await Promise.all([supabase.from("crm_briefs").select("id,titolo,stato,obiettivo,target,categoria,aggiornato_il,crm_accounts(nome)").eq("crm_tipo", "conto_terzi").order("aggiornato_il", { ascending: false }), supabase.from("crm_accounts").select("id,nome").eq("tipo", "conto_terzi").order("nome")]); if (b.error || a.error) setError((b.error || a.error).message); else { setRows(b.data || []); setAccounts(a.data || []); } }, []); useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  async function save(e) { e.preventDefault(); const { error: x } = await supabase.from("crm_briefs").insert({ ...form, crm_tipo: "conto_terzi", account_id: form.account_id || null, responsabile_id: profile.id, reparto_id: profile.reparto_ids?.[0] || null, creato_da: profile.id }); if (x) setError(x.message); else { setForm({ titolo: "", account_id: "", obiettivo: "", target: "", categoria: "" }); await load(); } }
  return <div className="crm-page"><div className="crm-toolbar"><div><h2>Brief Cliente</h2><p>Brief collegabili a opportunità, prodotti, documenti e AI Business Assistant.</p></div><Link className="primary-action crm-primary" to="/crm/ai"><Bot size={17} />Apri AI Brief</Link></div><ErrorBox error={error} />{canWrite ? <form className="crm-card-form" onSubmit={save}><input required placeholder="Titolo brief" value={form.titolo} onChange={(e) => setForm({ ...form, titolo: e.target.value })} /><select value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}><option value="">Cliente opzionale</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}</select><input placeholder="Obiettivo" value={form.obiettivo} onChange={(e) => setForm({ ...form, obiettivo: e.target.value })} /><input placeholder="Target" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} /><input placeholder="Categoria" value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} /><button className="primary-action crm-primary"><Plus size={16} />Salva brief</button></form> : null}<div className="crm-list-grid">{rows.map((row) => <article className="crm-list-card" key={row.id}><span>{row.stato}</span><h3>{row.titolo}</h3><p>{row.crm_accounts?.nome || row.obiettivo || "Brief non ancora associato"}</p><small>{row.target || row.categoria || "Dati da completare"}</small></article>)}</div></div>;
}

function OnlineManager({ entity }) {
  const { profile, canUseModule } = useAuth(); const canWrite = canUseModule("crm_online", "scrittura"); const campaign = entity === "campaigns"; const creator = entity === "creators"; const table = campaign ? "crm_campaigns" : creator ? "crm_creators" : "crm_customer_events";
  const [rows, setRows] = useState([]); const [accounts, setAccounts] = useState([]); const [form, setForm] = useState(campaign ? { nome: "", obiettivo: "", canale: "", budget: "", stato: "bozza" } : creator ? { nome: "", piattaforma: "", profilo: "", nicchia: "", follower: "" } : { account_id: "", fase: "lead", fonte: "", consenso_riferimento: "" }); const [error, setError] = useState("");
  const load = useCallback(async () => { const [r, a] = await Promise.all([supabase.from(table).select(entity === "journey" ? "*,crm_accounts(nome)" : "*").order(entity === "journey" ? "avvenuto_il" : "creato_il", { ascending: false }).limit(500), supabase.from("crm_accounts").select("id,nome").eq("tipo", "online").order("nome")]); if (r.error) setError(r.error.message); else { setRows(r.data || []); setAccounts(a.data || []); } }, [entity, table]); useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  async function save(e) { e.preventDefault(); const payload = campaign ? { ...form, canali: form.canale.split(",").map((value) => value.trim()).filter(Boolean), budget: form.budget ? Number(form.budget) : null, responsabile_id: profile.id, reparto_id: profile.reparto_ids?.[0] || null, creato_da: profile.id } : creator ? { ...form, follower: form.follower ? Number(form.follower) : null, responsabile_id: profile.id, reparto_id: profile.reparto_ids?.[0] || null, creato_da: profile.id } : { ...form, creato_da: profile.id }; const { error: x } = await supabase.from(table).insert(payload); if (x) setError(x.message); else { await load(); } }
  const title = campaign ? "Campaign Manager" : creator ? "Creator Management" : "Customer Journey";
  return <div className="crm-page"><div className="crm-toolbar"><div><h2>{title}</h2><p>{campaign ? "Obiettivi, canali, budget e KPI senza inventare fonti dati." : creator ? "Collaborazioni, contenuti, costi e vendite attribuite." : "Eventi minimali e autorizzati; nessun tracking invasivo."}</p></div></div><ErrorBox error={error} />{canWrite ? <form className="crm-card-form" onSubmit={save}>{campaign ? <><input required placeholder="Nome campagna" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /><input placeholder="Obiettivo" value={form.obiettivo} onChange={(e) => setForm({ ...form, obiettivo: e.target.value })} /><input placeholder="Canale" value={form.canale} onChange={(e) => setForm({ ...form, canale: e.target.value })} /><input type="number" placeholder="Budget" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} /></> : creator ? <><input required placeholder="Nome creator" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /><input placeholder="Piattaforma" value={form.piattaforma} onChange={(e) => setForm({ ...form, piattaforma: e.target.value })} /><input placeholder="Profilo / canale" value={form.profilo} onChange={(e) => setForm({ ...form, profilo: e.target.value })} /><input type="number" placeholder="Follower" value={form.follower} onChange={(e) => setForm({ ...form, follower: e.target.value })} /></> : <><select required value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}><option value="">Cliente online</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}</select><select value={form.fase} onChange={(e) => setForm({ ...form, fase: e.target.value })}>{["lead","visita","interesse","iscrizione","carrello","acquisto","riacquisto","recensione","loyalty"].map((v) => <option key={v}>{v}</option>)}</select><input placeholder="Fonte autorizzata" value={form.fonte} onChange={(e) => setForm({ ...form, fonte: e.target.value })} /><input placeholder="Riferimento consenso" value={form.consenso_riferimento} onChange={(e) => setForm({ ...form, consenso_riferimento: e.target.value })} /></>}<button className="primary-action crm-primary"><Plus size={16} />Aggiungi</button></form> : null}<div className="crm-list-grid">{rows.map((row) => <article className="crm-list-card" key={row.id}><span>{row.stato || row.stato_collaborazione || row.fase}</span><h3>{row.nome || row.crm_accounts?.nome || row.fase}</h3><p>{row.obiettivo || row.piattaforma || row.fonte || "Informazioni da completare"}</p><small>{campaign ? formatMoney(row.budget) : creator ? `${row.follower || 0} follower` : formatDate(row.avvenuto_il)}</small></article>)}</div></div>;
}

function renderCrmView(route) {
  switch (route.view) {
    case "overview": return <CrmOverview />;
    case "dashboard": return <CrmDashboard type={route.type} />;
    case "accounts": return <AccountsPage type={route.type} />;
    case "account": return <AccountDetail type={route.type} />;
    case "pipeline": return <Pipeline type={route.type} />;
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
