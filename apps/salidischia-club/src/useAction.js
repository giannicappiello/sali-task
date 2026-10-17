import { useRef, useState } from 'react';
import { message } from './client';
export function useAction() {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function run(action) {
    if (lock.current) return { ok: false };
    lock.current = true; setBusy(true); setError('');
    try { return { ok: true, value: await action() }; }
    catch (failure) { setError(message(failure)); return { ok: false }; }
    finally { lock.current = false; setBusy(false); }
  }
  return { busy, error, run, setError };
}
