import { useEffect, useCallback, useState, useRef, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { Bot, X, Maximize2 } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { captureAssistantContext, activeWorkspaceDialogs } from '../lib/assistantContext';
import './contextual-ai-assistant.css';
import './unified-assistant.css';
import { loadModuleWithRecovery } from '../deployment-recovery.js';
import { waitForModuleRetry } from '../workspace-updates.js';
const Assistant = lazy(() => loadModuleWithRecovery(() => import('../pages/AIAssistant/AIAssistant'), waitForModuleRetry));

export default function ContextualAIAssistant({ title = 'Workspace', module = 'Workspace' }) {
  const { hasModuleAccess, session } = useAuth();
  const location = useLocation();
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
  if (!allowed) return null;
  const getContext = () => captureAssistantContext({ dialog: contextRoot.current, path: location.pathname + location.search, title, module });
  return <>
    <button type="button" className="context-ai-trigger" onClick={() => open()} aria-label="Apri assistente AI"><Bot size={21}/><span>AI</span></button>
    {dialogs.map((dialog, i) => createPortal(<button type="button" className="context-ai-trigger assistant-popup-trigger" onClick={event => {event.stopPropagation();open(dialog);}} aria-label="Apri assistente AI per questo popup"><Bot size={18}/> AI</button>, dialog.querySelector('header') || dialog, `ai-popup-${i}`))}
    {mounted && createPortal(<dialog ref={panel} data-workspace-assistant="true" onCancel={() => setOpened(false)} onClose={() => setOpened(false)} className={`workspace-assistant-panel ${expanded ? 'expanded' : ''}`} aria-label="Assistente Workspace">
      <header className="workspace-assistant-heading"><div><strong>Assistente Workspace</strong><small>{contextTitle || title}</small></div><button type="button" onClick={() => setExpanded(!expanded)} aria-label="Espandi o riduci assistente"><Maximize2 size={18}/></button><button type="button" onClick={() => setOpened(false)} aria-label="Chiudi assistente"><X size={20}/></button></header>
      <Suspense fallback={<p>Caricamento assistente…</p>}><Assistant key={session?.user?.id} embedded getScreenContext={getContext} promptRequest={promptRequest}/></Suspense>
    </dialog>, document.body)}
  </>;
}
