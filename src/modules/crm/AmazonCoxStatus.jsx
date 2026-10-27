const labels = { pending: 'Da emettere dopo la spedizione', processing: 'In corso: verificare Mexal se interrotto', blocked: 'Da completare', reconciliation_required: 'Da riconciliare in Mexal' };
export default function AmazonCoxStatus({ status, reference, error }) {
  if (!status) return null;
  const proof=reference?.moneyVerification;
  const amount=cents=>new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format(cents/100);
  return <span>{reference ? `COX ${reference.series}/${reference.number} · ${reference.year}` : labels[status] || status}{reference?.taxTreatment ? <small> · {reference.taxTreatment.vatCode}: imposta riscossa da Amazon {amount(reference.taxTreatment.amazonCollectedTaxCents)}</small> : null}{proof ? <small> · Scarti ammessi alla seconda cifra decimale: totale {amount(proof.totalDifferenceCents)}, IVA {amount(proof.taxDifferenceCents)}</small> : null}{error ? <small> · {error}</small> : null}</span>;
}
