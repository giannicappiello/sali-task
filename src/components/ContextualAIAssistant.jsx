import { useEffect, useCallback, useState, useRef, lazy, Suspense, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Bot, X, Maximize2 } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { captureAssistantContext, activeWorkspaceDialogs } from '../lib/assistantContext';
import { captureWithMesFrame } from '../lib/assistantFrameContext';
import { getCostAssistantDraft, subscribeCostAssistantDraft } from '../features/production-costs/assistant-bridge';
import CostProposalReview from '../features/production-costs/CostProposalReview';
import './contextual-ai-assistant.css';
import './unified-assistant.css';
import { loadModuleWithRecovery } from '../deployment-recovery.js';
import { waitForModuleRetry } from '../workspace-updates.js';
const Assistant = lazy(() => loadModuleWithRecovery(() => import('../pages/AIAssistant/AIAssistant'), waitForModuleRetry));

export default function ContextualAIAssistant({ title = 'Workspace', module = 'Workspace' }) {
  const { hasModuleAccess, session } = useAuth();
  const location = useLocation();
  const costDraft = useSyncExternalStore(subscribeCostAssistantDraft, getCostAssistantDraft);
  const [costReview, setCostReview] = useState(false);
  const [opened, setOpened] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [dialogs, setDialogs] = useState([]);
  const [promptRequest, setPromptRequest] = useState(null);
  const [contextTitle, setContextTitle] = useState(title);
  const panel = useRef(null);
  const contextRoot = useRef(null);
  const allowed = hasModuleAccess("assistente_ai");
  const open = useCallback(dialog => {
    contextRoot.current = dialog || null;
    setContextTitle(captureAssistantContext({ dialog, path: location.pathname + location.search, title, module }).title);
    setMounted(true); setOpened(true);
  }, [location.pathname, location.search, title, module]);
  useEffect(() => {
    if (!panel.current) return;
    if (opened && !panel.current.open) panel.current.showModal();
    if (!opened && panel.current.open) panel.current.close();
  }, [opened, mounted]);
  useEffect(() => {
    if (!allowed) return;
    const update = () => {
      const next = activeWorkspaceDialogs(document);
      setDialogs(previous => previous.length === next.length && previous.every((node, i) => node === next[i]) ? previous : next);
    };
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'hidden', 'aria-hidden'] }); update();
    return () => observer.disconnect();
  }, [allowed]);
  useEffect(() => {
    const handler = event => {
      if (event.detail?.prompt) setPromptRequest({ text: String(event.detail.prompt).slice(0, 4000), id: crypto.randomUUID() });
      open();
    };
    window.addEventListener('workspace:open-assistant', handler);
    window.addEventListener('workspace:priority-ai', handler);
    return () => { window.removeEventListener('workspace:open-assistant', handler); window.removeEventListener('workspace:priority-ai', handler); };
  }, [open]);
  useEffect(()=>{
    const handler=event=>{
      if(!getCostAssistantDraft()||!event.detail?.costProposalId)return;
      const url=new URL(window.location.href);url.searchParams.set('costProposal',event.detail.costProposalId);window.history.replaceState(window.history.state,'',url);
    };
    window.addEventListener('workspace:assistant-response',handler);
    return()=>window.removeEventListener('workspace:assistant-response',handler);
  },[]);
  if (!allowed) return null;
  const getContext = async () => {
    const context = await captureWithMesFrame(captureAssistantContext({ dialog: contextRoot.current, path: location.pathname + location.search, title, module }));
    setContextTitle(context.title || title);
    return {...context, productionCostSettings:getCostAssistantDraft()?.settings || null};
  };
  return <>
    <button type="button" className="context-ai-trigger" onClick={() => open()} aria-label="Apri assistente AI"><Bot size={21}/><span>AI</span></button>
    {dialogs.map((dialog, i) => createPortal(<button type="button" className="context-ai-trigger assistant-popup-trigger" onClick={event => {event.stopPropagation();open(dialog);}} aria-label="Apri assistente AI per questo popup"><Bot size={18}/> AI</button>, dialog.querySelector('header') || dialog, `ai-popup-${i}`))}
    {mounted && createPortal(<dialog ref={panel} data-workspace-assistant="true" onCancel={() => setOpened(false)} onClose={() => setOpened(false)} className={`workspace-assistant-panel ${expanded ? 'expanded' : ''}`} aria-label="Assistente Workspace">
      <header className="workspace-assistant-heading"><div><strong>Assistente Workspace</strong><small>{contextTitle || title}</small></div><button type="button" onClick={() => setExpanded(!expanded)} aria-label="Espandi o riduci assistente"><Maximize2 size={18}/></button><button type="button" onClick={() => setOpened(false)} aria-label="Chiudi assistente"><X size={20}/></button></header>
      {costDraft && <nav className="assistant-cost-tabs" aria-label="Assistente costi"><button type="button" aria-pressed={!costReview} onClick={()=>setCostReview(false)}>Conversazione</button><button type="button" aria-pressed={costReview} onClick={()=>setCostReview(true)}>Proposte e verifiche costi</button></nav>}
      <div className="assistant-conversation-pane" hidden={Boolean(costDraft && costReview)}>
      <Suspense fallback={<p>Caricamento assistente…</p>}><Assistant key={session?.user?.id} embedded getScreenContext={getContext} promptRequest={promptRequest}/></Suspense>
      </div>
      {costDraft && costReview && <div className="assistant-cost-review"><CostProposalReview {...costDraft}/></div>}
    </dialog>, document.body)}
  </>;
}
