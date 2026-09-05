import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { LayoutList, Plus, Search, SquareKanban } from "lucide-react";
import WorkspaceTaskDialog from "../../components/WorkspaceTaskDialog";
import WorkspaceTaskKanban from "../../pages/Tasks/WorkspaceTaskKanban";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabaseClient";
import CrmCustomerLink from "./CrmCustomerLink";
import CrmPeriodFilter, { useCrmPeriod } from "./CrmPeriodFilter";
import { CrmPageHeader, CrmSectionNav } from "./CrmWorkspaceUI";
import { crmTypeConfig, formatDate, VIRTUAL_DIRECT_CUSTOMER_KEY } from "./crmConfig";
import { crmNavigation } from "./crmNavigation";
import { loadCrmCustomerDirectory } from "./crmWorkspaceCustomers";

const CLOSED_STATES = new Set(["evaso", "evasa", "completato", "completata", "chiuso", "chiusa"]);

function isCompleted(row) {
  return Boolean(row.completato_at) || CLOSED_STATES.has(String(row.stato || "").trim().toLowerCase());
}

export default function CrmActivitiesPage({ type }) {
  const config = crmTypeConfig(type);
  const period = useCrmPeriod();
  const { canUseModule, profile } = useAuth();
  const canWrite = canUseModule(config.moduleCode, "scrittura");
  const actorId = profile?.id || null;
  const [params, setParams] = useSearchParams();
  const [now] = useState(() => Date.now());
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const status = params.get("activityStatus") || "open";
  const due = params.get("activityDue") || "";
  const search = params.get("activitySearch") || "";
  const view = params.get("activityView") || "list";

  const updateParam = (name, value) => setParams((current) => {
    const next = new URLSearchParams(current);
    if (value) next.set(name, value); else next.delete(name);
    return next;
  }, { replace: true });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const [tasksResult, customersResult] = await Promise.all([
      supabase
        .from("v4_fasi_progetto")
        .select("id,titolo,descrizione,stato,deadline,priorita,completato_at,crm_customer_key,crm_opportunity_id,bloccante_id,source_type,v4_progetti(id,titolo,crm_customer_key)")
        .order("deadline", { ascending: true, nullsFirst: false })
        .limit(3000),
      loadCrmCustomerDirectory(supabase, type),
    ]);
    const loadError = tasksResult.error || customersResult.error;
    if (loadError) {
      setError(loadError.message);
      setRows([]);
    } else {
      const directory = customersResult.directory;
      const normalizedSearch = search.trim().toLocaleLowerCase("it-IT");
      setRows((tasksResult.data || []).flatMap((task) => {
        const customerKey = task.crm_customer_key || task.v4_progetti?.crm_customer_key || "";
        const customer = directory.get(customerKey);
        if (!customer) return [];
        const completed = isCompleted(task);
        if (status === "open" && completed) return [];
        if (status === "completed" && !completed) return [];
        if (due === "overdue" && (completed || !task.deadline || new Date(`${task.deadline}T23:59:59`).getTime() >= now)) return [];
        if (normalizedSearch && !`${task.titolo} ${task.descrizione || ""} ${customer.name} ${task.v4_progetti?.titolo || ""}`.toLocaleLowerCase("it-IT").includes(normalizedSearch)) return [];
        return [{ ...task, crm_customer_key: customerKey, crm_customer_name: customer.name, customerKey, customer, completed }];
      }));
    }
    setLoading(false);
  }, [due, now, search, status, type]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 150);
    return () => window.clearTimeout(timer);
  }, [load]);

  const navigation = crmNavigation(type);
  const initialCustomerKey = type === "brand_direct" ? VIRTUAL_DIRECT_CUSTOMER_KEY : "";
  const openTask = (task = null) => { setSelectedTask(task); setTaskDialogOpen(true); };
  const moveTask = async (taskId, nextStatus) => {
    if (!canWrite || nextStatus === "bloccata") return;
    const task = rows.find((row) => row.id === taskId);
    if (!task) return;
    if (task.bloccante_id) {
      const { data: blocker, error: blockerError } = await supabase.from("v4_fasi_progetto").select("titolo,stato,completato_at").eq("id", task.bloccante_id).maybeSingle();
      if (blockerError) return setError(blockerError.message);
      if (blocker && !isCompleted(blocker)) return setError(`Task bloccata da: ${blocker.titolo || "dipendenza"}. Completa prima il predecessore.`);
    }
    const done = nextStatus === "evaso";
    const now = new Date().toISOString();
    const { error: moveError } = await supabase.from("v4_fasi_progetto").update({ stato: nextStatus, completato_at: done ? now : null, completato_da: done ? actorId : null, modificato_da: actorId, updated_at: now }).eq("id", taskId);
    if (moveError) return setError(moveError.message);
    const { error: auditError } = await supabase.from("v4_audit_log").insert({ entity_type: "fase_progetto", entity_id: taskId, azione: "cambio stato kanban CRM", dettagli: { testo: nextStatus }, user_id: actorId });
    if (auditError) return setError(auditError.message);
    await load();
  };
  return <div className="crm-page">
    <CrmPageHeader eyebrow={config.label} title={`Attività ${config.label}`} description="Le stesse task e fasi operative del modulo Attività, filtrate per cliente CRM." actions={<><CrmPeriodFilter period={period} compact />{canWrite ? <button type="button" className="primary-action crm-primary" onClick={() => openTask()}><Plus size={16} />Nuova attività</button> : null}</>}>
      <CrmSectionNav items={navigation} period={period} label={`Navigazione ${config.label}`} />
    </CrmPageHeader>
    {error ? <div className="crm-message error">{error}</div> : null}
    <div className="crm-filters"><label><Search size={16} /><input value={search} onChange={(event) => updateParam("activitySearch", event.target.value)} placeholder="Cerca attività, cliente o progetto" /></label><select value={status} onChange={(event) => updateParam("activityStatus", event.target.value)}><option value="open">Aperte</option><option value="completed">Completate</option><option value="all">Tutte</option></select><div className="crm-view-toggle" aria-label="Vista attività"><button type="button" className={view === "list" ? "active" : ""} onClick={() => updateParam("activityView", "list")}><LayoutList size={16} />Lista</button><button type="button" className={view === "kanban" ? "active" : ""} onClick={() => updateParam("activityView", "kanban")}><SquareKanban size={16} />Kanban</button></div></div>
    {loading ? <div className="crm-loading">Caricamento attività...</div> : view === "kanban" ? <WorkspaceTaskKanban items={rows} onMove={moveTask} onOpen={openTask} /> : <div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Attività / task</th><th>Cliente</th><th>Progetto</th><th>Scadenza</th><th>Stato</th><th>Azioni</th></tr></thead><tbody>{rows.map((row) => {
      const overdue = !row.completed && row.deadline && new Date(`${row.deadline}T23:59:59`).getTime() < now;
      return <tr key={row.id}><td><strong>{row.titolo}</strong>{row.descrizione ? <small>{row.descrizione}</small> : null}</td><td><CrmCustomerLink crmType={type} customerCode={row.customer.customerCode} accountId={row.customer.accountId} name={row.customer.name} period={period}>{row.customer.name}</CrmCustomerLink></td><td>{row.v4_progetti ? <Link to={`/activities/projects?project=${row.v4_progetti.id}`}>{row.v4_progetti.titolo}</Link> : "Attività singola"}</td><td className={overdue ? "crm-missing-step" : ""}>{row.deadline ? formatDate(row.deadline) : "Senza scadenza"}</td><td>{row.stato || "da evadere"}</td><td><button type="button" className="secondary-action crm-table-action" onClick={() => openTask(row)}>Apri task</button></td></tr>;
    })}</tbody></table>{!rows.length ? <div className="crm-empty">Nessuna task o fase corrisponde ai filtri.</div> : null}</div>}
    <WorkspaceTaskDialog open={taskDialogOpen} phase={selectedTask} crmType={type} initialCustomerKey={selectedTask?.crm_customer_key || initialCustomerKey} canManage={canWrite} onClose={() => setTaskDialogOpen(false)} onSaved={load} />
  </div>;
}
