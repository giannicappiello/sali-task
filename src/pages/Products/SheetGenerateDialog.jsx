import { useEffect, useRef, useState } from 'react';
import SheetDialog from './SheetDialog';
import { SHEET_LANGUAGES, generationContent } from '../../../shared/directProductSheet.js';
import { getTemplate, listTemplates, sheetChannelApi } from './directSheetService';
import { generateSheetFiles } from './directSheetPdf';
import { archiveSheetFiles } from '../../../shared/directSheetArchive.js';

function GeneratedFile({ file }) {
  const media = useRef(null), download = useRef(null);
  useEffect(() => { const url = URL.createObjectURL(file.blob); media.current.src = url; download.current.href = url; return () => URL.revokeObjectURL(url); }, [file.blob]);
  return <section className="direct-generated-file"><strong>{file.name}</strong>{file.name.endsWith('.pdf') ? <iframe ref={media} title={file.name} /> : <img ref={media} alt={`Scheda ${file.languages.join(', ')}`} />}<a ref={download} download={file.name}>Scarica {file.name}</a></section>;
}
async function checksum(blob) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(b => b.toString(16).padStart(2, '0')).join(''); }
export default function SheetGenerateDialog({ product, sheet, translations, canArchive, onClose }) {
  const [templates, setTemplates] = useState([]), [templateId, setTemplateId] = useState(''), [format, setFormat] = useState('pdf'), [languages, setLanguages] = useState(['IT']);
  const [results, setResults] = useState([]), [warnings, setWarnings] = useState([]);
  const [files, setFiles] = useState([]), [saved, setSaved] = useState([]), [archives, setArchives] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  useEffect(() => { let live = true; listTemplates().then(rows => { if (live) { setTemplates(rows); setTemplateId(rows.find(row => row.is_default)?.id || rows[0]?.id || ''); } }).catch(e => { if (live) setError(e.message); }); sheetChannelApi('archives', { productId: product.id }).then(data => { if (live) setArchives(data.files); }).catch(e => { if (live) setError(e.message); }); return () => { live = false; }; }, [product.id]);
  function changed() { setWarnings([]); setResults([]); setFiles([]); setSaved([]); setMessage(''); setError(''); }
  async function generate(archive) {
    if (busy) return; setBusy(true); setError(''); setMessage('Caricamento template…'); setWarnings([]); setResults([]); setSaved([]); setFiles([]);
    try {
      const template = await getTemplate(templateId);
      const generated = await generateSheetFiles({ layout: template.layout, product, sheet, translations, languages, format, onProgress: setMessage, loadPhoto: async () => (await sheetChannelApi('photo', { productId: product.id })).dataUrl });
      setFiles(generated); setWarnings([...new Set(generated.flatMap(file => file.warnings || []))]);
      if (archive) {
        const outcome = await archiveSheetFiles({ files: generated, onProgress: setMessage,
          onResult: result => { setResults(current => [...current.filter(r => r.name !== result.name), result]); if (result.status === 'saved') setSaved(current => [...current, result.name]); },
          prepare: async file => sheetChannelApi('prepare_archive', { productId: product.id, revision: sheet.revision, templateId: template.id, templateRevision: template.revision,
            translationRevisions: Object.fromEntries(translations.map(t => [t.language, t.revision])), filename: file.name, format, languages: file.languages, sha256: await checksum(file.blob), size: file.blob.size }),
          upload: async (file, prepared) => {
            const upload = await fetch(prepared.url, { method: 'PUT', signal: AbortSignal.timeout(60000), headers: { 'Content-Type': format === 'pdf' ? 'application/pdf' : 'image/jpeg' }, body: file.blob });
            const response = await upload.json().catch(() => ({}));
            if (!upload.ok) throw new Error(response.error || 'Scrittura sul NAS non disponibile. Il file è scaricabile qui sotto.');
          },
          confirm: async (_file, prepared) => sheetChannelApi('confirm_archive', { productId: product.id, revision: sheet.revision, archiveId: prepared.id }),
        });
        const count = outcome.filter(r => r.status === 'saved').length;
        setMessage(count === generated.length ? 'Salvataggio sul NAS completato e verificato.' : `Operazione conclusa: ${count}/${generated.length} file salvati e verificati. Consulta gli esiti qui sotto.`);
        // Refreshing the historical list must never keep the save operation busy.
        void sheetChannelApi('archives', { productId: product.id }).then(data => setArchives(data.files)).catch(() => {});
      } else setMessage('Anteprima pronta. Per archiviare usa “Genera e salva sul NAS”.');
    } catch (e) { setError(e.name === 'TimeoutError' || e.name === 'AbortError' ? 'Tempo di attesa esaurito. Riprova: nessun salvataggio è stato confermato.' : e.message); setMessage(''); } finally { setBusy(false); }
  }
  return <SheetDialog title="Genera scheda tecnica" wide onClose={onClose} busy={busy}>
    <fieldset className="direct-sheet-form" disabled={busy}><label>Template<select aria-label="Template" value={templateId} onChange={e => { setTemplateId(e.target.value); changed(); }}><option value="">Scegli un template</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name}{t.is_default ? ' · Predefinito' : ''}</option>)}</select></label>
      {!templates.length && <p>Crea e salva un template da Prodotti Direct → Template scheda tecnica.</p>}
      <div className="direct-language-choices">{SHEET_LANGUAGES.map(language => { let valid = true; try { generationContent(sheet, translations, language.code, product); } catch { valid = false; }
        return <label className="direct-check" key={language.code}><input type="checkbox" checked={languages.includes(language.code)} disabled={!valid} onChange={e => { setLanguages(current => SHEET_LANGUAGES.map(l => l.code).filter(code => code === language.code ? e.target.checked : current.includes(code))); changed(); }} />{language.label} ({language.code}){!valid && <small>Da tradurre, aggiornare o approvare in “Compila Scheda”</small>}</label>;
      })}</div>
      <label>Formato<select aria-label="Formato" value={format} onChange={e => { setFormat(e.target.value); changed(); }}><option value="pdf">PDF vettoriale · una pagina per lingua</option><option value="jpeg">JPEG alta risoluzione · 300 dpi</option></select></label>
      <p>I nomi vengono ricavati dal codice articolo: {product.codice_mexal || product.codice}{format === 'pdf' ? '.pdf' : '_IT.jpeg, _ENG.jpeg…'}. Una nuova generazione sostituisce il file omonimo sul NAS, conservando la versione precedente.</p>
    </fieldset>
    {error && <p className="direct-sheet-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}{saved.length > 0 && <p role="status">File verificati sul NAS: {saved.join(', ')}</p>}
    <footer><button type="button" disabled={busy || !templateId || !languages.length} onClick={() => void generate(false)}>Anteprima</button>{canArchive && <button type="button" className="primary-action" disabled={busy || !templateId || !languages.length} onClick={() => void generate(true)}>{busy ? 'Generazione e salvataggio…' : 'Genera e salva sul NAS'}</button>}</footer>
    {warnings.length > 0 && <section aria-label="Avvisi impaginazione" className="direct-sheet-notice" role="status"><strong>Avvisi non bloccanti</strong><ul>{warnings.map(message => <li key={message}>{message}</li>)}</ul></section>}
    {results.length > 0 && <section aria-label="Esiti salvataggio" aria-live="polite"><h3>Esiti salvataggio</h3><ul>{results.map(result => <li key={result.name}><strong>{result.name}</strong>: {result.status === 'saved' ? 'Salvato e verificato sul NAS' : result.status === 'pending' ? 'Salvataggio in corso…' : result.status === 'unconfirmed' ? 'Salvataggio non confermato: ' + result.error : 'Non salvato: ' + result.error}</li>)}</ul></section>}
    <div className="direct-generated-files">{files.map((file, index) => <GeneratedFile key={`${file.name}-${index}-${file.blob.size}`} file={file} />)}</div>
    {archives.length > 0 && <section><h3>Ultimi file salvati sul NAS</h3><ul>{archives.map(file => <li key={file.id}><a href={file.url} target="_blank" rel="noreferrer">{file.filename}</a> · {file.languages.join(', ')} · rev. {file.source_revision}</li>)}</ul></section>}
  </SheetDialog>;
}
