import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from './client';
import { usePortalRpc } from './usePortalApi';
export default function useAsync(name, parameters = {}) {
  const rpc = usePortalRpc();
  const [result, setResult] = useState({ data: null, error: '', loading: true });
  const key = JSON.stringify(parameters), sequence = useRef(0);
  const reload = useCallback(async () => {
    const request = ++sequence.current;
    setResult(current => ({ ...current, loading: true, error: '' }));
    try { const data = await rpc(name, JSON.parse(key)); if (sequence.current === request) setResult({ data, error: '', loading: false }); }
    catch (error) { if (sequence.current === request) setResult({ data: null, error: message(error), loading: false }); }
  }, [key, name, rpc]);
  useEffect(() => { const generation = sequence; const timer = setTimeout(() => void reload(), 0); return () => { clearTimeout(timer); generation.current++; }; }, [reload]);
  return { ...result, reload };
}
