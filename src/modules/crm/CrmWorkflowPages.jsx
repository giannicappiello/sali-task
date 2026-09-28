import { isCustomerRecordScope } from '../../lib/customerRecordAccess.js';
import { useCallback, useEffect, useState } from "react";
import CrmB2BWorklist from "./CrmB2BWorklist";
import { Link, useSearchParams } from "react-router-dom";
import { FolderKanban, LayoutList, Plus, Search, SquareKanban } from "lucide-react";
import InfoTooltip from "../../components/InfoTooltip";
import WorkspaceProjectCreateDialog from "../../components/WorkspaceProjectCreateDialog";
import WorkspaceTaskDialog from "../../components/WorkspaceTaskDialog";
import WorkspaceTaskKanban from "../../pages/Tasks/WorkspaceTaskKanban";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabaseClient";
import { CrmBeautyDashboardPanel } from "./CrmBeautyDays";
import CrmCustomerLink from "./CrmCustomerLink";
import CrmPeriodFilter, { useCrmPeriod } from "./CrmPeriodFilter";
import { CrmPageHeader, CrmSectionNav } from "./CrmWorkspaceUI";
import { crmTypeConfig, formatDate, VIRTUAL_DIRECT_CUSTOMER_KEY } from "./crmConfig";
import { crmNavigation } from "./crmNavigation";
import { loadCrmCustomerDirectory } from "./crmWorkspaceCustomers";

function ErrorMessage({ error }) {
  return error ? <div className="crm-message error">{error}</div> : null;
}

