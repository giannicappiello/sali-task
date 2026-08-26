import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowUpRight, CheckCircle2, ChevronRight, Factory, RefreshCw, Search, Send, ShieldAlert, X } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";

const TABS = [
  ["evaluation", "OCT da valutare"], ["rdp", "RdP"], ["production", "In produzione"],
  ["completed", "Completati / evasi"], ["blocked", "Bloccati"],
];

async function callWorkbench(accessToken, action, extra = {}) {
  const response = await fetch("/api/mexal/automation", { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) throw Object.assign(new Error(payload.error || "Operazione Workbench non riuscita."), { code: payload.code });
  return payload;
}

function formatDate(value, withTime = false) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat("it-IT", withTime ? { dateStyle: "short", timeStyle: "short" } : { dateStyle: "short" }).format(parsed);
}

function badge(value, tone = "neutral") { return <span className={`rdp-badge rdp-${tone}`}>{value || "—"}</span>; }
function blocking(rows = []) { return rows.some((row) => ["Blocking", "Critical"].includes(row.severity) && row.status !== "Resolved"); }

function Diagnostics({ rows, onOpen }) {
  if (!rows?.length) return badge("Nessun alert", "green");
  return <div className="rdp-inline-diagnostics">{rows.slice(0, 3).map((row) => <button type="button" key={row.diagnosticId} className={`rdp-alert-${String(row.severity).toLowerCase()}`} onClick={() => onOpen(row)}><AlertTriangle size={14} />{row.errorCode}</button>)}</div>;
}

function AnalysisGrid({ analysis, proposal }) {
  const source = analysis || proposal || {};
  const fields = [
    ["RequestedQuantity", "requestedQuantity"], ["PhysicalQuantity", "physicalQuantity"], ["CommittedQuantity", "committedQuantity"],
    ["FreeQuantity", "freeQuantity"], ["CommittedToOtherOrders", "committedToOtherOrders"], ["ReallocatableQuantity", "reallocatableQuantity"],
    ["IncomingQuantity", "incomingQuantity"], ["ExpectedIncomingDate", "expectedIncomingDate"], ["MissingQuantity", "missingQuantity"],
    ["ProducibleQuantity", "producibleQuantity"], ["PlannableQuantity", "plannableQuantity"], ["NonFulfillableQuantity", "nonFulfillableQuantity"],
    ["MaterialCovered", "materialCovered"], ["BlockCode", "blockCode"],
  ];
  return <div className="rdp-analysis-grid">{fields.map(([label, key]) => <div key={key}><span>{label}</span><strong>{source[key] ?? "—"}</strong></div>)}</div>;
}

