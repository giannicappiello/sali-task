import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { Modal } from '../../features/production-costs/common';
import { applySpecificationSources, specificationSourceFields } from '../../../shared/productSpecification';
import './ProductSpecification.css';
import SpecificationApproval from './SpecificationApproval';

export default function ProductSpecificationViewButton({ articleCode, description }) {
  const { session } = useAuth();
  const [open, setOpen] = useState(false), [pdf, setPdf] = useState(null), [error, setError] = useState('');
  const [approval, setApproval] = useState(null), [approving, setApproving] = useState(false), [reload, setReload] = useState(0);
  const button = useRef(null);
  const request = useCallback(async (path, options = {}) => {
    const response = await fetch('/api/workspace/documents', { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'private_documents', path, input: options.body }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Capitolato non disponibile.');
    return result;
  }, [session?.access_token]);
  useEffect(() => {
    if (!open) return undefined;
    let active = true, objectUrl;
    async function load() {
      const query = new URLSearchParams({ articleCode });
      const { specification: saved, canApprove, sources } = await request(`specifications?${query}&includeSources=true`);
      const specification = saved || (sources.specificationKind === 'bulk' ? { version: 0, attachments: [], data: { description: description || articleCode } } : null);
      if (!specification) throw new Error('Il capitolato di questo prodotto non è ancora stato compilato in Documenti Private.');
      if (sources.bomError) throw new Error(sources.bomError);
      const { createProductSpecificationPdf } = await import('./createProductSpecificationPdf');
      const data = applySpecificationSources(specification.data, sources);
      const dirty = specificationSourceFields.some(name => (specification.data[name] || '') !== (data[name] || ''));
      const result = await createProductSpecificationPdf({ article: { articleCode, description }, specification: { ...specification, data }, photoUrl: sources.photoUrl, components: sources.components, dirty, request });
      if (active) { objectUrl = URL.createObjectURL(result.blob); setPdf({ ...result, url: objectUrl }); setApproval({ specification: { ...specification, data }, canApprove, disabled: dirty }); }
    }
    load().catch(cause => { if (active) setError(cause.message); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [open, articleCode, description, request, reload]);
  async function approve() {
    setApproving(true); setError('');
    try {
      await request(`specifications/approve?${new URLSearchParams({ articleCode })}`, { body: { expectedVersion: approval.specification.version } });
      setPdf(null); setApproval(null); setReload(n => n + 1);
    } catch (cause) { setError(cause.message); }
    finally { setApproving(false); }
  }
  function close() { if (approving) return; setOpen(false); setPdf(null); setApproval(null); setError(''); button.current?.focus(); }
  return <><button type="button" ref={button} onClick={() => setOpen(true)} disabled={!articleCode}><FileText size={17}/>Visualizza capitolato</button>
    {open && <Modal title={`Capitolato · ${articleCode}`} onClose={close} className="product-spec-viewer">
      {error ? <p role="alert" className="pc-error">{error}</p> : !pdf ? <p role="status">Preparazione capitolato…</p> : <>
        {pdf.warnings.length > 0 && <p role="alert" className="pc-note">{pdf.warnings.join(' ')}</p>}
        <iframe title={`Capitolato ${articleCode}`} src={pdf.url}/><SpecificationApproval {...approval} busy={approving} onApprove={approve}/><footer><a href={pdf.url} download={pdf.fileName}>Scarica PDF</a></footer>
      </>}
    </Modal>}
  </>;
}
