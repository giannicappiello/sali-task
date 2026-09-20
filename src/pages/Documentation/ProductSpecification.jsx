import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, File, FileText, Folder, FolderOpen, ImagePlus, RefreshCw, Save, Trash2, X } from 'lucide-react';
import { applySpecificationSources, specificationComponentFields, isSpecificationImage, MAX_SPECIFICATION_ATTACHMENTS, specificationFields, specificationSections } from '../../../shared/productSpecification';
import './ProductSpecification.css';

const labelDate = value => value ? new Date(value).toLocaleString('it-IT') : '';
const initialData = article => Object.fromEntries(specificationFields.map(([name]) => [name,
  name === 'description' ? article.description || '' : '',
]));
const filePath = (code, id) => `specifications/file?${new URLSearchParams({ articleCode: code, attachmentId: id })}`;

function Attachment({ attachment, articleCode, request, editable, onChange, onRemove }) {
  const [url, setUrl] = useState(''), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const container = useRef(null);
  const isImage = isSpecificationImage(attachment.path);
  useEffect(() => {
    if (!isImage || !attachment.id) return undefined;
    let active = true, started = false;
    const load = () => {
      if (started) return; started = true;
      request(filePath(articleCode, attachment.id)).then(result => { if (active) setUrl(result.url); })
        .catch(cause => { if (active) setError(cause.message); });
    };
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) load(); }, { rootMargin: '150px' });
    if (container.current) observer.observe(container.current);
    return () => { active = false; observer.disconnect(); };
  }, [articleCode, attachment.id, isImage, request, attempt]);
  async function open() {
    const opened = window.open('', '_blank');
    if (opened) opened.opener = null;
    try {
      if (!opened) throw new Error('Consenti l’apertura di nuove schede per visualizzare il file.');
      const result = await request(filePath(articleCode, attachment.id));
      opened.location.replace(result.url);
    } catch (cause) { opened?.close(); setError(cause.message); }
  }
  return <article ref={container} className="product-spec-attachment">
    {isImage && <div className="product-spec-image">{url && !error ? <img src={url} alt={attachment.caption || attachment.name} loading="lazy" onError={() => setError('Anteprima non disponibile. Riprova o apri il file.')} /> : <><ImagePlus/><small>{attachment.id ? 'Anteprima foto' : 'Salva il capitolato per visualizzare la foto.'}</small></>}</div>}
    <div className="product-spec-attachment-body"><strong>{attachment.name}</strong>
      {editable ? <label>Didascalia<input value={attachment.caption} maxLength={500} onChange={e => onChange(e.target.value)} /></label> : attachment.caption && <p>{attachment.caption}</p>}
      <div className="product-spec-actions">{attachment.id && <button type="button" onClick={open}>Apri file</button>}{editable && <button type="button" onClick={onRemove} aria-label={`Rimuovi collegamento a ${attachment.name}`}><Trash2 size={15}/>Rimuovi</button>}</div>
      {error && <div className="product-spec-file-error" role="alert">{error}{isImage && <button type="button" onClick={() => { setUrl(''); setError(''); setAttempt(n => n + 1); }}>Riprova anteprima</button>}</div>}
    </div>
  </article>;
}

