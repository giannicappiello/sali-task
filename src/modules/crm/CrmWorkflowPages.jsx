import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabaseClient";
import { CrmBeautyDashboardPanel } from "./CrmBeautyDays";
import CrmCustomerLink from "./CrmCustomerLink";
import CrmDeleteActivityButton from "./CrmDeleteActivityButton";
import CrmPeriodFilter, { useCrmPeriod } from "./CrmPeriodFilter";
import { CrmPageHeader, CrmSectionNav } from "./CrmWorkspaceUI";
import { crmTypeConfig, formatDate, formatMoney, VIRTUAL_DIRECT_CUSTOMER_KEY } from "./crmConfig";
import { crmNavigation } from "./crmNavigation";
import { loadCrmCustomerDirectory } from "./crmWorkspaceCustomers";

function ErrorMessage({ error }) {
  return error ? <div className="crm-message error">{error}</div> : null;
}

export function CrmDevelopmentsPage() {
  const type = "conto_terzi"; const config = crmTypeConfig(type); const period = useCrmPeriod();
  const { canUseModule } = useAuth(); const canWrite = canUseModule(config.moduleCode, "scrittura");
  const [params, setParams] = useSearchParams(); const [rows, setRows] = useState([]); const [error, setError] = useState("");
  const search = params.get("developmentSearch") || ""; const kind = params.get("developmentType") || "";
  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.from("crm_activities").select("id,tipo,titolo,descrizione,stato,data_attivita,crm_accounts(id,nome,codice_cliente_mexal),crm_opportunities(id,titolo)").eq("crm_tipo", type).in("tipo", ["campionatura", "sviluppo_formula", "sviluppo_nuova_formula", "invio_campioni", "preventivo"]).order("data_attivita", { ascending: false }).limit(2000);
    if (loadError) setError(loadError.message); else { setRows(data || []); setError(""); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const visible = rows.filter((row) => (!kind || row.tipo === kind) && (!search || `${row.titolo} ${row.crm_accounts?.nome || ""} ${row.crm_opportunities?.titolo || ""}`.toLowerCase().includes(search.toLowerCase())));
  const setParam = (name, value) => setParams((current) => { const next = new URLSearchParams(current); if (value) next.set(name, value); else next.delete(name); return next; }, { replace: true });
  return <div className="crm-page"><CrmPageHeader eyebrow="CRM PRIVATE" title="Campioni e sviluppi" description="Attività tecniche e commerciali collegate a cliente e progetto; la creazione operativa avviene dalla scheda progetto." actions={<CrmPeriodFilter period={period} compact />}><CrmSectionNav items={crmNavigation(type)} period={period} label="Navigazione CRM PRIVATE" /></CrmPageHeader><ErrorMessage error={error} />
    <div className="crm-filters"><label><Search size={16} /><input value={search} onChange={(event) => setParam("developmentSearch", event.target.value)} placeholder="Cerca cliente, progetto o sviluppo" /></label><select value={kind} onChange={(event) => setParam("developmentType", event.target.value)}><option value="">Tutti i tipi</option><option value="campionatura">Campionatura</option><option value="invio_campioni">Invio campioni</option><option value="sviluppo_formula">Sviluppo formula</option><option value="sviluppo_nuova_formula">Nuova formula</option><option value="preventivo">Preventivo</option></select></div>
    <div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Attività</th><th>Cliente</th><th>Progetto</th><th>Tipo</th><th>Data</th><th>Stato</th>{canWrite ? <th>Azioni</th> : null}</tr></thead><tbody>{visible.map((row) => <tr key={row.id}><td><strong>{row.titolo}</strong><small>{row.descrizione}</small></td><td>{row.crm_accounts ? <CrmCustomerLink crmType={type} customerCode={row.crm_accounts.codice_cliente_mexal} accountId={row.crm_accounts.id} name={row.crm_accounts.nome} period={period}>{row.crm_accounts.nome}</CrmCustomerLink> : "—"}</td><td>{row.crm_opportunities ? <Link to={period.withPeriod(`${config.basePath}/pipeline/${row.crm_opportunities.id}`)}>{row.crm_opportunities.titolo}</Link> : "—"}</td><td>{row.tipo.replaceAll("_", " ")}</td><td>{formatDate(row.data_attivita)}</td><td>{row.stato}</td>{canWrite ? <td><CrmDeleteActivityButton activity={row} canDelete onDeleted={load} onError={setError} compact /></td> : null}</tr>)}</tbody></table>{!visible.length ? <div className="crm-empty">Nessun campione o sviluppo corrisponde ai filtri.</div> : null}</div>
  </div>;
}

export function CrmProjectsPage({ type = "conto_terzi" }) {
  const config = crmTypeConfig(type); const period = useCrmPeriod();
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState([]); const [error, setError] = useState(""); const [loading, setLoading] = useState(true);
  const search = params.get("projectSearch") || "";
  const status = params.get("projectStatus") || "open";
  const load = useCallback(async () => {
    setLoading(true);
    const [projectsResult, customersResult] = await Promise.all([
      supabase.from("v4_progetti").select("id,titolo,descrizione,stato,deadline,crm_customer_key,crm_opportunity_id,v4_fasi_progetto(id,stato,deadline),crm_opportunities(id,titolo)").not("crm_customer_key", "is", null).order("created_at", { ascending: false }).limit(2000),
      loadCrmCustomerDirectory(supabase, type),
    ]);
    const loadError = projectsResult.error || customersResult.error;
    if (loadError) {
      setError(loadError.message);
      setRows([]);
    } else {
      const directory = customersResult.directory;
      const normalizedSearch = search.trim().toLocaleLowerCase("it-IT");
      setRows((projectsResult.data || []).flatMap((project) => {
        const customer = directory.get(project.crm_customer_key);
        if (!customer) return [];
        const closed = ["evaso", "evasa", "completato", "completata", "chiuso", "chiusa", "annullato", "annullata"].includes(String(project.stato || "").toLowerCase());
        if (status === "open" && closed) return [];
        if (status === "completed" && !closed) return [];
        if (normalizedSearch && !`${project.titolo} ${project.descrizione || ""} ${customer.name}`.toLocaleLowerCase("it-IT").includes(normalizedSearch)) return [];
        return [{ ...project, customer, closed }];
      }));
      setError("");
    }
    setLoading(false);
  }, [search, status, type]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const updateParam = (name, value) => setParams((current) => { const next = new URLSearchParams(current); if (value) next.set(name, value); else next.delete(name); return next; }, { replace: true });
  const returnTo = encodeURIComponent(`${config.basePath}/progetti${window.location.search}`);
  const directCustomer = type === "brand_direct" ? `&customerKey=${encodeURIComponent(VIRTUAL_DIRECT_CUSTOMER_KEY)}` : "";
  return <div className="crm-page"><CrmPageHeader eyebrow={config.label} title={`Progetti ${config.label}`} description="Gli stessi progetti operativi del modulo Attività, con cliente, task e deadline in un unico archivio." actions={<><CrmPeriodFilter period={period} compact /><Link className="primary-action crm-primary" to={`/activities/projects?new=1&crmType=${encodeURIComponent(type)}&returnTo=${returnTo}${directCustomer}`}><Plus size={16} />Nuovo progetto</Link></>}><CrmSectionNav items={crmNavigation(type)} period={period} label={`Navigazione ${config.label}`} /></CrmPageHeader><ErrorMessage error={error} />
    <div className="crm-filters"><label><Search size={16} /><input value={search} onChange={(event) => updateParam("projectSearch", event.target.value)} placeholder="Cerca progetto o cliente" /></label><select value={status} onChange={(event) => updateParam("projectStatus", event.target.value)}><option value="open">Aperti</option><option value="completed">Completati</option><option value="all">Tutti</option></select></div>
    {loading ? <div className="crm-loading">Caricamento progetti...</div> : <div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Progetto</th><th>Cliente</th><th>Task</th><th>Stato</th><th>Deadline</th><th>Pipeline collegata</th><th>Azioni</th></tr></thead><tbody>{rows.map((project) => <tr key={project.id}><td><strong>{project.titolo}</strong>{project.descrizione ? <small>{project.descrizione}</small> : null}</td><td><CrmCustomerLink crmType={type} customerCode={project.customer.customerCode} accountId={project.customer.accountId} name={project.customer.name} period={period}>{project.customer.name}</CrmCustomerLink></td><td>{project.v4_fasi_progetto?.length || 0}</td><td>{project.stato || "aperto"}</td><td>{formatDate(project.deadline)}</td><td>{project.crm_opportunities && type !== "brand_direct" ? <Link to={period.withPeriod(`${config.basePath}/pipeline/${project.crm_opportunities.id}`)}>{project.crm_opportunities.titolo}</Link> : "—"}</td><td><Link className="secondary-action" to={`/activities/projects?project=${project.id}&crmType=${encodeURIComponent(type)}&returnTo=${returnTo}`}>Apri progetto</Link></td></tr>)}</tbody></table>{!rows.length ? <div className="crm-empty">Nessun progetto operativo corrisponde ai filtri.</div> : null}</div>}
  </div>;
}

export function CrmBrandDirectDashboard() {
  const type = "brand_direct"; const config = crmTypeConfig(type); const period = useCrmPeriod();
  const [summary, setSummary] = useState({ projects: 0, openTasks: 0, completedTasks: 0, overdueTasks: 0 });
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    async function load() {
      const [projectsResult, tasksResult] = await Promise.all([
        supabase.from("v4_progetti").select("id", { count: "exact", head: true }).eq("crm_customer_key", VIRTUAL_DIRECT_CUSTOMER_KEY),
        supabase.from("v4_fasi_progetto").select("id,stato,deadline,completato_at").eq("crm_customer_key", VIRTUAL_DIRECT_CUSTOMER_KEY).limit(5000),
      ]);
      if (!active) return;
      const loadError = projectsResult.error || tasksResult.error;
      if (loadError) { setError(loadError.message); return; }
      const tasks = tasksResult.data || [];
      const completed = tasks.filter((task) => ["evaso", "evasa", "completato", "completata", "chiuso", "chiusa"].includes(String(task.stato || "").toLowerCase()) || task.completato_at);
      const completedIds = new Set(completed.map((task) => task.id));
      const today = new Date().toISOString().slice(0, 10);
      setSummary({ projects: projectsResult.count || 0, openTasks: tasks.length - completed.length, completedTasks: completed.length, overdueTasks: tasks.filter((task) => !completedIds.has(task.id) && task.deadline && String(task.deadline).slice(0, 10) < today).length });
      setError("");
    }
    void load();
    return () => { active = false; };
  }, []);
  const cards = [
    ["Progetti DIRECT", summary.projects, `${config.basePath}/progetti?projectStatus=all`],
    ["Attività aperte", summary.openTasks, `${config.basePath}/attivita?activityStatus=open`],
    ["Attività completate", summary.completedTasks, `${config.basePath}/attivita?activityStatus=completed`],
    ["Attività scadute", summary.overdueTasks, `${config.basePath}/attivita?activityStatus=open`],
  ];
  return <div className="crm-page"><CrmPageHeader eyebrow="CRM BRAND DIRECT" title="Cliente DIRECT" description="Area interna per progetti e attività sui prodotti DIRECT non collegati a farmacie o ad altri clienti."><CrmSectionNav items={crmNavigation(type)} period={period} label="Navigazione CRM BRAND DIRECT" /></CrmPageHeader><ErrorMessage error={error} /><div className="crm-kpi-grid">{cards.map(([label, value, path]) => <Link className="crm-kpi-card" key={label} to={period.withPeriod(path)}><span>{label}</span><strong>{value}</strong><small>Apri dettaglio →</small></Link>)}</div></div>;
}

