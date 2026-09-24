import { useCallback, useEffect, useRef, useState } from 'react';
import { Monitor, Play, Printer, Square } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { Modal } from '../../features/production-costs/common';
import ProductSpecificationViewButton from '../Documentation/ProductSpecificationViewButton';
import '../Documentation/ProductSpecification.css';
import ProgreMesLaunch from '../ProgreMes/ProgreMesLaunch';
import { stationActionUrl } from './productionCalendar';

function pdfUrl(base64) {
  return URL.createObjectURL(new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], { type: 'application/pdf' }));
}
export default function PreparationActions({ activity, onStarted }) {
  const { session } = useAuth();
  const [context, setContext] = useState(null), [mode, setMode] = useState(''), [error, setError] = useState('');
  const [sheet, setSheet] = useState(null), [busy, setBusy] = useState(false);
  const frame = useRef(null);
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
    const controller = new AbortController();
    request('context', {}, controller.signal).then(value => { if (!controller.signal.aborted) setContext(value); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [request]);
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
      await request('print', { contentHash: sheet.contentHash });
      frame.current?.contentWindow?.print();
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
  const actionUrl = stationActionUrl(activity, mode);
  return <>
    <ProductSpecificationViewButton articleCode={knownBulkCode || context?.bulkCode || ''} description={activity.descrizione || context?.description}/>
    <button type="button" disabled={!context?.canWrite} onClick={openSheet}><Printer size={17}/>Stampa foglio produzione</button>
    <button type="button" disabled={!activity.panelUrl} onClick={() => window.open(activity.panelUrl, '_blank', 'popup=yes,width=800,height=960,toolbar=no,menubar=no,location=no,status=no,resizable=yes,scrollbars=yes,noopener,noreferrer')}><Monitor size={17}/>Apri station</button>
    <button type="button" disabled={!context?.canWrite || !stationActionUrl(activity, 'start')} onClick={() => { setMode('start'); setError(''); }}><Play size={17}/>Avvia lavorazione</button>
    <button type="button" disabled={!context?.canWrite || !stationActionUrl(activity, 'close')} onClick={() => { setMode('close'); setError(''); }}><Square size={17}/>Concludi lavorazione</button>
    {!context && !error && <p role="status">Caricamento dati preparazione…</p>}
    {context && !context.bulkCode && <p role="status">Nessun codice semilavorato associato alla formula dell’ordine.</p>}
    {!mode && error && <p role="alert" className="pc-error">{error}</p>}
    {mode === 'sheet' && <Modal title="Foglio di produzione" onClose={close} className="product-spec-viewer">
      {error && <p role="alert" className="pc-error">{error}</p>}
      {!sheet && busy && <p role="status">Preparazione foglio MES…</p>}
      {sheet && <>{sheet.messages?.map((message, i) => <p key={i} className="pc-note">{message}</p>)}<iframe ref={frame} title="Foglio di produzione" src={sheet.url}/></>}
      <footer><button type="button" disabled={busy} onClick={close}>Chiudi</button>{sheet && <a href={sheet.url} download={sheet.fileName}>Scarica PDF</a>}<button type="button" disabled={busy || !sheet} onClick={print}><Printer size={17}/>{busy ? 'Preparazione…' : 'Stampa foglio produzione'}</button></footer>
    </Modal>}
    {(mode === 'start' || mode === 'close') && actionUrl && <Modal className="station-card-action" title={mode === 'start' ? 'Avvia lavorazione' : 'Concludi lavorazione'} onClose={close}>
      <strong>{activity.orderNumber} · {activity.resource}</strong>
      <ProgreMesLaunch inDialog screenCode="progremes.PlanningProduction" search={actionUrl.slice(actionUrl.indexOf('?'))}/>
      <footer><button type="button" onClick={close}>Chiudi</button></footer>
    </Modal>}
  </>;
}
