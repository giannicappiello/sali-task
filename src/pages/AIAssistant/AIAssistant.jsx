import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, CalendarClock, Camera, Check, ChevronDown, ChevronRight, Database, Download, ExternalLink, Factory, FileText, Folder, FolderKanban, Globe2, LoaderCircle, MessageSquare, PanelLeft, Paperclip, Plus, Search, Send, ShieldCheck, ShoppingCart, Trash2, X } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { prepareAssistantAttachments, serializeAssistantAttachments } from "./assistantAttachments";
import { buildAssistantArtifactFileAsync } from "./assistantArtifacts";
import { isPdfReportRequest } from "./assistantPdf";
import "./AIAssistant.css";
import "./assistantPdf.css";
import "./assistantHistory.css";
import "./assistantAttachments.css";
import "./assistantArial.css";
import "./autoplanning.css";
import "./assistantMobile.css";

const MODE_OPTIONS = [
  { id: "interno", label: "Dati interni", description: "Workspace + MES, piani, documenti e immagini", icon: Database, capability: "internal_data" },
  { id: "web", label: "Ricerca Web", description: "Ricerca online con fonti", icon: Globe2, capability: "web_search" },
];

function initialWelcome() {
  return { id: "welcome", role: "assistant", content: "Buongiorno. Con Dati interni posso analizzare insieme le informazioni autorizzate di Workspace e ProgreMES/MES, inclusi piani, immagini e documenti. Ricerca Web resta separata e usa fonti online. Ogni piano resta una proposta finché non viene approvato.", sources: [] };
}

function modeIsEnabled(capabilities, item) {
  return capabilities?.[item.capability] === true;
}

function isPlanningRequest(text) {
  return /\b(?:pianifica(?:zione|re)?|simula(?:zione|re)?|(?:crea|genera|prepara|proponi)(?:mi)?\s+(?:un\s+)?piano|autoapprend\w*|tempi?\s+(?:standard\w*|effettiv\w*|consuntiv\w*|produzion\w*|lavorazion\w*)|riduc(?:i|e|iamo|zione)\s+(?:i\s+)?tempi)\b/i.test(String(text || ""));
}

function inferredPlanType(text) {
  const value = String(text || "");
  if (/\b(?:produzion\w*|progremes|mes|macchin\w*|risors\w*|capacità|material\w*|autoapprend\w*|tempi?\s+(?:standard\w*|effettiv\w*|consuntiv\w*|lavorazion\w*)|riduc(?:i|e|iamo|zione)\s+(?:i\s+)?tempi)/i.test(value)) return "piano_produzione";
  if (/\b(?:ordin|acquist|approvvigion)/i.test(value)) return "piano_ordini";
  return "piano_attivita";
}

