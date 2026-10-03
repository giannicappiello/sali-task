import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { productionActivities } from './productionCalendar';
import { calendarFailure, emptyProductionCalendar } from './productionCalendarState';

export default function useProductionCalendar(profileId, month) {
  const year = month.getFullYear(), monthIndex = month.getMonth();
  const scope = `${profileId || ''}:${year}:${monthIndex}`;
  const [state, setState] = useState(() => ({ ...emptyProductionCalendar(), scope }));
  useEffect(() => {
    setState({ ...emptyProductionCalendar(), scope });
    if (!profileId) return;
    let disposed = false, controller, running = false, revision = '', nextRefresh = 0;
    const date = value => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    const from = date(new Date(year, monthIndex, -6));
    const to = date(new Date(year, monthIndex + 4, 7));
    async function refresh(force = false) {
      if (disposed || running || document.hidden || (!force && Date.now() < nextRefresh)) return;
      running = true;
      controller = new AbortController();
      setState(old => ({ ...old, loading: true }));
      try {
        const { data, error } = await supabase.auth.getSession();
        if (disposed) return;
        if (error || !data.session) throw Object.assign(new Error('Accedi nuovamente per visualizzare il piano MES.'), { status: 401 });
        const response = await fetch(`/api/workspace/hr-production-calendar?from=${from}&to=${to}${revision ? `&revision=${encodeURIComponent(revision)}` : ''}`, {
          headers: { Authorization: `Bearer ${data.session.access_token}` }, signal: controller.signal,
        });
        if (disposed) return;
        if (response.status === 304) {
          setState(old => ({ ...old, loading: false }));
          nextRefresh = Date.now() + 10000;
          return;
        }
        const payload = await response.json();
        if (!response.ok) throw Object.assign(new Error(payload.error || 'Pianificazione MES non disponibile.'), { status: response.status });
        revision = payload.revision || '';
        nextRefresh = Date.now() + (payload.stale ? 30000 : 10000);
        if (!disposed) setState({ scope, valid: true, items: productionActivities(payload.items || []), loading: false, error: '', warning: payload.warning || '', stale: payload.stale === true, enabled: payload.enabled === true, source: payload.source, updatedAt: payload.updatedAt });
      } catch (error) {
        if ([401, 403].includes(error.status)) revision = '';
        nextRefresh = Date.now() + 30000;
        if (!disposed && error.name !== 'AbortError') setState(old => ({ ...calendarFailure(old, error), scope }));
      } finally { running = false; }
    }
    const normalRefresh = () => refresh();
    const changed = () => refresh(true);
    Promise.resolve().then(normalRefresh);
    const timer = setInterval(normalRefresh, 60000);
    window.addEventListener('focus', normalRefresh);
    window.addEventListener('workspace:production-changed', changed);
    document.addEventListener('visibilitychange', normalRefresh);
    return () => { disposed = true; controller?.abort(); clearInterval(timer); window.removeEventListener('focus', normalRefresh); window.removeEventListener('workspace:production-changed', changed); document.removeEventListener('visibilitychange', normalRefresh); };
  }, [profileId, year, monthIndex, scope]);
  // Never expose a previous profile/month while the new effect is starting.
  return state.scope === scope ? state : emptyProductionCalendar();
}