export function CrmProjectsPage({ type = "conto_terzi" }) {
  const config = crmTypeConfig(type); const period = useCrmPeriod();
  const { canUseModule, profile, dataScope } = useAuth();
  const customerScoped = isCustomerRecordScope(dataScope);
  const canWrite = !customerScoped && canUseModule(config.moduleCode, "scrittura");
  const actorId = profile?.id || null;
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState([]); const [error, setError] = useState(""); const [loading, setLoading] = useState(true);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const search = params.get("projectSearch") || "";
  const status = params.get("projectStatus") || (params.get("projectView") === "list" ? "open" : "all");
  const view = params.get("projectView") || "kanban";
  const load = useCallback(async () => {
    setLoading(true);
    const [projectsResult, customersResult] = await Promise.all([
      supabase.from("v4_progetti").select("id,titolo,descrizione,stato,deadline,crm_customer_key,crm_opportunity_id,v4_fasi_progetto(id,titolo,descrizione,note,crm_tipo,stato,deadline,priorita,completato_at,crm_customer_key,crm_opportunity_id,bloccante_id),crm_opportunities(id,titolo)").not("crm_customer_key", "is", null).order("created_at", { ascending: false }).limit(2000),
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
  const selectedProjectId = params.get("kanbanProject") || "";
  const selectedProject = rows.find((project) => project.id === selectedProjectId);
  const changeView = (nextView, projectId = "") => setParams((current) => {
    const next = new URLSearchParams(current);
    next.set("projectView", nextView);
    if (nextView === "kanban") next.set("projectStatus", "all");
    if (projectId) next.set("kanbanProject", projectId); else next.delete("kanbanProject");
    return next;
  });
  const initialCustomerKey = type === "brand_direct" ? VIRTUAL_DIRECT_CUSTOMER_KEY : "";
  const kanbanTasks = rows.filter((project) => !selectedProjectId || project.id === selectedProjectId).flatMap((project) => (project.v4_fasi_progetto || []).map((task) => ({ ...task, progetto_id: project.id, v4_progetti: { id: project.id, titolo: project.titolo }, crm_customer_key: task.crm_customer_key || project.crm_customer_key, crm_customer_name: project.customer.name })));
  const moveTask = async (taskId, nextStatus) => {
    if ((!canWrite && !customerScoped) || nextStatus === "bloccata") return;
    if (customerScoped) {
      const { error } = await supabase.rpc("workspace_customer_task_status", { p_task_id: taskId, p_status: nextStatus });
      if (error) return setError(error.message);
      await load(); return;
    }
    const task = kanbanTasks.find((row) => row.id === taskId);
    if (!task) return;
    if (task.bloccante_id) {
      const { data: blocker, error: blockerError } = await supabase.from("v4_fasi_progetto").select("titolo,stato,completato_at").eq("id", task.bloccante_id).maybeSingle();
      if (blockerError) return setError(blockerError.message);
      const blockerDone = Boolean(blocker?.completato_at) || ["evaso", "evasa", "completato", "completata", "chiuso", "chiusa"].includes(String(blocker?.stato || "").toLowerCase());
      if (blocker && !blockerDone) return setError(`Task bloccata da: ${blocker.titolo || "dipendenza"}. Completa prima il predecessore.`);
    }
    const done = nextStatus === "evaso";
    const now = new Date().toISOString();
    const { error: moveError } = await supabase.from("v4_fasi_progetto").update({ stato: nextStatus, completato_at: done ? now : null, completato_da: done ? actorId : null, modificato_da: actorId, updated_at: now }).eq("id", taskId);
    if (moveError) return setError(moveError.message);
    const { error: auditError } = await supabase.from("v4_audit_log").insert({ entity_type: "fase_progetto", entity_id: taskId, azione: "cambio stato kanban progetto CRM", dettagli: { testo: nextStatus }, user_id: actorId });
    if (auditError) return setError(auditError.message);
    await load();
  };
  const openTask = (task) => { setSelectedTask(task); setTaskDialogOpen(true); };
  return <div className="crm-page"><CrmPageHeader eyebrow={config.label} title={`Progetti ${config.label}`} description="Gli stessi progetti operativi del modulo Attività, con cliente, task e deadline in un unico archivio." actions={<><CrmPeriodFilter period={period} compact />{canWrite ? <button type="button" className="primary-action crm-primary" onClick={() => setProjectDialogOpen(true)}><Plus size={16} />Nuovo progetto</button> : null}</>}><CrmSectionNav items={crmNavigation(type)} period={period} label={`Navigazione ${config.label}`} /></CrmPageHeader><ErrorMessage error={error} />
    <div className="crm-filters"><label><Search size={16} /><input value={search} onChange={(event) => updateParam("projectSearch", event.target.value)} placeholder="Cerca progetto o cliente" /></label><select value={status} onChange={(event) => updateParam("projectStatus", event.target.value)}><option value="open">Aperti</option><option value="completed">Completati</option><option value="all">Tutti</option></select><div className="crm-view-toggle" aria-label="Vista progetti"><button type="button" className={view === "list" ? "active" : ""} onClick={() => changeView("list")}><LayoutList size={16} />Lista</button><button type="button" className={view === "kanban" ? "active" : ""} onClick={() => changeView("kanban")}><SquareKanban size={16} />Kanban</button></div></div>
    {view === "kanban" && selectedProject ? <h2>{selectedProject.titolo} · {selectedProject.customer.name}</h2> : null}
    {loading ? <div className="crm-loading">Caricamento progetti...</div> : view === "kanban" ? <WorkspaceTaskKanban openOnCardClick items={kanbanTasks} onMove={moveTask} onOpen={openTask} /> : <div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Progetto</th><th>Cliente</th><th>Task</th><th>Stato</th><th>Deadline</th><th>Azioni</th></tr></thead><tbody>{rows.map((project) => <tr key={project.id}><td><strong>{project.titolo}</strong>{project.descrizione ? <small>{project.descrizione}</small> : null}</td><td><CrmCustomerLink crmType={type} customerCode={project.customer.customerCode} accountId={project.customer.accountId} name={project.customer.name} period={period}>{project.customer.name}</CrmCustomerLink></td><td>{project.v4_fasi_progetto?.length || 0}</td><td>{project.stato || "aperto"}</td><td>{formatDate(project.deadline)}</td><td><button type="button" className="secondary-action crm-table-action" onClick={() => changeView("kanban", project.id)}><FolderKanban size={16} />Apri progetto</button></td></tr>)}</tbody></table>{!rows.length ? <div className="crm-empty">Nessun progetto operativo corrisponde ai filtri.</div> : null}</div>}
    <WorkspaceProjectCreateDialog open={projectDialogOpen} crmType={type} initialCustomerKey={initialCustomerKey} onClose={() => setProjectDialogOpen(false)} onSaved={load} />
    <WorkspaceTaskDialog open={taskDialogOpen} phase={selectedTask} crmType={type} initialCustomerKey={selectedTask?.crm_customer_key || initialCustomerKey} canManage={canWrite} onClose={() => setTaskDialogOpen(false)} onSaved={load} />
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
    { label: "Progetti DIRECT", value: summary.projects, note: "Tutti i progetti del cliente virtuale DIRECT", info: "Numero complessivo dei progetti Workspace collegati al cliente virtuale DIRECT.", path: `${config.basePath}/progetti`, filters: { projectStatus: "all" } },
    { label: "Attività aperte", value: summary.openTasks, note: "Task e attività ancora da completare", info: "Numero di task e attività DIRECT non ancora completati, inclusi quelli in lavorazione o bloccati.", path: `${config.basePath}/attivita`, filters: { activityStatus: "open" } },
    { label: "Attività completate", value: summary.completedTasks, note: "Storico delle attività concluse", info: "Numero di task e attività DIRECT conclusi e conservati nello storico Workspace.", path: `${config.basePath}/attivita`, filters: { activityStatus: "completed" } },
    { label: "Attività scadute", value: summary.overdueTasks, note: "Attività aperte oltre la deadline", info: "Numero di task e attività DIRECT ancora aperti con deadline precedente alla data odierna.", path: `${config.basePath}/attivita`, filters: { activityStatus: "open", activityDue: "overdue" } },
  ];
  return <div className="crm-page"><CrmPageHeader eyebrow="CRM BRAND DIRECT" title="Cliente DIRECT" description="Area interna per progetti e attività sui prodotti DIRECT non collegati a farmacie o ad altri clienti."><CrmSectionNav items={crmNavigation(type)} period={period} label="Navigazione CRM BRAND DIRECT" /></CrmPageHeader><ErrorMessage error={error} /><div className="crm-kpi-grid">{cards.map((card) => <Link className="kpi-card crm-kpi" key={card.label} to={period.withPeriod(card.path, card.filters)} aria-label={`${card.label}: ${card.value}. Apri dettaglio`}><span>{card.label}<InfoTooltip label={card.label} text={card.info} /></span><strong>{card.value}</strong><small>{card.note}</small><em>Apri dettaglio →</em></Link>)}</div></div>;
}

export function CrmB2BFollowUpPage() { return <CrmB2BWorklist mode="follow-up" />; }
export function CrmB2BReordersPage() { return <CrmB2BWorklist mode="reorders" />; }

export function CrmBeautyDaysPage() {
  const type = "b2b"; const period = useCrmPeriod();
  return <div className="crm-page"><CrmPageHeader eyebrow="CRM DIRECT · BtoB" title="BeautyDays" description="Giornate effettuate presso le farmacie e lettura dell’impatto commerciale sui dati reali collegati." actions={<CrmPeriodFilter period={period} compact />}><CrmSectionNav items={crmNavigation(type)} period={period} label="Navigazione CRM B2B" /></CrmPageHeader><CrmBeautyDashboardPanel /></div>;
}