async function requestAI(token, body) {
  const response = await fetch("/api/ai/assistant", {
    method: "POST",
    headers: { Authorization: `Bearer ${token || ""}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) throw new Error(payload.error || "Richiesta AI non riuscita.");
  return payload;
}

export default function AIAssistant() {
  const { session, profile } = useAuth();
  const [capabilities, setCapabilities] = useState(null);
  const [mode, setMode] = useState("interno");
  const [conversationId, setConversationId] = useState("");
  const [conversations, setConversations] = useState([]);
  const [topics, setTopics] = useState([]);
  const [selectedTopicId, setSelectedTopicId] = useState("");
  const [expandedTopics, setExpandedTopics] = useState(() => new Set(["general"]));
  const [topicFormOpen, setTopicFormOpen] = useState(false);
  const [topicName, setTopicName] = useState("");
  const [topicType, setTopicType] = useState("argomento");
  const [historyFilter, setHistoryFilter] = useState("tutte");
  const [historySearch, setHistorySearch] = useState("");
  const [historyBusy, setHistoryBusy] = useState(false);
  const [messages, setMessages] = useState([initialWelcome()]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState("");
  const [proposal, setProposal] = useState(null);
  const [autoPlanningOpen, setAutoPlanningOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [autoProposals, setAutoProposals] = useState([]);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const endRef = useRef(null);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const retentionPromptedRef = useRef(false);

  useEffect(() => {
    if (!session?.access_token) return;
    Promise.all([
      requestAI(session.access_token, { action: "capabilities" }),
      requestAI(session.access_token, { action: "list_conversations" }),
      requestAI(session.access_token, { action: "list_autoplanning" }),
    ]).then(([capabilityPayload, historyPayload, autoPlanningPayload]) => {
      const recentConversations = historyPayload.conversations || [];
      const loadedCapabilities = capabilityPayload.capabilities;
      setCapabilities(loadedCapabilities);
      setConversations(recentConversations);
      setTopics(historyPayload.topics || []);
      setAutoProposals(autoPlanningPayload.proposals || []);
      setExpandedTopics(new Set(["general", ...(historyPayload.topics || []).map((topic) => topic.id)]));
      if (historyPayload.retention?.staleCount > 0 && !retentionPromptedRef.current) {
        retentionPromptedRef.current = true;
        void confirmStaleConversationDeletion(historyPayload.retention);
      }
      const requestedConversation = new URLSearchParams(window.location.search).get("conversation");
      const initialConversationId = requestedConversation || recentConversations[0]?.id || "";
      if (initialConversationId) void openConversation(initialConversationId);
    }).catch((requestError) => setError(requestError.message));
    // L'inizializzazione deve ripartire soltanto quando cambia la sessione autenticata.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);

  useEffect(() => {
    if (!session?.access_token) return undefined;
    const timer = window.setInterval(() => {
      void requestAI(session.access_token, { action: "list_autoplanning" })
        .then((payload) => setAutoProposals(payload.proposals || []))
        .catch(() => {});
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [session?.access_token]);

  const availableModes = useMemo(() => MODE_OPTIONS.filter((item) => modeIsEnabled(capabilities, item)), [capabilities]);
  const activeMode = availableModes.some((item) => item.id === mode) ? mode : (availableModes[0]?.id || "interno");
  const pendingAutoPlanningCount = autoProposals.filter((item) => item.state === "bozza").length;
  const conversationGroups = useMemo(() => {
    const groups = topics.map((topic) => ({ ...topic, conversations: conversations.filter((conversation) => conversation.argomento_id === topic.id) }));
    const general = conversations.filter((conversation) => !conversation.argomento_id);
    const query = historySearch.trim().toLocaleLowerCase("it-IT");
    return [...groups, { id: "general", nome: "Conversazioni generali", tipo: "argomento", conversations: general }]
      .filter((group) => historyFilter === "tutte" || group.tipo === historyFilter)
      .map((group) => {
        if (!query || group.nome.toLocaleLowerCase("it-IT").includes(query)) return group;
        return { ...group, conversations: group.conversations.filter((conversation) => String(conversation.titolo || "Conversazione").toLocaleLowerCase("it-IT").includes(query)) };
      })
      .filter((group) => !query || group.nome.toLocaleLowerCase("it-IT").includes(query) || group.conversations.length > 0);
  }, [conversations, topics, historyFilter, historySearch]);

  async function callAI(body) {
    return requestAI(session?.access_token, body);
  }

  function setConversationInUrl(id = "") {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("conversation", id);
    else url.searchParams.delete("conversation");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  async function refreshConversations() {
    if (!session?.access_token) return;
    const payload = await callAI({ action: "list_conversations" });
    setConversations(payload.conversations || []);
    setTopics(payload.topics || []);
    return payload;
  }

  async function confirmStaleConversationDeletion(retention) {
    const count = Number(retention?.staleCount || 0);
    if (!count) return;
    const message = `Sono presenti ${count} chat non utilizzate da più di ${retention.days || 60} giorni. Confermi l’eliminazione definitiva delle vecchie chat?`;
    const confirmed = window.workspaceConfirm ? await window.workspaceConfirm(message, { title: "Pulizia cronologia AI", variant: "danger", confirmLabel: "Elimina vecchie chat" }) : window.confirm(message);
    if (!confirmed) return;
    try {
      const result = await callAI({ action: "delete_stale_conversations" });
      const refreshed = await refreshConversations();
      if ((retention.staleConversationIds || []).includes(conversationId)) newConversation(selectedTopicId);
      if (result.deletedCount > 0) setError("");
      if (!refreshed?.conversations?.length) newConversation(selectedTopicId);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function openConversation(id) {
    if (!id || historyBusy) return;
    setHistoryBusy(true);
    setAutoPlanningOpen(false);
    setMobileSidebarOpen(false);
    setError("");
    try {
      const payload = await callAI({ action: "load_conversation", conversationId: id });
      const restoredMessages = (payload.messages || []).map((message) => ({
        id: message.id,
        role: message.ruolo,
        content: message.contenuto,
        sources: message.fonti || [],
        artifacts: message.ruolo === "assistant" ? (message.metadati?.artifacts?.length ? message.metadati.artifacts : (message.metadati?.downloadablePdf === true ? [{ id: `${message.id}-pdf`, kind: "pdf", fileName: "report-assistente-ai.pdf", mediaType: "application/pdf" }] : [])) : [],
      }));
      setConversationId(payload.conversation.id);
      setSelectedTopicId(payload.conversation.argomento_id || "");
      setMode(payload.conversation.modalita || "interno");
      setMessages(restoredMessages.length ? restoredMessages : [initialWelcome()]);
      setProposal(null);
      setConversationInUrl(payload.conversation.id);
    } catch (requestError) {
      setError(requestError.message);
      setConversationInUrl("");
    } finally {
      setHistoryBusy(false);
    }
  }

  function newConversation(topicId = selectedTopicId) {
    setAutoPlanningOpen(false);
    setMobileSidebarOpen(false);
    setConversationId("");
    setSelectedTopicId(typeof topicId === "string" && topicId !== "general" ? topicId : "");
    setMessages([initialWelcome()]);
    setProposal(null);
    setPrompt("");
    attachments.forEach((item) => item.preview && URL.revokeObjectURL(item.preview));
    setAttachments([]);
    setError("");
    setConversationInUrl("");
  }

  function toggleTopic(topicId) {
    setExpandedTopics((current) => {
      const next = new Set(current);
      if (next.has(topicId)) next.delete(topicId);
      else next.add(topicId);
      return next;
    });
  }

  function openTopicForm(type) {
    setTopicType(type);
    setTopicName("");
    setTopicFormOpen(true);
  }

  async function createTopic(event) {
    event.preventDefault();
    if (!topicName.trim()) return;
    setHistoryBusy(true);
    setError("");
    try {
      const payload = await callAI({ action: "create_topic", name: topicName.trim(), type: topicType });
      setTopics((current) => [payload.topic, ...current]);
      setExpandedTopics((current) => new Set([...current, payload.topic.id]));
      setSelectedTopicId(payload.topic.id);
      setHistoryFilter(topicType);
      setTopicName("");
      setTopicFormOpen(false);
      newConversation(payload.topic.id);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setHistoryBusy(false);
    }
  }

  async function deleteChat(event, conversation) {
    event.stopPropagation();
    const confirmed = window.workspaceConfirm ? await window.workspaceConfirm(`Confermi l’eliminazione definitiva della chat “${conversation.titolo || "Conversazione"}”?`, { title: "Elimina chat", variant: "danger", confirmLabel: "Elimina chat" }) : window.confirm("Confermi l’eliminazione definitiva della chat?");
    if (!confirmed) return;
    setHistoryBusy(true);
    setError("");
    try {
      await callAI({ action: "delete_conversation", conversationId: conversation.id });
      setConversations((current) => current.filter((item) => item.id !== conversation.id));
      if (conversationId === conversation.id) newConversation(conversation.argomento_id || "");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setHistoryBusy(false);
    }
  }

  async function addAttachments(files) {
    if (!files?.length || attachmentBusy) return;
    setAttachmentBusy(true);
    setError("");
    try {
      const prepared = await prepareAssistantAttachments(files, attachments);
      setAttachments((current) => [...current, ...prepared]);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setAttachmentBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
    }
  }

  function removeAttachment(id) {
    setAttachments((current) => {
      const removed = current.find((item) => item.id === id);
      if (removed?.preview) URL.revokeObjectURL(removed.preview);
      return current.filter((item) => item.id !== id);
    });
  }

  async function submit(event) {
    event.preventDefault();
    const text = prompt.trim();
    if ((!text && attachments.length === 0) || busy || attachmentBusy) return;
    const requestText = text || "Analizza i documenti allegati e riassumi i dati rilevanti.";
    const attachmentNames = attachments.map((item) => item.file.name);
    const displayedText = attachmentNames.length ? `${requestText}\n\nAllegati: ${attachmentNames.join(", ")}` : requestText;
    setError("");
    setBusy(true);
    const pdfRequested = isPdfReportRequest(requestText);
    setMessages((current) => [...current, { id: `user-${Date.now()}`, role: "user", content: displayedText, sources: [] }]);
    try {
      const history = messages.filter((message) => message.id !== "welcome").map(({ role, content }) => ({ role, content }));
      const serializedAttachments = await serializeAssistantAttachments(attachments);
      const planningRequested = activeMode === "interno" && capabilities?.planning === true && isPlanningRequest(requestText);
      const payload = planningRequested
        ? await callAI({ action: "proposal", prompt: requestText, attachments: serializedAttachments, proposalType: inferredPlanType(requestText), conversationId, topicId: selectedTopicId })
        : await callAI({ action: "chat", mode: activeMode, prompt: requestText, attachments: serializedAttachments, conversationId, topicId: selectedTopicId, messages: [...history, { role: "user", content: requestText }] });
      const activeConversationId = payload.conversationId || conversationId;
      setConversationId(activeConversationId);
      if (activeConversationId) setConversationInUrl(activeConversationId);
      setCapabilities(payload.capabilities || capabilities);
      if (payload.proposal) setProposal(payload.proposal);
      const responseArtifacts = payload.artifacts?.length ? payload.artifacts : ((payload.downloadablePdf === true || pdfRequested) ? [{ id: `pdf-${Date.now()}`, kind: "pdf", fileName: "report-assistente-ai.pdf", mediaType: "application/pdf" }] : []);
      setMessages((current) => [...current, { id: `assistant-${Date.now()}`, role: "assistant", content: payload.answer, sources: payload.sources || [], proposal: payload.proposal || null, artifacts: responseArtifacts }]);
      setPrompt("");
      attachments.forEach((item) => item.preview && URL.revokeObjectURL(item.preview));
      setAttachments([]);
      await refreshConversations();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision, targetProposal = proposal) {
    if (!targetProposal?.id || decisionBusy) return;
    setDecisionBusy(true);
    setError("");
    try {
      const payload = await callAI({ action: "decide_proposal", proposalId: targetProposal.id, decision });
      setProposal((current) => current?.id === targetProposal.id ? ({ ...current, state: payload.state }) : current);
      setAutoProposals((current) => current.map((item) => item.id === targetProposal.id ? ({ ...item, state: payload.state }) : item));
      if (!autoPlanningOpen) setMessages((current) => [...current, { id: `decision-${Date.now()}`, role: "assistant", content: payload.message, sources: [] }]);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setDecisionBusy(false);
    }
  }

  return (
    <section className="ai-assistant-page">
      {mobileSidebarOpen && <button type="button" className="ai-mobile-sidebar-overlay" aria-label="Chiudi menu Assistente AI" onClick={() => setMobileSidebarOpen(false)} />}
      <aside className={`ai-assistant-sidebar ${mobileSidebarOpen ? "mobile-open" : ""}`} aria-label="Modalità e cronologia Assistente AI">
        <div className="ai-assistant-brand"><span><Bot size={24} /></span><div><strong>Progre AI</strong><small>Assistente Workspace</small></div><button type="button" className="ai-mobile-sidebar-close" onClick={() => setMobileSidebarOpen(false)} aria-label="Chiudi modalità e cronologia"><X size={20} /></button></div>
        <button type="button" className="ai-new-chat" onClick={() => newConversation(selectedTopicId)}><Plus size={18} /> Nuova chat{selectedTopicId ? " nel gruppo" : ""}</button>
        <div className="ai-mode-list">
          <span>MODALITÀ DISPONIBILI</span>
          {MODE_OPTIONS.map((item) => {
            const Icon = item.icon;
            const enabled = modeIsEnabled(capabilities, item);
            return <button type="button" key={item.id} disabled={!enabled} className={activeMode === item.id ? "active" : ""} onClick={() => { setMode(item.id); setAutoPlanningOpen(false); setMobileSidebarOpen(false); }}><Icon size={19} /><span><strong>{item.label}</strong><small>{enabled ? item.description : "Non abilitata"}</small></span></button>;
          })}
        </div>
        {capabilities?.planning === true && <button type="button" className={`ai-autoplanning-link ${autoPlanningOpen ? "active" : ""}`} onClick={() => { setAutoPlanningOpen(true); setMobileSidebarOpen(false); }}>
          <CalendarClock size={19} />
          <span><strong>AUTOPROGRAMMAZIONE</strong><small>Proposte dai consuntivi MES</small></span>
          {pendingAutoPlanningCount > 0 && <b aria-label={`${pendingAutoPlanningCount} proposte da valutare`}>{pendingAutoPlanningCount}</b>}
        </button>}
        <div className="ai-history-list ai-grouped-history">
          <div className="ai-history-heading"><div><span>CRONOLOGIA</span><strong>Conversazioni</strong></div><small>{conversations.length}</small></div>
          <div className="ai-history-search"><Search size={15} /><input value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="Cerca nelle conversazioni" aria-label="Cerca nelle conversazioni" />{historySearch && <button type="button" onClick={() => setHistorySearch("")} aria-label="Azzera ricerca"><X size={14} /></button>}</div>
          <div className="ai-history-filters" role="group" aria-label="Filtra cronologia">
            {[{ id: "tutte", label: "Tutte" }, { id: "argomento", label: "Argomenti" }, { id: "progetto", label: "Progetti" }].map((filter) => <button type="button" key={filter.id} className={historyFilter === filter.id ? "active" : ""} onClick={() => setHistoryFilter(filter.id)}>{filter.label}</button>)}
          </div>
          <div className="ai-history-create-actions"><button type="button" onClick={() => openTopicForm("argomento")}><Plus size={14} /> Nuovo argomento</button><button type="button" onClick={() => openTopicForm("progetto")}><FolderKanban size={14} /> Nuovo progetto</button></div>
          {topicFormOpen && <form className="ai-topic-form" onSubmit={createTopic}>
            <div><strong>Nuovo {topicType}</strong><button type="button" onClick={() => setTopicFormOpen(false)} aria-label="Chiudi"><X size={14} /></button></div>
            <input autoFocus value={topicName} onChange={(event) => setTopicName(event.target.value)} maxLength={100} placeholder={`Nome ${topicType}`} />
            <button type="submit" disabled={!topicName.trim()}>Crea {topicType}</button>
          </form>}
          {historyBusy && <small className="ai-history-loading">Caricamento...</small>}
          {!historyBusy && conversations.length === 0 && <small className="ai-history-empty">Le conversazioni salvate appariranno qui.</small>}
          {!historyBusy && conversations.length > 0 && conversationGroups.length === 0 && <small className="ai-history-empty">Nessuna conversazione corrisponde ai filtri.</small>}
          <div className="ai-history-groups">{conversationGroups.map((group) => {
            const expanded = expandedTopics.has(group.id);
            const GroupIcon = group.tipo === "progetto" ? FolderKanban : Folder;
            return <section className={`ai-history-group ${selectedTopicId === group.id || (!selectedTopicId && group.id === "general") ? "selected" : ""}`} key={group.id}>
              <div className="ai-history-group-title">
                <button type="button" onClick={() => toggleTopic(group.id)}>{expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}<GroupIcon size={16} /><strong>{group.nome}</strong><small>{group.conversations.length}</small></button>
                {group.id !== "general" && <button type="button" className="ai-group-new-chat" onClick={() => { setSelectedTopicId(group.id); setExpandedTopics((current) => new Set([...current, group.id])); newConversation(group.id); }} title="Nuova chat in questo gruppo"><Plus size={14} /></button>}
              </div>
              {expanded && <div className="ai-history-group-chats">{group.conversations.map((conversation) => (
                <div className={`ai-history-chat ${conversationId === conversation.id ? "active" : ""}`} key={conversation.id}>
                  <button type="button" onClick={() => openConversation(conversation.id)}><MessageSquare size={14} /><span><strong>{conversation.titolo || "Conversazione"}</strong><small>{new Date(conversation.aggiornata_il || conversation.creata_il).toLocaleDateString("it-IT")}</small></span></button>
                  <button type="button" className="ai-delete-chat" onClick={(event) => void deleteChat(event, conversation)} title="Elimina chat" aria-label={`Elimina ${conversation.titolo || "conversazione"}`}><Trash2 size={14} /></button>
                </div>
              ))}{group.conversations.length === 0 && <small className="ai-history-empty">Nessuna chat. Premi + per iniziare.</small>}</div>}
            </section>;
          })}</div>
        </div>
        <div className="ai-access-summary">
          <ShieldCheck size={18} />
          <div><strong>Accesso controllato</strong><small>L’AI vede soltanto i moduli consentiti a {profile?.nome || "questo utente"}.</small></div>
        </div>
        {capabilities && <div className="ai-usage"><span>Utilizzo mensile</span><strong>{capabilities.monthly_requests || 0}{capabilities.monthly_limit ? ` / ${capabilities.monthly_limit}` : ""}</strong></div>}
      </aside>

      <div className="ai-chat-shell">
        <header className="ai-chat-header">
          <div><span className="ai-online-dot" /><div><h1>{autoPlanningOpen ? "Autoprogrammazione" : (MODE_OPTIONS.find((item) => item.id === activeMode)?.label || "Assistente AI")}</h1><p>{autoPlanningOpen ? "Proposte generate dai tempi effettivi ProgreMES" : MODE_OPTIONS.find((item) => item.id === activeMode)?.description}</p></div></div>
          <button type="button" className="ai-mobile-sidebar-trigger" onClick={() => setMobileSidebarOpen(true)} aria-expanded={mobileSidebarOpen}><PanelLeft size={18} /><span>Modalità e chat</span></button>
        </header>

        {autoPlanningOpen && <div className="ai-autoplanning-panel">
          <div className="ai-autoplanning-intro"><CalendarClock size={25} /><div><h2>Proposte da valutare</h2><p>Il sistema confronta i tempi standard con i consuntivi stabili. Nessun tempo viene modificato senza approvazione.</p></div></div>
          {autoProposals.length === 0 && <div className="ai-autoplanning-empty"><Check size={24} /><strong>Nessuna proposta disponibile</strong><span>La verifica automatica continuerà in background.</span></div>}
          {autoProposals.map((item) => <ProposalCard key={item.id} proposal={item} canDecide={capabilities?.apply_plans === true} busy={decisionBusy} onApprove={() => decide("approve", item)} onReject={() => decide("reject", item)} />)}
        </div>}

        {!autoPlanningOpen && <div className="ai-chat-messages" aria-live="polite">
          {messages.map((message) => (
            <article key={message.id} className={`ai-message ${message.role}`}>
              {message.role === "assistant" && <span className="ai-message-avatar"><Bot size={18} /></span>}
              <div className="ai-message-content">
                <p>{message.artifacts?.length ? `Ho elaborato ${message.artifacts.length === 1 ? "il file richiesto" : "i file richiesti"}.` : message.content}</p>
                {message.artifacts?.length > 0 && <div className="ai-generated-artifacts">{message.artifacts.map((artifact) => <AssistantArtifactCard key={artifact.id || artifact.fileName} artifact={artifact} content={message.content} />)}</div>}
                {message.sources?.length > 0 && <div className="ai-message-sources"><strong>Fonti Web</strong>{message.sources.map((source) => <a key={source.id || source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}<ExternalLink size={13} /></a>)}</div>}
                {message.proposal && <ProposalCard proposal={{ ...message.proposal, state: proposal?.id === message.proposal.id ? proposal.state : message.proposal.state }} canDecide={capabilities?.apply_plans === true} busy={decisionBusy} onApprove={() => decide("approve")} onReject={() => decide("reject")} />}
              </div>
            </article>
          ))}
          {busy && <article className="ai-message assistant"><span className="ai-message-avatar"><Bot size={18} /></span><div className="ai-thinking"><LoaderCircle size={18} /> Analisi in corso...</div></article>}
          <div ref={endRef} />
        </div>}

        {error && <div className="ai-chat-error"><span>{error}</span><button type="button" onClick={() => setError("")}><X size={16} /></button></div>}
        {!autoPlanningOpen && <form
          className={`ai-chat-compose ${dragActive ? "is-dragging" : ""}`}
          onSubmit={submit}
          onDragEnter={(event) => { event.preventDefault(); if (capabilities?.vision) setDragActive(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragActive(false); }}
          onDrop={(event) => { event.preventDefault(); setDragActive(false); if (capabilities?.vision) void addAttachments(event.dataTransfer.files); }}
        >
          {capabilities?.vision && <div className="ai-attachment-toolbar">
            <button type="button" className="ai-attachment-action" disabled={busy || attachmentBusy} onClick={() => fileInputRef.current?.click()}><Paperclip size={16} /> Allega</button>
            <button type="button" className="ai-attachment-action" disabled={busy || attachmentBusy} onClick={() => cameraInputRef.current?.click()}><Camera size={16} /> Fotocamera</button>
            {attachmentBusy && <LoaderCircle size={16} className="spin" aria-label="Preparazione allegato" />}
            <input ref={fileInputRef} hidden type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => void addAttachments(event.target.files)} />
            <input ref={cameraInputRef} hidden type="file" accept="image/*" capture="environment" onChange={(event) => void addAttachments(event.target.files)} />
          </div>}
          {attachments.length > 0 && <div className="ai-attachment-list">
            {attachments.map((item) => <div className="ai-attachment-item" key={item.id}>
              {item.preview ? <img src={item.preview} alt="" /> : <span className="ai-attachment-file-icon"><FileText size={18} /></span>}
              <div><strong title={item.file.name}>{item.file.name}</strong><small>{(item.file.size / 1024).toFixed(0)} KB</small></div>
              <button type="button" className="ai-attachment-remove" onClick={() => removeAttachment(item.id)} aria-label={`Rimuovi ${item.file.name}`}><Trash2 size={14} /></button>
            </div>)}
          </div>}
          <div className="ai-compose-row">
            <textarea rows="2" value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder={activeMode === "interno" ? (capabilities?.vision ? "Chiedi sui dati Workspace + MES oppure trascina qui un documento..." : "Chiedi sui dati autorizzati Workspace + MES...") : "Cerca sul Web con fonti verificabili..."} />
            <button type="submit" disabled={(!prompt.trim() && attachments.length === 0) || busy || attachmentBusy} aria-label="Invia richiesta"><Send size={20} /></button>
          </div>
          <small>{capabilities?.vision ? "PDF, JPG, PNG o WebP · massimo 4 file e 2,8 MB complessivi. " : ""}L’AI può commettere errori: verifica sempre dati, ordini e proposte operative.</small>
        </form>}
      </div>
    </section>
  );
}

function AssistantArtifactCard({ artifact, content }) {
  const [download, setDownload] = useState({ loading: true, error: "" });
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    setDownload({ loading: true, error: "" });
    void buildAssistantArtifactFileAsync(artifact, content).then((file) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(file.blob);
      setDownload({ ...file, url: objectUrl, size: file.blob.size, loading: false, error: "" });
    }).catch((artifactError) => {
      if (active) setDownload({ loading: false, error: artifactError.message || "File non disponibile." });
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [artifact, content]);

  if (download.error) return <span className="ai-artifact-error">{download.error}</span>;
  if (download.loading) return <span className="ai-artifact-error">Preparazione del file...</span>;
  const typeLabel = artifact.kind === "image"
    ? (download.mediaType === "image/jpeg" ? "Immagine JPEG" : "Immagine PNG")
    : artifact.kind === "chart" ? "Grafico SVG" : "Documento PDF";
  return <a className="ai-artifact-card" href={download.url} download={download.fileName}>
    <span className={`ai-artifact-icon ${artifact.kind}`}><FileText size={25} /></span>
    <span><strong>{download.fileName}</strong><small>{typeLabel} · {Math.max(1, Math.round(download.size / 1024))} KB</small></span>
    <Download size={19} />
  </a>;
}

function ProposalCard({ proposal, canDecide, busy, onApprove, onReject }) {
  const isDraft = proposal.state === "bozza";
  return (
    <section className="ai-proposal-card">
      <div className="ai-proposal-heading"><div>{proposal.type === "piano_produzione" ? <Factory size={20} /> : proposal.type === "piano_ordini" ? <ShoppingCart size={20} /> : <CalendarClock size={20} />}<strong>{proposal.learningFingerprint ? "Proposta tempi" : "Simulazione"}</strong></div><span>{proposal.state || "bozza"}</span></div>
      <p>{proposal.summary}</p>
      <div className="ai-proposal-columns"><div><strong>Criteri</strong><ul>{proposal.criteria?.map((item) => <li key={item}>{item}</li>)}</ul></div><div><strong>Avvertenze</strong><ul>{proposal.warnings?.length ? proposal.warnings.map((item) => <li key={item}>{item}</li>) : <li>Nessuna avvertenza dichiarata</li>}</ul></div></div>
      {proposal.changes?.length > 0 && <div className="ai-proposal-changes"><strong>Modifiche proposte</strong>{proposal.changes.map((change, index) => <div key={`${change.entity}-${index}`}><span>{change.entity}</span><p><b>Da:</b> {change.current}</p><p><b>A:</b> {change.proposed}</p><small>{change.reason} · Rischio {change.risk}</small></div>)}</div>}
      <div className="ai-proposal-status">{proposal.executable ? <><Check size={17} /> Dati sufficienti secondo la simulazione</> : <><ShieldCheck size={17} /> Servono verifiche o dati aggiuntivi prima dell’applicazione</>}</div>
      {isDraft && canDecide && <div className="ai-proposal-actions"><button type="button" disabled={busy} onClick={onReject}>Rifiuta</button><button type="button" disabled={busy || !proposal.executable} onClick={onApprove}><Check size={17} /> Approva proposta</button></div>}
      {isDraft && !canDecide && <small className="ai-proposal-no-access">Non hai il permesso di approvare o applicare piani.</small>}
    </section>
  );
}
