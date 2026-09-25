import { displayDateFormatter } from '../../lib/displayLocale.js';
import { Fragment, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronDown, ChevronUp, ClipboardList, Factory, RefreshCw, Search, X } from "lucide-react";
import WorkspacePageHeader from "../../components/WorkspacePageHeader";
import CommercialBatchProgress from "./CommercialBatchProgress";
import { commercialCounts, commercialStageLabel, commercialStages, deliveryState, hasBlock, openDiagnostics, selectCommercialRows } from "./commercial-order-state.js";
import "./commercial-orders.css";

const date = value => value && Number.isFinite(Date.parse(value)) ? displayDateFormatter({dateStyle:"short"}).format(new Date(value)) : "—";
const qty = value => value == null ? "—" : new Intl.NumberFormat("it-IT", { useGrouping: 'always', maximumFractionDigits:3}).format(value);
const PAGE_SIZE = 25;

function OrderDetail({ row, loadBatches, onOpen, onDiagnostic }) {
  const [tab, setTab] = useState(row.productionOrders?.length ? "batches" : "articles");
  const diagnostics = openDiagnostics(row);
  return <section className="commercial-detail" aria-label={`Avanzamento ${row.label}`}>
    <header><div><strong>{row.label}{row.rdpNumber ? ` · RDP${row.rdpNumber}` : ""}</strong><span>{row.customer}</span></div>
      <button type="button" className="secondary-action" onClick={() => onOpen(row)}>Apri dettaglio e azioni</button></header>
    <div className="commercial-detail-tabs" role="tablist" aria-label="Dettaglio ordine">
      {[["articles","Articoli",row.lines?.length || 0],["batches","Lavorazioni",null],["issues","Segnalazioni",diagnostics.length]].map(([code,label,count]) => <button key={code} type="button" role="tab" aria-selected={tab === code} onClick={() => setTab(code)}>{label}{count !== null && <span>{count}</span>}</button>)}
    </div>
    <div role="tabpanel">
      {tab === "articles" && <div className="commercial-scroll"><table className="commercial-line-table"><thead><tr><th>Articolo</th><th>Ordinato</th><th>Evaso</th><th>Residuo</th><th>Consegna</th><th>Stato produzione</th></tr></thead><tbody>
        {(row.lines || []).map(line => <tr key={line.id}><td><strong>{line.articleCode}</strong><small>{line.description}</small></td><td>{qty(line.orderedQuantity)} {line.unit}</td><td>{qty(line.fulfilledQuantity)} {line.unit}</td><td>{qty(line.residualQuantity)} {line.unit}</td><td>{date(line.deliveryDate)}</td><td>{line.productionStatus || "Da verificare"}</td></tr>)}
      </tbody></table>{!row.lines?.length && <p className="commercial-empty">Le righe sono conservate nel dettaglio della RdP.</p>}</div>}
      {tab === "batches" && (row.productionOrders?.length ? <CommercialBatchProgress orders={row.productionOrders} load={loadBatches} autoOpen/> : <p className="commercial-empty">Nessun OP collegato. Apri il dettaglio per verificare lo stato della richiesta; nessuna lavorazione viene generata dalla consultazione.</p>)}
      {tab === "issues" && <div className="commercial-issues">{diagnostics.length ? diagnostics.map(item => <button type="button" key={item.diagnosticId} onClick={() => onDiagnostic(item)}><AlertTriangle size={18}/><span><strong>{item.errorCode || "Segnalazione"}</strong><small>{item.message || item.description || "Apri per leggere il dettaglio e le azioni disponibili."}</small></span><span>Apri</span></button>) : <p className="commercial-empty"><CheckCircle2 size={18}/> Nessuna segnalazione aperta per questo ordine.</p>}</div>}
    </div>
  </section>;
}

