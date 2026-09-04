import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabaseClient";
import CrmCustomerLink from "./CrmCustomerLink";
import CrmDeleteActivityButton from "./CrmDeleteActivityButton";
import CrmPeriodFilter, { useCrmPeriod } from "./CrmPeriodFilter";
import { CrmPageHeader, CrmSectionNav } from "./CrmWorkspaceUI";
import { crmTypeConfig, formatDate } from "./crmConfig";
import { crmNavigation } from "./crmNavigation";

export default function CrmActivitiesPage({ type }) {
  const config = crmTypeConfig(type); const period = useCrmPeriod();
  const { canUseModule } = useAuth(); const canWrite = canUseModule(config.moduleCode, "scrittura");
  const [params, setParams] = useSearchParams();
  const [now] = useState(() => Date.now());
  const [rows, setRows] = useState([]); const [error, setError] = useState(""); const [loading, setLoading] = useState(true);
  const status = params.get("activityStatus") || "open"; const activityType = params.get("activityType") || ""; const search = params.get("activitySearch") || "";
  const updateParam = (name, value) => setParams((current) => { const next = new URLSearchParams(current); if (value) next.set(name, value); else next.delete(name); return next; }, { replace: true });
  const load = useCallback(async () => {
    setLoading(true); setError("");
    let query = supabase.from("crm_activities").select("*,crm_accounts(id,nome,codice_cliente_mexal),crm_opportunities(id,titolo)").eq("crm_tipo", type).order("data_attivita", { ascending: true }).limit(2000);
    if (status === "open") query = query.neq("stato", "completata");
    if (status === "completed") query = query.eq("stato", "completata");
    if (activityType) query = query.eq("tipo", activityType);
    const { data, error: loadError } = await query;
    if (loadError) setError(loadError.message); else setRows((data || []).filter((row) => !search || `${row.titolo} ${row.crm_accounts?.nome || ""}`.toLowerCase().includes(search.toLowerCase())));
    setLoading(false);
  }, [activityType, search, status, type]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 150); return () => window.clearTimeout(timer); }, [load]);
  const navigation = crmNavigation(type);
  return <div className="crm-page"><CrmPageHeader eyebrow={config.label} title={`Attività ${config.label}`} description="Agenda CRM centralizzata: scadute, prossime, completate e prive di scadenza." actions={<CrmPeriodFilter period={period} compact />}><CrmSectionNav items={navigation} period={period} label={`Navigazione ${config.label}`} /></CrmPageHeader>
    {error ? <div className="crm-message error">{error}</div> : null}
    <div className="crm-filters"><label><Search size={16} /><input value={search} onChange={(event) => updateParam("activitySearch", event.target.value)} placeholder="Cerca attività o cliente" /></label><select value={status} onChange={(event) => updateParam("activityStatus", event.target.value)}><option value="open">Aperte</option><option value="completed">Completate</option><option value="all">Tutte</option></select><select value={activityType} onChange={(event) => updateParam("activityType", event.target.value)}><option value="">Tutti i tipi</option>{["telefonata","email","visita","videocall","presentazione","formazione","campionatura","sviluppo_formula","preventivo","follow_up"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></div>
    {loading ? <div className="crm-loading">Caricamento attività...</div> : <div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Attività</th><th>Cliente</th><th>Progetto</th><th>Tipo</th><th>Scadenza</th><th>Stato</th>{canWrite ? <th>Azioni</th> : null}</tr></thead><tbody>{rows.map((row) => { const overdue = row.stato !== "completata" && row.data_attivita && new Date(row.data_attivita).getTime() < now; return <tr key={row.id}><td><strong>{row.titolo}</strong>{row.descrizione ? <small>{row.descrizione}</small> : null}</td><td>{row.crm_accounts ? <CrmCustomerLink crmType={type} customerCode={row.crm_accounts.codice_cliente_mexal} accountId={row.crm_accounts.id} name={row.crm_accounts.nome} period={period}>{row.crm_accounts.nome}</CrmCustomerLink> : "—"}</td><td>{row.crm_opportunities ? <Link to={period.withPeriod(`${config.basePath}/pipeline/${row.crm_opportunities.id}`)}>{row.crm_opportunities.titolo}</Link> : "—"}</td><td>{row.tipo.replaceAll("_", " ")}</td><td className={overdue ? "crm-missing-step" : ""}>{row.data_attivita ? formatDate(row.data_attivita) : "Senza scadenza"}</td><td>{row.stato}</td>{canWrite ? <td><CrmDeleteActivityButton activity={row} canDelete onDeleted={load} onError={setError} compact /></td> : null}</tr>; })}</tbody></table>{!rows.length ? <div className="crm-empty">Nessuna attività corrisponde ai filtri.</div> : null}</div>}
  </div>;
}
