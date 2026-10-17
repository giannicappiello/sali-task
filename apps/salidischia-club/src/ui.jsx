import { useEffect, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';

export function Alert({ error, children }) { return error ? <div className="notice error" role="alert">{error}</div> : children ? <div className="notice" role="status">{children}</div> : null; }
export function Loading() { return <div className="loading" role="status"><span className="spinner" />Un momento…</div>; }
export function Modal({ title, children, onClose }) {
  const ref = useRef(null);
  useEffect(() => { const node = ref.current, previous = document.activeElement; node.showModal(); return () => { node.close(); previous?.focus?.(); }; }, []);
  return <dialog ref={ref} className="club-dialog" aria-label={title} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === ref.current) onClose(); }}><header><h2>{title}</h2><button type="button" className="icon-button" aria-label="Chiudi" onClick={onClose}><X size={22} /></button></header>{children}</dialog>;
}
export function InstallApp() {
  const [prompt, setPrompt] = useState(null), [guide, setGuide] = useState(false);
  const [installed, setInstalled] = useState(() => window.matchMedia('(display-mode: standalone)').matches || !!navigator.standalone);
  useEffect(() => {
    const available = event => { event.preventDefault(); setPrompt(event); };
    const complete = () => { setInstalled(true); setPrompt(null); setGuide(false); };
    window.addEventListener('beforeinstallprompt', available); window.addEventListener('appinstalled', complete);
    return () => { window.removeEventListener('beforeinstallprompt', available); window.removeEventListener('appinstalled', complete); };
  }, []);
  async function install() {
    if (!prompt) { setGuide(true); return; }
    try { await prompt.prompt(); await prompt.userChoice; } finally { setPrompt(null); }
  }
  const appleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const mac = /Mac/.test(navigator.platform) && !appleMobile;
  return <>{!installed && <button type="button" className="button install-button" onClick={install}><Download size={17} />Scarica Fidelity</button>}{guide && <Modal title="Installa Sali di Ischia Club" onClose={() => setGuide(false)}><img className="install-icon" src="/icon-192.png" alt="Icona Sali Club" /><p>La tua Fidelity, sempre a portata di mano.</p>{appleMobile ? <ol><li>Apri questa pagina in <strong>Safari</strong>.</li><li>Tocca <strong>Condividi</strong>.</li><li>Scegli <strong>Aggiungi alla schermata Home</strong> e conferma. Se presente, attiva “Apri come app web”.</li></ol> : mac ? <ol><li>Apri il sito in <strong>Safari</strong>.</li><li>Nel menu File o Condividi scegli <strong>Aggiungi al Dock</strong>.</li><li>Conferma il nome “Sali di Ischia Club”. Con Chrome puoi usare la voce di installazione nel menu del browser.</li></ol> : <ol><li>Apri il sito in <strong>Chrome</strong> o un browser compatibile.</li><li>Apri il menu del browser.</li><li>Scegli <strong>Installa app</strong> oppure <strong>Aggiungi a schermata Home</strong> e conferma.</li></ol>}<button type="button" className="button primary full" onClick={() => setGuide(false)}>Ho capito</button></Modal>}</>;
}
