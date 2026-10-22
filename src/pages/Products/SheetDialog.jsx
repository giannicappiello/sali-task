import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

export default function SheetDialog({ title, onClose, children, wide = false, busy = false }) {
  const ref = useRef(null), titleId = useId();
  useEffect(() => {
    const element = ref.current, previous = document.activeElement;
    element.showModal();
    return () => { element.close(); previous?.focus?.(); };
  }, []);
  return <dialog ref={ref} className={`direct-sheet-dialog ${wide ? 'is-wide' : ''}`} aria-labelledby={titleId}
    onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <header><h2 id={titleId}>{title}</h2><button type="button" aria-label="Chiudi" disabled={busy} onClick={onClose}><X size={20} /></button></header>
    {children}
  </dialog>;
}
