import { displayDate } from '../../lib/displayDate';

export default function SpecificationApproval({ specification, canApprove, disabled, busy, onApprove, showDetails = true }) {
  const approved = Boolean(specification?.data?.approvedBy);
  return <div className="product-spec-approval">
    {showDetails && approved && <p>Approvato da <strong>{specification.data.approvedBy}</strong> il <strong>{displayDate(specification.data.approvedAt)}</strong></p>}
    {canApprove && <label><input type="checkbox" checked={approved} disabled={approved || disabled || busy || !specification?.version}
      onChange={e => { if (e.target.checked) onApprove(); }}/>{busy ? 'Registrazione approvazione…' : 'Approva'}</label>}
    {canApprove && !approved && (disabled || !specification?.version) && <small>Salva la revisione aggiornata prima di approvare.</small>}
  </div>;
}