function NasPicker({ section, request, onSelect, onClose }) {
  const [listing, setListing] = useState(null), [directory, setDirectory] = useState(''), [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const sequence = useRef({ value: 0 }), closeButton = useRef(null);
  useEffect(() => {
    let active = true;
    const requests = sequence.current;
    request('nas').then(result => { if (active) { setListing(result); setLoading(false); } })
      .catch(cause => { if (active) { setError(cause.message); setLoading(false); } });
    closeButton.current?.focus();
    return () => { active = false; requests.value++; };
  }, [request]);
  async function browse(path) {
    const seq = ++sequence.current.value; setLoading(true); setError(''); setSelected(null);
    try { const result = await request(`nas?directory=${encodeURIComponent(path)}`); if (seq === sequence.current.value) { setDirectory(path); setListing(result); } }
    catch (cause) { if (seq === sequence.current.value) setError(cause.message); }
    finally { if (seq === sequence.current.value) setLoading(false); }
  }
  function dialogKey(event) {
    if (event.key === 'Escape') onClose();
    if (event.key !== 'Tab') return;
    const elements = [...event.currentTarget.querySelectorAll('button:not(:disabled)')];
    const first = elements[0], last = elements.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  const files = (listing?.files || []).filter(f => section !== 'product' || isSpecificationImage(f.name));
  return <div className="product-spec-modal" role="presentation"><section role="dialog" aria-modal="true" aria-label="Seleziona un file NAS esistente" onKeyDown={dialogKey}>
    <header><div><h3>Seleziona dal NAS</h3><p>Il file resta nella cartella attuale.</p></div><button type="button" ref={closeButton} onClick={onClose} aria-label="Chiudi selezione NAS"><X/></button></header>
    <div className="private-nas-picker"><header><div><strong>Cartella corrente</strong><small>{directory || 'Archivio NAS'}</small></div>{listing?.parentPath != null && <button type="button" disabled={loading} onClick={() => browse(listing.parentPath)}><ArrowLeft size={15}/>Su</button>}</header>
      {loading ? <p role="status">Caricamento cartelle NAS…</p> : <div className="private-nas-entries">
        {(listing?.directories || []).map(dir => <button type="button" key={dir.relativePath} onClick={() => browse(dir.relativePath)}><Folder size={17}/><span>{dir.name}</span></button>)}
        {files.map(file => <button type="button" key={file.relativePath} className={selected?.relativePath === file.relativePath ? 'selected' : ''} aria-pressed={selected?.relativePath === file.relativePath} onClick={() => setSelected(file)}><File size={17}/><span>{file.name}</span><small>{(file.sizeBytes / 1048576).toLocaleString('it-IT', { maximumFractionDigits: 2 })} MB</small></button>)}
        {!files.length && !listing?.directories?.length && <p>Nessun {section === 'product' ? 'file immagine' : 'file'} disponibile in questa cartella.</p>}
      </div>}
    </div>{error && <div role="alert" className="private-upload-error">{error}<button type="button" onClick={() => browse(directory)}>Riprova</button></div>}
    <footer><small>{selected?.name || 'Seleziona un file dalle cartelle esistenti.'}</small><button type="button" disabled={!selected || loading} onClick={() => onSelect(selected)}>Associa file selezionato</button></footer>
  </section></div>;
}

export default function ProductSpecification({ article, canEdit, request, drafts }) {
  const code = article.articleCode;
  const [spec, setSpec] = useState(null), [dirty, setDirty] = useState(false), [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [picker, setPicker] = useState(null), [revisions, setRevisions] = useState(null), [historyError, setHistoryError] = useState('');
  const [reload, setReload] = useState(0);
  const [sources, setSources] = useState(null), [sourceError, setSourceError] = useState('');
  const [pdf, setPdf] = useState(null), [pdfLoading, setPdfLoading] = useState(false), [photoError, setPhotoError] = useState(false);
  const previewClose = useRef(null), previewTrigger = useRef(null);
  const pickerTrigger = useRef(null), mounted = useRef(true);
  const resource = `specifications?${new URLSearchParams({ articleCode: code })}`;
  useEffect(() => {
    mounted.current = true;
    const pending = drafts.get(code);
    let active = true;
    Promise.all([pending ? Promise.resolve({ specification: pending }) : request(resource),
      request(`specifications/sources?${new URLSearchParams({ articleCode: code })}`).catch(cause => ({ sourceError: cause.message })),
    ]).then(([{ specification }, loadedSources]) => {
      if (active) {
        setSpec(specification || { data: initialData(article), attachments: [], version: 0 });
        setDirty(Boolean(pending)); setSources(loadedSources.sourceError ? null : loadedSources);
        setSourceError(loadedSources.sourceError || ''); setPhotoError(false); setLoading(false);
      }
    }).catch(cause => { if (active) { setError(cause.message); setLoading(false); } });
    return () => { active = false; mounted.current = false; };
  }, [article, code, drafts, request, resource, reload]);
  useEffect(() => { if (pdf) previewClose.current?.focus(); return () => { if (pdf) URL.revokeObjectURL(pdf.url); }; }, [pdf]);
  const displayedData = spec && sources ? applySpecificationSources(spec.data, sources) : spec?.data;
  const sourceChanges = Boolean(spec && sources && ['customer', 'semiFinished'].some(name => (spec.data[name] || '') !== displayedData[name]));
  async function preview(event) {
    previewTrigger.current = event.currentTarget; setPdfLoading(true); setError('');
    try {
      const { createProductSpecificationPdf } = await import('./createProductSpecificationPdf');
      const result = await createProductSpecificationPdf({ article, specification: { ...spec, data: displayedData },
        photoUrl: sources?.photoUrl, components: sources?.components, dirty: dirty || sourceChanges, request });
      if (mounted.current) setPdf({ ...result, url: URL.createObjectURL(result.blob) });
    } catch (cause) { if (mounted.current) setError(cause.message); }
    finally { if (mounted.current) setPdfLoading(false); }
  }
  function closePreview() { setPdf(null); previewTrigger.current?.focus(); }
  function change(next) { setSpec(next); setDirty(true); drafts.set(code, next); setMessage(''); }
  function closePicker() { setPicker(null); pickerTrigger.current?.focus(); }
  function openPicker(section, event) { pickerTrigger.current = event.currentTarget; setPicker(section); }
  function addFile(file) {
    if (spec.attachments.some(a => a.section === picker && a.path.toUpperCase() === file.relativePath.toUpperCase())) {
      setError('Questo file è già associato alla sezione.'); closePicker(); return;
    }
    change({ ...spec, attachments: [...spec.attachments, { section: picker, path: file.relativePath, name: file.name, caption: '' }] });
    setError(''); closePicker();
  }
  async function save(event) {
    event.preventDefault(); setSaving(true); setError(''); setMessage('');
    const submitted = spec;
    try {
      const result = await request(`specifications/save?${new URLSearchParams({ articleCode: code })}`, { body: { expectedVersion: spec.version, data: displayedData, attachments: spec.attachments } });
      if (drafts.get(code) === submitted) drafts.delete(code);
      if (mounted.current) { setSpec(result); setDirty(false); setMessage(`Capitolato salvato. Revisione ${result.version}.`); setRevisions(null); }
    } catch (cause) { if (mounted.current) setError(cause.message); }
    finally { if (mounted.current) setSaving(false); }
  }
  function refresh() {
    if (dirty && !window.confirm('Ricaricare il capitolato? Le modifiche non salvate di questo articolo saranno scartate.')) return;
    drafts.delete(code); setDirty(false); setLoading(true); setError(''); setMessage(''); setRevisions(null); setReload(n => n + 1);
  }
  async function loadHistory(event) {
    if (!event.currentTarget.open || revisions) return;
    setHistoryError('');
    try { const result = await request(`specifications/history?${new URLSearchParams({ articleCode: code })}`); if (mounted.current) setRevisions(result.revisions); }
    catch (cause) { if (mounted.current) setHistoryError(cause.message); }
  }
  function field([name, label, type]) {
    const automatic = ['customer', 'semiFinished'].includes(name);
    if (name === 'additionalComponents') {
      const selected = (spec.data[name] || '').split('\n').filter(Boolean);
      const components = sources?.components.filter(c => !/^FP/i.test(c.code)) || [];
      return <div className="product-spec-wide" key={name}><label>{label}<select value="" disabled={!canEdit || !sources || Boolean(sources.bomError)} onChange={e => { if (e.target.value) change({ ...spec, data: { ...spec.data, [name]: [...selected, e.target.value].join('\n') } }); }}><option value="">Aggiungi un componente dalla distinta</option>{components.filter(c => !selected.includes(c.code)).map(c => <option key={c.code} value={c.code}>{c.code} — {c.description}</option>)}</select></label>
        {selected.map(value => <div className="product-spec-actions" key={value}><small>{value} — {components.find(c => c.code === value)?.description || 'Non presente nella distinta attuale'}</small>{canEdit && <button type="button" aria-label={`Rimuovi componente ${value}`} onClick={() => change({ ...spec, data: { ...spec.data, [name]: selected.filter(c => c !== value).join('\n') } })}><Trash2 size={14}/></button>}</div>)}</div>;
    }
    if (Object.hasOwn(specificationComponentFields, name)) {
      const components = sources?.components.filter(c => !/^FP/i.test(c.code)) || [];
      const selected = spec.data[name] || '';
      return <label key={name}>{label}<select value={selected} disabled={!canEdit || !sources || Boolean(sources.bomError)} onChange={e => {
        const component = components.find(c => c.code === e.target.value);
        const descriptionField = specificationComponentFields[name];
        change({ ...spec, data: { ...spec.data, [name]: e.target.value, ...(descriptionField ? { [descriptionField]: component?.description || '' } : {}) } });
      }}><option value="">Seleziona dalla distinta base</option>{selected && !components.some(c => c.code === selected) && <option value={selected}>{selected} — non presente nella distinta attuale</option>}{components.map(c => <option key={c.code} value={c.code}>{c.code} — {c.description || 'Descrizione non disponibile'}</option>)}</select></label>;
    }
    return <label key={name} className={type === 'textarea' ? 'product-spec-wide' : ''}>{label}{type === 'textarea'
      ? <textarea rows={3} maxLength={5000} value={spec.data[name] || ''} readOnly={!canEdit} onChange={e => change({ ...spec, data: { ...spec.data, [name]: e.target.value } })}/>
      : type === 'yesno' ? <select value={spec.data[name] || ''} disabled={!canEdit} onChange={e => change({ ...spec, data: { ...spec.data, [name]: e.target.value } })}><option value="">Da definire</option><option value="yes">Sì</option><option value="no">No</option></select>
        : <input maxLength={500} value={displayedData[name] || ''} readOnly={!canEdit || automatic} placeholder={automatic ? 'Non disponibile nelle anagrafiche' : ''} onChange={e => change({ ...spec, data: { ...spec.data, [name]: e.target.value } })}/>}</label>;
  }
  function attachments(section) {
    return <><div className="product-spec-attachments">{spec.attachments.filter(a => a.section === section).map(a => <Attachment key={`${a.section}-${a.path}`} attachment={a} articleCode={code} request={request} editable={canEdit && !saving}
      onChange={caption => change({ ...spec, attachments: spec.attachments.map(item => item === a ? { ...item, caption } : item) })}
      onRemove={() => change({ ...spec, attachments: spec.attachments.filter(item => item !== a) })}/>)}</div>
      {canEdit && <button type="button" disabled={spec.attachments.length >= MAX_SPECIFICATION_ATTACHMENTS} onClick={e => openPicker(section, e)}><FolderOpen size={16}/>{section === 'product' ? 'Scegli foto dal NAS' : 'Associa foto o documento dal NAS'}</button>}</>;
  }
  return <section className="private-document-section product-specification">
    <header className="private-document-section-heading"><div><h3>Capitolato prodotto</h3><p>Foto, caratteristiche e istruzioni di confezionamento</p></div><span className="product-spec-status">{dirty || sourceChanges ? 'Modifiche non salvate' : spec?.version ? `Revisione ${spec.version}` : 'Da compilare'}</span></header>
    {loading ? <p role="status">Caricamento capitolato…</p> : !spec ? <><div role="alert" className="private-upload-error">{error}</div><button type="button" onClick={refresh}><RefreshCw size={15}/>Riprova</button></> : <>
      <div className="product-spec-actions product-spec-preview-action"><button type="button" onClick={preview} disabled={pdfLoading || loading || !sources || Boolean(sources.bomError)}><FileText size={17}/>{pdfLoading ? 'Preparazione PDF…' : 'Visualizza capitolato'}</button></div>
      {sourceError && <p role="alert" className="private-upload-error">{sourceError} Ricarica per recuperare foto, distinta e cliente.</p>}
      {sources?.bomError && <p role="alert" className="private-upload-error">{sources.bomError}</p>}
      {sources && !sources.bomError && !sources.components.length && <p role="status">Nessuna distinta base disponibile per questo articolo.</p>}
      {sources?.missingCustomerNames > 0 && <p role="status">Alcuni clienti collegati non hanno una ragione sociale disponibile.</p>}
      <form onSubmit={save}><fieldset disabled={saving}>
        <div className="product-spec-overview"><div className="product-spec-product-photos">
          {sources?.photoUrl && <article className="product-spec-attachment"><div className="product-spec-image">{photoError ? <p role="alert">Foto di catalogo non disponibile. Ricarica per riprovare.</p> : <img src={sources.photoUrl} alt={`Foto ${code}`} onError={() => setPhotoError(true)}/>}</div><div className="product-spec-attachment-body"><small>Foto da Workspace · Prodotti</small></div></article>}
          {!sources?.photoUrl && !spec.attachments.some(a => a.section === 'product') && <div className="product-spec-placeholder"><ImagePlus/><strong>Foto prodotto finito</strong><small>Nessuna foto disponibile nel catalogo</small></div>}{attachments('product')}</div>
          <div className="product-spec-fields"><label>Codice articolo<input value={code} readOnly/></label>{specificationSections[0].fields.map(field)}</div></div>
        {specificationSections.slice(1).map(section => <details key={section.id} className="product-spec-section" open={section.id === 'primary' || undefined}><summary>{section.title}</summary><div className="product-spec-fields">{section.fields.map(field)}</div>{attachments(section.id)}</details>)}
        <footer className="product-spec-footer"><div><small>{spec.updatedAt ? `Salvato il ${labelDate(spec.updatedAt)} da ${spec.updatedBy}` : 'I file restano nelle cartelle NAS esistenti.'}</small>{dirty && <small>Le modifiche non salvate restano disponibili passando ad altri articoli in questa pagina.</small>}</div><div className="product-spec-actions"><button type="button" onClick={refresh}><RefreshCw size={15}/>Ricarica</button>{canEdit && <button className="product-spec-save" type="submit" disabled={(!dirty && !sourceChanges && Boolean(spec.version)) || !sources || Boolean(sources.bomError)}><Save size={16}/>{saving ? 'Salvataggio…' : 'Salva capitolato'}</button>}</div></footer>
      </fieldset></form>
      {error && <div className="private-upload-error" role="alert">{error}</div>}{message && <p className="product-spec-message" role="status">{message}</p>}
      {spec.version > 0 && <details className="product-spec-section" onToggle={loadHistory}><summary>Storico revisioni</summary>{historyError ? <p role="alert">{historyError}</p> : revisions ? <ul>{revisions.map(r => <li key={r.version}>Rev. {r.version} · {labelDate(r.updatedAt)} · {r.updatedBy}</li>)}</ul> : <p>Caricamento revisioni…</p>}</details>}
    </>}
    {picker && <NasPicker section={picker} request={request} onSelect={addFile} onClose={closePicker}/>}
    {pdf && <div className="product-spec-modal"><section className="product-spec-pdf" role="dialog" aria-modal="true" aria-label="Anteprima capitolato" onKeyDown={e => { if (e.key === 'Escape') closePreview(); }}>
      <header><h3>Capitolato · {code}</h3><button type="button" ref={previewClose} onClick={closePreview} aria-label="Chiudi anteprima"><X/></button></header>
      {pdf.warnings.length > 0 && <p role="alert">{pdf.warnings.join(' ')}</p>}
      <iframe title={`Capitolato ${code}`} src={pdf.url}/><footer><small>{dirty || sourceChanges || !spec.version ? 'Bozza con i dati attualmente visualizzati.' : `Revisione ${spec.version}`}</small><a href={pdf.url} download={pdf.fileName}>Scarica PDF</a></footer>
    </section></div>}
  </section>;
}
