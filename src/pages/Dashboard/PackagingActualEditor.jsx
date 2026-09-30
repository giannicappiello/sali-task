import { useRef, useState } from 'react';

const fields = [
  ['operator', 'text'], ['responsible', 'text'], ['expiry', 'date'],
  ['piecesPerBox', 'number'], ['boxesPerLayer', 'number'], ['layersPerPallet', 'number'],
  ['piecesPerPallet', 'number'], ['pallets', 'number'], ['produced', 'number'], ['scrap', 'number'], ['notes', 'textarea'],
];
export default function PackagingActualEditor({ sheet, saved, busy, onSave, onCancel }) {
  const frame = useRef(null), [error, setError] = useState('');
  const actual = saved?.actual || { piecesPerBox: sheet.packagingSheet?.pezziPerCollo || '', materialWastes: [] };
  function initialize() {
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    for (const [key, type] of fields) {
      const cell = doc.querySelector(`[data-packaging-field="${key}"]`);
      if (!cell) { setError('Aggiornare MES: il foglio modificabile non è disponibile.'); return; }
      const label = cell.textContent.split(':')[0];
      cell.textContent = '';
      const fieldLabel = doc.createElement('label'); fieldLabel.textContent = label;
      const input = doc.createElement(type === 'textarea' ? 'textarea' : 'input');
      if (type !== 'textarea') input.type = type;
      input.name = key; input.value = type === 'date' ? String(actual[key] || '').slice(0,10) : actual[key] ?? '';
      input.required = key !== 'notes'; input.disabled = Boolean(saved);
      input.style.cssText = 'display:block;width:100%;padding:10px;border:1px solid #b8c9e2;border-radius:8px;background:white;color:#172b49;font:inherit';
      input.maxLength = key === 'notes' ? 2000 : 200;
      if (type === 'number') { input.min = ['produced','piecesPerBox'].includes(key) ? '1' : '0'; input.max = '1000000000'; input.step = '1'; }
      fieldLabel.append(input); cell.append(fieldLabel);
    }
  }
  function submit() {
    const doc = frame.current?.contentDocument; if (!doc) return;
    const value = {...actual};
    for (const [key,type] of fields) {
      const input = doc.querySelector(`[name="${key}"]`);
      if (!input) { setError('Aggiornare MES: foglio incompleto.'); return; }
      if (!saved && !input.reportValidity()) return;
      value[key] = type === 'number' ? Number(input.value) : input.value;
    }
    onSave(value);
  }
  return <>
    {error && <p role="alert">{error}</p>}
    <iframe style={busy ? {pointerEvents:"none",opacity:.7} : undefined} ref={frame} title="Compila foglio di confezionamento" sandbox="allow-same-origin" srcDoc={sheet.sheetHtml} onLoad={initialize}/>
    <p>Salva e chiudi registra il consuntivo, termina la lavorazione selezionata e archivia il PDF sul NAS.</p>
    <footer><button type="button" disabled={busy} onClick={onCancel}>Torna al foglio</button><button type="button" disabled={busy || Boolean(error)} onClick={submit}>{busy ? 'Salvataggio in corso…' : 'Salva e chiudi'}</button></footer>
  </>;
}
