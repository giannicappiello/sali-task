import { useEffect, useRef, useState } from 'react';
import SheetDialog from './SheetDialog';
import SheetPhotoCrop, { SheetPhoto } from './SheetPhotoCrop';
import { alignBoxes, boundBox, defaultLayout, TEMPLATE_FIELDS, sheetValues, templateBoxText, titleBox, resizeBox } from '../../../shared/directProductSheet.js';
import { discardChanges, getTemplate, listTemplates, saveTemplate, sheetChannelApi } from './directSheetService';
import { buildDirectSheetPdf, jpegBackground } from './directSheetPdf';

export function SheetPdfPreview({ result, onClose }) {
  const [url] = useState(() => URL.createObjectURL(result.doc.output('blob')));
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <SheetDialog title="Anteprima scheda tecnica" wide onClose={onClose}>
    {result.missing.length > 0 && <p className="direct-sheet-notice">Dati assenti nell’anagrafica o nella scheda: {result.missing.join(', ')}.</p>}
    <iframe className="direct-sheet-pdf" title="Anteprima PDF scheda tecnica" src={url} />
    <footer><button type="button" onClick={() => result.doc.save('scheda-tecnica.pdf')}>Scarica PDF</button></footer>
  </SheetDialog>;
}
const alignments = [['left', 'Bordi sinistri'], ['center', 'Centri orizzontali'], ['right', 'Bordi destri'], ['top', 'Bordi superiori'], ['middle', 'Centri verticali'], ['bottom', 'Bordi inferiori'], ['distribute-x', 'Distribuisci orizzontalmente'], ['distribute-y', 'Distribuisci verticalmente'], ['same-width', 'Stessa larghezza'], ['same-height', 'Stessa altezza']];
const initialTemplate = () => ({ name: 'Scheda tecnica Direct', layout: defaultLayout(), is_default: false });