function DetailPanel({ detail, onClose, onDiagnostics, canDecide, onDecision }) {
  const [openLine, setOpenLine] = useState(null);
  if (!detail) return null;
  return <div className="rdp-detail-backdrop" role="presentation" onMouseDown={onClose}><section className="rdp-detail" role="dialog" aria-modal="true" aria-label="Dettaglio RdP e OCT" onMouseDown={(event) => event.stopPropagation()}>
    <header><div><span className="rdp-eyebrow">Lineage commerciale e produttivo</span><h2>{detail.request ? `RdP ${detail.request.external_id}` : detail.orders.map((item) => item.label).join(", ")}</h2><p>{detail.orders.map((item) => `${item.label} · ${item.customer || "cliente non disponibile"}`).join(" | ")}</p></div><button type="button" className="rdp-icon-button" onClick={onClose} aria-label="Chiudi dettaglio"><X /></button></header>
    {detail.request && <div className="rdp-request-meta"><span>Stato {badge(detail.request.workspace_status || detail.request.stato, detail.request.stage === "blocked" ? "red" : "blue")}</span><span>Creata {formatDate(detail.request.created_at, true)}</span><span>Tentativi {detail.request.attempt_count ?? 0}</span><span>Contratto v{detail.request.contract_version || 2}</span></div>}
    {detail.revision?.modified && <div className="rdp-revision-alert"><AlertTriangle/><div><strong>OCT MODIFICATO IN MEXAL</strong><p>Aggiunte {detail.revision.added.length} · rimosse {detail.revision.removed.length} · quantità/UDM modificate {detail.revision.changed.length} · consegna {detail.revision.deliveryChanged ? "modificata" : "invariata"}.</p><small>Le opzioni “mantieni pianificazione + delta” e “integra e ripianifica” saranno abilitate soltanto quando esposte dal contratto MES.</small></div></div>}
    <div className="rdp-line-list">{detail.lines.map((line) => <article key={line.id} className={line.descriptive ? "rdp-line descriptive" : "rdp-line"}>
      <button type="button" className="rdp-line-summary" onClick={() => setOpenLine(openLine === line.id ? null : line.id)}>
        <span className="rdp-position">{line.position ?? "—"}</span><span><strong>{line.descriptive ? "Riga descrittiva" : line.articleCode}</strong><small>{line.description || "—"}</small></span>
        <span><strong>{line.quantity ?? "—"} {line.octUom || ""}</strong><small>UDM produzione {line.productionUom || "da risolvere"}</small></span>
        {badge(line.mesStatus || line.mappingStatus, blocking(line.diagnostics) ? "red" : "neutral")}<ChevronRight size={18} />
      </button>
      {openLine === line.id && <div className="rdp-line-body">
        <div className="rdp-commercial"><h3>Dati commerciali OCT</h3><dl><div><dt>Posizione Mexal</dt><dd>{line.position ?? "—"}</dd></div><div><dt>Quantità completa</dt><dd>{line.quantity ?? "—"} {line.octUom || ""}</dd></div><div><dt>ProductionUom</dt><dd>{line.productionUom || "da risolvere in MES"}</dd></div><div><dt>Conversione</dt><dd>{line.conversion ? `${line.conversion.factor} · ${line.conversion.source}` : "Nessuna"}</dd></div></dl></div>
        <div className="rdp-mes"><h3>Analisi produttiva MES</h3><AnalysisGrid analysis={line.mesAnalysis} proposal={line.proposal} /></div>
        <Diagnostics rows={line.diagnostics} onOpen={onDiagnostics} />
      </div>}
    </article>)}</div>
    {detail.request && canDecide && detail.lines.some((line) => line.proposal && !line.proposal.confirmation_external_id) && <section className="rdp-decisions"><h3>Decisioni operatore disponibili</h3><p>Il backend attuale espone la pianificazione completa. Le altre decisioni saranno mostrate solo quando disponibili nel contratto MES.</p>{detail.lines.filter((line) => line.proposal && !line.proposal.confirmation_external_id).map((line) => <button type="button" className="primary-action" key={line.proposal.id} onClick={() => onDecision(line)}><Factory size={16}/>Pianificazione completa · {line.articleCode}</button>)}</section>}
    {detail.request && <nav className="rdp-deep-links" aria-label="Apri schermate MES nel contesto"><span>Apri nel contesto:</span>{[["planning","Planning"],["produzione","Produzione"],["operatore-produzione","Operatore produzione"],["confezionamento","Confezionamento"],["magazzino","Magazzino"],["documenti","Documenti"]].map(([code,label]) => <a key={code} href={`/produzione/${code}?rdpId=${encodeURIComponent(detail.request.external_id)}`}>{label}<ArrowUpRight size={14}/></a>)}</nav>}
  </section></div>;
}

function PreviewDialog({ preview, busy, sendEnabled, onCancel, onConfirm }) {
  if (!preview) return null;
  return <div className="rdp-dialog-backdrop" role="presentation"><section className="rdp-dialog" role="dialog" aria-modal="true" aria-label="Anteprima RdP">
    <header><div><span className="rdp-eyebrow">Conferma controllata</span><h2>Anteprima RdP multi-OCT</h2></div><button type="button" onClick={onCancel} disabled={busy}><X /></button></header>
    <div className="rdp-no-netting"><ShieldAlert /><div><strong>NESSUNA NETTIFICAZIONE WORKSPACE</strong><p>ProgreMES è il master dell’analisi produttiva, di materiali, formule, Station e Filling.</p></div></div>
    <dl className="rdp-preview-summary"><div><dt>OCT</dt><dd>{preview.demand.orderCount}</dd></div><div><dt>Righe produttive</dt><dd>{preview.demand.itemCount}</dd></div><div><dt>Snapshot</dt><dd>#{preview.snapshot.id}</dd></div><div><dt>Stato</dt><dd>{preview.status}</dd></div></dl>
    <div className="rdp-preview-items">{preview.demand.orders.map((order) => <article key={order.orderId}><strong>{order.sigla}/{order.serie}/{order.numero}</strong><span>Revisione {order.commercialRevision}</span><span>Consegna {formatDate(order.requestedDeliveryDate)}</span></article>)}</div>
    {!sendEnabled && <div className="rdp-gate-off" role="alert"><ShieldAlert/><div><strong>Invio RdP Production non disponibile</strong><p>Uno o più gate WorkspaceMES/ProgreMES sono OFF. Verificare il Centro Diagnostico.</p></div></div>}
    <div className="rdp-dialog-actions"><button type="button" className="secondary-action" onClick={onCancel} disabled={busy}>Annulla</button><button type="button" className="primary-action" onClick={onConfirm} disabled={busy || !sendEnabled}>{busy ? <><RefreshCw className="rdp-spin" size={17}/>Invio in corso…</> : <><Send size={17}/>Crea RdP</>}</button></div>
  </section></div>;
}

