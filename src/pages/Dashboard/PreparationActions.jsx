import { observeCentralPrint, pendingCentralPrint, finishCentralPrint } from './centralPrint.js';
import BatchSheetActions from './BatchSheetActions';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Monitor, Play, Printer, Square } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { Modal } from '../../features/production-costs/common';
import ProductSpecificationViewButton from '../Documentation/ProductSpecificationViewButton';
import '../Documentation/ProductSpecification.css';
import { stationActionUrl } from './productionCalendar';
import { requestProgremesWorkspaceWindow } from '../ProgreMes/progremesWindow';

function pdfUrl(base64) {
  return URL.createObjectURL(new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], { type: 'application/pdf' }));
}
export default function PreparationActions({ activity, onStarted }) {
  const { session, dataScope } = useAuth();
  const customerScoped = Boolean(dataScope?.customerCode || dataScope?.customerCodes?.length);
  const [context, setContext] = useState(null), [mode, setMode] = useState(''), [error, setError] = useState('');
  const [sheet, setSheet] = useState(null), [busy, setBusy] = useState(false);
  const frame = useRef(null);
  const printRequest = useRef(null);
  const [printMessage, setPrintMessage] = useState('');
  const [printPending, setPrintPending] = useState(false);
  const printKey = `mes-print:production:${session?.user?.id}:${activity.productionOrderId}`;
  const request = useCallback(async (operation, extra = {}, signal) => {
    const response = await fetch('/api/production/actions', { method: 'POST', signal,
      headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'preparation_actions', productionOrderId: activity.productionOrderId,
        resourceCode: activity.resourceCode, operation, ...extra }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Operazione MES non riuscita.');
    return result;
  }, [session?.access_token, activity.productionOrderId, activity.resourceCode]);
  useEffect(() => {
    if (customerScoped) return undefined;
    const controller = new AbortController();
    request('context', {}, controller.signal).then(value => { if (!controller.signal.aborted) setContext(value); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [request, customerScoped]);
  useEffect(() => () => { if (sheet?.url) URL.revokeObjectURL(sheet.url); }, [sheet?.url]);
  async function openSheet() {
    setMode('sheet'); setSheet(null); setError(''); setBusy(true);
    try { const result = await request('sheet'); setSheet({ ...result, url: pdfUrl(result.pdfBase64) }); }
    catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }
  async function print() {
    setBusy(true); setError('');
    try {
      printRequest.current ||= pendingCentralPrint(printKey, { hash: sheet.contentHash });
      const pending = printRequest.current;
      setPrintPending(true);
      const job = await observeCentralPrint(() => request('print', { contentHash: pending.hash, printRequestId: pending.id }),
        (job, message) => setPrintMessage(message || `Stampa ${job.status} su PRODUZIONE (${job.printer}).`));
      if (job) {
        finishCentralPrint(printKey);
        printRequest.current = null;
        setPrintPending(false);
        if (job.status === 'Failed' || job.confirmationError) setError(job.confirmationError || `Stampa non riuscita: ${job.error}. Verificare la coda MES prima di ristampare.`);
      }
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }
  const knownBulkCode = /^FP/i.test(activity.articleCode || '') ? activity.articleCode : '';
  const close = () => { if (!busy) {
    const changed = mode === 'start' || mode === 'close';
    setMode(''); setSheet(null); setError('');
    if (changed) {
      request('context').then(setContext).catch(cause => setError(cause.message));
      onStarted?.(); window.dispatchEvent(new Event('workspace:production-changed'));
    }
  } };
  function openStation(operation) {
    const search = '?destination=station&station=' + encodeURIComponent(activity.resourceCode) + (operation ? '&stationAction=' + operation + '&orderId=' + activity.productionOrderId : '');
    requestProgremesWorkspaceWindow('/produzione/progremes.PlanningProduction' + search);
  }
  return <>
    <ProductSpecificationViewButton articleCode={knownBulkCode || context?.bulkCode || (customerScoped ? activity.articleCode : '')} description={activity.descrizione || context?.description}/>
    {!customerScoped && <>
    <BatchSheetActions productionOrderId={activity.productionOrderId} kind="production" operationType="Production" batchNumber={activity.batchNumber}><button type="button" disabled={!context?.canPrint} onClick={openSheet}><Printer size={17}/>Stampa foglio produzione</button>

    <button type="button" disabled={!context?.canWrite || !stationActionUrl(activity, 'start')} onClick={() => openStation('start')}><Play size={17}/>Avvia lavorazione</button>
    </BatchSheetActions>
    <button type="button" disabled={!activity.panelUrl || !context?.canPrint} onClick={() => openStation()}><Monitor size={17}/>Apri station</button>
    <button type="button" disabled={!context?.canWrite || !stationActionUrl(activity, 'close')} onClick={() => openStation('close')}><Square size={17}/>Concludi lavorazione</button>
    {!context && !error && <p role="status">Caricamento dati preparazione…</p>}
    {context && !context.bulkCode && <p role="status">Nessun codice semilavorato associato alla formula dell’ordine.</p>}
    {!mode && error && <p role="alert" className="pc-error">{error}</p>}
    </>}
    {mode === 'sheet' && <Modal title="Foglio di produzione" onClose={close} className="product-spec-viewer">
      {printMessage && <p role="status" className="pc-note">{printMessage}</p>}
      {error && <p role="alert" className="pc-error">{error}</p>}
      {!sheet && busy && <p role="status">Preparazione foglio MES…</p>}
      {sheet && <>{sheet.messages?.map((message, i) => <p key={i} className="pc-note">{message}</p>)}<iframe ref={frame} title="Foglio di produzione" srcDoc={sheet.sheetHtml || undefined} src={sheet.sheetHtml ? undefined : sheet.url}/></>}
      <footer><button type="button" disabled={busy} onClick={close}>Chiudi</button>{sheet && <a href={sheet.url} download={sheet.fileName}>Scarica PDF</a>}<button type="button" disabled={busy || !sheet} onClick={print}><Printer size={17}/>{busy ? 'Stampa in corso…' : printPending ? 'Verifica stampa' : printMessage ? 'Ristampa su PRODUZIONE' : 'Stampa su PRODUZIONE'}</button></footer>
    </Modal>}

  </>;
}
