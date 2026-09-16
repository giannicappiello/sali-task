import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { hrRpc, positionPayload } from './hrService';

const Context = createContext(null);
// eslint-disable-next-line react-refresh/only-export-components
export const useHrAttendance = () => useContext(Context);

export default function HrAttendanceProvider({ children }) {
  const { profile, hasModuleAccess } = useAuth();
  const enabled = Boolean(profile?.id && hasModuleAccess('hr'));
  const [open, setOpen] = useState(null);
  const [status, setStatus] = useState('Controllo posizione non attivo');
  const [notice, setNotice] = useState('');
  const ownOpen = open?.user_id === profile?.id ? open : null;
  const refresh = useCallback(async () => {
    const result = await hrRpc('workspace_hr_open_session');
    setOpen(result);
    return result;
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const reload = async () => {
      try { const result = await hrRpc('workspace_hr_open_session'); if (active) setOpen(result); }
      catch { if (active) { setOpen(null); setStatus('Controllo non disponibile: verifica la connessione e riapri HR.'); } }
    };
    const timer = window.setTimeout(reload, 0);
    const poll = window.setInterval(() => { if (!document.hidden) void reload(); }, 60000);
    window.addEventListener('online', reload);
    window.addEventListener('focus', reload);
    return () => { active = false; clearTimeout(timer); clearInterval(poll); window.removeEventListener('online', reload); window.removeEventListener('focus', reload); };
  }, [enabled, profile?.id]);
  useEffect(() => {
    if (!enabled || !ownOpen?.id || !ownOpen.auto_checkout || !navigator.geolocation) return;
    let active = true, pending = false, lastSent = 0;
    const watcher = navigator.geolocation.watchPosition(async (position) => {
      if (!active || pending || Date.now() - lastSent < 15000) return;
      if (!navigator.onLine || Date.now() - position.timestamp > 30000 || position.coords.accuracy > 50) {
        setStatus('Posizione o connessione non attendibile: ricorda il checkout manuale.'); return;
      }
      pending = true; lastSent = Date.now();
      try {
        const result = await hrRpc('workspace_hr_punch', { p_action: 'observe', p_key: crypto.randomUUID(), p_position: positionPayload(position), p_attendance_id: ownOpen.id });
        if (!active) return;
        if (result.checkout_at) {
          setOpen(null); setNotice(result.checkout_kind === 'automatic' ? 'Checkout automatico registrato: allontanamento dalla sede confermato.' : 'Presenza chiusa. Controllo posizione terminato.');
          window.dispatchEvent(new Event('workspace:hr-changed'));
        } else setStatus('Controllo di supporto attivo mentre Workspace riceve la posizione.');
      } catch (error) { if (active) setStatus(`${error.message} Usa il checkout manuale.`); }
      finally { pending = false; }
    }, () => { if (active) setStatus('Posizione non disponibile: il checkout automatico non è garantito.'); },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 25000 });
    return () => { active = false; navigator.geolocation.clearWatch(watcher); };
  }, [enabled, ownOpen?.id, ownOpen?.auto_checkout]);
  return <Context.Provider value={{ open: enabled ? ownOpen : null, status: ownOpen?.auto_checkout ? status : 'Controllo posizione non attivo', notice: enabled ? notice : '', refresh }}>{children}</Context.Provider>;
}
