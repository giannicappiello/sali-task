import { useCallback, useEffect, useState } from "react";
import { Bot, CheckCircle2, FilePenLine, RefreshCw, Send, Sparkles, XCircle } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabaseClient";
import CrmPeriodFilter, { useCrmPeriod } from "./CrmPeriodFilter";
import { CrmPageHeader } from "./CrmWorkspaceUI";

async function crmAIRequest(payload) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  const response = await fetch("/api/ai/crm-brief", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token || ""}` },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success === false) throw new Error(result.error || "Richiesta AI non riuscita.");
  return result;
}

function PlanPreview({ decision, busy, onApprove, onRegenerate, onCancel }) {
  const plan = decision?.plan;
  if (!plan) return null;
  return <section className="crm-plan">
    <span className="crm-eyebrow">Preview obbligatoria</span>
    <h3>{plan.project?.title || decision.title}</h3>
    <p>{plan.strategy || decision.summary}</p>
    {plan.facts?.length ? <div><strong>Fatti</strong><ul>{plan.facts.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
    {plan.missingData?.length ? <div><strong>Dati mancanti</strong><ul>{plan.missingData.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
    {plan.interpretations?.length ? <div><strong>Interpretazioni</strong><ul>{plan.interpretations.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
    {plan.recommendations?.length ? <div><strong>Raccomandazioni</strong><ul>{plan.recommendations.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
    {plan.questions?.length ? <div><strong>Informazioni mancanti</strong><ul>{plan.questions.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
    {plan.risks?.length ? <div><strong>Rischi</strong><ul>{plan.risks.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
    {plan.phases?.length ? <div><strong>Piano operativo</strong><ol>{plan.phases.map((phase) => <li key={phase.title}><strong>{phase.title}</strong>{phase.tasks?.length ? <ul>{phase.tasks.map((task) => <li key={task.title}>{task.title}{task.owner ? ` · ${task.owner}` : ""}</li>)}</ul> : null}</li>)}</ol></div> : null}
    <div className="crm-plan-actions">
      <button className="primary-action crm-primary" type="button" disabled={busy || plan.readyForApproval === false} onClick={onApprove}><CheckCircle2 size={17} />Approva e crea progetto</button>
      <button className="secondary-action crm-secondary" type="button" disabled={busy} onClick={onRegenerate}><RefreshCw size={17} />Rigenera</button>
      <button className="secondary-action crm-secondary" type="button" disabled={busy} onClick={onCancel}><XCircle size={17} />Annulla</button>
    </div>
    {plan.readyForApproval === false ? <small>Completa prima le informazioni richieste: il piano non può ancora essere applicato.</small> : null}
  </section>;
}

export default function CrmAIBrief() {
  const location = useLocation();
  const period = useCrmPeriod();
  const { canUseModule } = useAuth();
  const [briefs, setBriefs] = useState([]);
  const [briefId, setBriefId] = useState("");
  const [crmType, setCrmType] = useState(location.state?.crmType || "conto_terzi");
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState([]);
  const [decision, setDecision] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const canWrite = canUseModule("crm_ai", "scrittura");

  const loadBriefs = useCallback(async () => {
    const { data, error: loadError } = await supabase.from("crm_briefs").select("id,titolo,crm_tipo,stato,aggiornato_il").order("aggiornato_il", { ascending: false }).limit(100);
    if (loadError) setError(loadError.message); else setBriefs(data || []);
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void loadBriefs(), 0); return () => window.clearTimeout(timer); }, [loadBriefs]);

  async function loadBrief(id) {
    setBriefId(id); setDecision(null); setResult(null); setError("");
    if (!id) { setMessages([]); return; }
    const [{ data: brief }, { data: storedMessages }, { data: decisions }] = await Promise.all([
      supabase.from("crm_briefs").select("crm_tipo").eq("id", id).single(),
      supabase.from("crm_brief_messages").select("ruolo,contenuto,creato_il").eq("brief_id", id).order("creato_il"),
      supabase.from("crm_ai_decisions").select("id,titolo,riepilogo,piano,stato").eq("brief_id", id).order("versione", { ascending: false }).limit(1),
    ]);
    setCrmType(brief?.crm_tipo || "conto_terzi"); setMessages((storedMessages || []).map((item) => ({ role: item.ruolo, content: item.contenuto })));
    const latest = decisions?.[0]; if (latest?.stato === "proposta") setDecision({ id: latest.id, title: latest.titolo, summary: latest.riepilogo, plan: latest.piano });
  }

  async function analyze(event, regenerate = false) {
    event?.preventDefault();
    const text = prompt.trim() || (regenerate ? "Rigenera il piano considerando l'intera conversazione e proponi alternative più concrete." : "");
    if (!text || !canWrite) return;
    setBusy(true); setError(""); setResult(null);
    try {
      const response = await crmAIRequest({ action: "analyze", briefId: briefId || null, crmType, accountId: location.state?.accountId || null, from: period.from, to: period.to, prompt: text });
      setBriefId(response.briefId); setMessages(response.messages || []); setDecision(response.decision || null); setPrompt(""); await loadBriefs();
    } catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  }

  async function approve() {
    if (!decision?.id || !canWrite) return;
    setBusy(true); setError("");
    try {
      const response = await crmAIRequest({ action: "approve", briefId, decisionId: decision.id });
      setResult(response.application); setDecision(null); await loadBriefs();
    } catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  }

  async function cancelDecision() {
    if (!decision?.id) return;
    const { error: updateError } = await supabase.from("crm_ai_decisions").update({ stato: "rifiutata" }).eq("id", decision.id);
    if (updateError) setError(updateError.message); else setDecision(null);
  }

  return <div className="crm-page">
    <CrmPageHeader eyebrow="CRM Platform AI" title="AI Business Assistant" description="BRIEF → ANALISI → DECISIONE UMANA → PIANO → PROGETTO → FASI → REMINDER" actions={<CrmPeriodFilter period={period} compact />} />
    {error ? <div className="crm-message error">{error}</div> : null}
    <div className="crm-ai-shell">
      <aside className="crm-ai-sidebar"><button className="primary-action crm-primary" type="button" onClick={() => { setBriefId(""); setMessages([]); setDecision(null); setResult(null); }}><FilePenLine size={17} />Nuovo brief</button><h3>Brief salvati</h3><div className="crm-brief-list">{briefs.map((item) => <button type="button" className={briefId === item.id ? "active" : ""} key={item.id} onClick={() => void loadBrief(item.id)}><strong>{item.titolo}</strong><span>{item.crm_tipo} · {item.stato}</span></button>)}</div></aside>
      <section className="crm-ai-main"><header className="crm-ai-head"><Bot size={24} /><div><strong>Chat strategica</strong><span>I dati vengono filtrati server-side prima di essere inviati al modello.</span></div><select value={crmType} disabled={Boolean(briefId)} onChange={(e) => setCrmType(e.target.value)}><option value="conto_terzi">Conto Terzi</option><option value="b2b">B2B</option><option value="online">Online</option></select></header>
        <div className="crm-ai-messages">{!messages.length ? <div className="crm-ai-welcome"><Sparkles size={28} /><h3>Da un obiettivo a un piano controllato</h3><p>Descrivi obiettivo, target, budget, tempistiche e vincoli. L’assistente farà domande prima di proporre un piano.</p></div> : messages.map((message, index) => <div className={`crm-ai-message ${message.role}`} key={`${message.role}-${index}`}>{message.content}</div>)}<PlanPreview decision={decision} busy={busy} onApprove={() => void approve()} onRegenerate={() => void analyze(null, true)} onCancel={() => void cancelDecision()} />{result ? <div className="crm-plan"><h3>Progetto creato</h3><p>{result.message}</p>{result.projectId ? <a className="primary-action crm-primary" href="/activities/projects">Apri i progetti Workspace</a> : null}</div> : null}</div>
        <form className="crm-ai-composer" onSubmit={analyze}><textarea disabled={!canWrite || busy} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Esempio: lanciamo una linea capelli ricci per donne 25-45 anni, budget 20.000 euro, con creator..." /><div className="crm-plan-actions"><button className="primary-action crm-primary" disabled={!canWrite || busy || !prompt.trim()}>{busy ? <RefreshCw className="spin" size={17} /> : <Send size={17} />}{busy ? "Analisi in corso..." : "Analizza e proponi piano"}</button><small>Nessuna attività viene creata senza la tua approvazione esplicita.</small></div></form>
      </section>
    </div>
  </div>;
}
