import { useRef, useState } from 'react';
import { calculatePackagingTotals } from './packagingTotals.js';
import { calculateMaterialActuals } from './packagingMaterialActuals.js';

const fields = [
  ['operator', 'text'], ['responsible', 'text'], ['closureDate', 'date'],
  ['piecesPerBox', 'number'], ['boxesPerLayer', 'number'], ['layersPerPallet', 'number'],
  ['piecesPerPallet', 'number'], ['pallets', 'number'], ['produced', 'number'], ['scrap', 'number'], ['notes', 'textarea'],
];
const incompleteFields = ['incompletePalletFullBoxes', 'incompletePalletPiecesPerBox', 'incompletePalletPartialBoxes', 'incompletePalletCount'];
export default function PackagingActualEditor({ sheet, saved, busy, onSave, onCancel }) {
  const frame = useRef(null), [error, setError] = useState('');
  const actual = saved?.actual || { closureDate: new Date().toLocaleDateString('sv-SE'), piecesPerBox: sheet.packagingSheet?.pezziPerCollo || '', materialWastes: [] };
  function initialize() {
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    for (const row of doc.querySelectorAll('[data-packaging-material]')) {
      const articleId = Number(row.dataset.packagingMaterial);
      const material = actual.materials?.find(item => item.articleId === articleId);
      for (const cell of row.querySelectorAll('[data-material-field]')) {
        const key = cell.dataset.materialField;
        const input = doc.createElement('input');
        input.type = 'number'; input.min = '0'; input.max = '1000000000';
        input.step = row.dataset.materialUnit?.toUpperCase() === 'PZ' ? '1' : '0.000001';
        input.inputMode = input.step === '1' ? 'numeric' : 'decimal';
        input.required = true; input.disabled = Boolean(saved);
        input.readOnly = key === 'deposited';
        input.dataset.materialInput = key;
        input.setAttribute('aria-label', `${row.dataset.materialCode} - ${{deposited:'Depositati',consumed:'Consumo effettivo',wasted:'Scartati',returned:'Reso'}[key]}`);
        input.value = material?.[key] ?? (['returned', 'wasted'].includes(key) ? 0 : '');
        cell.replaceChildren(input);
      }
    }
    for (const [key, type] of [...fields, ...incompleteFields.filter(key => doc.querySelector(`[data-packaging-field="${key}"]`)).map(key => [key, 'number'])]) {
      const cell = doc.querySelector(`[data-packaging-field="${key}"]`);
      if (!cell) { setError('Aggiornare MES: il foglio modificabile non è disponibile.'); return; }
      const label = cell.textContent.split(':')[0];
      cell.textContent = '';
      const fieldLabel = doc.createElement('label'); fieldLabel.textContent = label;
      const input = doc.createElement(type === 'textarea' ? 'textarea' : 'input');
      if (type !== 'textarea') input.type = type;
      input.name = key; input.value = type === 'date' ? String(actual[key] || '').slice(0,10) : actual[key] ?? (incompleteFields.includes(key) ? 0 : '');
      input.required = key !== 'notes'; input.disabled = Boolean(saved);
      input.readOnly = ['piecesPerPallet', 'produced'].includes(key);
      input.style.cssText = 'display:block;width:100%;padding:10px;border:1px solid #b8c9e2;border-radius:8px;background:white;color:#172b49;font:inherit';
      input.maxLength = key === 'notes' ? 2000 : 200;
      if (type === 'number') { input.inputMode = 'numeric'; input.min = ['produced','piecesPerBox'].includes(key) ? '1' : '0'; input.max = '1000000000'; input.step = '1'; }
      fieldLabel.append(input); cell.append(fieldLabel);
    }
    const recalculate = event => {
      const edited = event?.target;
      if (edited?.dataset.materialInput === 'consumed')
        edited.closest('[data-packaging-material]').dataset.manualConsumption = 'true';
      if (saved) return;
      const values = {};
      for (const key of ['piecesPerBox', 'boxesPerLayer', 'layersPerPallet', 'pallets', 'incompletePalletFullBoxes', 'incompletePalletPiecesPerBox'])
        values[key] = doc.querySelector(`[name="${key}"]`)?.value;
      const totals = calculatePackagingTotals(values);
      for (const key of ['piecesPerPallet', 'produced'])
        doc.querySelector(`[name="${key}"]`).value = totals[key] ?? '';
      const produced = doc.querySelector('[name="produced"]');
      const planned = Number(doc.querySelector('[data-planned-quantity]')?.dataset.plannedQuantity);
      for (const row of doc.querySelectorAll('[data-packaging-material]')) {
        const input = key => row.querySelector('[data-material-input="' + key + '"]');
        const material = calculateMaterialActuals({ required: row.dataset.required, unit: row.dataset.materialUnit },
          produced?.value, planned, { consumed: input('consumed').value, returned: input('returned').value, wasted: input('wasted').value },
          row.dataset.manualConsumption === 'true');
        input('consumed').value = material.consumed ?? '';
        input('deposited').value = material.deposited ?? '';
      }
    };
    doc.addEventListener('input', recalculate); recalculate();
    const pieces = doc.querySelector('[name="piecesPerBox"]');
    const updatePieces = () => { const mirror = doc.querySelector('[data-packaging-pieces-per-box]'); if (mirror) mirror.textContent = pieces?.value || '—'; };
    pieces?.addEventListener('input', updatePieces); updatePieces();
  }
  function submit() {
    if (saved) { setError(''); onSave(actual); return; }
    const doc = frame.current?.contentDocument; if (!doc) return;
    const value = {...actual};
    for (const [key,type] of fields) {
      const input = doc.querySelector(`[name="${key}"]`);
      if (!input) { setError('Aggiornare MES: foglio incompleto.'); return; }
      if (!saved && !input.reportValidity()) { setError('Compilare correttamente il campo: ' + (input.closest('label')?.firstChild?.textContent || key)); input.scrollIntoView({block:'center'}); return; }
      value[key] = type === 'number' ? Number(input.value) : input.value;
    }
    if (!saved && doc.querySelector('[data-packaging-version="2"]')) {
      value.materials = [];
      for (const row of doc.querySelectorAll('[data-packaging-material]')) {
        const material = {articleId: Number(row.dataset.packagingMaterial)};
        for (const input of row.querySelectorAll('[data-material-input]')) {
          if (!input.reportValidity() || input.value === '' || Number(input.value) < 0) { setError(row.dataset.materialCode + ': verificare ' + input.getAttribute('aria-label') + '. Le quantità non possono essere negative.'); input.scrollIntoView({block:'center'}); return; }
          material[input.dataset.materialInput] = Number(input.value);
        }
        if (Math.abs(material.deposited - material.consumed - material.wasted - material.returned) > 0.0000001) {
          setError(`${row.dataset.materialCode}: Depositati deve corrispondere a Consumo effettivo + Scartati + Reso.`); return;
        }
        value.materials.push(material);
      }
    }
    for (const key of incompleteFields) {
      const input = doc.querySelector(`[name="${key}"]`);
      if (input) {
        if (!saved && !input.reportValidity()) return;
        value[key] = Number(input.value);
      }
    }
    setError(''); onSave(value);
  }
  return <>
    {error && <p role="alert">{error}</p>}
    <iframe style={busy ? {pointerEvents:"none",opacity:.7} : undefined} ref={frame} title="Compila foglio di confezionamento" sandbox="allow-same-origin" srcDoc={sheet.sheetHtml} onLoad={initialize}/>
    <footer className="packaging-editor-actions"><button className="packaging-editor-back" type="button" disabled={busy} onClick={onCancel}>Torna al foglio</button><button className="packaging-editor-save" type="button" disabled={busy} onClick={submit}>{busy ? 'Salvataggio in corso…' : 'Salva e chiudi'}</button></footer>
  </>;
}
