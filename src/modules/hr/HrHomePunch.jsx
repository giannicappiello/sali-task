import { useRef, useState } from 'react';
import { useHrAttendance } from './HrAttendanceProvider';
import { hrRpc, locate } from './hrService';
import './hr-home-punch.css';

export default function HrHomePunch() {
  const attendance = useHrAttendance();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const key = useRef(crypto.randomUUID());
  const pending = useRef(false);
  if (!attendance?.member) return null;
  const open = attendance.open;
  async function punch() {
    if (pending.current || !attendance.ready) return;
    pending.current = true;
    setBusy(true); setError(''); setMessage('');
    try {
      await hrRpc('workspace_hr_punch', {
        p_action: open ? 'out' : 'in', p_key: key.current,
        p_position: open ? null : await locate(), p_attendance_id: open?.id || null,
      });
      await attendance.refresh();
      key.current = crypto.randomUUID();
      setMessage(open ? 'Uscita registrata.' : 'Entrata registrata.');
      window.dispatchEvent(new Event('workspace:hr-changed'));
    } catch (failure) { setError(failure.message); }
    finally { pending.current = false; setBusy(false); }
  }
  return <section className="hr-home-punch" aria-label="Timbratura personale">
    <button type="button" className={open ? 'is-out' : ''} disabled={busy || !attendance.ready} onClick={punch}>
      {busy ? 'Registrazione in corso…' : open ? 'Registra uscita' : 'Registra entrata'}
    </button>
    {!attendance.ready && <p role="status">Verifica della presenza non disponibile. Attendi il ripristino della connessione.</p>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
