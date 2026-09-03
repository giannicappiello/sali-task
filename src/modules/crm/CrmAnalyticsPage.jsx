import { useCallback, useEffect, useState } from "react";
import InfoTooltip from "../../components/InfoTooltip";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabaseClient";
import CrmPeriodFilter, { useCrmPeriod } from "./CrmPeriodFilter";
import { CrmPageHeader, CrmSectionNav } from "./CrmWorkspaceUI";
import { crmTypeConfig, formatMoney } from "./crmConfig";

function Metric({ label, value, text }) {
  return <article className="kpi-card crm-kpi"><span>{label}<InfoTooltip label={label} text={text} /></span><strong>{value}</strong></article>;
}

export default function CrmAnalyticsPage({ type }) {
  const config = crmTypeConfig(type); const period = useCrmPeriod();
  const { canUseModule } = useAuth(); const canAdmin = canUseModule(config.moduleCode, "amministrazione");
  const [metrics, setMetrics] = useState({}); const [stages, setStages] = useState([]);
  const [settings, setSettings] = useState(null); const [lossReasons, setLossReasons] = useState([]);
  const [newReason, setNewReason] = useState(""); const [error, setError] = useState("");
  const load = useCallback(async () => {
    const [analytics, stageRows, workflow, reasons] = await Promise.all([
      supabase.rpc("crm_opportunity_analytics", { p_crm_type: type, p_from: period.from, p_to: period.to }),
      supabase.from("crm_opportunity_stages").select("*").eq("crm_tipo", type).order("ordine"),
      supabase.from("crm_workflow_settings").select("*").eq("crm_tipo", type).maybeSingle(),
      supabase.from("crm_loss_reasons").select("*").eq("crm_tipo", type).order("ordine"),
    ]);
    const failure = analytics.error || stageRows.error || workflow.error || reasons.error;
    if (failure) setError(failure.message); else { setMetrics(analytics.data || {}); setStages(stageRows.data || []); setSettings(workflow.data || null); setLossReasons(reasons.data || []); }
  }, [period.from, period.to, type]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const navigation = [["Clienti", `${config.basePath}/clienti`], ["Pipeline", `${config.basePath}/pipeline`], ["Attività", `${config.basePath}/attivita`], ["Analisi", `${config.basePath}/analisi`], ...(type === "conto_terzi" ? [["Brief", `${config.basePath}/brief`]] : [])];
  async function saveSettings(event) { event.preventDefault(); const { error: saveError } = await supabase.from("crm_workflow_settings").update(settings).eq("crm_tipo", type); if (saveError) setError(saveError.message); else await load(); }
  async function saveStage(stage) { const { error: saveError } = await supabase.from("crm_opportunity_stages").update({ probabilita_default: stage.probabilita_default, soglia_aging_giorni: stage.soglia_aging_giorni }).eq("id", stage.id); if (saveError) setError(saveError.message); else await load(); }
  async function addLossReason(event) { event.preventDefault(); const name = newReason.trim(); if (!name) return; const code = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""); const { error: saveError } = await supabase.from("crm_loss_reasons").insert({ crm_tipo: type, codice: code, nome: name, ordine: Number(lossReasons.at(-1)?.ordine || 0) + 10 }); if (saveError) setError(saveError.message); else { setNewReason(""); await load(); } }
  return <div className="crm-page">
    <CrmPageHeader eyebrow={config.label} title={`Analisi ${config.label}`} description="Indicatori della pipeline sul perimetro CRM autorizzato." actions={<CrmPeriodFilter period={period} compact />}><CrmSectionNav items={navigation} period={period} label={`Navigazione ${config.label}`} /></CrmPageHeader>
    {error ? <div className="crm-message error">{error}</div> : null}
    <div className="crm-kpi-grid"><Metric label="Conversione" value={metrics.conversion_rate == null ? "—" : `${metrics.conversion_rate}%`} text="Opportunità vinte divise per tutte le opportunità chiuse; calcolo server-side sul periodo e sul perimetro autorizzato." /><Metric label="Valore pipeline" value={formatMoney(metrics.pipeline_value)} text="Somma server-side del valore nominale delle opportunità aperte." /><Metric label="Pipeline ponderata" value={formatMoney(metrics.weighted_value)} text="Valore moltiplicato per probabilità, per ogni opportunità aperta." /><Metric label="Vinte" value={metrics.won || 0} text={`Opportunità chiuse come vinte; valore finale ${formatMoney(metrics.won_value)}.`} /><Metric label="Perse" value={metrics.lost || 0} text={`Opportunità chiuse come perse; valore finale ${formatMoney(metrics.lost_value)}.`} /><Metric label="Durata ciclo" value={metrics.average_cycle_days == null ? "—" : `${metrics.average_cycle_days} gg`} text="Media dei giorni tra apertura e chiusura delle opportunità nel periodo." /></div>
    {canAdmin && settings ? <section className="panel crm-panel"><h3>Configurazione workflow</h3>
      <form className="crm-form-grid" onSubmit={saveSettings}><label>Nuovo cliente (giorni)<input type="number" min="1" value={settings.nuovi_clienti_giorni} onChange={(event) => setSettings({ ...settings, nuovi_clienti_giorni: Number(event.target.value) })} /></label><label>Riordino standard (giorni)<input type="number" min="1" value={settings.riordino_giorni_default} onChange={(event) => setSettings({ ...settings, riordino_giorni_default: Number(event.target.value) })} /></label><label>Post BeautyDays (giorni)<input type="number" min="1" max="180" value={settings.beauty_post_evento_giorni} onChange={(event) => setSettings({ ...settings, beauty_post_evento_giorni: Number(event.target.value) })} /></label><button className="primary-action crm-primary">Salva parametri</button></form>
      <div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Fase</th><th>Probabilità predefinita</th><th>Soglia aging</th><th>Azioni</th></tr></thead><tbody>{stages.map((stage) => <tr key={stage.id}><td>{stage.nome}</td><td><input type="number" min="0" max="100" value={stage.probabilita_default ?? ""} onChange={(event) => setStages((current) => current.map((item) => item.id === stage.id ? { ...item, probabilita_default: event.target.value === "" ? null : Number(event.target.value) } : item))} /></td><td><input type="number" min="1" value={stage.soglia_aging_giorni ?? ""} disabled={stage.finale} onChange={(event) => setStages((current) => current.map((item) => item.id === stage.id ? { ...item, soglia_aging_giorni: event.target.value === "" ? null : Number(event.target.value) } : item))} /></td><td><button type="button" className="secondary-action" onClick={() => void saveStage(stage)}>Salva fase</button></td></tr>)}</tbody></table></div>
      <h3>Motivi di perdita</h3><form className="crm-inline-form" onSubmit={addLossReason}><input value={newReason} onChange={(event) => setNewReason(event.target.value)} placeholder="Nuovo motivo" /><button className="primary-action crm-primary">Aggiungi motivo</button></form><div className="crm-list-grid">{lossReasons.map((reason) => <article className="crm-list-card" key={reason.id}><strong>{reason.nome}</strong><small>{reason.attivo ? "Attivo" : "Non attivo"}</small></article>)}</div>
    </section> : null}
  </div>;
}
