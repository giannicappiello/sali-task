import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, FolderKanban, ListChecks, Plus } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabaseClient";
import CrmCustomerLink from "./CrmCustomerLink";
import CrmDeleteActivityButton from "./CrmDeleteActivityButton";
import CrmDeleteProjectButton from "./CrmDeleteProjectButton";
import CrmPeriodFilter, { useCrmPeriod } from "./CrmPeriodFilter";
import { CrmPageHeader, CrmSectionNav } from "./CrmWorkspaceUI";
import { crmTypeConfig, formatDate, formatMoney } from "./crmConfig";
import { crmNavigation } from "./crmNavigation";

function message(error) {
  return error ? <div className="crm-message error">{error}</div> : null;
}

function nextOpenActivity(activities) {
  return [...activities]
    .filter((item) => item.stato !== "completata" && item.data_attivita)
    .sort((left, right) => left.data_attivita.localeCompare(right.data_attivita))[0] || null;
}

export default function CrmOpportunityDetail({ type }) {
  const { opportunityId } = useParams();
  const pageLocation = useLocation();
  const navigate = useNavigate();
  const config = crmTypeConfig(type);
  const period = useCrmPeriod();
  const { profile, canUseModule, isAdmin, userDepartmentIds = [] } = useAuth();
  const canWrite = canUseModule(config.moduleCode, "scrittura");
  const [opportunity, setOpportunity] = useState(null);
  const [stages, setStages] = useState([]);
  const [lossReasons, setLossReasons] = useState([]);
  const [activities, setActivities] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [stageHistory, setStageHistory] = useState([]);
  const [links, setLinks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [activityTypes, setActivityTypes] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [users, setUsers] = useState([]);
  const [operationalActivities, setOperationalActivities] = useState([]);
  const [briefs, setBriefs] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState({ tipo: "follow_up", titolo: "", data_attivita: "", priorita: "normale" });
  const [operationalDraft, setOperationalDraft] = useState({ activity_type_id: "", titolo: "", descrizione: "", deadline: "", reparto_id: "", responsabile_id: "" });
  const [operationalPreview, setOperationalPreview] = useState(null);
  const [completion, setCompletion] = useState(null);
  const [now] = useState(() => Date.now());
  const [transition, setTransition] = useState({ stage_id: "", valore_finale: "", motivo_perdita_id: "", motivo_perdita: "", concorrente: "", data_ricontatto: "" });
  const [projectTitle, setProjectTitle] = useState("");
  const [briefDraft, setBriefDraft] = useState({ categoria: "", tipo_prodotto: "", quantita: "", packaging: "", prezzo_target: "", mercati: "", certificazioni: "", formula: "da_sviluppare", claim: "", note: "" });

  const load = useCallback(async () => {
    setError("");
    const opportunityResult = await supabase.from("crm_opportunities")
      .select("*,crm_accounts!inner(id,nome,tipo,codice_cliente_mexal),crm_opportunity_stages(id,nome,codice,finale,vinta,probabilita_default,soglia_aging_giorni)")
      .eq("id", opportunityId).eq("crm_accounts.tipo", type).maybeSingle();
    if (opportunityResult.error || !opportunityResult.data) {
      setError(opportunityResult.error?.message || "Progetto non trovato o non autorizzato.");
      return;
    }
    const current = opportunityResult.data;
    const [stageResult, reasonResult, activityResult, contactResult, historyResult, linkResult, projectResult, typeResult, departmentResult, userResult, userDepartmentsResult, operationalResult, briefResult] = await Promise.all([
      supabase.from("crm_opportunity_stages").select("*").eq("crm_tipo", type).eq("attiva", true).order("ordine"),
      supabase.from("crm_loss_reasons").select("*").eq("crm_tipo", type).eq("attivo", true).order("ordine"),
      supabase.from("crm_activities").select("*,crm_contacts(nome,cognome),responsabile:responsabile_id(nome,cognome)").eq("opportunity_id", opportunityId).order("data_attivita", { ascending: false }),
      supabase.from("crm_contacts").select("id,nome,cognome,ruolo,email,telefono,principale").eq("account_id", current.account_id).order("principale", { ascending: false }),
      supabase.from("crm_opportunity_stage_history").select("*,from_stage:from_stage_id(nome),to_stage:to_stage_id(nome)").eq("opportunity_id", opportunityId).order("changed_at", { ascending: false }),
      supabase.from("crm_workspace_links").select("*").eq("crm_entity_type", "opportunity").eq("crm_entity_id", opportunityId),
      supabase.from("v4_progetti").select("id,titolo,stato,deadline").order("created_at", { ascending: false }).limit(200),
      supabase.from("crm_activity_types").select("*").eq("crm_tipo", type).eq("attivo", true).order("ordine"),
      supabase.from("reparti").select("id,nome").eq("attivo", true).order("nome"),
      supabase.from("utenti").select("id,nome,cognome,reparto_id").eq("attivo", true).order("nome"),
      supabase.from("utenti_reparti").select("utente_id,reparto_id"),
      supabase.rpc("crm_opportunity_operational_progress", { p_opportunity_id: opportunityId }),
      supabase.from("crm_briefs").select("*").eq("opportunity_id", opportunityId).order("aggiornato_il", { ascending: false }),
    ]);
    const failure = stageResult.error || reasonResult.error || activityResult.error || contactResult.error || historyResult.error || linkResult.error || projectResult.error || typeResult.error || departmentResult.error || userResult.error || userDepartmentsResult.error || operationalResult.error || briefResult.error;
    if (failure) setError(failure.message);
    setOpportunity(current);
    setStages(stageResult.data || []);
    setLossReasons(reasonResult.data || []);
    setActivities(activityResult.data || []);
    setContacts(contactResult.data || []);
    setStageHistory(historyResult.data || []);
    setLinks(linkResult.data || []);
    setProjects(projectResult.data || []);
    setActivityTypes(typeResult.data || []);
    const allowedDepartmentIds = new Set(userDepartmentIds);
    setDepartments((departmentResult.data || []).filter((item) => isAdmin || allowedDepartmentIds.has(item.id)));
    const memberships = userDepartmentsResult.data || [];
    setUsers((userResult.data || []).filter((item) => isAdmin || item.id === profile?.id || allowedDepartmentIds.has(item.reparto_id) || memberships.some((membership) => membership.utente_id === item.id && allowedDepartmentIds.has(membership.reparto_id))));
    setOperationalActivities(operationalResult.data || []);
    setBriefs(briefResult.data || []);
    setTransition((value) => ({ ...value, stage_id: current.stage_id || "", valore_finale: current.valore_finale ?? current.valore ?? "", motivo_perdita_id: current.motivo_perdita_id || "", motivo_perdita: current.motivo_perdita || "", concorrente: current.concorrente || "", data_ricontatto: current.data_ricontatto || "" }));
  }, [isAdmin, opportunityId, profile?.id, type, userDepartmentIds]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const selectedStage = stages.find((stage) => stage.id === transition.stage_id);
  const next = useMemo(() => nextOpenActivity(activities), [activities]);
  const nextIsOverdue = Boolean(next?.data_attivita && new Date(next.data_attivita).getTime() < now);
  const nextOwner = next?.responsabile ? `${next.responsabile.nome || ""} ${next.responsabile.cognome || ""}`.trim() : "Responsabile non assegnato";
  const stageEnteredAt = stageHistory[0]?.changed_at || opportunity?.creato_il;
  const stageAge = stageEnteredAt ? Math.max(0, Math.floor((now - new Date(stageEnteredAt).getTime()) / 86400000)) : 0;
  const agingThreshold = opportunity?.crm_opportunity_stages?.soglia_aging_giorni;
  const linkedProjectIds = new Set(links.filter((item) => item.workspace_entity_type === "project").map((item) => item.workspace_entity_id));

  async function saveDetails(event) {
    event.preventDefault(); if (!canWrite || !opportunity) return;
    setBusy(true); setError("");
    const { error: saveError } = await supabase.from("crm_opportunities").update({
      titolo: opportunity.titolo.trim(), descrizione: opportunity.descrizione || null,
      valore: opportunity.valore === "" ? null : Number(opportunity.valore),
      probabilita: opportunity.probabilita === "" ? null : Number(opportunity.probabilita),
      chiusura_prevista: opportunity.chiusura_prevista || null,
    }).eq("id", opportunity.id);
    if (saveError) setError(saveError.message); else await load();
    setBusy(false);
  }

  async function changeStage(event) {
    event.preventDefault(); if (!canWrite) return;
    setBusy(true); setError("");
    const { error: transitionError } = await supabase.rpc("crm_transition_opportunity", {
      p_opportunity_id: opportunityId, p_stage_id: transition.stage_id,
      p_valore_finale: transition.valore_finale === "" ? null : Number(transition.valore_finale),
      p_motivo_perdita_id: transition.motivo_perdita_id || null,
      p_motivo_perdita: transition.motivo_perdita || null, p_concorrente: transition.concorrente || null,
      p_data_ricontatto: transition.data_ricontatto || null,
    });
    if (transitionError) setError(transitionError.message); else await load();
    setBusy(false);
  }

  async function addActivity(event) {
    event.preventDefault(); if (!canWrite || !activity.titolo.trim()) return;
    setBusy(true); setError("");
    const { error: activityError } = await supabase.from("crm_activities").insert({
      crm_tipo: type, account_id: opportunity.account_id, opportunity_id: opportunityId,
      tipo: activity.tipo, titolo: activity.titolo.trim(), data_attivita: activity.data_attivita || null,
      priorita: activity.priorita, responsabile_id: opportunity.responsabile_id || profile.id,
      reparto_id: opportunity.reparto_id || profile.reparto_ids?.[0] || profile.reparto_id || null, creato_da: profile.id,
    });
    if (activityError) setError(activityError.message); else { setActivity({ tipo: "follow_up", titolo: "", data_attivita: "", priorita: "normale" }); await load(); }
    setBusy(false);
  }

  async function createTechnicalBrief(event) {
    event.preventDefault();
    if (!canWrite || type !== "conto_terzi" || !briefDraft.tipo_prodotto.trim()) return;
    setBusy(true); setError("");
    const { error: briefError } = await supabase.from("crm_briefs").insert({
      crm_tipo: type, titolo: `Brief tecnico · ${opportunity.titolo}`, account_id: opportunity.account_id,
      opportunity_id: opportunityId, categoria: briefDraft.categoria || null, tipo_prodotto: briefDraft.tipo_prodotto.trim(),
      quantita: briefDraft.quantita === "" ? null : Number(briefDraft.quantita), packaging: briefDraft.packaging || null,
      prezzo_target: briefDraft.prezzo_target === "" ? null : Number(briefDraft.prezzo_target),
      mercati: briefDraft.mercati.split(",").map((value) => value.trim()).filter(Boolean),
      certificazioni: briefDraft.certificazioni.split(",").map((value) => value.trim()).filter(Boolean),
      claim: briefDraft.claim || null, note: briefDraft.note || null,
      dati: { formula: briefDraft.formula }, responsabile_id: opportunity.responsabile_id || profile.id,
      reparto_id: opportunity.reparto_id || profile.reparto_ids?.[0] || profile.reparto_id || null, creato_da: profile.id,
    });
    if (briefError) setError(briefError.message); else {
      setBriefDraft({ categoria: "", tipo_prodotto: "", quantita: "", packaging: "", prezzo_target: "", mercati: "", certificazioni: "", formula: "da_sviluppare", claim: "", note: "" });
      await load();
    }
    setBusy(false);
  }

  async function completeActivity(event) {
    event.preventDefault(); if (!completion) return;
    setBusy(true); setError("");
    const { error: completionError } = await supabase.rpc("crm_complete_activity", {
      p_activity_id: completion.id, p_esito: completion.esito || null,
      p_prossima_azione: completion.prossima_azione || null, p_prossima_data: completion.prossima_data || null,
    });
    if (completionError) setError(completionError.message); else { setCompletion(null); await load(); }
    setBusy(false);
  }

  async function previewOperationalActivity(event) {
    event.preventDefault();
    if (!canWrite || !operationalDraft.activity_type_id || !operationalDraft.titolo.trim() || !operationalDraft.deadline) return;
    setBusy(true); setError("");
    const { data, error: previewError } = await supabase.rpc("crm_preview_operational_activity", {
      p_activity_type_id: operationalDraft.activity_type_id,
      p_deadline: operationalDraft.deadline,
      p_department_id: operationalDraft.reparto_id || null,
      p_responsible_id: operationalDraft.responsabile_id || null,
    });
    if (previewError) setError(previewError.message); else setOperationalPreview(data);
    setBusy(false);
  }

  async function confirmOperationalActivity() {
    if (!operationalPreview || !canWrite) return;
    setBusy(true); setError("");
    const idempotencyKey = `crm:${opportunityId}:${operationalDraft.activity_type_id}:${operationalDraft.deadline}:${operationalDraft.titolo.trim().toLowerCase()}`;
    const { error: creationError } = await supabase.rpc("crm_create_operational_activity", {
      p_account_id: opportunity.account_id,
      p_opportunity_id: opportunityId,
      p_activity_type_id: operationalDraft.activity_type_id,
      p_title: operationalDraft.titolo.trim(),
      p_description: operationalDraft.descrizione || null,
      p_deadline: operationalDraft.deadline,
      p_department_id: operationalDraft.reparto_id || null,
      p_responsible_id: operationalDraft.responsabile_id || null,
      p_idempotency_key: idempotencyKey,
    });
    if (creationError) setError(creationError.message);
    else {
      setOperationalPreview(null);
      setOperationalDraft({ activity_type_id: "", titolo: "", descrizione: "", deadline: "", reparto_id: "", responsabile_id: "" });
      await load();
    }
    setBusy(false);
  }

  async function linkProject(projectId) {
    if (!canWrite || !projectId) return;
    setBusy(true); setError("");
    const { error: linkError } = await supabase.from("crm_workspace_links").insert({
      crm_entity_type: "opportunity", crm_entity_id: opportunityId,
      workspace_entity_type: "project", workspace_entity_id: projectId, creato_da: profile.id,
      metadati: { source: "crm_opportunity" },
    });
    if (linkError && linkError.code !== "23505") setError(linkError.message); else await load();
    setBusy(false);
  }

  async function createProject(event) {
    event.preventDefault(); const title = projectTitle.trim(); if (!canWrite || !title) return;
    setBusy(true); setError("");
    const { data, error: projectError } = await supabase.from("v4_progetti").insert({ titolo: title, descrizione: opportunity.descrizione || `Progetto Workspace generato dal progetto CRM ${opportunity.titolo}`, deadline: opportunity.chiusura_prevista || null, creato_da: profile.id, modificato_da: profile.id }).select("id").single();
    if (projectError) { setError(projectError.message); setBusy(false); return; }
    await linkProject(data.id); setProjectTitle(""); setBusy(false);
  }

  if (!opportunity) return <div className="crm-page">{message(error)}<div className="crm-loading">Caricamento progetto...</div></div>;
  const account = opportunity.crm_accounts;
  return <div className="crm-page">
    <CrmPageHeader eyebrow={config.label} title={opportunity.titolo} description="Scheda operativa completa del progetto commerciale, con attività, chiusura e collegamenti Workspace." actions={<div className="crm-header-actions"><CrmPeriodFilter period={period} compact /><CrmDeleteProjectButton project={opportunity} canDelete={canWrite} onDeleted={() => navigate(period.withPeriod(`${config.basePath}/pipeline`), { replace: true })} onError={setError} /></div>}>
      <CrmSectionNav items={crmNavigation(type)} period={period} label={`Navigazione ${config.label}`} />
    </CrmPageHeader>
    {message(error)}
    <div className="crm-opportunity-summary panel">
      <div><span>Cliente</span><CrmCustomerLink crmType={type} customerCode={account.codice_cliente_mexal} accountId={account.id} name={account.nome} period={period}>{account.nome}</CrmCustomerLink></div>
      <div><span>Contatto principale</span><strong>{contacts[0] ? `${contacts[0].nome} ${contacts[0].cognome || ""}`.trim() : "Non indicato"}</strong></div>
      <div><span>Fase</span><strong>{opportunity.crm_opportunity_stages?.nome || "Senza fase"}</strong></div>
      <div><span>Valore</span><strong>{formatMoney(opportunity.valore)}</strong></div>
      <div><span>Ponderato</span><strong>{formatMoney(Number(opportunity.valore || 0) * Number(opportunity.probabilita || 0) / 100)}</strong></div>
      <div className={nextIsOverdue || !next ? "crm-aging-alert" : ""}><span>Prossimo passo</span><strong>{next ? `${nextIsOverdue ? "ATTIVITÀ SCADUTA" : "PROSSIMA ATTIVITÀ"} · ${next.titolo}` : "NESSUNA ATTIVITÀ PIANIFICATA"}</strong>{next ? <small>{nextOwner} · {formatDate(next.data_attivita)}</small> : null}</div>
      <div className={agingThreshold && stageAge > agingThreshold ? "crm-aging-alert" : ""}><span>Tempo nella fase</span><strong>{stageAge} giorni{agingThreshold ? ` / soglia ${agingThreshold}` : ""}</strong></div>
      {canWrite ? <Link className="secondary-action" to="/crm/ai" state={{ accountId: account.id, opportunityId, crmType: type }}>Pianifica con AI</Link> : null}
    </div>
    <div className="crm-detail-grid">
      <form className="panel crm-panel crm-card-form" onSubmit={saveDetails}><h3>Dati progetto</h3>
        <input required value={opportunity.titolo} onChange={(event) => setOpportunity({ ...opportunity, titolo: event.target.value })} aria-label="Titolo progetto" />
        <textarea value={opportunity.descrizione || ""} onChange={(event) => setOpportunity({ ...opportunity, descrizione: event.target.value })} placeholder="Descrizione" />
        <input type="number" min="0" step="0.01" value={opportunity.valore ?? ""} onChange={(event) => setOpportunity({ ...opportunity, valore: event.target.value })} placeholder="Valore" />
        <input type="number" min="0" max="100" value={opportunity.probabilita ?? ""} onChange={(event) => setOpportunity({ ...opportunity, probabilita: event.target.value })} placeholder="Probabilità %" />
        <input type="date" value={opportunity.chiusura_prevista || ""} onChange={(event) => setOpportunity({ ...opportunity, chiusura_prevista: event.target.value })} aria-label="Chiusura prevista" />
        {canWrite ? <button className="primary-action crm-primary" disabled={busy}>Salva dati</button> : null}
      </form>
      <form className="panel crm-panel crm-card-form" onSubmit={changeStage}><h3>Avanzamento e chiusura</h3>
        <select value={transition.stage_id} onChange={(event) => setTransition({ ...transition, stage_id: event.target.value })}>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.nome}</option>)}</select>
        {selectedStage?.finale ? <input type="number" min="0" step="0.01" value={transition.valore_finale} onChange={(event) => setTransition({ ...transition, valore_finale: event.target.value })} placeholder="Valore finale" /> : null}
        {selectedStage?.finale && !selectedStage?.vinta ? <><select required value={transition.motivo_perdita_id} onChange={(event) => setTransition({ ...transition, motivo_perdita_id: event.target.value })}><option value="">Motivo perdita</option>{lossReasons.map((reason) => <option key={reason.id} value={reason.id}>{reason.nome}</option>)}</select><input value={transition.concorrente} onChange={(event) => setTransition({ ...transition, concorrente: event.target.value })} placeholder="Concorrente" /><textarea value={transition.motivo_perdita} onChange={(event) => setTransition({ ...transition, motivo_perdita: event.target.value })} placeholder="Dettagli perdita" /><label>Data ricontatto<input type="date" value={transition.data_ricontatto} onChange={(event) => setTransition({ ...transition, data_ricontatto: event.target.value })} /></label></> : null}
        {canWrite ? <button className="primary-action crm-primary" disabled={busy}>Conferma fase</button> : null}
      </form>
    </div>
    {type === "conto_terzi" ? <section className="panel crm-panel"><div className="panel-header"><div><h3>Richiesta cliente e brief tecnico</h3><p>Specifiche di prodotto collegate al progetto commerciale; alimentano campionatura e progetto Workspace senza confondere gli oggetti CRM.</p></div></div>
      {briefs.length ? <div className="crm-list-grid">{briefs.map((brief) => <article className="crm-list-card" key={brief.id}><span>{brief.stato}</span><h3>{brief.tipo_prodotto || brief.titolo}</h3><p>{[brief.categoria, brief.packaging, brief.quantita ? `Q.tà ${Number(brief.quantita).toLocaleString("it-IT")}` : null].filter(Boolean).join(" · ")}</p><small>{brief.prezzo_target != null ? `Target ${formatMoney(brief.prezzo_target)} · ` : ""}{brief.dati?.formula?.replaceAll("_", " ") || "Formula non indicata"}</small></article>)}</div> : <p>Nessun brief tecnico collegato.</p>}
      {canWrite ? <form className="crm-technical-brief-form" onSubmit={createTechnicalBrief}><label>Categoria prodotto<input value={briefDraft.categoria} onChange={(event) => setBriefDraft({ ...briefDraft, categoria: event.target.value })} /></label><label>Tipo prodotto<input required value={briefDraft.tipo_prodotto} onChange={(event) => setBriefDraft({ ...briefDraft, tipo_prodotto: event.target.value })} /></label><label>Quantità indicativa<input type="number" min="0" step="0.001" value={briefDraft.quantita} onChange={(event) => setBriefDraft({ ...briefDraft, quantita: event.target.value })} /></label><label>Formato / packaging<input value={briefDraft.packaging} onChange={(event) => setBriefDraft({ ...briefDraft, packaging: event.target.value })} /></label><label>Target prezzo<input type="number" min="0" step="0.01" value={briefDraft.prezzo_target} onChange={(event) => setBriefDraft({ ...briefDraft, prezzo_target: event.target.value })} /></label><label>Formula<select value={briefDraft.formula} onChange={(event) => setBriefDraft({ ...briefDraft, formula: event.target.value })}><option value="cliente">Formula cliente</option><option value="progre">Formula PROGRE</option><option value="da_sviluppare">Da sviluppare</option></select></label><label>Mercati<input value={briefDraft.mercati} onChange={(event) => setBriefDraft({ ...briefDraft, mercati: event.target.value })} placeholder="Italia, UE" /></label><label>Certificazioni<input value={briefDraft.certificazioni} onChange={(event) => setBriefDraft({ ...briefDraft, certificazioni: event.target.value })} placeholder="ISO, Bio..." /></label><label className="crm-form-wide">Claim richiesti<input value={briefDraft.claim} onChange={(event) => setBriefDraft({ ...briefDraft, claim: event.target.value })} /></label><label className="crm-form-wide">Note tecniche<textarea value={briefDraft.note} onChange={(event) => setBriefDraft({ ...briefDraft, note: event.target.value })} /></label><button className="primary-action crm-primary" disabled={busy}><Plus size={16} />Crea brief tecnico</button></form> : null}
    </section> : null}
    <section className="panel crm-panel crm-operational-section">
      <div className="panel-header crm-operational-heading"><div><h3>Attività operative</h3><p>Task e progetti Workspace collegati al progetto commerciale. L’avanzamento deriva dagli stati reali delle task.</p></div><ListChecks size={22} /></div>
      {operationalActivities.length ? <div className="crm-operational-grid">{operationalActivities.map((item) => <article className="panel crm-operational-card" key={item.activity_id}>
        <div><span className={`status-badge ${item.activity_class === "strutturata" ? "crm-operational-structured" : "crm-operational-simple"}`}>{item.activity_class === "strutturata" ? "Attività strutturata" : "Attività semplice"}</span><strong>{item.activity_title}</strong></div>
        <div className="crm-progress-track" aria-label={`Avanzamento ${item.progress || 0}%`}><i style={{ width: `${Math.min(100, Number(item.progress || 0))}%` }} /></div>
        <b>{Number(item.progress || 0).toLocaleString("it-IT")}%</b>
        <small>{item.completed_tasks}/{item.total_tasks} completate · {item.in_progress_tasks} in corso · {item.blocked_tasks} bloccate · {item.overdue_tasks} scadute</small>
        <small>Deadline {formatDate(item.deadline)} · Reparti: {(item.department_names || []).join(", ") || "non indicati"}</small>
        <small>Prossimo step: {item.next_task_title || "nessuno"}</small>
        <div className="crm-operational-links">{item.project_id ? <Link className="secondary-action" to={`/activities/projects?project=${item.project_id}&returnTo=${encodeURIComponent(pageLocation.pathname + pageLocation.search)}`}>Apri progetto</Link> : null}{item.next_task_id ? <Link className="secondary-action" to={`/activities/tasks?task=${item.next_task_id}&returnTo=${encodeURIComponent(pageLocation.pathname + pageLocation.search)}`}>Apri task</Link> : null}<CrmDeleteActivityButton activity={{ id: item.activity_id, titolo: item.activity_title, activity_class: item.activity_class, workspace_project_id: item.project_id, workspace_task_id: item.next_task_id }} canDelete={canWrite} onDeleted={load} onError={setError} compact /></div>
      </article>)}</div> : <div className="table-message">Nessuna attività operativa collegata.</div>}
      {canWrite ? <form className="crm-operational-form" onSubmit={previewOperationalActivity}>
        <label><span>Tipo attività</span><select required value={operationalDraft.activity_type_id} onChange={(event) => setOperationalDraft({ ...operationalDraft, activity_type_id: event.target.value })}><option value="">Seleziona tipo attività</option>{activityTypes.map((item) => <option key={item.id} value={item.id}>{item.nome} · {item.classe}</option>)}</select></label>
        <label><span>Titolo</span><input required value={operationalDraft.titolo} onChange={(event) => setOperationalDraft({ ...operationalDraft, titolo: event.target.value })} placeholder="Attività da realizzare" /></label>
        <label><span>Deadline</span><input required type="date" value={operationalDraft.deadline} onChange={(event) => setOperationalDraft({ ...operationalDraft, deadline: event.target.value })} /></label>
        <label><span>Reparto</span><select value={operationalDraft.reparto_id} onChange={(event) => setOperationalDraft({ ...operationalDraft, reparto_id: event.target.value })}><option value="">Reparto del progetto</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label>
        <label><span>Responsabile</span><select value={operationalDraft.responsabile_id} onChange={(event) => setOperationalDraft({ ...operationalDraft, responsabile_id: event.target.value })}><option value="">Responsabile del progetto</option>{users.map((item) => <option key={item.id} value={item.id}>{`${item.nome || ""} ${item.cognome || ""}`.trim()}</option>)}</select></label>
        <label className="crm-operational-description"><span>Descrizione</span><textarea value={operationalDraft.descrizione} onChange={(event) => setOperationalDraft({ ...operationalDraft, descrizione: event.target.value })} placeholder="Descrizione operativa" /></label>
        <button className="primary-action crm-primary" disabled={busy}><Plus size={16} />Anteprima creazione</button>
      </form> : null}
    </section>
    <section className="panel crm-panel"><h3>Attività e prossimo passo</h3>
      {canWrite ? <form className="crm-inline-form" onSubmit={addActivity}><select value={activity.tipo} onChange={(event) => setActivity({ ...activity, tipo: event.target.value })}>{["telefonata","email","visita","videocall","presentazione","formazione","campionatura","sviluppo_formula","preventivo","follow_up"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select><input required value={activity.titolo} onChange={(event) => setActivity({ ...activity, titolo: event.target.value })} placeholder="Prossima azione" /><input type="datetime-local" value={activity.data_attivita} onChange={(event) => setActivity({ ...activity, data_attivita: event.target.value })} /><select value={activity.priorita} onChange={(event) => setActivity({ ...activity, priorita: event.target.value })}><option value="bassa">Bassa</option><option value="normale">Normale</option><option value="alta">Alta</option></select><button className="primary-action crm-primary" disabled={busy}><Plus size={16} />Aggiungi</button></form> : null}
      <ul className="crm-timeline">{activities.map((item) => <li key={item.id}><strong>{item.titolo}</strong><span>{item.tipo.replaceAll("_", " ")} · {formatDate(item.data_attivita)} · {item.stato}</span>{item.esito ? <small>Esito: {item.esito}</small> : null}<div className="crm-row-inline-actions">{canWrite && item.stato !== "completata" ? <button type="button" className="secondary-action" onClick={() => setCompletion({ id: item.id, esito: "", prossima_azione: "", prossima_data: "" })}><CheckCircle2 size={15} />Completa</button> : null}<CrmDeleteActivityButton activity={item} canDelete={canWrite} onDeleted={load} onError={setError} compact /></div></li>)}</ul>
    </section>
    {type === "conto_terzi" && opportunity.crm_opportunity_stages?.vinta ? <section className="panel crm-panel"><h3>Progetto Workspace</h3><p>Un progetto commerciale vinto può creare un progetto Workspace oppure collegarne uno esistente, senza duplicarlo.</p><form className="crm-inline-form" onSubmit={createProject}><input value={projectTitle} onChange={(event) => setProjectTitle(event.target.value)} placeholder="Titolo nuovo progetto Workspace" /><button className="primary-action crm-primary" disabled={!canWrite || busy}><Plus size={16} />Crea progetto Workspace</button></form><select defaultValue="" onChange={(event) => void linkProject(event.target.value)} disabled={!canWrite || busy}><option value="">Collega progetto Workspace esistente</option>{projects.filter((item) => !linkedProjectIds.has(item.id)).map((item) => <option key={item.id} value={item.id}>{item.titolo}</option>)}</select>{projects.filter((item) => linkedProjectIds.has(item.id)).map((item) => <Link className="crm-row-card" key={item.id} to="/activities/projects"><FolderKanban size={18} /><strong>{item.titolo}</strong><span>{item.stato || "Progetto Workspace"}</span></Link>)}</section> : null}
    <section className="panel crm-panel"><h3>Storico fasi</h3><ul className="crm-timeline">{stageHistory.map((item) => <li key={item.id}><strong>{item.to_stage?.nome || "Fase aggiornata"}</strong><span>{formatDate(item.changed_at)}{item.from_stage?.nome ? ` · da ${item.from_stage.nome}` : ""}</span></li>)}</ul></section>
    {completion ? <div className="crm-modal-backdrop"><form className="crm-modal" onSubmit={completeActivity}><h3>Completa attività</h3><textarea value={completion.esito} onChange={(event) => setCompletion({ ...completion, esito: event.target.value })} placeholder="Esito" /><input value={completion.prossima_azione} onChange={(event) => setCompletion({ ...completion, prossima_azione: event.target.value })} placeholder="Prossima azione (opzionale)" /><input type="datetime-local" value={completion.prossima_data} onChange={(event) => setCompletion({ ...completion, prossima_data: event.target.value })} /><div className="crm-modal-actions"><button type="button" onClick={() => setCompletion(null)}>Annulla</button><button className="primary-action crm-primary" disabled={busy}>Completa e pianifica</button></div></form></div> : null}
    {operationalPreview ? <div className="crm-modal-backdrop"><div className="crm-modal crm-workflow-preview" role="dialog" aria-modal="true" aria-labelledby="crm-workflow-preview-title"><h3 id="crm-workflow-preview-title">Anteprima attività operativa</h3><p>Verrà creato: <strong>{operationalPreview.project_count} progetto</strong>, <strong>{operationalPreview.task_count} task</strong>, <strong>{operationalPreview.department_count} reparti coinvolti</strong>.</p><ol>{(operationalPreview.tasks || []).map((item, index) => <li key={item.rule_id || index}><strong>{item.title}</strong><span>{formatDate(item.deadline)} · {item.priority || "normale"}{item.mandatory ? " · obbligatoria" : ""}</span></li>)}</ol><div className="crm-modal-actions"><button type="button" className="secondary-action" onClick={() => setOperationalPreview(null)}>Annulla</button><button type="button" className="primary-action crm-primary" onClick={confirmOperationalActivity} disabled={busy}>{busy ? "Creazione..." : "Conferma e crea"}</button></div></div></div> : null}
  </div>;
}
