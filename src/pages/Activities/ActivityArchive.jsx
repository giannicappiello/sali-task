import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Archive, BellRing, CheckCircle2, Folder, ListChecks, Search } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";
import { VIRTUAL_DIRECT_CUSTOMER_KEY } from "../../modules/crm/crmConfig";

const CLOSED_STATES = new Set(["evaso", "evasa", "completato", "completata", "chiuso", "chiusa", "annullato", "annullata"]);

function normalize(value) {
  return String(value || "").trim().toLowerCase().replaceAll(" ", "_");
}

function isTaskClosed(item) {
  return Boolean(item?.completato_at) || CLOSED_STATES.has(normalize(item?.stato));
}

function isReminderClosed(item) {
  return Boolean(item?.completato) || Boolean(item?.completato_at) || CLOSED_STATES.has(normalize(item?.stato));
}

function dateOnly(value) {
  return value ? String(value).slice(0, 10) : "";
}

function formatDate(value) {
  const date = dateOnly(value);
  return date ? new Date(`${date}T00:00:00`).toLocaleDateString("it-IT") : "—";
}

function latestDate(values) {
  return values.filter(Boolean).toSorted().at(-1) || null;
}

function makeDepartmentMap(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const list = map.get(row.progetto_id || row.fase_id || row.reminder_id) || [];
    if (row.reparto_id) list.push(row.reparto_id);
    map.set(row.progetto_id || row.fase_id || row.reminder_id, list);
  });
  return map;
}

