import { gpsErrorMessage } from './hrGpsErrors';
import { usesMobileLocation } from './hrPunchDevice';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { hrRpc, positionPayload } from './hrService';
import { shouldSendObservation } from './hrGpsObservation';

const Context = createContext(null);
// eslint-disable-next-line react-refresh/only-export-components
export const useHrAttendance = () => useContext(Context);

export default function HrAttendanceProvider({ children }) {
  const { profile, hasModuleAccess } = useAuth();
  const enabled = Boolean(profile?.id && hasModuleAccess('hr'));
  const [open, setOpen] = useState(null);
  const [manualPending, setManualPending] = useState(false);
  const [status, setStatus] = useState('Controllo posizione non attivo');
  const [notice, setNotice] = useState('');
  const [identity, setIdentity] = useState(null);
  const ownOpen = open?.user_id === profile?.id ? open : null;
  const refresh = useCallback(async () => {
    try {
      const result = await hrRpc('workspace_hr_punch_status');
      setOpen(result.open);
      setIdentity({ userId: result.actor_id, member: result.member, ready: true });
      return result.open;
    } catch (error) {
      setIdentity(previous => previous ? { ...previous, ready: false } : null);
      throw error;
    }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const reload = async () => {
      try { const result = await hrRpc('workspace_hr_punch_status'); if (active) { setOpen(result.open); setIdentity({ userId: result.actor_id, member: result.member, ready: true }); } }
      catch { if (active) { setIdentity(previous => previous ? { ...previous, ready: false } : null); setStatus('Controllo non disponibile: verifica la connessione e riapri HR.'); } }
    };
    const timer = window.setTimeout(reload, 0);
    const poll = window.setInterval(() => { if (!document.hidden) void reload(); }, 60000);
    window.addEventListener('online', reload);
    window.addEventListener('focus', reload);
    return () => { active = false; clearTimeout(timer); clearInterval(poll); window.removeEventListener('online', reload); window.removeEventListener('focus', reload); };
  }, [enabled, profile?.id]);
  useEffect(() => {
    if (!usesMobileLocation() || !enabled || !ownOpen?.id || !ownOpen.auto_checkout || manualPending) return;
    if (!navigator.geolocation) return;
    let active = true;
    const watcher = navigator.geolocation.watchPosition(async (position) => {
      if (!active) return;
      if (!navigator.onLine || Date.now() - position.timestamp > 30000) {
        setStatus('Posizione o connessione non attendibile: ricorda il checkout manuale.'); return;
      }
      if (!shouldSendObservation(position)) return;
      // Send immediately; an in-flight inside observation must not discard an outside one.
      try {
        const result = await hrRpc('workspace_hr_punch', { p_action: 'observe', p_key: crypto.randomUUID(), p_position: positionPayload(position), p_attendance_id: ownOpen.id });
        if (!active) return;
        if (result.checkout_at) {
          setOpen(null); setNotice(result.checkout_kind === 'automatic' ? 'Checkout automatico registrato: allontanamento dalla sede confermato.' : 'Presenza chiusa. Controllo posizione terminato.');
          window.dispatchEvent(new Event('workspace:hr-changed'));
        } else setStatus(result.ignored ? result.message : 'Posizione dentro il perimetro aziendale: presenza invariata.');
      } catch (error) { if (active) setStatus(`${error.message} Usa il checkout manuale.`); }
    }, (error) => { if (active) setStatus(gpsErrorMessage(error)); },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 25000 });
    return () => { active = false; navigator.geolocation.clearWatch(watcher); };
  }, [enabled, ownOpen, manualPending]);
  return <Context.Provider value={{ member: enabled && identity?.userId === profile?.id && identity.member, ready: enabled && identity?.userId === profile?.id && identity.ready, open: enabled ? ownOpen : null, status: ownOpen?.auto_checkout ? (!navigator.geolocation ? 'Geolocalizzazione non supportata su questo dispositivo.' : status) : 'Controllo posizione non attivo', notice: enabled ? notice : '', refresh, setManualPending }}>{children}</Context.Provider>;
}
