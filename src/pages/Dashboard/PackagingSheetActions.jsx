import { observeCentralPrint, pendingCentralPrint, finishCentralPrint } from './centralPrint.js';
import BatchSheetActions from './BatchSheetActions';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Printer } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { Modal } from '../../features/production-costs/common';
import PackagingSheet from './PackagingSheet';

export default function PackagingSheetActions({ productionOrderId }) {
  const { session } = useAuth();
  const [mode, setMode] = useState(''), [result, setResult] = useState(null), [error, setError] = useState(''), [printing, setPrinting] = useState(false);
  const [pieces, setPieces] = useState(0);
  const printRequest = useRef(null);
  const [printMessage, setPrintMessage] = useState('');
  const [printPending, setPrintPending] = useState(false);
  const printKey = `mes-print:packaging:${session?.user?.id}:${productionOrderId}`;
  const request = useCallback(async (operation, signal, piecesPerBox, printRequestId) => {
    const response = await fetch('/api/production/actions', { method: 'POST', signal,
      headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'packaging_sheet', productionOrderId, operation, piecesPerBox, printRequestId }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Foglio non disponibile.');
    if (operation === 'read' && !data.sheet) throw new Error('Il servizio MES non ha restituito il foglio di confezionamento.');
    return data;
  }, [productionOrderId, session?.access_token]);
  useEffect(() => {
    if (!mode) return undefined;
    const controller = new AbortController();
    request('read', controller.signal).then(value => { if (!controller.signal.aborted) { setResult(value); setPieces(value.sheet.pezziPerCollo || 0); } }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [mode, request]);
  async function print() {
    setPrinting(true); setError('');
    try {
      printRequest.current ||= pendingCentralPrint(printKey, { pieces: Number(pieces) });
      const pending = printRequest.current;
      setPrintPending(true);
      const job = await observeCentralPrint(() => request('print', undefined, pending.pieces, pending.id),
        (job, message) => setPrintMessage(message || `Stampa ${job.status} su PRODUZIONE (${job.printer}).`));
      if (job) {
        finishCentralPrint(printKey);
        printRequest.current = null;
        setPrintPending(false);
        if (job.status === 'Failed' || job.confirmationError) setError(job.confirmationError || `Stampa non riuscita: ${job.error}. Verificare la coda MES prima di ristampare.`);
      }
    } catch (cause) { setError(cause.message); }
    finally { setPrinting(false); }
  }
  function close() { if (!printing) { setMode(''); setResult(null); setError(''); } }
  const disabled = !Number.isSafeInteger(Number(productionOrderId)) || Number(productionOrderId) <= 0;
  return <BatchSheetActions productionOrderId={productionOrderId} kind="packaging"><button type="button" disabled={disabled} onClick={() => setMode('open')}><FileText size={17}/>Apri foglio confezionamento</button>
    {mode && <Modal title="Foglio di confezionamento" onClose={close} className="dashboard-production-sheet packaging-sheet-modal">
      {printMessage && <p role="status" className="pc-note">{printMessage}</p>}
      {error && <p role="alert" className="pc-note">{error}</p>}
      {result?.sheet && <label className="pc-field packaging-sheet-settings"><span>Pezzi per collo</span><input type="number" min="0" step="1" value={pieces} readOnly={result.sheet.pezziPerColloDaCapitolato} disabled={printing} onChange={e => setPieces(e.target.value)}/><small>{result.sheet.pezziPerColloDaCapitolato ? `Dal capitolato prodotto · revisione ${result.sheet.revisioneCapitolato}` : 'Dato assente nel capitolato: inseriscilo manualmente. Verrà salvato alla stampa anche per le etichette termiche.'}</small></label>}
      <div className="packaging-sheet-content">{result?.sheet ? <PackagingSheet sheet={{ ...result.sheet, pezziPerCollo: Number(pieces) }}/>: !error && <p role="status">Preparazione foglio di confezionamento…</p>}</div>
      <footer><button type="button" disabled={printing} onClick={close}>Chiudi</button><button type="button" disabled={!result?.sheet || !result.canPrint || printing || !Number.isFinite(Number(pieces)) || Number(pieces) < 0} onClick={print}><Printer size={17}/>{printing ? 'Stampa in corso…' : printPending ? 'Verifica stampa' : printMessage ? 'Ristampa su PRODUZIONE' : 'Stampa su PRODUZIONE'}</button></footer>
    </Modal>}
  </BatchSheetActions>;
}
