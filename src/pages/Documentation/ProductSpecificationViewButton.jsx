import { useEffect, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { Modal } from '../../features/production-costs/common';
import { applySpecificationSources } from '../../../shared/productSpecification';
import './ProductSpecification.css';

export default function ProductSpecificationViewButton({ articleCode, description }) {
  const { session } = useAuth();
  const [open, setOpen] = useState(false), [pdf, setPdf] = useState(null), [error, setError] = useState('');
  const button = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    let active = true, objectUrl;
    const token = session?.access_token;
    async function request(path, options = {}) {
      const response = await fetch('/api/workspace/documents', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'private_documents', path, input: options.body }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Capitolato non disponibile.');
      return result;
    }
    async function load() {
      const query = new URLSearchParams({ articleCode });
      const [{ specification }, sources] = await Promise.all([request(`specifications?${query}`), request(`specifications/sources?${query}`)]);
      if (!specification) throw new Error('Il capitolato di questo prodotto non è ancora stato compilato in Documenti Private.');
      if (sources.bomError) throw new Error(sources.bomError);
      const { createProductSpecificationPdf } = await import('./createProductSpecificationPdf');
      const data = applySpecificationSources(specification.data, sources);
      const dirty = ['customer', 'semiFinished'].some(name => (specification.data[name] || '') !== data[name]);
      const result = await createProductSpecificationPdf({ article: { articleCode, description }, specification: { ...specification, data }, photoUrl: sources.photoUrl, components: sources.components, dirty, request });
      if (active) { objectUrl = URL.createObjectURL(result.blob); setPdf({ ...result, url: objectUrl }); }
    }
    load().catch(cause => { if (active) setError(cause.message); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [open, articleCode, description, session?.access_token]);
  function close() { setOpen(false); setPdf(null); setError(''); button.current?.focus(); }
  return <><button type="button" ref={button} onClick={() => setOpen(true)} disabled={!articleCode}><FileText size={17}/>Visualizza capitolato</button>
    {open && <Modal title={`Capitolato · ${articleCode}`} onClose={close} className="product-spec-viewer">
      {error ? <p role="alert" className="pc-error">{error}</p> : !pdf ? <p role="status">Preparazione capitolato…</p> : <>
        {pdf.warnings.length > 0 && <p role="alert" className="pc-note">{pdf.warnings.join(' ')}</p>}
        <iframe title={`Capitolato ${articleCode}`} src={pdf.url}/><footer><a href={pdf.url} download={pdf.fileName}>Scarica PDF</a></footer>
      </>}
    </Modal>}
  </>;
}
