import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { productionActivities } from './productionCalendar';

export default function useProductionCalendar(profileId, month) {
  const [state, setState] = useState({ items: [], loading: false, error: '', enabled: false });
  const year = month.getFullYear(), monthIndex = month.getMonth();
  useEffect(() => {
    if (!profileId) return;
    let disposed = false;
    let controller;
    let running = false;
    const date = value => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    const from = date(new Date(year, monthIndex, -6));
    const to = date(new Date(year, monthIndex + 4, 7));
    async function refresh() {
      if (disposed || running || document.hidden) return;
      running = true;
      controller = new AbortController();
      setState(old => ({ ...old, loading: true }));
      try {
        const { data, error } = await supabase.auth.getSession();
        if (disposed) return;
        if (error || !data.session) throw new Error('Accedi nuovamente per visualizzare il piano MES.');
        const response = await fetch(`/api/workspace/hr-production-calendar?from=${from}&to=${to}`, {
          headers: { Authorization: `Bearer ${data.session.access_token}` }, signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Pianificazione MES non disponibile.');
        if (!disposed) setState({ items: productionActivities(payload.items || []), loading: false, error: '', warning: payload.warning || '', enabled: payload.enabled === true, source: payload.source, updatedAt: payload.updatedAt });
      } catch (error) {
        if (!disposed && error.name !== 'AbortError') setState({ items: [], loading: false, error: error.message, enabled: true });
      } finally { running = false; }
    }
    Promise.resolve().then(refresh);
    const timer = setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    window.addEventListener('workspace:production-changed', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { disposed = true; controller?.abort(); clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('workspace:production-changed', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [profileId, year, monthIndex]);
  return state;
}
