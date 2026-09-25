import { formatDisplayDate } from '../lib/displayLocale.js';
import "../pages/Production/priority-revision.css";

const number = new Intl.NumberFormat("it-IT", { useGrouping: 'always',  maximumFractionDigits: 6 });
const date = value => value ? formatDisplayDate(new Date(value), { dateStyle: "short", timeStyle: "short" }) : "Da ripianificare";
export default function PriorityRevisionSummary({ revision }) {
  const snapshot = revision?.snapshot;
  if (!snapshot) return null;
  return <div className="priority-summary">
    <div className="priority-title"><h3>{revision.number} · {snapshot.input.orderNumber}</h3><span className="priority-badge">{({ PROPOSED: "Da confermare", MES_APPLIED: "MES applicato · da allineare", COMPLETED: "Completata", RECONCILIATION_REQUIRED: "Da riconciliare" })[revision.status] || revision.status}</span></div>
    <p>{snapshot.input.reason}</p>
    {revision.workspaceBlock ? <p role="alert" className="priority-error">Prima della conferma: {revision.workspaceBlock}</p> : null}
    <div className="priority-kpis">
      <div><span>Lavorazioni coinvolte</span><strong>{snapshot.impacts.length}</strong></div>
      <div><span>In attesa di copertura</span><strong>{snapshot.impacts.filter(x => x.coverage === "In attesa di copertura").length}</strong></div>
      <div><span>Componenti con scoperti</span><strong>{snapshot.needs.filter(x => x.shortage > 0).length}</strong></div>
    </div>
    <h3>Conseguenze sulle lavorazioni</h3>
    <div className="priority-table" role="region" aria-label="Confronto pianificazione" tabIndex={0}><table><thead><tr><th>Lavorazione / cliente</th><th>Piano precedente</th><th>Piano proposto</th><th>Consegna richiesta</th><th>Fattibilità</th></tr></thead><tbody>
      {snapshot.impacts.map(row => <tr key={row.orderId}><td><strong>{row.orderNumber}</strong><span>{row.product}</span><small>{row.customer || "Cliente non indicato"}</small></td><td>{date(row.beforeStart)}<small>Fine: {date(row.beforeEnd)}</small></td><td>{date(row.afterStart)}<small>Fine: {date(row.afterEnd)}</small></td><td>{date(row.dueAt)}{row.afterEnd && new Date(row.afterEnd) > new Date(row.dueAt) ? <span className="priority-warning">Oltre la consegna</span> : null}</td><td><strong>{row.coverage}</strong><small>{row.reason}</small></td></tr>)}
    </tbody></table></div>
    <h3>Materiali e fabbisogni aggiornati</h3>
    {snapshot.materialBalances?.length ? <><h4>Disimpegno e disponibilità fisica</h4><div className="priority-table" role="region" aria-label="Bilancio disimpegni" tabIndex={0}><table><thead><tr><th>Articolo</th><th>Fisico</th><th>Prenotato prima / eccedenza</th><th>Disimpegnato</th><th>Assegnato alla destinazione</th><th>Prenotato dopo / libero</th></tr></thead><tbody>{snapshot.materialBalances.map(row => <tr key={row.articleCode}><td><strong>{row.articleCode}</strong><small>{row.unit}</small></td><td>{number.format(row.physical)}</td><td>{number.format(row.reservedBefore)}<small>Eccedenza: {number.format(row.overbookedBefore)}</small></td><td>{number.format(row.released)}</td><td>{number.format(row.assignedToTarget)}</td><td>{number.format(row.reservedAfter)}<small>Libero: {number.format(row.freeAfter)}</small></td></tr>)}</tbody></table></div></> : null}
    <p className="priority-help">Quantità nelle unità indicate. Gli arrivi sono coperture future già assegnate, non giacenza fisica. Non vengono emessi ordini fornitore automaticamente.</p>
    <div className="priority-table" role="region" aria-label="Copertura materiali e fabbisogni" tabIndex={0}><table><thead><tr><th>Ordine / materiale</th><th>Fabbisogno</th><th>Impegno prima</th><th>Impegno dopo</th><th>Da arrivi</th><th>Scoperto</th></tr></thead><tbody>
      {snapshot.needs.filter(row => !row.internalProduction).map((row, i) => <tr key={`${row.orderId}:${row.articleCode}:${i}`}><td><strong>{row.orderNumber} · {row.articleCode}</strong><small>{row.description}</small></td><td>{number.format(row.required)} {row.unit}</td><td>{number.format(row.physicalBefore)}</td><td>{number.format(row.physicalAfter)}</td><td>{number.format(row.future)}<small>{row.future > 0 ? date(row.availableAt) : "—"}</small></td><td className={row.shortage > 0 ? "priority-warning" : ""}>{number.format(row.shortage)} {row.unit}</td></tr>)}
    </tbody></table></div>
    <details><summary>Informazioni e vincoli della revisione</summary><p>Gli OP non vengono duplicati. Le produzioni avviate restano protette. I fogli coinvolti devono essere rigenerati e stampati dopo l’applicazione. Il piano dipende dalle disponibilità e dal calendario MES al momento della simulazione.</p>{snapshot.warnings.map((warning, i) => <p key={i}>{warning}</p>)}</details>
  </div>;
}
