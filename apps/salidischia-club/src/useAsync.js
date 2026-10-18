import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from './client';
import { isConnectionError } from './networkErrors';
import { usePortalRpc } from './usePortalApi';

// Read-only queries may retry transient transport failures. Mutations use
// useAction and are never retried here.
export default function useAsync(name, parameters = {}, enabled = true, refreshInterval = 0) {
  const rpc = usePortalRpc();
  const [result, setResult] = useState({ data: null, error: '', loading: true });
  const key = JSON.stringify(parameters), sequence = useRef(0);
  const connectionFailed = useRef(false), pending = useRef(0);
  const reload = useCallback(async (options) => {
    if (!enabled) return;
    const request = ++sequence.current;
    pending.current = request;connectionFailed.current = false;
    setResult(current => ({ ...current, loading: options?.background === true ? !current.data : true, error: '' }));
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const data = await rpc(name, JSON.parse(key));
          if (sequence.current === request) setResult({ data, error: '', loading: false });
          return;
        } catch (error) {
          if (sequence.current !== request) return;
          if (attempt < 2 && isConnectionError(error)) {
            await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 600 : 1500));
            if (sequence.current !== request) return;
          } else throw error;
        }
      }
    } catch (error) {
      if (sequence.current === request) {
        connectionFailed.current = isConnectionError(error);
        setResult(current => ({ data: connectionFailed.current ? current.data : null, error: message(error), loading: false }));
      }
    } finally { if (pending.current === request) pending.current = 0; }
  }, [key, name, rpc, enabled]);
  useEffect(() => {
    connectionFailed.current = false;
    const generation = sequence;
    const timer = setTimeout(() => void reload(), 0);
    return () => { clearTimeout(timer);generation.current++; };
  }, [reload]);
  useEffect(() => {
    const reconnect = () => { if ((connectionFailed.current || refreshInterval > 0) && !pending.current) void reload({background:true}); };
    const visible = () => { if (document.visibilityState === 'visible') reconnect(); };
    window.addEventListener('online', reconnect);document.addEventListener('visibilitychange', visible);
    if (refreshInterval > 0) window.addEventListener('focus', visible);
    const timer = refreshInterval > 0 ? setInterval(visible, refreshInterval) : null;
    return () => { window.removeEventListener('online', reconnect);document.removeEventListener('visibilitychange', visible);window.removeEventListener('focus', visible);if (timer) clearInterval(timer); };
  }, [reload, refreshInterval]);
  return { ...result, data: enabled ? result.data : null, error: enabled ? result.error : '', loading: enabled && result.loading, reload };
}
