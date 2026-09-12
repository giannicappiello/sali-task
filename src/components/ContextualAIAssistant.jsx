import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bot, Check, LoaderCircle, Send, ShieldCheck, X } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import "./contextual-ai-assistant.css";

function visibleContext({ pathname, title, module }) {
  const root = document.querySelector(".content-area") || document.querySelector("main") || document.body;
  const controls = [...root.querySelectorAll("input,select,textarea")].slice(0, 40).map((element) => {
    const label = element.labels?.[0]?.innerText || element.getAttribute("aria-label") || element.getAttribute("placeholder") || element.name || "Campo";
    const value = element.tagName === "SELECT" ? element.selectedOptions?.[0]?.textContent : element.value;
    return { label, value };
  }).filter((item) => String(item.value || "").trim());
  const selected = window.getSelection?.()?.toString() || "";
  return {
    system: "workspace", path: pathname, title, module,
    screenCode: root.querySelector("[data-screen-code]")?.dataset?.screenCode || "",
    targetType: root.querySelector("[data-layout-target-type]")?.dataset?.layoutTargetType || "",
    targetCode: root.querySelector("[data-layout-target-code]")?.dataset?.layoutTargetCode || "",
    recordId: root.querySelector("[data-record-id]")?.dataset?.recordId || "",
    selection: selected,
    visibleSummary: (root.innerText || "").replace(/\s+/g, " ").trim().slice(0, 5000),
    fields: controls,
  };
}

async function requestAI(token, body) {
  const response = await fetch("/api/ai/assistant", { method: "POST", headers: { Authorization: `Bearer ${token || ""}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) throw new Error(payload.error || "Richiesta AI non riuscita.");
  return payload;
}

const ACTION_LABELS = {
  UI_CONFIGURE_VIEW: "Configura schermata", ACCESS_ROLE_UPDATE: "Modifica ruolo e accessi", MONITOR_RULE_CREATE: "Crea monitoraggio",
  ARTICLE_UPDATE: "Modifica articolo", DOCUMENT_METADATA_UPDATE: "Modifica documento", FORMULA_CREATE_REVISION: "Crea revisione formula",
  PLANNING_CRITERIA_UPDATE: "Modifica criteri planning", RDP_UPDATE: "Modifica RdP", OP_UPDATE: "Modifica OP",
  LOT_OVERRIDE: "Forza lotto", LOT_DOCUMENT_LINK: "Collega documento al lotto", PURCHASE_PROPOSAL_CREATE: "Crea proposta acquisto",
};

function ControlledAction({ action, busy, onDecision }) {
  const done = ["executed", "rejected", "failed"].includes(action.state);
  return <section className={`context-ai-action risk-${action.risk || "write"}`}>
    <div><ShieldCheck size={17}/><strong>{ACTION_LABELS[action.tool] || action.tool}</strong><span>{action.system === "mes" ? "MES · tunnel firmato" : "Workspace"}</span></div>
    <pre>{JSON.stringify(action.preview || action.result || {}, null, 2)}</pre>
    {done ? <p>Stato: <strong>{action.state}</strong></p> : <div className="context-ai-action-buttons"><button type="button" disabled={busy} onClick={() => onDecision(action, "reject")}><X size={16}/>Rifiuta</button><button type="button" disabled={busy} onClick={() => onDecision(action, "confirm")}><Check size={16}/>Conferma</button></div>}
  </section>;
}

export default function ContextualAIAssistant({ title = "Schermata", module = "Workspace" }) {
  const { session, hasModuleAccess } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef(null);
  const allowed = typeof hasModuleAccess !== "function" || hasModuleAccess("assistente_ai");
  const pageKey = `${location.pathname}${location.search}`;

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);
  if (!allowed) return null;

  async function send(event) {
    event.preventDefault();
    const value = prompt.trim();
    if (!value || busy) return;
    setMessages((current) => [...current, { role: "user", content: value }]); setPrompt(""); setBusy(true); setError("");
    try {
      const currentContext = visibleContext({ pathname: pageKey, title, module });
      const payload = await requestAI(session?.access_token, { prompt: value, mode: "interno", conversationId, messages: messages.map(({ role, content }) => ({ role, content })), screenContext: currentContext });
      setConversationId(payload.conversationId || conversationId);
      setMessages((current) => [...current, { role: "assistant", content: payload.answer, actions: payload.controlledActions || [] }]);
    } catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  }

  async function decide(messageIndex, action, decision) {
    setBusy(true); setError("");
    try {
      const payload = await requestAI(session?.access_token, { action: "controlled_decide", proposalId: action.id, decision });
      setMessages((current) => current.map((message, index) => index !== messageIndex ? message : { ...message, actions: message.actions.map((item) => item.id === action.id ? { ...item, state: payload.controlledAction?.state, result: payload.controlledAction?.result } : item) }).concat({ role: "assistant", content: payload.answer }));
      if (action.tool === "UI_CONFIGURE_VIEW" && payload.controlledAction?.state === "executed") window.dispatchEvent(new CustomEvent("workspace:builder-layout-changed"));
    } catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  }

  return <>
    <button type="button" className="context-ai-trigger" onClick={() => setOpen(true)} aria-label={`Apri assistente AI per ${title}`} title="Chiedi all'AI su questa schermata"><Bot size={21}/><span>AI</span></button>
    {open && typeof document !== "undefined" ? createPortal(<div className="context-ai-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
      <aside className="context-ai-dialog" role="dialog" aria-modal="true" aria-label={`Assistente AI contestuale: ${title}`}>
        <header><div><span>ASSISTENTE CONTESTUALE</span><h2><Bot size={22}/>{title}</h2><p>Conosce la schermata, i filtri e i dati autorizzati visibili.</p></div><button type="button" onClick={() => setOpen(false)} aria-label="Chiudi"><X size={21}/></button></header>
        <div className="context-ai-scope"><ShieldCheck size={16}/> Contesto protetto · {module} · {location.pathname}</div>
        <div className="context-ai-messages">
          {!messages.length ? <div className="context-ai-empty"><Bot size={30}/><strong>Cosa vuoi analizzare o cambiare?</strong><p>Puoi chiedere spiegazioni oppure proporre modifiche a dati, filtri, card e KPI. Le scritture richiedono sempre conferma.</p></div> : null}
          {messages.map((message, index) => <div className={`context-ai-message ${message.role}`} key={`${message.role}-${index}`}><p>{message.content}</p>{message.actions?.map((action) => <ControlledAction key={action.id} action={action} busy={busy} onDecision={(item, decision) => decide(index, item, decision)}/>)}</div>)}
          {busy ? <div className="context-ai-thinking"><LoaderCircle size={18}/> Elaborazione…</div> : null}<div ref={endRef}/>
        </div>
        {error ? <p className="context-ai-error">{error}</p> : null}
        <form onSubmit={send}><textarea rows="2" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Chiedi informazioni o proponi una modifica…"/><button type="submit" disabled={busy || !prompt.trim()} aria-label="Invia"><Send size={19}/></button></form>
      </aside>
    </div>, document.body) : null}
  </>;
}
