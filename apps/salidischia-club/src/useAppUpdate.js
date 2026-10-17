import { useEffect, useRef, useState } from 'react';

export default function useAppUpdate() {
  const [available, setAvailable] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const registration = useRef(null), requested = useRef(false), activated = useRef(false), timeout = useRef(null);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let active = true, controlled = !!navigator.serviceWorker.controller, lastCheck = 0;
    const watched = new Map();
    const announce = () => { if (active) setAvailable(true); };
    const watch = worker => {
      if (!worker || watched.has(worker)) return;
      const state = () => { if (worker.state === 'installed' && navigator.serviceWorker.controller) announce(); };
      watched.set(worker, state); worker.addEventListener('statechange', state); state();
    };
    const found = () => watch(registration.current?.installing);
    const changed = () => {
      if (!controlled) { controlled = true; return; }
      activated.current = true;
      if (requested.current) window.location.reload();
      else announce(); // Another tab must not reload a form in this tab.
    };
    const check = () => {
      if (!active || document.visibilityState !== 'visible' || navigator.onLine === false || Date.now() - lastCheck < 60000) return;
      lastCheck = Date.now(); void registration.current?.update().catch(() => {});
    };
    navigator.serviceWorker.addEventListener('controllerchange', changed);
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then(value => {
      if (!active) return;
      registration.current = value; value.addEventListener('updatefound', found);
      if (value.waiting && navigator.serviceWorker.controller) announce();
      watch(value.installing);
    }).catch(() => {});
    window.addEventListener('focus', check); window.addEventListener('online', check); document.addEventListener('visibilitychange', check);
    const interval = window.setInterval(check, 15 * 60 * 1000);
    return () => {
      active = false; clearInterval(interval); clearTimeout(timeout.current);
      registration.current?.removeEventListener('updatefound', found);
      navigator.serviceWorker.removeEventListener('controllerchange', changed);
      window.removeEventListener('focus', check); window.removeEventListener('online', check); document.removeEventListener('visibilitychange', check);
      watched.forEach((listener, worker) => worker.removeEventListener('statechange', listener));
    };
  }, []);
  function update() {
    if (requested.current) return;
    setError(''); requested.current = true; setBusy(true);
    if (activated.current) { window.location.reload(); return; }
    const worker = registration.current?.waiting;
    if (!worker) { requested.current = false; setBusy(false); setError('La versione non è ancora pronta. Riprova tra qualche istante.'); return; }
    try {
      worker.postMessage({ type: 'SKIP_WAITING' });
      timeout.current = window.setTimeout(() => { requested.current = false; setBusy(false); setError('Aggiornamento non completato. Puoi riprovare quando hai terminato le operazioni.'); }, 15000);
    } catch {
      requested.current = false; setBusy(false); setError('Aggiornamento non riuscito. Riprova.');
    }
  }
  return { available, busy, error, update };
}
