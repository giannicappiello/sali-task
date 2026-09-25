import { useEffect, useRef, useState } from 'react';
import { useHrAttendance } from './HrAttendanceProvider';
import { hrRpc, locate } from './hrService';
import './hr.css';

function CheckoutDialog({ onClose, onSave }) {
  const ref = useRef(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { const dialog = ref.current; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className="hr-dialog" aria-labelledby="checkout-title" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={async e => { e.preventDefault(); if (busy) return; setBusy(true); setError(''); try { await onSave(reason); onClose(); } catch (failure) { setError(failure.message); } finally { setBusy(false); } }}>
      <h2 id="checkout-title">Registra uscita</h2>
      <p>Verifichiamo la posizione attuale. Se sei fuori sede, indica il motivo. L’uscita sarà registrata all’orario corrente.</p>
      <label>Motivo dell’uscita fuori sede<textarea aria-label="Motivo dell’uscita fuori sede" maxLength={2000} rows={3} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <p className="hr-muted">Obbligatorio fuori dal perimetro aziendale.</p>
      {error && <p role="alert" className="hr-error">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={onClose}>Annulla</button><button className="hr-primary" disabled={busy}>{busy ? 'Verifica posizione…' : 'Conferma uscita'}</button></footer>
    </form>
  </dialog>;
}

export default function HrPunchButton({ className = '', disabled = false, onComplete }) {
  const monitor = useHrAttendance();
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const key = useRef(crypto.randomUUID());
  const pending = useRef(false);
  const open = monitor?.open;
  const setManualPending = monitor?.setManualPending;
  useEffect(() => { setManualPending?.(dialog || busy); return () => setManualPending?.(false); }, [dialog, busy, setManualPending]);
  async function punch(reason = '') {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const position = await locate();
      const result = await hrRpc('workspace_hr_location_punch', { p_action: open ? 'out' : 'in', p_key: key.current, p_attendance_id: open?.id || null, p_position: position, p_reason: reason });
      key.current = crypto.randomUUID();
      await monitor.refresh();
      setMessage(result.checkout_at ? 'Uscita registrata. Controllo posizione terminato.' : 'Entrata registrata. Controllo posizione attivo mentre Workspace riceve il GPS.');
      window.dispatchEvent(new Event('workspace:hr-changed'));
      await onComplete?.();
    } catch (failure) { setError(failure.message); throw failure; }
    finally { pending.current = false; setBusy(false); }
  }
  return <>
    <button type="button" className={className} disabled={disabled || busy || !monitor?.ready} onClick={() => open ? setDialog(true) : void punch().catch(() => {})}>
      {busy ? 'Verifica posizione…' : open ? 'Registra uscita' : 'Registra entrata'}
    </button>
    {message && <p role="status">{message}</p>}
    {error && !dialog && <p role="alert" className="hr-error">{error}</p>}
    {dialog && <CheckoutDialog onClose={() => setDialog(false)} onSave={punch}/>}
  </>;
}
