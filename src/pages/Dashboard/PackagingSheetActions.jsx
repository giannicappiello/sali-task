import { useEffect, useState } from 'react';
import { FileText, Printer } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { Modal } from '../../features/production-costs/common';
import { requestProgremesNavigation } from '../ProgreMes/progremesWindow';

export default function PackagingSheetActions({ productionOrderId }) {
  const { session } = useAuth();
  const [mode, setMode] = useState(''), [url, setUrl] = useState(''), [error, setError] = useState('');
  useEffect(() => {
    if (!mode) return undefined;
    const controller = new AbortController();
    requestProgremesNavigation(session?.access_token, { screenCode: 'progremes.Produzione',
      search: new URLSearchParams({ destination: 'foglio-confezionamento', productionId: productionOrderId }).toString(), signal: controller.signal,
    }).then(value => { if (!controller.signal.aborted) setUrl(value); }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [mode, productionOrderId, session?.access_token]);
  function close() { setMode(''); setUrl(''); setError(''); }
  const disabled = !Number.isSafeInteger(Number(productionOrderId)) || Number(productionOrderId) <= 0;
  return <><button type="button" disabled={disabled} onClick={() => setMode('open')}><FileText size={17}/>Apri foglio confezionamento</button>
    <button type="button" disabled={disabled} onClick={() => setMode('print')}><Printer size={17}/>Stampa foglio di confezionamento</button>
    {mode && <Modal title={mode === 'print' ? 'Stampa foglio di confezionamento' : 'Foglio di confezionamento'} onClose={close} className="dashboard-production-sheet">
      {mode === 'print' && <p className="pc-note">Premi «Stampa foglio di confezionamento» nel foglio per aprire la finestra di stampa e registrare l’emissione in MES.</p>}
      {error ? <p role="alert" className="pc-error">{error}</p> : !url ? <p role="status">Apertura foglio MES…</p> : <iframe title="Foglio di confezionamento MES" src={url} referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals allow-popups"/>}
    </Modal>}
  </>;
}
