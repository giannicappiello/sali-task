import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { Plus, Search } from "lucide-react";
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
  const pageLocation = useLocation();
  const [params, setParams] = useSearchParams();
  const [now] = useState(() => Date.now());
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const status = params.get("activityStatus") || "open";
  const due = params.get("activityDue") || "";
  const search = params.get("activitySearch") || "";

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
        .select("id,titolo,descrizione,stato,deadline,completato_at,crm_customer_key,source_type,v4_progetti(id,titolo,crm_customer_key)")
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
        return [{ ...task, customerKey, customer, completed }];
      }));
    }
    setLoading(false);
  }, [due, now, search, status, type]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 150);
    return () => window.clearTimeout(timer);
  }, [load]);

  const navigation = crmNavigation(type);
  const returnTo = encodeURIComponent(pageLocation.pathname + pageLocation.search);
  const directCustomer = type === "brand_direct" ? `&customerKey=${encodeURIComponent(VIRTUAL_DIRECT_CUSTOMER_KEY)}` : "";
  return <div className="crm-page">
    <CrmPageHeader eyebrow={config.label} title={`Attività ${config.label}`} description="Le stesse task e fasi operative del modulo Attività, filtrate per cliente CRM." actions={<><CrmPeriodFilter period={period} compact /><Link className="primary-action crm-primary" to={`/activities/tasks?new=1&crmType=${encodeURIComponent(type)}&returnTo=${returnTo}${directCustomer}`}><Plus size={16} />Nuova attività</Link></>}>
      <CrmSectionNav items={navigation} period={period} label={`Navigazione ${config.label}`} />
    </CrmPageHeader>
    {error ? <div className="crm-message error">{error}</div> : null}
    <div className="crm-filters"><label><Search size={16} /><input value={search} onChange={(event) => updateParam("activitySearch", event.target.value)} placeholder="Cerca attività, cliente o progetto" /></label><select value={status} onChange={(event) => updateParam("activityStatus", event.target.value)}><option value="open">Aperte</option><option value="completed">Completate</option><option value="all">Tutte</option></select></div>
    {loading ? <div className="crm-loading">Caricamento attività...</div> : <div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Attività / task</th><th>Cliente</th><th>Progetto</th><th>Scadenza</th><th>Stato</th><th>Azioni</th></tr></thead><tbody>{rows.map((row) => {
      const overdue = !row.completed && row.deadline && new Date(`${row.deadline}T23:59:59`).getTime() < now;
      return <tr key={row.id}><td><strong>{row.titolo}</strong>{row.descrizione ? <small>{row.descrizione}</small> : null}</td><td><CrmCustomerLink crmType={type} customerCode={row.customer.customerCode} accountId={row.customer.accountId} name={row.customer.name} period={period}>{row.customer.name}</CrmCustomerLink></td><td>{row.v4_progetti ? <Link to={`/activities/projects?project=${row.v4_progetti.id}`}>{row.v4_progetti.titolo}</Link> : "Attività singola"}</td><td className={overdue ? "crm-missing-step" : ""}>{row.deadline ? formatDate(row.deadline) : "Senza scadenza"}</td><td>{row.stato || "da evadere"}</td><td><Link className="secondary-action" to={`/activities/tasks?task=${row.id}`}>Apri task</Link></td></tr>;
    })}</tbody></table>{!rows.length ? <div className="crm-empty">Nessuna task o fase corrisponde ai filtri.</div> : null}</div>}
  </div>;
}