export default function RdpWorkbench({ onBack }) {
  const { session, hasPermission } = useAuth();
  const accessToken = session?.access_token;
  const canCreate = hasPermission?.("rdp.create");
  const canDecide = hasPermission?.("rdp.decide");
  const [data, setData] = useState([]); const [tab, setTab] = useState("evaluation"); const [selected, setSelected] = useState([]);
  const [filters, setFilters] = useState({ search: "", customer: "", ready: "" }); const [detail, setDetail] = useState(null);
  const [preview, setPreview] = useState(null); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [result, setResult] = useState(null);
  const [decision, setDecision] = useState(null);
  const [productionGates, setProductionGates] = useState(null);
  const sendEnabled = productionGates?.allOn === true;

  async function load() { setLoading(true); setError(""); try { const payload = await callWorkbench(accessToken, "progremes_workbench_list"); setData(payload.items || []); setProductionGates(payload.productionGates || null); } catch (e) { setProductionGates(null); setError(e.message); } finally { setLoading(false); } }
  useEffect(() => {
    if (!accessToken) return undefined;
    let active = true;
    callWorkbench(accessToken, "progremes_workbench_list")
      .then((payload) => { if (active) { setData(payload.items || []); setProductionGates(payload.productionGates || null); } })
      .catch((loadError) => { if (active) { setProductionGates(null); setError(loadError.message); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accessToken]);
  const visible = useMemo(() => data.filter((row) => {
    if (row.stage !== tab) return false;
    const haystack = `${row.label} ${row.customer} ${row.status}`.toLowerCase();
    if (filters.search && !haystack.includes(filters.search.toLowerCase())) return false;
    if (filters.customer && !String(row.customer).toLowerCase().includes(filters.customer.toLowerCase())) return false;
    if (filters.ready === "ready" && !row.ready) return false;
    if (filters.ready === "blocked" && row.ready) return false;
    return true;
  }), [data, tab, filters]);
  const selectedRows = data.filter((row) => selected.includes(row.id));
  const selectionBlocked = selectedRows.some((row) => !row.ready || blocking(row.diagnostics));

  function toggle(row) { setSelected((current) => current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id]); setPreview(null); setResult(null); }
  async function openDetail(row) { setError(""); try { setDetail(await callWorkbench(accessToken, "progremes_workbench_detail", { orderId: row.id, requestId: row.requestId })); } catch (e) { setError(e.message); } }
  async function createPreview() { if (!sendEnabled || !selected.length || busy) return; setBusy(true); setError(""); try { setPreview(await callWorkbench(accessToken, "progremes_production_preview", { orderIds: selected })); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  async function sendRequest() { if (!sendEnabled || !preview || busy) return; setBusy(true); setError(""); try { const response = await callWorkbench(accessToken, "progremes_production_request", { orderIds: selected, snapshotId: preview.snapshot.id }); setResult(response); setPreview(null); setSelected([]); await load(); } catch (e) { setError(e.code === "DEMAND_CHANGED" ? "L’OCT è cambiato dopo l’anteprima: ripetere il precheck." : e.message); } finally { setBusy(false); } }
  async function confirmDecision() { if (!decision?.proposal?.id || busy) return; setBusy(true); setError(""); try { await callWorkbench(accessToken, "progremes_production_confirm", { proposalId: decision.proposal.id }); setDecision(null); setResult({ status: "Planned", externalId: detail?.request?.external_id }); setDetail(await callWorkbench(accessToken, "progremes_workbench_detail", { requestId: detail.request.id })); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  function openDiagnostic(row) { window.location.assign(`/produzione/diagnostica?diagnosticId=${encodeURIComponent(row.diagnosticId)}`); }

  return <div className="production-page rdp-workbench">
    <header className="rdp-header"><button type="button" className="diagnostics-back" onClick={onBack}><ArrowLeft size={16}/>Gestione produzione</button><div><span className="rdp-eyebrow">WorkspaceMES</span><h1>RdP Workbench</h1><p>Gestione OCT, richieste di produzione, analisi MES e decisioni operative.</p></div><button type="button" className="secondary-action" onClick={load} disabled={loading}><RefreshCw className={loading ? "rdp-spin" : ""} size={17}/>Aggiorna</button></header>
    <nav className="rdp-tabs" aria-label="Stati Workbench">{TABS.map(([code,label]) => <button type="button" key={code} className={tab === code ? "active" : ""} onClick={() => setTab(code)}>{label}<span>{data.filter((row) => row.stage === code).length}</span></button>)}</nav>
    <section className="rdp-toolbar"><label><Search size={17}/><input value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Cerca OCT, cliente, stato…"/></label><input value={filters.customer} onChange={(e) => setFilters({ ...filters, customer: e.target.value })} placeholder="Filtra cliente"/><select value={filters.ready} onChange={(e) => setFilters({ ...filters, ready: e.target.value })}><option value="">Pronti e bloccati</option><option value="ready">Solo pronti</option><option value="blocked">Solo bloccati</option></select></section>
    {error && <div className="production-message" role="alert"><span>{error}</span><button type="button" onClick={() => setError("")}><X size={16}/>Chiudi</button></div>}
    {result && <div className="rdp-success"><CheckCircle2/><div><strong>RdP ricevuta da ProgreMES</strong><p>ID {result.externalId || result.id || "registrato"} · Stato {result.status || "Received"}</p></div></div>}
    {tab === "evaluation" && <div className="rdp-selection-bar"><span><strong>{selected.length}</strong> OCT selezionati · lineage e quantità complete preservati</span><button type="button" className="primary-action" onClick={createPreview} disabled={!canCreate || !sendEnabled || !selected.length || selectionBlocked || busy}>{busy ? "Verifica…" : "Verifica e crea anteprima"}</button>{!canCreate && <small>Permesso rdp.create richiesto.</small>}{!sendEnabled && <small>Invio RdP Production non disponibile: verificare i gate nel Centro Diagnostico.</small>}{selectionBlocked && <small>Rimuovere gli OCT bloccati prima di creare la RdP.</small>}</div>}
    {loading ? <div className="production-loading">Caricamento OCT e RdP…</div> : <div className="rdp-table-wrap"><table className="rdp-table"><thead><tr>{tab === "evaluation" && <th>Seleziona</th>}<th>OCT</th><th>Cliente</th><th>Date</th><th>Righe / quantità</th><th>Stato</th><th>Diagnostica</th><th /></tr></thead><tbody>{visible.map((row) => <tr key={row.id} className={!row.ready ? "blocked" : ""}>{tab === "evaluation" && <td><input type="checkbox" checked={selected.includes(row.id)} disabled={!row.ready} onChange={() => toggle(row)} aria-label={`Seleziona ${row.label}`}/></td>}<td><strong>{row.label}</strong><small>Rev. sorgente {formatDate(row.sourceTimestamp, true)}</small></td><td>{row.customer}</td><td><span>Ordine {formatDate(row.orderDate)}</span><small>Consegna {formatDate(row.deliveryDate)}</small></td><td><strong>{row.productiveLineCount}/{row.lineCount} righe</strong><small>{row.quantity} {row.units.join(", ")}</small></td><td>{badge(row.ready ? row.status : "BLOCCATO", row.ready ? "green" : "red")}</td><td><Diagnostics rows={row.diagnostics} onOpen={openDiagnostic}/></td><td><button type="button" className="rdp-open" onClick={() => openDetail(row)}>Apri<ChevronRight size={16}/></button></td></tr>)}</tbody></table>{!visible.length && <div className="rdp-empty">Nessun elemento per i filtri e lo stato selezionati.</div>}</div>}
    <DetailPanel detail={detail} onClose={() => setDetail(null)} onDiagnostics={openDiagnostic} canDecide={canDecide} onDecision={setDecision}/>
    <PreviewDialog preview={preview} busy={busy} sendEnabled={sendEnabled} onCancel={() => setPreview(null)} onConfirm={sendRequest}/>
    {decision && <div className="rdp-dialog-backdrop"><section className="rdp-dialog" role="dialog" aria-modal="true" aria-label="Conferma pianificazione"><header><div><span className="rdp-eyebrow">Decisione operatore</span><h2>Pianificazione completa</h2></div><button type="button" onClick={() => setDecision(null)} disabled={busy}><X/></button></header><div className="rdp-no-netting"><ShieldAlert/><div><strong>Impatto produttivo</strong><p>ProgreMES creerà o confermerà la pianificazione per {decision.articleCode}, quantità {decision.quantity} {decision.productionUom || decision.octUom}. L’operazione sarà auditata dal flusso MES.</p></div></div><div className="rdp-dialog-actions"><button type="button" className="secondary-action" onClick={() => setDecision(null)} disabled={busy}>Annulla</button><button type="button" className="primary-action" onClick={confirmDecision} disabled={busy}>{busy ? "Conferma…" : "Conferma pianificazione"}</button></div></section></div>}
  </div>;
}
