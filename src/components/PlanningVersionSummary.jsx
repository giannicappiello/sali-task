import "../pages/Production/planning-lifecycle.css";
import { planningDate, planningStages, planningStatuses } from "../pages/Production/planning-display";

const date = value => planningDate(value, "Non pianificata");
const phases = { 0: "Miscelazione", 1: "Controllo qualità", 2: "Attesa", 3: "Confezionamento", 4: "Lavaggio", 5: "Magazzino", 6: "Manutenzione", 7: "Astucciatura" };
export default function PlanningVersionSummary({ version, query = "", children }) {
  if (!version?.snapshot) return null;
  const { snapshot } = version;
  const rows = (snapshot.impacts || []).filter(row => Object.values(row).join(" ").toLocaleLowerCase("it-IT").includes(query.toLocaleLowerCase("it-IT")));
  return <div className="plan-summary">
    <p>Versione <strong>{version.id?.slice(0, 8)}</strong> · {planningStatuses[version.status] || version.status} · {date(version.createdAt)}</p>
    {!!snapshot.blocks?.length && <div className="plan-notice plan-error" role="alert"><strong>Da risolvere prima della conferma</strong><ul>{snapshot.blocks.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
    {children}
    {!!snapshot.shortages?.length && <div className="plan-notice"><h3>Fabbisogni specifici {version.status === "PROPOSED" ? "da generare" : "generati"}</h3><p>{snapshot.shortagesCoveredAtUtc ? "Copertura verificata: " + date(snapshot.shortagesCoveredAtUtc) : "Carenza autorizzata: le quantità indicate non sono prenotate né disponibili per l’avvio."}</p><div className="plan-table-wrap"><table><thead><tr><th>RdP / OP</th><th>Fase</th><th>Materiale</th><th>Quantità mancante</th></tr></thead><tbody>{snapshot.shortages.map((item, i) => <tr key={i}><td>{snapshot.impacts?.find(row => row.orderId === item.orderId)?.number || item.orderId}</td><td>{phases[item.phase] || item.phase}</td><td>{item.code}</td><td>{new Intl.NumberFormat("it-IT", { maximumFractionDigits: 6 }).format(item.quantity)} {item.unit}</td></tr>)}</tbody></table></div></div>}
    <div className="plan-table-wrap" tabIndex={0} role="region" aria-label="Confronto versioni del piano">
      <table><thead><tr><th>RdP / OP · articolo</th><th>Consegna richiesta</th><th>Piano precedente</th><th>Piano proposto</th><th>Fase / copertura</th><th>Motivo</th></tr></thead><tbody>
        {rows.map(row => <tr key={row.orderId}><td><strong>{row.number}</strong><br />{row.article} · {row.description}</td><td>{date(row.requestedAt)}</td><td>{date(row.beforeStart)}<br />{date(row.beforeEnd)}</td><td>{date(row.afterStart)}<br />{date(row.afterEnd)}</td><td>{planningStages[row.stage] || row.stage}<br />{row.coverage}</td><td>{row.reason || "Proposta calcolata dal motore APS"}</td></tr>)}
        {!rows.length && <tr><td colSpan={6}>Nessuna riga corrisponde alla ricerca.</td></tr>}
      </tbody></table>
    </div>
    {!!snapshot.warnings?.length && <details className="plan-notice"><summary>Informazioni e avvisi del calcolo ({snapshot.warnings.length})</summary><ul>{snapshot.warnings.map((s, i) => <li key={i}>{s}</li>)}</ul></details>}
    <details className="plan-notice"><summary>Fasi, impianti e operatori ({snapshot.tasks?.length || 0})</summary><div className="plan-table-wrap"><table><thead><tr><th>RdP / OP</th><th>Fase / batch</th><th>Impianto</th><th>Inizio / fine</th><th>Operatori</th><th>Protezione</th></tr></thead><tbody>{snapshot.tasks?.map((task, i) => {
      const resource = snapshot.resources?.find(x => x.id === task.resourceId);
      return <tr key={i}><td>{task.orderNumber || snapshot.impacts?.find(x => x.orderId === task.orderId)?.number || task.orderId}<br />{task.articleCode}</td><td>{phases[task.type] || task.type} · {task.batchNumber}/{task.batchCount}</td><td>{resource ? `${resource.code} · ${resource.description}` : `Impianto ${task.resourceId}`}</td><td>{date(task.start)}<br />{date(task.end)}</td><td>{task.operatoriIds?.map(id => snapshot.operators?.find(x => x.id === id)?.description || `Operatore ${id}`).join(", ") || "Non previsti"}</td><td>{task.locked || task.status === 2 ? "Conservata" : task.salvato ? "Già nel piano" : "Proposta"}</td></tr>;
    })}</tbody></table></div></details>
    <details className="plan-notice"><summary>Materiali da coprire ({snapshot.requirements?.length || 0})</summary><div className="plan-table-wrap"><table><thead><tr><th>OP / domanda</th><th>Articolo</th><th>Quantità</th><th>UM</th></tr></thead><tbody>{snapshot.requirements?.map((r, i) => <tr key={i}><td>{snapshot.impacts?.find(x => x.orderId === r.orderId)?.number || r.orderId}</td><td>{r.code}</td><td>{new Intl.NumberFormat("it-IT", { maximumFractionDigits: 6 }).format(r.quantity)}</td><td>{r.unit}</td></tr>)}</tbody></table></div></details>
  </div>;
}
