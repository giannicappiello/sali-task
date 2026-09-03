import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { CrmBeautyDashboardPanel } from "./CrmBeautyDays";
import CrmCustomerLink from "./CrmCustomerLink";
import CrmPeriodFilter, { useCrmPeriod } from "./CrmPeriodFilter";
import { CrmPageHeader, CrmSectionNav } from "./CrmWorkspaceUI";
import { crmTypeConfig, formatDate, formatMoney } from "./crmConfig";
import { crmNavigation } from "./crmNavigation";

function ErrorMessage({ error }) {
  return error ? <div className="crm-message error">{error}</div> : null;
}

export function CrmDevelopmentsPage() {
  const type = "conto_terzi"; const config = crmTypeConfig(type); const period = useCrmPeriod();
  const [params, setParams] = useSearchParams(); const [rows, setRows] = useState([]); const [error, setError] = useState("");
  const search = params.get("developmentSearch") || ""; const kind = params.get("developmentType") || "";
  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.from("crm_activities").select("id,tipo,titolo,descrizione,stato,data_attivita,crm_accounts(id,nome,codice_cliente_mexal),crm_opportunities(id,titolo)").eq("crm_tipo", type).in("tipo", ["campionatura", "sviluppo_formula", "sviluppo_nuova_formula", "invio_campioni", "preventivo"]).order("data_attivita", { ascending: false }).limit(2000);
    if (loadError) setError(loadError.message); else { setRows(data || []); setError(""); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const visible = rows.filter((row) => (!kind || row.tipo === kind) && (!search || `${row.titolo} ${row.crm_accounts?.nome || ""} ${row.crm_opportunities?.titolo || ""}`.toLowerCase().includes(search.toLowerCase())));
  const setParam = (name, value) => setParams((current) => { const next = new URLSearchParams(current); if (value) next.set(name, value); else next.delete(name); return next; }, { replace: true });
  return <div className="crm-page"><CrmPageHeader eyebrow="CRM PRIVATE" title="Campioni e sviluppi" description="Attività tecniche e commerciali collegate a cliente e opportunità; la creazione operativa avviene dalla scheda opportunità." actions={<CrmPeriodFilter period={period} compact />}><CrmSectionNav items={crmNavigation(type)} period={period} label="Navigazione CRM PRIVATE" /></CrmPageHeader><ErrorMessage error={error} />
    <div className="crm-filters"><label><Search size={16} /><input value={search} onChange={(event) => setParam("developmentSearch", event.target.value)} placeholder="Cerca cliente, opportunità o sviluppo" /></label><select value={kind} onChange={(event) => setParam("developmentType", event.target.value)}><option value="">Tutti i tipi</option><option value="campionatura">Campionatura</option><option value="invio_campioni">Invio campioni</option><option value="sviluppo_formula">Sviluppo formula</option><option value="sviluppo_nuova_formula">Nuova formula</option><option value="preventivo">Preventivo</option></select></div>
    <div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Attività</th><th>Cliente</th><th>Opportunità</th><th>Tipo</th><th>Data</th><th>Stato</th></tr></thead><tbody>{visible.map((row) => <tr key={row.id}><td><strong>{row.titolo}</strong><small>{row.descrizione}</small></td><td>{row.crm_accounts ? <CrmCustomerLink crmType={type} customerCode={row.crm_accounts.codice_cliente_mexal} accountId={row.crm_accounts.id} name={row.crm_accounts.nome} period={period}>{row.crm_accounts.nome}</CrmCustomerLink> : "—"}</td><td>{row.crm_opportunities ? <Link to={period.withPeriod(`${config.basePath}/pipeline/${row.crm_opportunities.id}`)}>{row.crm_opportunities.titolo}</Link> : "—"}</td><td>{row.tipo.replaceAll("_", " ")}</td><td>{formatDate(row.data_attivita)}</td><td>{row.stato}</td></tr>)}</tbody></table>{!visible.length ? <div className="crm-empty">Nessun campione o sviluppo corrisponde ai filtri.</div> : null}</div>
  </div>;
}

export function CrmProjectsPage() {
  const type = "conto_terzi"; const config = crmTypeConfig(type); const period = useCrmPeriod();
  const [rows, setRows] = useState([]); const [error, setError] = useState("");
  const load = useCallback(async () => {
    const opportunityResult = await supabase.from("crm_opportunities").select("id,titolo,crm_accounts!inner(id,nome,tipo,codice_cliente_mexal)").eq("crm_accounts.tipo", type).limit(2000);
    if (opportunityResult.error) { setError(opportunityResult.error.message); return; }
    const opportunities = opportunityResult.data || []; const opportunityIds = opportunities.map((row) => row.id);
    const linkResult = opportunityIds.length ? await supabase.from("crm_workspace_links").select("crm_entity_id,workspace_entity_id").eq("crm_entity_type", "opportunity").eq("workspace_entity_type", "project").in("crm_entity_id", opportunityIds) : { data: [], error: null };
    if (linkResult.error) { setError(linkResult.error.message); return; }
    const projectIds = [...new Set((linkResult.data || []).map((row) => row.workspace_entity_id))];
    const projectResult = projectIds.length ? await supabase.from("v4_progetti").select("id,titolo,stato,deadline").in("id", projectIds) : { data: [], error: null };
    if (projectResult.error) { setError(projectResult.error.message); return; }
    const byOpportunity = new Map(opportunities.map((row) => [row.id, row])); const byProject = new Map((projectResult.data || []).map((row) => [row.id, row]));
    setRows((linkResult.data || []).map((link) => ({ link, opportunity: byOpportunity.get(link.crm_entity_id), project: byProject.get(link.workspace_entity_id) })).filter((row) => row.opportunity && row.project)); setError("");
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  return <div className="crm-page"><CrmPageHeader eyebrow="CRM PRIVATE" title="Progetti collegati" description="Tracciabilità Cliente → Opportunità CRM → Progetto Workspace; nessun progetto esistente viene duplicato o modificato." actions={<CrmPeriodFilter period={period} compact />}><CrmSectionNav items={crmNavigation(type)} period={period} label="Navigazione CRM PRIVATE" /></CrmPageHeader><ErrorMessage error={error} /><div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Progetto Workspace</th><th>Cliente</th><th>Opportunità</th><th>Stato</th><th>Deadline</th><th>Azioni</th></tr></thead><tbody>{rows.map(({ link, opportunity, project }) => <tr key={`${link.crm_entity_id}:${link.workspace_entity_id}`}><td><strong>{project.titolo}</strong></td><td><CrmCustomerLink crmType={type} customerCode={opportunity.crm_accounts.codice_cliente_mexal} accountId={opportunity.crm_accounts.id} name={opportunity.crm_accounts.nome} period={period}>{opportunity.crm_accounts.nome}</CrmCustomerLink></td><td><Link to={period.withPeriod(`${config.basePath}/pipeline/${opportunity.id}`)}>{opportunity.titolo}</Link></td><td>{project.stato}</td><td>{formatDate(project.deadline)}</td><td><Link className="secondary-action" to={`/activities/projects?project=${project.id}`}>Apri progetto</Link></td></tr>)}</tbody></table>{!rows.length ? <div className="crm-empty">Nessun progetto Workspace collegato a opportunità PRIVATE.</div> : null}</div></div>;
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
  const title = mode === "reorders" ? "Riordini e opportunità commerciali" : "Clienti da seguire";
  const description = mode === "reorders" ? "Clienti acquisiti ordinati per ultimo acquisto, frequenza e valore: fuori dalla pipeline prospect, dentro il ciclo di sviluppo." : "Priorità commerciali derivate dall’assenza di attività nel periodo, senza modificare lo stato CRM del cliente.";
  return <div className="crm-page"><CrmPageHeader eyebrow="CRM DIRECT · BtoB" title={title} description={description} actions={<CrmPeriodFilter period={period} compact />}><CrmSectionNav items={crmNavigation(type)} period={period} label="Navigazione CRM B2B" /></CrmPageHeader><ErrorMessage error={error} /><div className="crm-filters"><label><Search size={16} /><input value={search} onChange={(event) => setParams((current) => { const next = new URLSearchParams(current); if (event.target.value) next.set("customerSearch", event.target.value); else next.delete("customerSearch"); return next; }, { replace: true })} placeholder="Cerca cliente o codice" /></label></div><div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Cliente</th><th>Codice</th><th>Segmento dinamico</th><th>Ultimo ordine</th><th>Ordini storici</th><th>Valore storico</th><th>Frequenza</th><th>Riordino atteso</th></tr></thead><tbody>{visible.map((row) => <tr key={row.codice_cliente}><td><CrmCustomerLink crmType={type} customerCode={row.codice_cliente} name={row.ragione_sociale} period={period}>{row.ragione_sociale}</CrmCustomerLink></td><td>{row.codice_cliente}</td><td><span className="status-badge">{row.classificazione.replaceAll("_", " ")}</span></td><td>{formatDate(row.ultimo_ordine_il)}{row.giorni_da_ultimo_ordine != null ? <small>{row.giorni_da_ultimo_ordine} giorni fa</small> : null}</td><td>{row.numero_ordini || 0}</td><td>{formatMoney(row.valore_ordini)}</td><td>{row.frequenza_media_giorni ? `${row.frequenza_media_giorni} gg` : "Non disponibile"}</td><td>{formatDate(row.riordino_atteso_il)}</td></tr>)}</tbody></table>{!visible.length ? <div className="crm-empty">Nessun cliente corrisponde ai filtri.</div> : null}</div></div>;
}

export function CrmB2BFollowUpPage() { return <B2BCustomerActionPage mode="follow-up" />; }
export function CrmB2BReordersPage() { return <B2BCustomerActionPage mode="reorders" />; }

export function CrmBeautyDaysPage() {
  const type = "b2b"; const period = useCrmPeriod();
  return <div className="crm-page"><CrmPageHeader eyebrow="CRM DIRECT · BtoB" title="BeautyDays" description="Giornate effettuate presso le farmacie e lettura dell’impatto commerciale sui dati reali collegati." actions={<CrmPeriodFilter period={period} compact />}><CrmSectionNav items={crmNavigation(type)} period={period} label="Navigazione CRM B2B" /></CrmPageHeader><CrmBeautyDashboardPanel /></div>;
}
