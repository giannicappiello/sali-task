import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CheckCircle2, FolderKanban, Plus } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabaseClient";
import CrmCustomerLink from "./CrmCustomerLink";
import CrmPeriodFilter, { useCrmPeriod } from "./CrmPeriodFilter";
import { CrmPageHeader, CrmSectionNav } from "./CrmWorkspaceUI";
import { crmTypeConfig, formatDate, formatMoney } from "./crmConfig";

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
  const config = crmTypeConfig(type);
  const period = useCrmPeriod();
  const { profile, canUseModule } = useAuth();
  const canWrite = canUseModule(config.moduleCode, "scrittura");
  const [opportunity, setOpportunity] = useState(null);
  const [stages, setStages] = useState([]);
  const [lossReasons, setLossReasons] = useState([]);
  const [activities, setActivities] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [stageHistory, setStageHistory] = useState([]);
  const [links, setLinks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState({ tipo: "follow_up", titolo: "", data_attivita: "", priorita: "normale" });
  const [completion, setCompletion] = useState(null);
  const [now] = useState(() => Date.now());
  const [transition, setTransition] = useState({ stage_id: "", valore_finale: "", motivo_perdita_id: "", motivo_perdita: "", concorrente: "", data_ricontatto: "" });
  const [projectTitle, setProjectTitle] = useState("");

  const load = useCallback(async () => {
    setError("");
    const opportunityResult = await supabase.from("crm_opportunities")
      .select("*,crm_accounts!inner(id,nome,tipo,codice_cliente_mexal),crm_opportunity_stages(id,nome,codice,finale,vinta,probabilita_default,soglia_aging_giorni)")
      .eq("id", opportunityId).eq("crm_accounts.tipo", type).maybeSingle();
    if (opportunityResult.error || !opportunityResult.data) {
      setError(opportunityResult.error?.message || "Opportunità non trovata o non autorizzata.");
      return;
    }
    const current = opportunityResult.data;
    const [stageResult, reasonResult, activityResult, contactResult, historyResult, linkResult, projectResult] = await Promise.all([
      supabase.from("crm_opportunity_stages").select("*").eq("crm_tipo", type).eq("attiva", true).order("ordine"),
      supabase.from("crm_loss_reasons").select("*").eq("crm_tipo", type).eq("attivo", true).order("ordine"),
      supabase.from("crm_activities").select("*,crm_contacts(nome,cognome)").eq("opportunity_id", opportunityId).order("data_attivita", { ascending: false }),
      supabase.from("crm_contacts").select("id,nome,cognome,ruolo,email,telefono,principale").eq("account_id", current.account_id).order("principale", { ascending: false }),
      supabase.from("crm_opportunity_stage_history").select("*,from_stage:from_stage_id(nome),to_stage:to_stage_id(nome)").eq("opportunity_id", opportunityId).order("changed_at", { ascending: false }),
      supabase.from("crm_workspace_links").select("*").eq("crm_entity_type", "opportunity").eq("crm_entity_id", opportunityId),
      supabase.from("v4_progetti").select("id,titolo,stato,deadline").order("created_at", { ascending: false }).limit(200),
    ]);
    const failure = stageResult.error || reasonResult.error || activityResult.error || contactResult.error || historyResult.error || linkResult.error || projectResult.error;
    if (failure) setError(failure.message);
    setOpportunity(current);
    setStages(stageResult.data || []);
    setLossReasons(reasonResult.data || []);
    setActivities(activityResult.data || []);
    setContacts(contactResult.data || []);
    setStageHistory(historyResult.data || []);
    setLinks(linkResult.data || []);
    setProjects(projectResult.data || []);
    setTransition((value) => ({ ...value, stage_id: current.stage_id || "", valore_finale: current.valore_finale ?? current.valore ?? "", motivo_perdita_id: current.motivo_perdita_id || "", motivo_perdita: current.motivo_perdita || "", concorrente: current.concorrente || "", data_ricontatto: current.data_ricontatto || "" }));
  }, [opportunityId, type]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const selectedStage = stages.find((stage) => stage.id === transition.stage_id);
  const next = useMemo(() => nextOpenActivity(activities), [activities]);
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
    const { data, error: projectError } = await supabase.from("v4_progetti").insert({ titolo: title, descrizione: opportunity.descrizione || `Progetto generato dall’opportunità CRM ${opportunity.titolo}`, deadline: opportunity.chiusura_prevista || null, creato_da: profile.id, modificato_da: profile.id }).select("id").single();
    if (projectError) { setError(projectError.message); setBusy(false); return; }
    await linkProject(data.id); setProjectTitle(""); setBusy(false);
  }

  if (!opportunity) return <div className="crm-page">{message(error)}<div className="crm-loading">Caricamento opportunità...</div></div>;
  const account = opportunity.crm_accounts;
  return <div className="crm-page">
    <CrmPageHeader eyebrow={config.label} title={opportunity.titolo} description="Scheda operativa completa dell’opportunità, con attività, chiusura e collegamenti Workspace." actions={<CrmPeriodFilter period={period} compact />}>
      <CrmSectionNav items={[["Clienti", `${config.basePath}/clienti`], ["Pipeline", `${config.basePath}/pipeline`], ["Attività", `${config.basePath}/attivita`], ...(type === "conto_terzi" ? [["Brief", `${config.basePath}/brief`]] : []), ["Analisi", `${config.basePath}/analisi`]]} period={period} label={`Navigazione ${config.label}`} />
    </CrmPageHeader>
    {message(error)}
    <div className="crm-opportunity-summary panel">
      <div><span>Cliente</span><CrmCustomerLink crmType={type} customerCode={account.codice_cliente_mexal} accountId={account.id} name={account.nome} period={period}>{account.nome}</CrmCustomerLink></div>
      <div><span>Contatto principale</span><strong>{contacts[0] ? `${contacts[0].nome} ${contacts[0].cognome || ""}`.trim() : "Non indicato"}</strong></div>
      <div><span>Fase</span><strong>{opportunity.crm_opportunity_stages?.nome || "Senza fase"}</strong></div>
      <div><span>Valore</span><strong>{formatMoney(opportunity.valore)}</strong></div>
      <div><span>Ponderato</span><strong>{formatMoney(Number(opportunity.valore || 0) * Number(opportunity.probabilita || 0) / 100)}</strong></div>
      <div><span>Prossimo passo</span><strong>{next ? `${next.titolo} · ${formatDate(next.data_attivita)}` : "Mancante"}</strong></div>
      <div className={agingThreshold && stageAge > agingThreshold ? "crm-aging-alert" : ""}><span>Tempo nella fase</span><strong>{stageAge} giorni{agingThreshold ? ` / soglia ${agingThreshold}` : ""}</strong></div>
    </div>
    <div className="crm-detail-grid">
      <form className="panel crm-panel crm-card-form" onSubmit={saveDetails}><h3>Dati opportunità</h3>
        <input required value={opportunity.titolo} onChange={(event) => setOpportunity({ ...opportunity, titolo: event.target.value })} aria-label="Titolo opportunità" />
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
    <section className="panel crm-panel"><h3>Attività e prossimo passo</h3>
      {canWrite ? <form className="crm-inline-form" onSubmit={addActivity}><select value={activity.tipo} onChange={(event) => setActivity({ ...activity, tipo: event.target.value })}>{["telefonata","email","visita","videocall","presentazione","formazione","campionatura","sviluppo_formula","preventivo","follow_up"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select><input required value={activity.titolo} onChange={(event) => setActivity({ ...activity, titolo: event.target.value })} placeholder="Prossima azione" /><input type="datetime-local" value={activity.data_attivita} onChange={(event) => setActivity({ ...activity, data_attivita: event.target.value })} /><select value={activity.priorita} onChange={(event) => setActivity({ ...activity, priorita: event.target.value })}><option value="bassa">Bassa</option><option value="normale">Normale</option><option value="alta">Alta</option></select><button className="primary-action crm-primary" disabled={busy}><Plus size={16} />Aggiungi</button></form> : null}
      <ul className="crm-timeline">{activities.map((item) => <li key={item.id}><strong>{item.titolo}</strong><span>{item.tipo.replaceAll("_", " ")} · {formatDate(item.data_attivita)} · {item.stato}</span>{item.esito ? <small>Esito: {item.esito}</small> : null}{canWrite && item.stato !== "completata" ? <button type="button" className="secondary-action" onClick={() => setCompletion({ id: item.id, esito: "", prossima_azione: "", prossima_data: "" })}><CheckCircle2 size={15} />Completa</button> : null}</li>)}</ul>
    </section>
    {type === "conto_terzi" && opportunity.crm_opportunity_stages?.vinta ? <section className="panel crm-panel"><h3>Progetto Workspace</h3><p>Una opportunità vinta può creare un progetto oppure collegarne uno esistente, senza duplicarlo.</p><form className="crm-inline-form" onSubmit={createProject}><input value={projectTitle} onChange={(event) => setProjectTitle(event.target.value)} placeholder="Titolo nuovo progetto" /><button className="primary-action crm-primary" disabled={!canWrite || busy}><Plus size={16} />Crea progetto</button></form><select defaultValue="" onChange={(event) => void linkProject(event.target.value)} disabled={!canWrite || busy}><option value="">Collega progetto esistente</option>{projects.filter((item) => !linkedProjectIds.has(item.id)).map((item) => <option key={item.id} value={item.id}>{item.titolo}</option>)}</select>{projects.filter((item) => linkedProjectIds.has(item.id)).map((item) => <Link className="crm-row-card" key={item.id} to="/activities/projects"><FolderKanban size={18} /><strong>{item.titolo}</strong><span>{item.stato || "Progetto Workspace"}</span></Link>)}</section> : null}
    <section className="panel crm-panel"><h3>Storico fasi</h3><ul className="crm-timeline">{stageHistory.map((item) => <li key={item.id}><strong>{item.to_stage?.nome || "Fase aggiornata"}</strong><span>{formatDate(item.changed_at)}{item.from_stage?.nome ? ` · da ${item.from_stage.nome}` : ""}</span></li>)}</ul></section>
    {completion ? <div className="crm-modal-backdrop"><form className="crm-modal" onSubmit={completeActivity}><h3>Completa attività</h3><textarea value={completion.esito} onChange={(event) => setCompletion({ ...completion, esito: event.target.value })} placeholder="Esito" /><input value={completion.prossima_azione} onChange={(event) => setCompletion({ ...completion, prossima_azione: event.target.value })} placeholder="Prossima azione (opzionale)" /><input type="datetime-local" value={completion.prossima_data} onChange={(event) => setCompletion({ ...completion, prossima_data: event.target.value })} /><div className="crm-modal-actions"><button type="button" onClick={() => setCompletion(null)}>Annulla</button><button className="primary-action crm-primary" disabled={busy}>Completa e pianifica</button></div></form></div> : null}
  </div>;
}