export default function ActivityArchive() {
  const { profile, isAdmin, dataScope, canViewScopedData } = useAuth();
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const canViewScopedDataRef = useRef(canViewScopedData);
  const query = params.get("search") || "";
  const type = params.get("type") || "all";
  const canReadAll = dataScope?.mode === "tutti" || isAdmin?.();
  const visibleUserScope = dataScope?.userIds?.join(",") || "";
  const visibleDepartmentScope = dataScope?.departmentIds?.join(",") || "";

  useEffect(() => {
    canViewScopedDataRef.current = canViewScopedData;
  }, [canViewScopedData]);

  useEffect(() => {
    if (!profile?.id) return undefined;
    let active = true;

    async function loadArchive() {
      setLoading(true);
      setError("");
      const [projectsResult, tasksResult, remindersResult, projectDepartmentsResult, taskDepartmentsResult, reminderDepartmentsResult, usersResult, departmentsResult, accountsResult, customersResult] = await Promise.all([
        supabase.from("v4_progetti").select("*").order("updated_at", { ascending: false }).limit(5000),
        supabase.from("v4_fasi_progetto").select("*").order("completato_at", { ascending: false, nullsFirst: false }).limit(5000),
        supabase.from("agenda_reminder").select("*").order("deadline", { ascending: false, nullsFirst: false }).limit(5000),
        supabase.from("v4_progetto_reparti").select("progetto_id,reparto_id"),
        supabase.from("v4_fase_reparti").select("fase_id,reparto_id"),
        supabase.from("agenda_reminder_reparti").select("reminder_id,reparto_id"),
        supabase.from("utenti").select("id,nome,cognome,email"),
        supabase.from("reparti").select("id,nome"),
        supabase.from("crm_accounts").select("id,nome,codice_cliente_mexal"),
        supabase.from("crm_classified_customers").select("codice_cliente,ragione_sociale"),
      ]);
      if (!active) return;
      const loadError = [projectsResult, tasksResult, remindersResult, projectDepartmentsResult, taskDepartmentsResult, reminderDepartmentsResult, usersResult, departmentsResult, accountsResult, customersResult].find((result) => result.error)?.error;
      if (loadError) {
        setError(loadError.message);
        setRows([]);
        setLoading(false);
        return;
      }

      const projectDepartments = makeDepartmentMap(projectDepartmentsResult.data || []);
      const taskDepartments = makeDepartmentMap(taskDepartmentsResult.data || []);
      const reminderDepartments = makeDepartmentMap(reminderDepartmentsResult.data || []);
      const userNames = new Map((usersResult.data || []).map((user) => [user.id, `${user.nome || ""} ${user.cognome || ""}`.trim() || user.email || "Utente"]));
      const departmentNames = new Map((departmentsResult.data || []).map((department) => [department.id, department.nome]));
      const customerNames = new Map([[VIRTUAL_DIRECT_CUSTOMER_KEY, "DIRECT"]]);
      (customersResult.data || []).forEach((customer) => {
        if (customer.codice_cliente) customerNames.set(`mexal:${customer.codice_cliente}`, customer.ragione_sociale || customer.codice_cliente);
      });
      (accountsResult.data || []).forEach((account) => {
        customerNames.set(`crm:${account.id}`, account.nome);
        if (account.codice_cliente_mexal) customerNames.set(`mexal:${account.codice_cliente_mexal}`, account.nome);
      });

      const allTasks = tasksResult.data || [];
      const allProjects = projectsResult.data || [];
      const projectsById = new Map(allProjects.map((project) => [project.id, project]));
      const visibleTasks = allTasks.filter((task) => canReadAll || canViewScopedDataRef.current({
        ownerId: task.creato_da,
        userIds: [task.assegnato_a].filter(Boolean),
        departmentIds: taskDepartments.get(task.id) || [task.reparto_id].filter(Boolean),
      }));
      const visibleTaskIds = new Set(visibleTasks.map((task) => task.id));
      const visibleProjectIdsFromTasks = new Set(visibleTasks.map((task) => task.progetto_id).filter(Boolean));
      const visibleProjects = allProjects.filter((project) => canReadAll || visibleProjectIdsFromTasks.has(project.id) || canViewScopedDataRef.current({
        ownerId: project.creato_da,
        departmentIds: projectDepartments.get(project.id) || [],
      }));
      const visibleReminders = (remindersResult.data || []).filter((reminder) => canReadAll || canViewScopedDataRef.current({
        ownerId: reminder.utente_id,
        departmentIds: reminderDepartments.get(reminder.id) || [],
      }));

      const taskRows = visibleTasks.filter(isTaskClosed).map((task) => {
        const project = projectsById.get(task.progetto_id);
        const customerKey = task.crm_customer_key || project?.crm_customer_key || "";
        return {
          id: task.id,
          type: "tasks",
          typeLabel: task.source_type === "crm_activity" ? "Attività CRM" : "Task / fase",
          title: task.titolo,
          description: task.descrizione,
          parent: project?.titolo || "Attività singola",
          customer: customerNames.get(customerKey) || (customerKey ? "Cliente collegato" : "—"),
          owner: userNames.get(task.assegnato_a || task.creato_da) || "—",
          departments: (taskDepartments.get(task.id) || [task.reparto_id].filter(Boolean)).map((id) => departmentNames.get(id)).filter(Boolean).join(", ") || "—",
          closedAt: task.completato_at || task.updated_at || task.deadline,
          href: `/activities/tasks?task=${encodeURIComponent(task.id)}&filter=completate`,
        };
      });

      const phasesByProject = new Map();
      allTasks.forEach((task) => {
        if (!task.progetto_id) return;
        phasesByProject.set(task.progetto_id, [...(phasesByProject.get(task.progetto_id) || []), task]);
      });
      const projectRows = visibleProjects.flatMap((project) => {
        const projectTasks = phasesByProject.get(project.id) || [];
        const closed = CLOSED_STATES.has(normalize(project.stato)) || (projectTasks.length > 0 && projectTasks.every(isTaskClosed));
        if (!closed) return [];
        const customerKey = project.crm_customer_key || "";
        return [{
          id: project.id,
          type: "projects",
          typeLabel: "Progetto",
          title: project.titolo,
          description: project.descrizione,
          parent: `${projectTasks.filter((task) => visibleTaskIds.has(task.id)).length} task / fasi visibili`,
          customer: customerNames.get(customerKey) || (customerKey ? "Cliente collegato" : "—"),
          owner: userNames.get(project.creato_da) || "—",
          departments: (projectDepartments.get(project.id) || []).map((id) => departmentNames.get(id)).filter(Boolean).join(", ") || "—",
          closedAt: latestDate(projectTasks.map((task) => task.completato_at || task.updated_at)) || project.updated_at || project.deadline,
          href: `/activities/projects?project=${encodeURIComponent(project.id)}`,
        }];
      });

      const reminderRows = visibleReminders.filter(isReminderClosed).map((reminder) => ({
        id: reminder.id,
        type: "reminders",
        typeLabel: "Reminder",
        title: reminder.titolo,
        description: reminder.descrizione,
        parent: reminder.progetto_id ? visibleProjects.find((project) => project.id === reminder.progetto_id)?.titolo || "Progetto collegato" : "Reminder autonomo",
        customer: "—",
        owner: userNames.get(reminder.utente_id) || "—",
        departments: (reminderDepartments.get(reminder.id) || []).map((id) => departmentNames.get(id)).filter(Boolean).join(", ") || "—",
        closedAt: reminder.completato_at || reminder.updated_at || reminder.deadline,
        href: `/activities/reminders?reminder=${encodeURIComponent(reminder.id)}`,
      }));

      setRows([...taskRows, ...projectRows, ...reminderRows].toSorted((left, right) => String(right.closedAt || "").localeCompare(String(left.closedAt || ""))));
      setLoading(false);
    }

    void loadArchive();
    return () => { active = false; };
  }, [canReadAll, dataScope?.mode, profile?.id, visibleDepartmentScope, visibleUserScope]);

  const visibleRows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("it-IT");
    return rows.filter((row) => {
      if (type !== "all" && row.type !== type) return false;
      if (!normalizedQuery) return true;
      return `${row.title || ""} ${row.description || ""} ${row.parent} ${row.customer} ${row.owner} ${row.departments} ${row.typeLabel}`.toLocaleLowerCase("it-IT").includes(normalizedQuery);
    });
  }, [query, rows, type]);

  const counts = useMemo(() => ({
    tasks: rows.filter((row) => row.type === "tasks").length,
    projects: rows.filter((row) => row.type === "projects").length,
    reminders: rows.filter((row) => row.type === "reminders").length,
  }), [rows]);

  function updateParam(name, value, defaultValue = "") {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (!value || value === defaultValue) next.delete(name); else next.set(name, value);
      return next;
    }, { replace: true });
  }

  return <div className="v4-page activity-archive-page">
    <div className="page-title-row"><div><h1>Archivio attività</h1><p>Storico unico di attività, task, progetti e reminder conclusi. I dati restano disponibili per CRM e analisi.</p></div></div>
    <div className="activity-archive-kpis" aria-label="Riepilogo archivio">
      <button type="button" className={type === "tasks" ? "active" : ""} onClick={() => updateParam("type", "tasks", "all")}><ListChecks size={21} /><span><strong>{counts.tasks}</strong>Attività / task</span></button>
      <button type="button" className={type === "projects" ? "active" : ""} onClick={() => updateParam("type", "projects", "all")}><Folder size={21} /><span><strong>{counts.projects}</strong>Progetti</span></button>
      <button type="button" className={type === "reminders" ? "active" : ""} onClick={() => updateParam("type", "reminders", "all")}><BellRing size={21} /><span><strong>{counts.reminders}</strong>Reminder</span></button>
      <button type="button" className={type === "all" ? "active" : ""} onClick={() => updateParam("type", "all", "all")}><Archive size={21} /><span><strong>{rows.length}</strong>Totale archivio</span></button>
    </div>
    <div className="v4-toolbar activity-archive-toolbar"><label className="task-search"><Search size={18} /><input value={query} onChange={(event) => updateParam("search", event.target.value)} placeholder="Ricerca rapida totale nell’archivio" /></label><select value={type} onChange={(event) => updateParam("type", event.target.value, "all")} aria-label="Tipo di elemento archiviato"><option value="all">Tutti i tipi</option><option value="tasks">Attività e task</option><option value="projects">Progetti</option><option value="reminders">Reminder</option></select></div>
    {error ? <div className="activity-archive-error" role="alert">{error}</div> : null}
    {loading ? <div className="panel activities-empty">Caricamento archivio...</div> : <div className="panel activity-archive-list"><div className="activity-archive-list-header"><strong>{visibleRows.length} elementi</strong><span>Ordinati dalla chiusura più recente</span></div>{visibleRows.length ? visibleRows.map((row) => <article key={`${row.type}-${row.id}`} className="activity-archive-row"><span className="activity-archive-icon"><CheckCircle2 size={18} /></span><div className="activity-archive-main"><span>{row.typeLabel}</span><strong>{row.title || "Senza titolo"}</strong><small>{row.description || row.parent}</small></div><dl><div><dt>Cliente</dt><dd>{row.customer}</dd></div><div><dt>Progetto / contesto</dt><dd>{row.parent}</dd></div><div><dt>Responsabile / reparto</dt><dd>{row.owner}{row.departments !== "—" ? ` · ${row.departments}` : ""}</dd></div><div><dt>Chiusura</dt><dd>{formatDate(row.closedAt)}</dd></div></dl><Link className="secondary-action" to={row.href}>Apri storico</Link></article>) : <div className="activities-empty">Nessun elemento chiuso corrisponde ai filtri.</div>}</div>}
  </div>;
}
