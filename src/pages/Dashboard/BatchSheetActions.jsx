import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Play, Printer } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { Modal } from '../../features/production-costs/common';
import PackagingSheet from './PackagingSheet';
import './BatchSheetActions.css';

const states = {NOT_STARTED:'Da avviare', RUNNING:'In lavorazione', COMPLETED:'Completato', SUSPENDED:'Sospeso', CLOSING:'In chiusura'};

export default function BatchSheetActions({ productionOrderId, kind, children }) {
  const { session } = useAuth();
  const [list, setList] = useState(null), [error, setError] = useState(''), [open, setOpen] = useState(false);
  const [phaseId, setPhaseId] = useState(''), [sheet, setSheet] = useState(null), [busy, setBusy] = useState(false);
  const [confirmStart, setConfirmStart] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const frame = useRef(null);
  const request = useCallback(async (operation, extra = {}, signal) => {
    const response = await fetch('/api/production/actions', { method: 'POST', signal,
      headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'batch_sheet', productionOrderId, kind, operation, ...extra }) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'Batch non disponibile.');
    return value;
  }, [session?.access_token, productionOrderId, kind]);
  useEffect(() => {
    const controller = new AbortController();
    setList(null); setError('');
    request('list', {}, controller.signal).then(value => { if (!controller.signal.aborted) setList(value); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [request]);
  useEffect(() => () => { if (sheet?.url) URL.revokeObjectURL(sheet.url); }, [sheet]);
  const phase = list?.phases?.find(p => p.id === phaseId);
  useEffect(() => {
    if (!open || !phaseId) return;
    const controller = new AbortController();
    setBusy(true); setError(''); setSheet(null); setConfirmStart(false);
    request('sheet', { phaseId }, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(new Blob([Uint8Array.from(atob(value.pdfBase64), c => c.charCodeAt(0))], { type: 'application/pdf' }));
      setSheet({ ...value, url });
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [open, phaseId, request, loadAttempt]);
  async function act(operation) {
    setBusy(true); setError('');
    try {
      await request(operation, { phaseId: sheet.phaseId, contentHash: sheet.contentHash });
      if (operation === 'print') {
        if (sheet.packagingSheet) {
          const { printPackagingSheet } = await import('./printPackagingSheet.jsx');
          await printPackagingSheet(sheet.packagingSheet);
        } else frame.current?.contentWindow?.print();
      }
      else {
        setList(await request('list')); setConfirmStart(false);
        window.dispatchEvent(new Event('workspace:production-changed'));
      }
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }
  if (list?.managed === false) return children;
  const title = kind === 'production' ? 'produzione' : 'confezionamento';
  return <>
    <button type="button" disabled={!list} onClick={() => { setOpen(true); setError(''); setSheet(null); setConfirmStart(false); setPhaseId(list.phases.length === 1 ? list.phases[0].id : ''); }}><FileText size={17}/>Gestione batch {title}</button>
    {!open && error && <p role="alert">{error}</p>}
    {open && <Modal title={`Foglio di ${title} · batch`} className="product-spec-viewer batch-sheet-modal" onClose={() => { if (!busy) { setOpen(false); setSheet(null); } }}>
      <label className="pc-field"><span>Batch / lavorazione</span><select value={phaseId} disabled={busy} onChange={e => { setPhaseId(e.target.value); setSheet(null); setConfirmStart(false); setError(''); }}>
        <option value="">Seleziona il batch</option>
        {list.phases.map(p => <option key={p.id} value={p.id}>Batch {p.number} · {p.quantity} {p.unit} · {p.lotCode || 'Lotto da assegnare'} · {states[p.executionStatus] || p.executionStatus} · {p.resource}{p.phase === 7 ? ' · Astucciatura' : ''}</option>)}
      </select></label>
      {!list.phases.length && <p>Nessuna lavorazione di {title} disponibile per questo ordine.</p>}
      {error && !sheet && phaseId && <button type="button" disabled={busy} onClick={() => setLoadAttempt(value => value + 1)}>Riprova apertura foglio</button>}
      {error && <p role="alert" className="pc-error">{error}</p>}
      {busy && <p role="status">Operazione in corso…</p>}
      {sheet && (sheet.packagingSheet ? <div className="packaging-sheet-content"><PackagingSheet sheet={sheet.packagingSheet}/></div> : <iframe ref={frame} title={`Foglio di ${title}`} src={sheet.url}/>)}
      {confirmStart && <p>Confermi l’avvio del batch {phase?.number} selezionato su {phase?.resource}?</p>}
      <footer><button type="button" disabled={busy} onClick={() => { setOpen(false); setSheet(null); }}>Chiudi</button>
        <button type="button" disabled={!sheet || busy} onClick={() => act('print')}><Printer size={17}/>Stampa foglio</button>
        {phase?.executionStatus === 'NOT_STARTED' && <button type="button" disabled={!sheet || busy} onClick={() => confirmStart ? act('start') : setConfirmStart(true)}><Play size={17}/>{confirmStart ? 'Conferma avvio' : 'Avvia lavorazione'}</button>}
      </footer>
    </Modal>}
  </>;
}
