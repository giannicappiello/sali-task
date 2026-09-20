import { useCallback, useEffect, useState } from 'react';
import { Play, Printer, Tag } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { Modal } from '../../features/production-costs/common';
import ThermalLabel from './ThermalLabel';

export default function PackagingOperationalActions({ productionOrderId, resourceCode, orderNumber, articleCode, operationType, onStarted }) {
  const { session } = useAuth();
  const [mode, setMode] = useState(''), [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [count, setCount] = useState(1), [pieces, setPieces] = useState(0);
  const request = useCallback(async (operation, extra = {}, signal) => {
    const response = await fetch('/api/mexal/automation', { method: 'POST', signal,
      headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'packaging_actions', productionOrderId, resourceCode, operation, ...extra }) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'Operazione MES non riuscita.');
    return value;
  }, [session?.access_token, productionOrderId, resourceCode]);
  useEffect(() => {
    if (!mode) return undefined;
    const controller = new AbortController();
    request(mode === 'labels' ? 'thermal-read' : 'start-context', {}, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      if (mode === 'labels' && !value.label) throw new Error('Etichetta non disponibile.');
      setData(value);
      if (value.label) { setCount(value.label.numeroEtichette); setPieces(value.label.pezziPerCollo); }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [mode, request]);
  function open(value) { setData(null); setError(''); setMode(value); }
  function close() { if (!busy) setMode(''); }
  function changePieces(value) {
    setPieces(value);
    if (Number(value) > 0 && data?.label) setCount(Math.max(1, Math.ceil(data.label.quantitaDaConfezionare / Number(value))));
  }
  const validLabels = Number.isInteger(Number(count)) && Number(count) >= 1 && Number(count) <= 1000 && pieces !== '' && Number.isFinite(Number(pieces)) && Number(pieces) >= 0;
  async function printLabels() {
    if (!validLabels) return;
    setBusy(true); setError('');
    try {
      const { printThermalLabels } = await import('./printThermalLabels.jsx');
      const result = await request('thermal-print', { labelCount: Number(count), piecesPerBox: Number(pieces) });
      setData(result);
      setCount(result.label.numeroEtichette); setPieces(result.label.pezziPerCollo);
      await printThermalLabels(result.label, result.label.numeroEtichette, result.label.pezziPerCollo);
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }
  async function start() {
    setBusy(true); setError('');
    try {
      const result = await request('start', { productionId: data.productionId });
      if (result.started !== true) throw new Error('Avvio non confermato. Ricarica lo stato prima di riprovare.');
      setData(old => ({ ...old, ready: false, started: true }));
      onStarted?.();
      window.dispatchEvent(new Event('workspace:production-changed'));
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }
  const unavailable = !Number.isSafeInteger(Number(productionOrderId)) || Number(productionOrderId) <= 0;
  return <><button type="button" disabled={unavailable} onClick={() => open('labels')}><Tag size={17}/>Etichetta termica</button>
    <button type="button" disabled={unavailable || !resourceCode || operationType !== 'Packaging'} onClick={() => open('start')}><Play size={17}/>Avvia confezionamento</button>
    {mode === 'labels' && <Modal title="Etichetta termica" onClose={close} className="thermal-label-modal">
      {error && <p role="alert" className="pc-note">{error}</p>}
      {!data && !error && <p role="status">Caricamento etichetta…</p>}
      {data?.label && <div className="thermal-label-body"><div className="thermal-label-settings"><strong>{data.label.numeroOrdine} · {data.label.codiceProdotto}</strong><label>Pezzi per collo<input type="number" min="0" step="1" value={pieces} readOnly={data.label.pezziPerColloDaCapitolato} disabled={busy} onChange={e => changePieces(e.target.value)}/></label><small>{data.label.pezziPerColloDaCapitolato ? `Dal capitolato prodotto · revisione ${data.label.revisioneCapitolato}` : 'Dato assente nel capitolato: inseriscilo manualmente. Verrà salvato alla stampa anche per il foglio di confezionamento.'}</small><label>Numero etichette<input type="number" min="1" max="1000" step="1" value={count} readOnly={Number(pieces) > 0} disabled={busy} onChange={e => setCount(e.target.value)}/></label><p>Formato 100 × 150 mm. Una etichetta per ogni collo. Anteprima del primo collo.</p>{!validLabels && <p role="alert">Indica da 1 a 1.000 etichette e pezzi per collo non negativi.</p>}</div><ThermalLabel label={data.label} count={count} pieces={Number(pieces)}/></div>}
      <footer><button type="button" disabled={busy} onClick={close}>Chiudi</button><button type="button" disabled={busy || !data?.canWrite || !data?.label || !validLabels} onClick={printLabels}><Printer size={17}/>{busy ? 'Preparazione stampa…' : 'Stampa etichette'}</button></footer>
    </Modal>}
    {mode === 'start' && <Modal title="Avvia confezionamento" onClose={close}>
      <div className="packaging-start-summary"><strong>{orderNumber} · {articleCode}</strong><p>Linea: {resourceCode}{data?.resourceName ? ` · ${data.resourceName}` : ''}</p></div>
      {error && <p role="alert" className="pc-note">{error}</p>}
      {!data && !error && <p role="status">Verifica dello stato MES…</p>}
      {data?.started ? <p role="status">Confezionamento avviato.</p> : data && <p>{data.ready ? 'Conferma l’avvio su questa linea. MES verifica ODL, foglio, etichette e delibera del semilavorato.' : 'Il confezionamento è già avviato o non è nello stato Da avviare.'}</p>}
      <footer className="packaging-start-actions"><button type="button" disabled={busy} onClick={close}>Chiudi</button><button type="button" disabled={busy || !data?.ready || !data?.canWrite} onClick={start}>{busy ? 'Avvio…' : 'Conferma avvio'}</button></footer>
    </Modal>}
  </>;
}
