import "../pages/Production/planning-lifecycle.css";
import { useState } from "react";
import { Modal } from "../features/production-costs/common";
import { planningBlockResolution } from "../pages/Production/planning-block-resolution";
import { planningDate, planningStages, planningStatuses } from "../pages/Production/planning-display";

const date = value => planningDate(value, "Non pianificata");
const phases = { 0: "Miscelazione", 1: "Controllo qualità", 2: "Attesa", 3: "Confezionamento", 4: "Lavaggio", 5: "Magazzino", 6: "Manutenzione", 7: "Astucciatura" };
export default function PlanningVersionSummary({ version, query = "", children, onResolveBlock, busy = false }) {
  const [openedBlock, setOpenedBlock] = useState(null);
  const [resolutionError, setResolutionError] = useState("");
  if (!version?.snapshot) return null;
  const { snapshot } = version;
  // Older snapshots mark closed orders as PRESERVED, with this explicit reason.
  const historicalOrderIds = new Set((snapshot.impacts || [])
    .filter(row => ["HISTORICAL", "CANCELLED", "COMPLETED", "CLOSED"].includes(row.stage)
      || row.reason?.trim() === "Storico conservato; nessuna riapertura.")
    .map(row => row.orderId));
  const rows = (snapshot.impacts || []).filter(row => !historicalOrderIds.has(row.orderId)
    && Object.values(row).join(" ").toLocaleLowerCase("it-IT").includes(query.toLocaleLowerCase("it-IT")));
  const tasks = (snapshot.tasks || []).filter(task => !historicalOrderIds.has(task.orderId));
  const revision = version.kind === "RECALCULATE" || snapshot.input?.planOnly;
  const moved = (snapshot.taskChanges || []).filter(change => change.before && change.after
    && `${change.number} ${change.article}`.toLocaleLowerCase("it-IT").includes(query.toLocaleLowerCase("it-IT")));
  const position = value => `${value.resourceIds.map(id => snapshot.resources?.find(r => r.id === id)?.code || id).join(", ")} · ${date(value.start)} – ${date(value.end)}`;
  return <div className="plan-summary">
    <p>Versione <strong>{version.id?.slice(0, 8)}</strong> · {planningStatuses[version.status] || version.status} · {date(version.createdAt)}</p>
    {!!snapshot.blocks?.length && <div className="plan-notice plan-error" role="alert"><strong>Da risolvere prima della conferma</strong><ul>{snapshot.blocks.map((s, i) => <li key={i}><button type="button" className="plan-block-link" onClick={() => { setResolutionError(""); setOpenedBlock(s); }}>{s} <strong>Vedi soluzione →</strong></button></li>)}</ul></div>}
    {openedBlock && <Modal title="Risolvi problema del piano" onClose={() => { if (!busy) setOpenedBlock(null); }} className="plan-resolution-modal">
      <div className="planning-lifecycle">
        <p className="plan-notice plan-error">{openedBlock}</p>
        {(() => {
          const resolution = planningBlockResolution(openedBlock);
          return resolution ? <>
            <h3>{resolution.number} · {resolution.phase}</h3>
            <p>I fabbisogni salvati non corrispondono alla formula o distinta corrente, oppure la distinta non è valida.</p>
            <p>La soluzione proposta include <strong>{resolution.number}</strong> nella revisione insieme alle RdP già selezionate e genera una nuova anteprima. Le fasi non protette di questo ordine potranno cambiare date e impianti: controlla il confronto prima di confermare.</p>
            <p>Il calcolo non applica il piano e non rilascia ODL. Se la distinta è incompleta, il nuovo controllo continuerà a segnalarlo.</p>
            {onResolveBlock && version.kind === "RECALCULATE" && version.status === "PROPOSED"
              ? <button type="button" className="plan-primary" disabled={busy} onClick={async () => {
                setResolutionError("");
                try { await onResolveBlock(resolution); setOpenedBlock(null); }
                catch (error) { setResolutionError(error.message); }
              }}>{busy ? "Calcolo in corso…" : `Includi ${resolution.number} e calcola anteprima`}</button>
              : <p>Prepara una nuova versione con operazione «Rivedi piano e fattibilità», includendo questo ordine nella selezione.</p>}
          </> : <><h3>Verifica richiesta</h3><p>Questo blocco non dispone ancora di una soluzione automatica. Verifica il vincolo indicato nel messaggio prima di calcolare una nuova anteprima; il controllo non verrà ignorato.</p></>;
        })()}
        {resolutionError && <p role="alert" className="plan-notice plan-error">{resolutionError}</p>}
        <button type="button" disabled={busy} onClick={() => setOpenedBlock(null)}>Chiudi</button>
      </div>
    </Modal>}
    {snapshot.merge && <section className="plan-notice" aria-label="Riepilogo fusione ordini">
      <h3>Fusione ordini · {snapshot.merge.article}</h3>
      <p><strong>{snapshot.merge.targetNumber} · OP {snapshot.merge.targetOrderId}</strong> resta attivo con <strong>{new Intl.NumberFormat("it-IT", { useGrouping: "always", maximumFractionDigits: 6 }).format(snapshot.merge.combinedQuantity)} {snapshot.merge.unit}</strong> ({new Intl.NumberFormat("it-IT", { useGrouping: "always", maximumFractionDigits: 6 }).format(snapshot.merge.targetQuantity)} + {new Intl.NumberFormat("it-IT", { useGrouping: "always", maximumFractionDigits: 6 }).format(snapshot.merge.sourceQuantity)}).</p>
      <p><strong>{snapshot.merge.sourceNumber} · OP {snapshot.merge.sourceOrderId}</strong> viene assorbito e annullato nello storico.</p>
      <p>Riferimenti conservati: <strong>{snapshot.merge.commercialReferences?.join(" · ")}</strong>.</p>
      <p>Lotto mantenuto: <strong>{snapshot.merge.retainedLot || "Non ancora assegnato"}</strong>. La fusione non avvia la produzione.</p>
      <p>Verifica sotto il nuovo piano, le risorse e i fabbisogni prima di confermare.</p>
    </section>}
    {children}
    {!!snapshot.shortages?.length && <div className="plan-notice"><h3>Fabbisogni specifici {version.status === "PROPOSED" ? "da generare" : "generati"}</h3><p>{snapshot.shortagesCoveredAtUtc ? "Copertura verificata: " + date(snapshot.shortagesCoveredAtUtc) : "Carenza autorizzata: le quantità indicate non sono prenotate né disponibili per l’avvio."}</p><div className="plan-table-wrap"><table><thead><tr><th>RdP / OP</th><th>Fase</th><th>Materiale</th><th>Quantità mancante</th></tr></thead><tbody>{snapshot.shortages.map((item, i) => <tr key={i}><td>{snapshot.impacts?.find(row => row.orderId === item.orderId)?.number || item.orderId}</td><td>{phases[item.phase] || item.phase}</td><td>{item.code}</td><td>{new Intl.NumberFormat("it-IT", { useGrouping: 'always',  maximumFractionDigits: 6 }).format(item.quantity)} {item.unit}</td></tr>)}</tbody></table></div></div>}
    {revision ? <section aria-label="Lavorazioni spostate"><h3>Lavorazioni spostate</h3>
      {!snapshot.taskChanges ? <p>Ricalcola l’anteprima per vedere le lavorazioni spostate.</p> : !moved.length ? <p>Nessuna lavorazione spostata{query ? " per la ricerca indicata" : ""}.</p> :
        <div className="plan-table-wrap"><table><thead><tr><th>RdP / articolo</th><th>Fase / batch</th><th>Prima</th><th>Dopo</th></tr></thead><tbody>{moved.map((change, i) =>
          <tr key={i}><td>{change.number} · {change.article}</td><td>{phases[change.phase] || change.phase} · {change.batchNumber}</td><td>{position(change.before)}</td><td>{position(change.after)}</td></tr>)}</tbody></table></div>}
      {snapshot.taskChanges?.some(c => !c.before) && <p>{snapshot.taskChanges.filter(c => !c.before).length} nuove lavorazioni pianificate.</p>}
      {snapshot.taskChanges?.some(c => !c.after) && <p>{snapshot.taskChanges.filter(c => !c.after).length} lavorazioni non ripianificate: verificare gli avvisi e i blocchi.</p>}
    </section> : <>
    <div className="plan-table-wrap" tabIndex={0} role="region" aria-label="Confronto versioni del piano">
      <table><thead><tr><th>RdP / OP · articolo</th><th>Consegna richiesta</th><th>Piano precedente</th><th>Piano proposto</th><th>Station proposta</th><th>Fase / copertura</th><th>Motivo</th></tr></thead><tbody>
        {rows.map(row => <tr key={row.orderId}><td><strong>{row.number}</strong><br />{row.article} · {row.description}</td><td>{date(row.requestedAt)}</td><td>{date(row.beforeStart)}<br />{date(row.beforeEnd)}</td><td>{date(row.afterStart)}<br />{date(row.afterEnd)}</td><td>{[...new Set(tasks.filter(task => task.orderId === row.orderId && task.type === 0).map(task => { const resource = snapshot.resources?.find(item => item.id === task.resourceId); return resource ? `${resource.code} · ${resource.description}` : `Impianto ${task.resourceId}`; }))].join(", ") || "—"}</td><td>{planningStages[row.stage] || row.stage}<br />{row.coverage}</td><td>{row.reason || "Proposta calcolata dal motore APS"}</td></tr>)}
        {!rows.length && <tr><td colSpan={7}>Nessuna riga corrisponde alla ricerca.</td></tr>}
      </tbody></table>
    </div>
    </>}
    {!!snapshot.warnings?.length && <details className="plan-notice"><summary>Informazioni e avvisi del calcolo ({snapshot.warnings.length})</summary><ul>{snapshot.warnings.map((s, i) => <li key={i}>{s}</li>)}</ul></details>}
    {!revision && <details className="plan-notice"><summary>Fasi, impianti e operatori ({tasks.length})</summary><div className="plan-table-wrap"><table><thead><tr><th>RdP / OP</th><th>Fase / batch</th><th>Impianto</th><th>Inizio / fine</th><th>Operatori</th><th>Protezione</th></tr></thead><tbody>{tasks.map((task, i) => {
      const resource = snapshot.resources?.find(x => x.id === task.resourceId);
      return <tr key={i}><td>{task.orderNumber || snapshot.impacts?.find(x => x.orderId === task.orderId)?.number || task.orderId}<br />{task.articleCode}</td><td>{phases[task.type] || task.type} · {task.batchNumber}/{task.batchCount}</td><td>{resource ? `${resource.code} · ${resource.description}` : `Impianto ${task.resourceId}`}</td><td>{date(task.start)}<br />{date(task.end)}</td><td>{task.operatoriIds?.map(id => snapshot.operators?.find(x => x.id === id)?.description || `Operatore ${id}`).join(", ") || "Non previsti"}</td><td>{task.locked || task.status === 2 ? "Conservata" : task.salvato ? "Già nel piano" : "Proposta"}</td></tr>;
    })}</tbody></table></div></details>}
    <details className="plan-notice"><summary>Materiali da coprire ({snapshot.requirements?.length || 0})</summary><div className="plan-table-wrap"><table><thead><tr><th>OP / domanda</th><th>Articolo</th><th>Quantità</th><th>UM</th></tr></thead><tbody>{snapshot.requirements?.map((r, i) => <tr key={i}><td>{snapshot.impacts?.find(x => x.orderId === r.orderId)?.number || r.orderId}</td><td>{r.code}</td><td>{new Intl.NumberFormat("it-IT", { useGrouping: 'always',  maximumFractionDigits: 6 }).format(r.quantity)}</td><td>{r.unit}</td></tr>)}</tbody></table></div></details>
  </div>;
}
