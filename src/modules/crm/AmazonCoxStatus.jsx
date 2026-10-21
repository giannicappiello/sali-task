const labels = { pending: 'Da emettere dopo la spedizione', processing: 'In corso: verificare Mexal se interrotto', blocked: 'Da completare', reconciliation_required: 'Da riconciliare in Mexal' };
export default function AmazonCoxStatus({ status, reference, error }) {
  if (!status) return null;
  return <span>{reference ? `COX ${reference.series}/${reference.number} · ${reference.year}` : labels[status] || status}{error ? <small> · {error}</small> : null}</span>;
}