function B2BCustomerActionPage({ mode }) {
  const type = "b2b"; const period = useCrmPeriod(); const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState([]); const [error, setError] = useState(""); const search = params.get("customerSearch") || ""; const segment = params.get("segment") || "";
  const load = useCallback(async () => {
    const result = await supabase.rpc("crm_b2b_customer_worklist");
    if (result.error) setError(result.error.message); else { setRows(result.data || []); setError(""); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 150); return () => window.clearTimeout(timer); }, [load]);
  const visible = useMemo(() => rows.filter((row) => {
    const matchesSearch = !search || `${row.ragione_sociale} ${row.codice_cliente}`.toLowerCase().includes(search.toLowerCase());
    const matchesMode = segment ? true : mode === "reorders" ? Number(row.numero_ordini || 0) > 0 : ["a_rischio", "dormiente", "perso"].includes(row.classificazione);
    return matchesSearch && matchesMode && (!segment || row.classificazione === segment);
  }), [mode, rows, search, segment]);
  const title = mode === "reorders" ? "Riordini e progetti commerciali" : "Clienti da seguire";
  const description = mode === "reorders" ? "Clienti acquisiti ordinati per ultimo acquisto, frequenza e valore: fuori dalla pipeline prospect, dentro il ciclo di sviluppo." : "Priorità commerciali derivate dall’assenza di attività nel periodo, senza modificare lo stato CRM del cliente.";
  return <div className="crm-page"><CrmPageHeader eyebrow="CRM DIRECT · BtoB" title={title} description={description} actions={<CrmPeriodFilter period={period} compact />}><CrmSectionNav items={crmNavigation(type)} period={period} label="Navigazione CRM B2B" /></CrmPageHeader><ErrorMessage error={error} /><div className="crm-filters"><label><Search size={16} /><input value={search} onChange={(event) => setParams((current) => { const next = new URLSearchParams(current); if (event.target.value) next.set("customerSearch", event.target.value); else next.delete("customerSearch"); return next; }, { replace: true })} placeholder="Cerca cliente o codice" /></label></div><div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Cliente</th><th>Codice</th><th>Segmento dinamico</th><th>Ultimo ordine</th><th>Ordini storici</th><th>Valore storico</th><th>Frequenza</th><th>Riordino atteso</th></tr></thead><tbody>{visible.map((row) => <tr key={row.codice_cliente}><td><CrmCustomerLink crmType={type} customerCode={row.codice_cliente} name={row.ragione_sociale} period={period}>{row.ragione_sociale}</CrmCustomerLink></td><td>{row.codice_cliente}</td><td><span className="status-badge">{row.classificazione.replaceAll("_", " ")}</span></td><td>{formatDate(row.ultimo_ordine_il)}{row.giorni_da_ultimo_ordine != null ? <small>{row.giorni_da_ultimo_ordine} giorni fa</small> : null}</td><td>{row.numero_ordini || 0}</td><td>{formatMoney(row.valore_ordini)}</td><td>{row.frequenza_media_giorni ? `${row.frequenza_media_giorni} gg` : "Non disponibile"}</td><td>{formatDate(row.riordino_atteso_il)}</td></tr>)}</tbody></table>{!visible.length ? <div className="crm-empty">Nessun cliente corrisponde ai filtri.</div> : null}</div></div>;
}

export function CrmB2BFollowUpPage() { return <B2BCustomerActionPage mode="follow-up" />; }
export function CrmB2BReordersPage() { return <B2BCustomerActionPage mode="reorders" />; }

export function CrmBeautyDaysPage() {
  const type = "b2b"; const period = useCrmPeriod();
  return <div className="crm-page"><CrmPageHeader eyebrow="CRM DIRECT · BtoB" title="BeautyDays" description="Giornate effettuate presso le farmacie e lettura dell’impatto commerciale sui dati reali collegati." actions={<CrmPeriodFilter period={period} compact />}><CrmSectionNav items={crmNavigation(type)} period={period} label="Navigazione CRM B2B" /></CrmPageHeader><CrmBeautyDashboardPanel /></div>;
}
