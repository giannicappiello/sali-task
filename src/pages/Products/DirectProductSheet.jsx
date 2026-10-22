import { lazy, Suspense, useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { SHEET_FIELDS, SHEET_LANGUAGES, emptySheet, sheetStatus, sheetValues } from '../../../shared/directProductSheet.js';
import { discardChanges, getSheet, getTranslations, publishClub, saveSheet, saveTranslation, sheetChannelApi } from './directSheetService';
import SheetDialog from './SheetDialog';
const SheetGenerateDialog = lazy(() => import('./SheetGenerateDialog'));

export function SheetStatus({ sheet }) { const status = sheetStatus(sheet); return <span className={`direct-sheet-status ${status.code}`}>Scheda: {status.label} · {status.count}/6</span>; }

function ChannelPublication({ productId, sheet, dirty, onPublished }) {
  const [targets, setTargets] = useState([]), [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; sheetChannelApi('targets', { productId }).then(data => { if (live) setTargets(data.targets); }).catch(e => { if (live) setError(e.message); }); return () => { live = false; }; }, [productId]);
  async function publish(target) {
    setBusy(true); setError(''); setMessage('');
    try {
      if (target === 'club') { await publishClub(productId, sheet.revision); setMessage('Testi pubblicati per i prodotti già visibili nel catalogo Club.'); await onPublished({ ...sheet, club_revision: sheet.revision }); }
      else {
        const data = await sheetChannelApi('publish', { productId, revision: sheet.revision, mappingId: target.id });
        setTargets(current => current.map(t => t.id === target.id ? { ...t, delivery: data.delivery } : t)); setMessage(data.delivery.message);
      }
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const allowed = sheet && sheetStatus(sheet).count === 6 && !dirty && !busy;
  return <section className="direct-sheet-publication"><h3>Pubblicazione sui canali</h3><p>Gli invii usano la scheda italiana salvata. La visibilità dei prodotti si gestisce nei rispettivi cataloghi.</p>
    {dirty && <p>Salva le modifiche prima di pubblicare.</p>}
    <div className="direct-sheet-actions"><button type="button" disabled={!allowed || sheet.club_revision === sheet.revision} onClick={() => void publish('club')}>Pubblica nel Club</button><span>{sheet?.club_revision ? `Club: revisione ${sheet.club_revision}${sheet.club_revision !== sheet.revision ? ' · da aggiornare' : ' pubblicata'}` : 'Club: scheda non pubblicata'}</span></div>
    {targets.map(target => <div key={target.id} className="direct-sheet-channel"><div><strong>{target.name}</strong><small>{target.sku} · {target.marketplace || 'Sito'}{target.delivery ? ` · rev. ${target.delivery.revision}: ${target.delivery.message || target.delivery.status}` : ''}</small></div><button type="button" disabled={!allowed || (target.delivery?.revision === sheet.revision && ['sent','accepted','pending'].includes(target.delivery.status))} onClick={() => void publish(target)}>Invia {target.provider === 'amazon_sp_api' ? 'ad Amazon' : 'al sito'}</button></div>)}
    {!targets.length && <p>Le destinazioni sito e Amazon compaiono quando esiste una connessione attiva e una riconciliazione verificata del prodotto.</p>}
    {message && <p role="status">{message}</p>}{error && <p role="alert" className="direct-sheet-error">{error}</p>}
  </section>;
}
function SheetContentEditor({ product, sheet: initial, translations: initialTranslations, canPublish, onClose, onSaved }) {
  const [source, setSource] = useState(initial), [translations, setTranslations] = useState(initialTranslations);
  const [language, setLanguage] = useState('IT'), [content, setContent] = useState(() => ({ ...emptySheet(), ...initial?.content }));
  const [original, setOriginal] = useState(() => JSON.stringify({ ...emptySheet(), ...initial?.content })), [reviewed, setReviewed] = useState(false), [originalReviewed, setOriginalReviewed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const currentTranslation = translations.find(t => t.language === language), dirty = JSON.stringify(content) !== original || reviewed !== originalReviewed;
  async function close() { if (!busy && await discardChanges(dirty)) onClose(); }
  async function changeLanguage(next) {
    if (!await discardChanges(dirty)) return;
    const row = next === 'IT' ? source : translations.find(t => t.language === next), value = { ...emptySheet(), ...row?.content };
    if (next !== 'IT') value.inci = source?.content.inci || '';
    const approved = Boolean(row?.reviewed && row.source_revision === source?.revision);
    setLanguage(next); setContent(value); setOriginal(JSON.stringify(value)); setReviewed(approved); setOriginalReviewed(approved); setError(''); setMessage('');
  }
  async function save(event) {
    event.preventDefault(); if (busy) return; setBusy(true); setError(''); setMessage('');
    try {
      if (language === 'IT') { const saved = await saveSheet(product.id, content, source?.revision); setSource(saved); setContent(saved.content); setOriginal(JSON.stringify(saved.content)); await onSaved(saved, translations); }
      else {
        const saved = await saveTranslation(product.id, language, content, source?.revision, currentTranslation?.revision, reviewed);
        const next = [...translations.filter(t => t.language !== language), saved]; setTranslations(next); setOriginal(JSON.stringify(saved.content)); setContent(saved.content); setOriginalReviewed(saved.reviewed); await onSaved(source, next);
      }
      setMessage('Scheda salvata.');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function translate() {
    if (!await discardChanges(dirty)) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await sheetChannelApi('translate', { productId: product.id, revision: source.revision, language });
      setContent(result.content); setReviewed(false); setMessage('Traduzione pronta: controlla tutti i campi, approvala e salvala.');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <SheetDialog title={`Compila Scheda · ${sheetValues(product).code}`} onClose={close} busy={busy}>
    <form onSubmit={save} className="direct-sheet-form">
      <div className="direct-sheet-actions"><label>Lingua della scheda<select aria-label="Lingua della scheda" disabled={busy} value={language} onChange={e => void changeLanguage(e.target.value)}>{SHEET_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label} ({l.code})</option>)}</select></label><SheetStatus sheet={{ content }} /></div>
      {language !== 'IT' && <><p>La traduzione va controllata prima di generare i documenti. L’INCI/CTFA resta identico alla scheda italiana.</p>{currentTranslation && currentTranslation.source_revision !== source?.revision && <p className="direct-sheet-notice">La scheda italiana è cambiata: aggiorna e rivedi questa traduzione.</p>}<button type="button" disabled={busy || sheetStatus(source).count !== 6} onClick={translate}>Traduci automaticamente dall’italiano salvato</button></>}
      {error && <p className="direct-sheet-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
      <fieldset disabled={busy}>{SHEET_FIELDS.map(field => <label key={field.key}>{field.label}<textarea aria-label={field.label} rows={field.key === 'inci' ? 4 : 5} maxLength={12000} value={content[field.key]} readOnly={language !== 'IT' && field.key === 'inci'} onChange={e => { setContent(current => ({ ...current, [field.key]: e.target.value })); if (language !== 'IT') setReviewed(false); }} /><small>{content[field.key].length}/12000</small></label>)}
      {language !== 'IT' && <label className="direct-check"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />Ho controllato la traduzione e la approvo per la generazione.</label>}</fieldset>
      <footer><span>{dirty ? 'Modifiche non salvate' : 'Tutti i testi visualizzati sono salvati o ancora vuoti'}</span><button type="submit" className="primary-action" disabled={busy || !dirty || (language !== 'IT' && sheetStatus(source).count !== 6)}>{busy ? 'Operazione in corso…' : 'Salva scheda'}</button></footer>
    </form>
    {canPublish && language === 'IT' && <ChannelPublication productId={product.id} sheet={source} dirty={dirty || busy} onPublished={async saved => { setSource(saved); await onSaved(saved, translations); }} />}
  </SheetDialog>;
}
export default function DirectProductSheet({ product, onSaved }) {
  const { canUseModule } = useAuth(), canWrite = canUseModule('prodotti', 'scrittura'), canPublish = canUseModule('prodotti', 'amministrazione');
  const [sheet, setSheet] = useState(null), [translations, setTranslations] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState(''), [editor, setEditor] = useState(false), [generate, setGenerate] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => { let live = true; Promise.all([getSheet(product.id), getTranslations(product.id)]).then(([row, langs]) => { if (live) { setSheet(row); setTranslations(langs); setError(''); } }).catch(e => { if (live) setError(e.message); }).finally(() => { if (live) setLoading(false); }); return () => { live = false; }; }, [product.id, retry]);
  async function saved(row, langs) { setSheet(row); setTranslations(langs); onSaved?.(row); }
  return <>
    <div className="direct-sheet-product-title"><h2>{sheetValues(product).name}</h2>{canWrite && <button type="button" className="primary-action" disabled={loading || Boolean(error)} onClick={() => setEditor(true)}><FileText size={17} />Compila Scheda</button>}</div>
    <div className="direct-sheet-actions">{loading ? <span>Caricamento scheda…</span> : error ? <><span className="direct-sheet-error" role="alert">Scheda non disponibile: {error}</span><button type="button" className="secondary-action" onClick={() => { setLoading(true); setRetry(n => n + 1); }}>Riprova</button></> : <><SheetStatus sheet={sheet} /><button type="button" className="secondary-action" disabled={sheetStatus(sheet).count !== 6} onClick={() => setGenerate(true)}>Genera scheda tecnica</button>{sheet?.revision && <small>Revisione italiana {sheet.revision} · {new Date(sheet.updated_at).toLocaleString('it-IT')}</small>}</>}</div>
    {sheet && <div className="direct-sheet-content">{SHEET_FIELDS.filter(f => sheet.content[f.key]).map(f => <section key={f.key}><h3>{f.label}</h3><p>{sheet.content[f.key]}</p></section>)}</div>}
    {editor && <SheetContentEditor product={product} sheet={sheet} translations={translations} canPublish={canPublish} onClose={() => setEditor(false)} onSaved={saved} />}
    {generate && <Suspense fallback={<p>Caricamento generatore…</p>}><SheetGenerateDialog product={product} sheet={sheet} translations={translations} canArchive={canWrite} onClose={() => setGenerate(false)} /></Suspense>}
  </>;
}
