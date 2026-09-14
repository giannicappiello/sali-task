export default function MaterialTransferSummary({ evidence }) {
  if (!evidence) return null;
  return <section aria-label="Conseguenze del trasferimento">
    <p><strong>{evidence.quantity} {evidence.unit} di {evidence.articleCode} → {evidence.orderNumber}</strong></p>
    <ul>{evidence.transfers?.map(row => <li key={row.sourceOrderId}>
      {row.orderNumber} · {row.product}: trasferiti {row.quantity} {evidence.unit}; riserva residua {row.reservedAfter}; scoperto fisico risultante {row.physicalShortageAfter}.
    </li>)}</ul>
    <p>Scoperto residuo destinazione: {evidence.missingAfter} {evidence.unit}.</p>
    <p>{evidence.warning}</p>
  </section>;
}
