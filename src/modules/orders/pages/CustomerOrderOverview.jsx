const quantity = value => Number(value || 0).toLocaleString('it-IT', { maximumFractionDigits: 3 });
import { displayDate } from '../../../lib/displayDate.js';
const date = value => value ? displayDate(value) : 'Da pianificare';

export default function CustomerOrderOverview({ rows }) {
  return <div className="rdp-oct-cards">{rows.map(row => <article key={row.id} className="rdp-oct-card">
    <header className="rdp-oct-card-header"><div><strong>{row.label}</strong><p>{row.customer}</p>
      <p>Riferimento fattura: {row.invoiceLookupError ? 'Verifica temporaneamente non disponibile' : row.invoiceReferences?.join(', ') || 'Non disponibile'}</p>
      <p>Ultimazione prevista: {date(row.plannedCompletionDate)}</p>
    </div></header>
    <div style={{ overflowX: 'auto' }}><table className="orders-table"><thead><tr><th>Articolo</th><th>Ordinato</th><th>Evaso</th><th>Ultimazione prevista</th></tr></thead>
      <tbody>{(row.lines || []).map(line => <tr key={line.id}><td>{line.articleCode} · {line.description}</td><td>{quantity(line.orderedQuantity)} {line.unit}</td><td>{quantity(line.fulfilledQuantity)} {line.unit}</td><td>{date(row.plannedCompletionDate)}</td></tr>)}</tbody>
    </table></div>
  </article>)}</div>;
}
