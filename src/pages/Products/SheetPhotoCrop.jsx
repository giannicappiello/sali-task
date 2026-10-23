import { useRef, useState } from 'react';
import SheetDialog from './SheetDialog';
import { photoCrop, photoSourceRect } from '../../../shared/directProductSheet.js';

export function SheetPhoto({ src, crop }) {
  const [size, setSize] = useState(null);
  const rect = size ? photoSourceRect(size.width, size.height, crop) : null;
  return <><img src={src} alt="" hidden onLoad={e => setSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })} />{rect && <svg width="100%" height="100%" viewBox={rect.join(' ')} role="img" aria-label="Foto prodotto" preserveAspectRatio="xMidYMid meet"><image href={src} width={size.width} height={size.height} /></svg>}</>;
}
export default function SheetPhotoCrop({ src, crop, onApply, onClose }) {
  const [area, setArea] = useState(() => photoCrop(crop)), [ratio, setRatio] = useState(1), [error, setError] = useState('');
  const drag = useRef(null);
  function point(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100)), y: Math.max(0, Math.min(100, (event.clientY - rect.top) / rect.height * 100)) };
  }
  function move(event) {
    if (!drag.current) return;
    const end = point(event), start = drag.current;
    if (Math.abs(end.x - start.x) >= 1 && Math.abs(end.y - start.y) >= 1) setArea(photoCrop({ x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) }));
  }
  return <SheetDialog title="Ritaglia foto prodotto" wide onClose={onClose}>
    <p>Trascina sulla foto per selezionare la parte da usare. Il ritaglio vale per questa casella del template; la foto originale resta disponibile.</p>
    <div className="direct-photo-crop-stage" style={{ width: Math.min(900, 550 * ratio) }} onPointerDown={e => { if (e.button !== 0) return; drag.current = point(e); e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
      <img src={src} alt="Seleziona area da ritagliare" draggable="false" onLoad={e => setRatio(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)} onError={() => setError('Foto non disponibile per il ritaglio.')} />
      <div className="direct-photo-crop-selection" style={{ left: area.x + '%', top: area.y + '%', width: area.width + '%', height: area.height + '%' }} />
    </div>
    {error && <p role="alert">{error}</p>}
    <div className="direct-sheet-actions">{[['x','Sinistra (%)'],['y','Alto (%)'],['width','Larghezza ritaglio (%)'],['height','Altezza ritaglio (%)']].map(([key,label]) => <label key={key}>{label}<input aria-label={label} type="number" min={key === 'x' || key === 'y' ? 0 : 1} max="100" step="0.1" value={Number(area[key].toFixed(2))} onChange={e => setArea(current => photoCrop({ ...current, [key]: Number(e.target.value) }))} /></label>)}</div>
    <footer><button type="button" onClick={() => setArea(photoCrop())}>Ripristina foto intera</button><button type="button" onClick={onClose}>Annulla</button><button type="button" className="primary-action" disabled={Boolean(error)} onClick={() => onApply(area)}>Applica ritaglio</button></footer>
  </SheetDialog>;
}
