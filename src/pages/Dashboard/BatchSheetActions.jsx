import { batchPrintStart } from './batchPrintStart.js';
import PackagingActualEditor from './PackagingActualEditor';
import { assertPackagingEditorAvailable } from './packagingActualAvailability.js';
import { observeCentralPrint, pendingCentralPrint, finishCentralPrint } from './centralPrint.js';
import { useCallback, useEffect, useState } from 'react';
import { FileText, Play, Printer } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { Modal } from '../../features/production-costs/common';
import './BatchSheetActions.css';

const states = {NOT_STARTED:'Da avviare', RUNNING:'In lavorazione', COMPLETED:'Completato', SUSPENDED:'Sospeso', CLOSING:'In chiusura'};

export default function BatchSheetActions({ productionOrderId, kind, children }) {
  const { session } = useAuth();
  const [list, setList] = useState(null), [error, setError] = useState(''), [open, setOpen] = useState(false);
  const [phaseId, setPhaseId] = useState(''), [sheet, setSheet] = useState(null), [busy, setBusy] = useState(false);
  const [autoEdit, setAutoEdit] = useState(false);
  const [editing, setEditing] = useState(false), [savedActual, setSavedActual] = useState(null);
  const [confirmStart, setConfirmStart] = useState(false);
  const [allowShortage, setAllowShortage] = useState(false);
  const [printedHash, setPrintedHash] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [printMessage, setPrintMessage] = useState('');
  const [printPending, setPrintPending] = useState(false);
  const printKey = `mes-print:batch:${session?.user?.id}:${productionOrderId}:${kind}:${phaseId}`;
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
  const phases = list?.phases || [];
  const phase = phases.find(p => p.id === phaseId);
  useEffect(() => {
    if (!open || !phaseId) return;
    const controller = new AbortController();
    setBusy(true); setError(''); setSheet(null); setConfirmStart(false); setEditing(false); setAllowShortage(false); setPrintedHash('');
    request('sheet', { phaseId }, controller.signal).then(async value => {
      const blob = value.packagingSheet
        ? (await import('./packagingSheetPdf.js')).packagingSheetPdf(value.packagingSheet)
        : new Blob([Uint8Array.from(atob(value.pdfBase64), c => c.charCodeAt(0))], { type: 'application/pdf' });
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      setSheet({ ...value, url });
      if (autoEdit && list?.phases?.some(p => p.id === phaseId && p.phase === 3 && ['RUNNING','SUSPENDED','CLOSING'].includes(p.executionStatus))) {
        assertPackagingEditorAvailable(value);
        const actual = await request('actual-sheet', {phaseId}, controller.signal);
        if (!controller.signal.aborted) { setSavedActual(actual.saved); setEditing(true); }
      }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [open, phaseId, request, loadAttempt, autoEdit]);
  async function printSheet() {
    const pending = pendingCentralPrint(printKey, { hash: sheet.contentHash, phaseId: sheet.phaseId });
    if (pending.hash !== sheet.contentHash || pending.phaseId !== sheet.phaseId)
      throw new Error('Una stampa precedente è ancora in attesa. Verificare la coda MES prima di avviare il foglio aggiornato.');
    setPrintPending(true);
    const job = await observeCentralPrint(() => request('print', { phaseId: pending.phaseId, contentHash: pending.hash, printRequestId: pending.id }),
      (job, message) => setPrintMessage(message || 'Stampa ' + job.status + ' su PRODUZIONE (' + job.printer + ').'));
    if (job) {
      finishCentralPrint(printKey); setPrintPending(false);
      if (job.status === 'Failed' || job.confirmationError)
        throw new Error(job.confirmationError || 'Stampa non riuscita: ' + job.error);
      setPrintedHash(sheet.contentHash);
    }
    return job;
  }
  async function act(operation) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (operation === 'print') await printSheet();
      else {
        if (operation === 'print-start') {
          const started = await batchPrintStart({ alreadyPrinted: printedHash === sheet.contentHash,
            print: printSheet, onPrinted: () => setPrintedHash(sheet.contentHash),
            start: () => request('start', { phaseId: sheet.phaseId, contentHash: sheet.contentHash, allowShortage }) });
          if (!started) return;
          setPrintMessage('Foglio stampato. Lavorazione in produzione nel MES. Il caricamento PLC viene confermato nella UI della Station collegata.');
        } else await request(operation, { phaseId: sheet.phaseId, contentHash: sheet.contentHash });
        setList(await request('list')); setConfirmStart(false);
        window.dispatchEvent(new Event('workspace:production-changed'));
      }
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }
  async function saveSheet(actual) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = await request('complete-sheet', {phaseId, contentHash:savedActual?.sheetHash || sheet.contentHash, actual});
      if (!result.closed) throw new Error('Chiusura non confermata: riaprire il foglio prima di riprovare.');
      setPrintMessage(result.message); setEditing(false); setList(await request('list'));
      window.dispatchEvent(new Event('workspace:production-changed'));
    } catch (cause) { setError(cause.message); } finally { setBusy(false); }
  }
  if (list?.managed === false) return children;
  const title = kind === 'production' ? 'produzione' : 'confezionamento';
  return <>
    <button type="button" disabled={!list || open} onClick={() => {
      setAutoEdit(kind === 'packaging'); setOpen(true); setError(''); setSheet(null); setConfirmStart(false); setPrintMessage('');
      setPhaseId(phases.length === 1 ? phases[0].id : '');
    }}><FileText size={17}/>{kind === 'packaging' && list?.phases?.some(p => p.phase === 3 && ['RUNNING','SUSPENDED','CLOSING'].includes(p.executionStatus)) ? 'Compila foglio' : `Gestione batch ${title}`}</button>
    {!open && error && <p role="alert">{error}</p>}
    {open && <Modal title={`Foglio di ${title} · batch`} className="product-spec-viewer batch-sheet-modal" onClose={() => { if (!busy) { setOpen(false); setSheet(null); setError(''); } }}>
      <label className="pc-field"><span>Batch / lavorazione</span><select value={phaseId} disabled={busy} onChange={e => { setPhaseId(e.target.value); setPrintMessage(''); setPrintPending(false); setSheet(null); setConfirmStart(false); setError(''); }}>
        <option value="">Seleziona il batch</option>
        {phases.map(p => <option key={p.id} value={p.id}>Batch {p.number} · {p.quantity} {p.unit} · {p.lotCode || 'Lotto da assegnare'} · {states[p.executionStatus] || p.executionStatus} · {p.resource}{p.phase === 7 ? ' · Astucciatura' : ''}</option>)}
      </select></label>
      {phase?.actualStart && <p><strong>Avviata il {String(phase.actualStart).replace("T"," ").slice(0,16)}</strong></p>}
      {list && !phases.length && <p>Nessuna lavorazione di {title} disponibile per questo ordine.</p>}
      {error && !sheet && phaseId && <button type="button" disabled={busy} onClick={() => setLoadAttempt(value => value + 1)}>Riprova apertura foglio</button>}
      {error && <p role="alert" className="pc-error">{error}</p>}
      {printMessage && <p role="status">{printMessage}</p>}
      {busy && <p role="status">Operazione in corso…</p>}
      {sheet && !editing && <iframe title={`Foglio di ${title}`} srcDoc={sheet.sheetHtml || undefined} src={sheet.sheetHtml ? undefined : sheet.url}/>}
      {editing && sheet && <PackagingActualEditor key={phaseId} sheet={sheet} saved={savedActual} busy={busy} onSave={saveSheet} onCancel={() => setEditing(false)}/>}
      {confirmStart && <p>Confermi l’avvio del batch {phase?.number} selezionato su {phase?.resource}?</p>}
      {!editing && <footer><button type="button" disabled={busy} onClick={() => { setOpen(false); setSheet(null); setError(''); }}>Chiudi</button>
        <button type="button" disabled={!sheet || busy} onClick={() => act('print')}><Printer size={17}/>{printPending ? 'Verifica stampa' : kind === 'production' ? 'Stampa Foglio' : printMessage ? 'Ristampa su PRODUZIONE' : 'Stampa su PRODUZIONE'}</button>
        {kind === 'production' && <label className="batch-start-shortage"><input type="checkbox" checked={allowShortage} disabled={busy || phase?.executionStatus !== 'NOT_STARTED'} onChange={e => setAllowShortage(e.target.checked)}/> Avvia con materiali mancanti</label>}
        {kind === 'production' && <button type="button" disabled={!sheet || busy || phase?.executionStatus !== 'NOT_STARTED'} onClick={() => act('print-start')}><Play size={17}/>Stampa e Avvia</button>}
        {kind !== 'production' && phase?.executionStatus === 'NOT_STARTED' && <button type="button" disabled={!sheet || busy} onClick={() => confirmStart ? act('start') : setConfirmStart(true)}><Play size={17}/>{confirmStart ? 'Conferma avvio' : 'Avvia lavorazione'}</button>}
        {kind === 'packaging' && phase?.executionStatus === 'COMPLETED' && <button type="button" disabled={busy} onClick={async () => { try { setPrintMessage((await request('archive-status',{phaseId})).message); } catch(e) { setError(e.message); } }}>Verifica PDF sul NAS</button>}
      </footer>}
    </Modal>}
  </>;
}