export default function SheetTemplateEditor({ product, content, onClose, onSaved }) {
  const [template, setTemplate] = useState(initialTemplate), [original, setOriginal] = useState(() => JSON.stringify(initialTemplate()));
  const [templates, setTemplates] = useState([]), [selected, setSelected] = useState([]), [pageId, setPageId] = useState('page-1');
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState(''), [preview, setPreview] = useState(null);
  const [cropping, setCropping] = useState(null);
  const gesture = useRef(null);
  const layout = template.layout, page = layout.pages.find(p => p.id === pageId) || layout.pages[0];
  const boxes = layout.boxes.filter(b => b.page === page.id), chosen = boxes.filter(b => selected.includes(b.id)), active = chosen[0];
  const dirty = JSON.stringify(template) !== original, values = sheetValues(product, content);
  useEffect(() => {
    let live = true;
    async function initialize() {
      try {
        const rows = await listTemplates();
        if (!live) return;
        setTemplates(rows);
        const preferred = rows.find(row => row.is_default);
        if (preferred) {
          const next = await getTemplate(preferred.id);
          if (!live) return;
          setTemplate(next); setOriginal(JSON.stringify(next)); setPageId(next.layout.pages[0].id);
        }
      } catch (e) { if (live) setError(e.message); }
      finally { if (live) setBusy(false); }
    }
    void initialize();
    return () => { live = false; };
  }, []);
  function changeLayout(transform) { setTemplate(current => ({ ...current, layout: transform(current.layout) })); setNotice(''); }
  function updateBoxes(patch) { changeLayout(current => ({ ...current, boxes: current.boxes.map(b => selected.includes(b.id) ? ('width' in patch || 'height' in patch ? resizeBox(b, patch.width ?? b.width, patch.height ?? b.height, 'height' in patch ? 'height' : 'width') : boundBox({ ...b, ...patch })) : b) })); }
  async function close() { if (!busy && await discardChanges(dirty)) onClose(); }
  async function load(id) {
    if (!await discardChanges(dirty)) return;
    setBusy(true); setError('');
    try {
      const next = id ? await getTemplate(id) : initialTemplate();
      setTemplate(next); setOriginal(JSON.stringify(next)); setSelected([]); setPageId(next.layout.pages[0].id);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function save() {
    if (busy) return; setBusy(true); setError('');
    try {
      const saved = await saveTemplate(template, template.is_default);
      setTemplate(saved); setOriginal(JSON.stringify(saved)); setNotice('Template salvato.');
      setTemplates(await listTemplates()); await onSaved?.();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function background(file) {
    if (!file) return; setBusy(true); setError('');
    try {
      const { data, landscape } = await jpegBackground(file);
      changeLayout(current => ({ ...current, pages: current.pages.map(p => p.id === page.id ? { ...p, background: data, width: landscape ? 841.89 : 595.28, height: landscape ? 595.28 : 841.89 } : p) }));
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  function selectBox(id, multiple) { setSelected(ids => multiple ? ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id] : [id]); }
  function startDrag(event, box, resize = false) {
    if (busy || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    if (event.shiftKey && !resize) { selectBox(box.id, true); return; }
    const ids = resize ? [box.id] : selected.includes(box.id) ? selected : [box.id]; setSelected(ids);
    const stage = event.currentTarget.closest('.direct-template-page');
    gesture.current = { x: event.clientX, y: event.clientY, rect: stage.getBoundingClientRect(), ids, boxes: layout.boxes, resize, box };
    stage.setPointerCapture(event.pointerId);
  }
  function move(event) {
    const g = gesture.current; if (!g) return;
    let dx = (event.clientX - g.x) / g.rect.width * 100, dy = (event.clientY - g.y) / g.rect.height * 100;
    const group = g.boxes.filter(b => g.ids.includes(b.id));
    if (!g.resize) {
      dx = Math.max(-Math.min(...group.map(b => b.x)), Math.min(100 - Math.max(...group.map(b => b.x + b.width)), dx));
      dy = Math.max(-Math.min(...group.map(b => b.y)), Math.min(100 - Math.max(...group.map(b => b.y + b.height)), dy));
    }
    changeLayout(current => ({ ...current, boxes: g.boxes.map(b => g.ids.includes(b.id) ? g.resize ? resizeBox(b, b.width + dx, b.height + dy, Math.abs(dy / b.height) > Math.abs(dx / b.width) ? 'height' : 'width') : boundBox({ ...b, x: b.x + dx, y: b.y + dy }) : b) }));
  }
  function nudge(event, box) {
    if (busy) return;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const amount = event.shiftKey ? 1 : .1, ids = selected.includes(box.id) ? selected : [box.id];
    setSelected(ids);
    changeLayout(current => ({ ...current, boxes: current.boxes.map(b => ids.includes(b.id) ? boundBox({ ...b, x: b.x + (event.key === 'ArrowRight' ? amount : event.key === 'ArrowLeft' ? -amount : 0), y: b.y + (event.key === 'ArrowDown' ? amount : event.key === 'ArrowUp' ? -amount : 0) }) : b) }));
  }
  async function showPreview() {
    setBusy(true); setError('');
    try { setPreview(await buildDirectSheetPdf({ layout, values, loadPhoto: async () => (await sheetChannelApi('photo', { productId: product.id })).dataUrl })); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <SheetDialog title="Template scheda tecnica" wide onClose={close} busy={busy}>
    <fieldset className="direct-template-controls" disabled={busy}>
      <div className="direct-sheet-actions"><label>Template salvati<select aria-label="Template salvati" value={template.id || ''} onChange={e => void load(e.target.value)}><option value="">Nuovo template</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name}{t.is_default ? ' · Predefinito' : ''}</option>)}</select></label>
        <button type="button" onClick={() => void load('')}>Nuovo</button><button type="button" onClick={() => { const copy = { ...template, id: undefined, revision: undefined, is_default: false, name: `${template.name} (copia)`.slice(0, 120) }; setTemplate(copy); }}>Duplica</button>
        <label>Nome template<input maxLength={120} value={template.name} onChange={e => setTemplate(current => ({ ...current, name: e.target.value }))} /></label>
        <label className="direct-check"><input type="checkbox" checked={template.is_default} onChange={e => setTemplate(current => ({ ...current, is_default: e.target.checked }))} />Predefinito</label>
      </div>
      <div className="direct-sheet-actions"><label>Pagina<select aria-label="Pagina" value={page.id} onChange={e => { setPageId(e.target.value); setSelected([]); }}>{layout.pages.map((p, i) => <option key={p.id} value={p.id}>Pagina {i + 1}</option>)}</select></label>
        <label>Sfondo JPEG<input type="file" accept="image/jpeg" onChange={e => { void background(e.target.files[0]); e.target.value = ''; }} /></label>
        <button type="button" disabled={!page.background} onClick={() => changeLayout(current => ({ ...current, pages: current.pages.map(p => p.id === page.id ? { ...p, background: '' } : p) }))}>Rimuovi sfondo</button>
        <label>Orientamento<select aria-label="Orientamento" value={page.width > page.height ? 'landscape' : 'portrait'} onChange={e => changeLayout(current => ({ ...current, pages: current.pages.map(p => p.id === page.id ? { ...p, width: e.target.value === 'landscape' ? 841.89 : 595.28, height: e.target.value === 'landscape' ? 595.28 : 841.89 } : p) }))}><option value="portrait">A4 verticale</option><option value="landscape">A4 orizzontale</option></select></label>
      </div>
      <div className="direct-template-align" aria-label="Allineamento caselle">{alignments.map(([key, label]) => <button type="button" key={key} disabled={!chosen.length || (key.startsWith('distribute') && chosen.length < 3)} onClick={() => changeLayout(current => ({ ...current, boxes: alignBoxes(current.boxes, selected, key) }))}>{label}</button>)}</div>
    </fieldset>
    {error && <p className="direct-sheet-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <p className="direct-template-help">Una pagina di template per ogni lingua. Seleziona più caselle con le spunte o Maiusc + clic. Trascina per spostare, usa l’angolo per ridimensionare o le frecce per piccoli spostamenti. Una casella si allinea alla pagina; più caselle fra loro. L’anteprima PDF verifica lo spazio dei testi reali.</p>
    <div className="direct-template-workspace">
      <aside><h3>Campi del template</h3><div className="direct-template-fields">{TEMPLATE_FIELDS.map(field => <button type="button" key={field.key} disabled={busy || layout.boxes.length >= 60} onClick={() => { const id = crypto.randomUUID(); changeLayout(current => ({ ...current, boxes: [...current.boxes, { ...defaultLayout().boxes.find(b => b.field === field.key), id, page: page.id, x: 10, y: 10 }] })); setSelected([id]); }}>+ {field.label}</button>)}</div>
        <h3>Titoli separati</h3><button type="button" disabled={busy || layout.boxes.length >= 60} onClick={() => { const missing = TEMPLATE_FIELDS.filter(f => !f.image && !boxes.some(b => b.field === f.key && b.kind === 'title')).map(f => boxes.find(b => b.field === f.key && b.kind !== 'title')).filter(Boolean).slice(0, 60 - layout.boxes.length).map(titleBox); changeLayout(current => ({ ...current, boxes: [...current.boxes, ...missing] })); setSelected(missing.map(b => b.id)); }}>Aggiungi titoli mancanti</button><p>I titoli sono tradotti nella lingua della scheda. Usa uno sfondo senza titoli incorporati.</p><div className="direct-template-fields">{TEMPLATE_FIELDS.filter(field => !field.image).map(field => <button type="button" key={field.key} disabled={busy || layout.boxes.length >= 60} onClick={() => { const base = boxes.find(b => b.field === field.key && b.kind !== 'title') || defaultLayout().boxes.find(b => b.field === field.key); const next = titleBox({ ...base, page: page.id }); changeLayout(current => ({ ...current, boxes: [...current.boxes, next] })); setSelected([next.id]); }}>+ Titolo {field.label}</button>)}</div>
        <h3>Caselle nella pagina</h3>{boxes.map(box => <label className="direct-check" key={box.id}><input type="checkbox" checked={selected.includes(box.id)} onChange={() => selectBox(box.id, true)} />{box.kind === 'title' ? 'Titolo · ' : ''}{TEMPLATE_FIELDS.find(f => f.key === box.field).label}</label>)}
      </aside>
      <div className="direct-template-canvas-wrap"><div className="direct-template-page" style={{ aspectRatio: `${page.width}/${page.height}`, backgroundImage: page.background ? `url(${page.background})` : undefined }}
        onPointerMove={move} onPointerUp={() => { gesture.current = null; }} onPointerCancel={() => { gesture.current = null; }} onLostPointerCapture={() => { gesture.current = null; }}>
        {boxes.map(box => { const field = TEMPLATE_FIELDS.find(f => f.key === box.field), picked = selected.includes(box.id);
          return <div role="button" aria-label={`Casella ${box.kind === 'title' ? 'Titolo ' : ''}${field.label}`} aria-pressed={picked} tabIndex={busy ? -1 : 0} key={box.id} className={`direct-template-box ${picked ? 'selected' : ''}`}
            style={{ left: `${box.x}%`, top: `${box.y}%`, width: `${box.width}%`, height: `${box.height}%` }}
            onPointerDown={e => startDrag(e, box)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectBox(box.id, e.shiftKey); } else nudge(e, box); }}>
            <span className="direct-template-box-tag">{box.kind === 'title' ? 'Titolo · ' : ''}{field.label}</span>
            <div className="direct-template-box-content" style={{ textAlign: box.align, justifyContent: box.vertical === 'middle' ? 'center' : box.vertical === 'bottom' ? 'flex-end' : 'flex-start', fontFamily: { helvetica: 'Arial', times: 'Times New Roman', courier: 'Courier New' }[box.font], fontWeight: box.bold ? 'bold' : 'normal', color: box.color, fontSize: `${box.fontSize * 100 / page.width}cqw` }}>
              {field.image ? values.photo ? <SheetPhoto src={values.photo} crop={box.crop} /> : <span>Foto prodotto</span> : <span>{templateBoxText(box, values)}</span>}
            </div>
            {picked && <span className="direct-template-resize" aria-hidden="true" onPointerDown={e => startDrag(e, box, true)} />}
          </div>;
        })}
      </div></div>
      <aside><h3>Proprietà {chosen.length > 1 ? `(${chosen.length} caselle)` : ''}</h3>{active ? <fieldset disabled={busy} className="direct-template-properties">
        {['x', 'y', 'width', 'height'].map((key, i) => <label key={key}>{['Posizione X (%)', 'Posizione Y (%)', 'Larghezza (%)', 'Altezza (%)'][i]}<input type="number" step="0.1" min={i < 2 ? 0 : 2} max={100} value={Number(active[key].toFixed(2))} onChange={e => updateBoxes({ [key]: Number(e.target.value) })} /></label>)}
        {active.field === 'photo' && <><button type="button" disabled={!values.photo} onClick={() => setCropping(active)}>Ritaglia foto</button><button type="button" disabled={!active.crop} onClick={() => changeLayout(current => ({ ...current, boxes: current.boxes.map(b => b.id === active.id ? { ...b, crop: undefined } : b) }))}>Ripristina foto intera</button></>}
        {active.field === 'photo' && <label className="direct-check"><input type="checkbox" checked={Boolean(active.lockAspect)} onChange={e => updateBoxes({ lockAspect: e.target.checked })} />Blocca proporzioni foto</label>}
        {active.kind === 'title' && <><p>Il titolo segue la lingua della scheda ed è indipendente dal testo.</p><label>Maiuscole/minuscole titoli<select aria-label="Maiuscole/minuscole titoli" value={active.titleCase || 'normal'} onChange={e => { const titleCase = e.target.value; changeLayout(current => ({ ...current, boxes: current.boxes.map(b => selected.includes(b.id) && b.kind === 'title' ? { ...b, titleCase } : b) })); }}><option value="normal">Normale</option><option value="uppercase">TUTTO MAIUSCOLO</option><option value="lowercase">tutto minuscolo</option></select></label></>}
        <label>Pagina caselle<select aria-label="Pagina caselle" value={active.page} onChange={e => { updateBoxes({ page: e.target.value }); setPageId(e.target.value); }}>{layout.pages.map((p, i) => <option key={p.id} value={p.id}>Pagina {i + 1}</option>)}</select></label>
        <label>Carattere<select aria-label="Carattere" value={active.font} onChange={e => updateBoxes({ font: e.target.value })}><option value="helvetica">Arial / Helvetica</option><option value="times">Times</option><option value="courier">Courier</option></select></label>
        <label>Dimensione testo (pt)<input type="number" min={6} max={60} value={active.fontSize} onChange={e => updateBoxes({ fontSize: Math.min(60, Math.max(6, Number(e.target.value))) })} /></label>
        <label>Allineamento testo<select aria-label="Allineamento testo" value={active.align} onChange={e => updateBoxes({ align: e.target.value })}><option value="left">Sinistra</option><option value="center">Centro</option><option value="right">Destra</option><option value="justify">Giustificato</option></select></label>
        <label>Allineamento verticale testo<select aria-label="Allineamento verticale testo" value={active.vertical} onChange={e => updateBoxes({ vertical: e.target.value })}><option value="top">In alto</option><option value="middle">Al centro</option><option value="bottom">In basso</option></select></label>
        <label>Colore testo<input type="color" value={active.color} onChange={e => updateBoxes({ color: e.target.value })} /></label>
        <label className="direct-check"><input type="checkbox" checked={active.bold} onChange={e => updateBoxes({ bold: e.target.checked })} />Grassetto</label>
        <button type="button" onClick={() => { changeLayout(current => ({ ...current, boxes: current.boxes.filter(b => !selected.includes(b.id)) })); setSelected([]); }}>Elimina caselle selezionate</button>
      </fieldset> : <p>Seleziona una casella per modificarne posizione e testo.</p>}</aside>
    </div>
    <footer><span>{dirty ? 'Modifiche non salvate' : 'Template salvato o nuovo'}</span><button type="button" disabled={busy} onClick={showPreview}>Anteprima PDF</button><button type="button" className="primary-action" disabled={busy || !template.name.trim() || !layout.boxes.length} onClick={save}>{busy ? 'Operazione in corso…' : 'Salva template'}</button></footer>
    {cropping && <SheetPhotoCrop src={values.photo} crop={cropping.crop} onClose={() => setCropping(null)} onApply={crop => { changeLayout(current => ({ ...current, boxes: current.boxes.map(b => b.id === cropping.id ? { ...b, crop } : b) })); setCropping(null); }} />}
    {preview && <SheetPdfPreview result={preview} onClose={() => setPreview(null)} />}
  </SheetDialog>;
}