export default function CommercialOrdersScreen({ data, stage, onStage, loading, busy, onReload, onSync, syncRunning, syncStatus, customerScoped,
  selected, onToggle, onClearSelection, canCreate, sendEnabled, selectionBlocked, onPreview, onOpen, onDiagnostic, loadBatches, onBack, children }) {
  const [search,setSearch] = useState(""); const [focus,setFocus] = useState(""); const [sort,setSort] = useState("delivery");
  const [expanded,setExpanded] = useState(null); const [page,setPage] = useState(0);
  const counts = useMemo(() => commercialCounts(data),[data]);
  const rows = useMemo(() => selectCommercialRows(data,{stage,search,focus,sort}),[data,stage,search,focus,sort]);
  const currentPage = Math.min(page,Math.max(0,Math.ceil(rows.length/PAGE_SIZE)-1));
  const visible = rows.slice(currentPage*PAGE_SIZE,(currentPage+1)*PAGE_SIZE);
  function choose(nextStage,nextFocus="") { onStage(nextStage);setFocus(nextFocus);setPage(0);setExpanded(null); }
  const metrics = [
    ["Ordini aperti",counts.active,ClipboardList,"all","active","blue"],
    ["OCT da valutare",counts.evaluation,ClipboardList,"evaluation","","blue"],
    ["In produzione",counts.production,Factory,"production","","green"],
    ["Consegne da verificare",counts.late,CalendarClock,"all","late","amber"],
    ["Ordini bloccati",counts.attention,AlertTriangle,"all","attention","red"],
  ];
  return <section className="commercial-screen">
    <WorkspacePageHeader icon={<ClipboardList size={29}/>} title="Ordini e avanzamento" description="Dall’OCT alle singole lavorazioni: consegne, batch, lotti e documenti." backLabel="Gestione produzione" onBack={onBack}/>
    <div className="commercial-summary" aria-label="Riepilogo ordini">{metrics.map(([label,value,Icon,nextStage,nextFocus,tone]) => <button key={label} type="button" className={`commercial-metric tone-${tone}`} aria-pressed={stage===nextStage && focus===nextFocus} onClick={() => choose(nextStage,nextFocus)}><Icon size={21}/><span><strong>{loading ? "—" : value}</strong><small>{label}</small></span></button>)}</div>
    <section className="commercial-panel">
      <header className="commercial-panel-heading"><div><h2>Ordini e consegne</h2><p>Seleziona una riga per leggere articoli, singole lavorazioni e segnalazioni.</p></div><div className="commercial-actions"><button type="button" className="secondary-action" disabled={loading || busy} onClick={onReload}><RefreshCw size={16}/>Aggiorna vista</button>{!customerScoped && <button type="button" className="secondary-action" disabled={syncRunning || loading || busy} onClick={onSync}><RefreshCw size={16}/> {syncRunning ? "Sincronizzazione OCT…" : "Sincronizza OCT"}</button>}</div></header>
      <div className="commercial-filters">
        <label className="commercial-search"><Search size={18}/><input aria-label="Cerca ordine, RdP, cliente o articolo" placeholder="Cerca OCT, RdP, cliente o articolo…" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/>{search && <button type="button" aria-label="Azzera ricerca" onClick={()=>{setSearch("");setPage(0);}}><X size={16}/></button>}</label>
        <label>Stato ordine<select value={stage} onChange={e=>choose(e.target.value)}>{commercialStages.map(([code,label])=><option key={code} value={code}>{label}</option>)}</select></label>
        <label>Ordina per<select value={sort} onChange={e=>{setSort(e.target.value);setPage(0);}}><option value="delivery">Consegna richiesta</option><option value="planned">Ultimazione prevista</option><option value="customer">Cliente</option></select></label>
        <button type="button" className="secondary-action" onClick={()=>{choose("all");setSearch("");setSort("delivery");}}>Azzera filtri</button>
      </div>
      {focus && <div className="commercial-focus">Filtro: {focus === "active" ? "ordini aperti" : focus === "late" ? "consegne scadute o previste oltre la data richiesta" : "ordini bloccati o con segnalazioni bloccanti"}<button type="button" onClick={()=>{setFocus("");setPage(0);}}>Rimuovi filtro</button></div>}
      {syncStatus && <details className="commercial-sync"><summary>Stato sincronizzazione OCT</summary>{syncStatus}</details>}
      {children}
      {selected.length > 0 && <div className="commercial-selection"><strong>{selected.length} OCT selezionati per la RdP</strong><button type="button" className="secondary-action" onClick={onClearSelection} disabled={busy}>Annulla selezione</button><button type="button" className="primary-action" onClick={onPreview} disabled={!canCreate || !sendEnabled || selectionBlocked || busy}>{busy ? "Verifica in corso…" : "Verifica e crea anteprima RdP"}</button>{(!sendEnabled || selectionBlocked) && <small>{!sendEnabled ? "Generazione RdP non disponibile: verificare i servizi MES." : "La selezione contiene ordini bloccati: controlla le segnalazioni."}</small>}</div>}
      {loading ? <div className="commercial-empty" role="status">Caricamento ordini e avanzamento…</div> : <>
        <div className="commercial-list-caption"><span>{rows.length} ordini trovati</span><small>Le quantità evase sono commerciali; i consuntivi di produzione sono nelle lavorazioni.</small></div>
        <div className="commercial-scroll"><table className="commercial-orders-table"><thead><tr><th>OCT / RdP</th><th>Cliente / articoli</th><th>Consegna richiesta</th><th>Ultimazione prevista</th><th>Stato ordine</th><th>Azioni</th></tr></thead><tbody>
          {visible.map(row => <Fragment key={row.id}><tr className={expanded===row.id ? "is-expanded" : ""}>
            <td><strong>{row.label}</strong><small>{row.rdpNumber ? `RDP${row.rdpNumber}` : row.stage === "evaluation" ? "RdP da creare" : "RdP non associata"}</small>{row.stage === "evaluation" && !customerScoped && <label className="commercial-select"><input type="checkbox" aria-label={`Seleziona ${row.label} per RdP`} checked={selected.includes(row.id)} disabled={!canCreate || !row.ready || hasBlock(row) || busy} onChange={()=>onToggle(row)}/>Seleziona OCT</label>}</td>
            <td><strong>{row.customer || "Cliente non disponibile"}</strong><small>{(row.lines || []).slice(0,2).map(line=>line.articleCode).join(" · ")}{row.lines?.length>2 ? ` +${row.lines.length-2} articoli` : ""}</small></td>
            <td>{date(row.deliveryDate)}{deliveryState(row) && <small className="commercial-late">{deliveryState(row)}</small>}</td><td>{row.plannedCompletionDate ? date(row.plannedCompletionDate) : "Da pianificare"}</td>
            <td><span className={`commercial-status status-${row.stage}`}>{commercialStageLabel(row.stage)}</span>{openDiagnostics(row).length>0 && <small className="commercial-warning">{openDiagnostics(row).length} segnalazioni aperte</small>}</td>
            <td><div className="commercial-row-actions"><button type="button" className="secondary-action" aria-expanded={expanded===row.id} onClick={()=>setExpanded(expanded===row.id ? null : row.id)}>{expanded===row.id ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}Lavorazioni</button><button type="button" className="secondary-action" onClick={()=>onOpen(row)}>{row.stage === "rdp" ? "Verifica RdP" : "Dettaglio"}</button></div></td>
          </tr>{expanded===row.id && <tr><td colSpan={6} className="commercial-detail-cell"><OrderDetail key={row.id} row={row} loadBatches={id=>loadBatches(row,id)} onOpen={onOpen} onDiagnostic={onDiagnostic}/></td></tr>}</Fragment>)}
        </tbody></table></div>
        {!rows.length && <p className="commercial-empty">Nessun ordine per i filtri impostati. Premi “Azzera filtri” per tornare all’elenco.</p>}
        <footer className="commercial-pagination"><span>{rows.length ? `${currentPage*PAGE_SIZE+1}–${Math.min((currentPage+1)*PAGE_SIZE,rows.length)} di ${rows.length}` : "0 ordini"}</span><button type="button" className="secondary-action" disabled={currentPage===0} onClick={()=>{setPage(currentPage-1);setExpanded(null);}}>Precedente</button><button type="button" className="secondary-action" disabled={(currentPage+1)*PAGE_SIZE>=rows.length} onClick={()=>{setPage(currentPage+1);setExpanded(null);}}>Successiva</button></footer>
      </>}
    </section>
  </section>;
}
