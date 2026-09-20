import { useCallback, useEffect, useState } from 'react';
import { FileText, Printer } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { Modal } from '../../features/production-costs/common';
import PackagingSheet from './PackagingSheet';

export default function PackagingSheetActions({ productionOrderId }) {
  const { session } = useAuth();
  const [mode, setMode] = useState(''), [result, setResult] = useState(null), [error, setError] = useState(''), [printing, setPrinting] = useState(false);
  const [pieces, setPieces] = useState(0);
  const request = useCallback(async (operation, signal, piecesPerBox) => {
    const response = await fetch('/api/mexal/automation', { method: 'POST', signal,
      headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'packaging_sheet', productionOrderId, operation, piecesPerBox }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Foglio non disponibile.');
    if (!data.sheet) throw new Error('Il servizio MES non ha restituito il foglio di confezionamento.');
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
      const value = await request('print', undefined, Number(pieces));
      setResult(value);
      setPieces(value.sheet.pezziPerCollo || 0);
      const { printPackagingSheet } = await import('./printPackagingSheet.jsx');
      await printPackagingSheet(value.sheet);
    } catch (cause) { setError(cause.message); }
    finally { setPrinting(false); }
  }
  function close() { if (!printing) { setMode(''); setResult(null); setError(''); } }
  const disabled = !Number.isSafeInteger(Number(productionOrderId)) || Number(productionOrderId) <= 0;
  return <><button type="button" disabled={disabled} onClick={() => setMode('open')}><FileText size={17}/>Apri foglio confezionamento</button>
    {mode && <Modal title="Foglio di confezionamento" onClose={close} className="dashboard-production-sheet">
      {error && <p role="alert" className="pc-note">{error}</p>}
      {result?.sheet && <label className="pc-field"><span>Pezzi per collo</span><input type="number" min="0" step="1" value={pieces} readOnly={result.sheet.pezziPerColloDaCapitolato} disabled={printing} onChange={e => setPieces(e.target.value)}/><small>{result.sheet.pezziPerColloDaCapitolato ? `Dal capitolato prodotto · revisione ${result.sheet.revisioneCapitolato}` : 'Dato assente nel capitolato: inseriscilo manualmente. Verrà salvato alla stampa anche per le etichette termiche.'}</small></label>}
      <div className="packaging-sheet-content">{result?.sheet ? <PackagingSheet sheet={{ ...result.sheet, pezziPerCollo: Number(pieces) }}/>: !error && <p role="status">Preparazione foglio di confezionamento…</p>}</div>
      <footer><button type="button" disabled={printing} onClick={close}>Chiudi</button><button type="button" disabled={!result?.sheet || !result.canPrint || printing || !Number.isFinite(Number(pieces)) || Number(pieces) < 0} onClick={print}><Printer size={17}/>{printing ? 'Preparazione stampa…' : 'Stampa foglio di confezionamento'}</button></footer>
    </Modal>}
  </>;
}
