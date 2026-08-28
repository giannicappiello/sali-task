import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Ban, CheckCircle2, ChevronRight, Factory, RefreshCw, Search, Send, ShieldAlert, X } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { confirmedProductionOrder, diagnosticCanBeArchived, diagnosticIsManageable, productionOrderProgremesPath } from "./rdp-workbench-state.js";

const TABS = [
  ["evaluation", "OCT da valutare"], ["rdp", "RdP"], ["production", "In produzione"],
  ["completed", "Completati / evasi"], ["blocked", "Bloccati"],
  ["history", "Storico RdP"],
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

function BackgroundSyncStatus({ refresh }) {
  if (!refresh) return null;
  if (refresh.status === "completed") return <div className="rdp-background-sync rdp-background-sync-complete" role="status"><CheckCircle2 size={16}/><span>OCT aggiornati da Mexal.</span></div>;
  if (refresh.status === "failed") return <div className="rdp-background-sync rdp-background-sync-failed" role="alert" title={refresh.last_error || "Consultare il Centro Diagnostico"}><AlertTriangle size={16}/><span>Sincronizzazione OCT non riuscita.</span></div>;
  if (refresh.status === "cancelled") return null;
  return <div className="rdp-background-sync" role="status"><RefreshCw className="rdp-spin" size={16}/><span>Sincronizzazione OCT in background.</span></div>;
}

function formatQuantity(value) {
  return new Intl.NumberFormat("it-IT", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(Number(value) || 0);
}

function rdpProgressiveLabel(value) {
  const progressive = Number(value);
  return Number.isSafeInteger(progressive) && progressive > 0
    ? `RDP${progressive}`
    : null;
}

function rdpLabel(request) { return rdpProgressiveLabel(request?.rdp_number) || "RdP"; }

function OctOrderCard({ row, selectable, selected, onToggle, onOpen, onDiagnostic }) {
  const status = row.stage === "history" ? "Annullata" : (row.ready ? row.status : "BLOCCATO");
  const tone = row.stage === "history" ? "neutral" : (row.ready ? "green" : "red");
  const rowRdpLabel = rdpProgressiveLabel(row.rdpNumber);
  return <article className={`rdp-oct-card ${!row.ready && row.stage !== "history" ? "blocked" : ""}`}>
    <header className="rdp-oct-card-header">
      <div className="rdp-oct-identity"><div className="rdp-oct-reference"><strong>{row.label}</strong>{rowRdpLabel && <span className="rdp-oct-rdp">{rowRdpLabel}</span>}</div><span>{row.customer}</span><small className="rdp-oct-meta">Ordine: {formatDate(row.orderDate)} · Consegna: {formatDate(row.deliveryDate)} · Revisione sorgente: {formatDate(row.sourceTimestamp, true)}</small></div>
      <div className="rdp-oct-actions">
        {badge(status, tone)}
        {selectable && <label className="rdp-oct-select"><input type="checkbox" checked={selected} disabled={!row.ready} onChange={onToggle}/><span>{selected ? "Selezionato" : "Seleziona per RdP"}</span></label>}
        <button type="button" className="rdp-open-card" onClick={onOpen}>Apri dettaglio<ChevronRight size={16}/></button>
      </div>
    </header>
    <div className="rdp-oct-lines" role="table" aria-label={`Righe ${row.label}`}>
      <div className="rdp-oct-line rdp-oct-line-head" role="row"><span>Articolo</span><span>Ordinato</span><span>Evaso</span><span>Residuo</span><span>Consegna</span><span>Produzione</span></div>
      {(row.lines || []).map((line) => <div className="rdp-oct-line" role="row" key={line.id}>
        <span><strong>{line.articleCode}</strong><small>{line.description}</small></span>
        <span>{formatQuantity(line.orderedQuantity)} {line.unit}</span>
        <span>{formatQuantity(line.fulfilledQuantity)} {line.unit}</span>
        <span>{formatQuantity(line.residualQuantity)} {line.unit}</span>
        <span>{formatDate(line.deliveryDate)}</span>
        <span>{badge(line.productionStatus, row.ready ? "neutral" : "red")}</span>
      </div>)}
      {!row.lines?.length && <div className="rdp-oct-line-empty">Righe conservate nello storico della RdP.</div>}
    </div>
    <footer><Diagnostics rows={row.diagnostics} onOpen={onDiagnostic}/></footer>
  </article>;
}

function AnalysisGrid({ analysis, proposal }) {
  const source = analysis || proposal || {};
  const fields = [
    ["RequestedQuantity", ["requestedQuantity", "requested"]], ["PhysicalQuantity", ["physicalQuantity", "physical"]], ["CommittedQuantity", ["committedQuantity", "committed"]],
    ["FreeQuantity", ["freeQuantity", "free"]], ["IncomingQuantity", ["incomingQuantity", "incoming"]], ["ExpectedIncomingDate", ["expectedIncomingDate"]],
    ["MissingQuantity", ["missingQuantity", "missing"]], ["ProducibleQuantity", ["producibleQuantity", "producible"]], ["PlannableQuantity", ["plannableQuantity", "plannable"]],
    ["MaterialCovered", ["materialCovered"]], ["MaterialStatus", ["materialStatusNote"]], ["BlockCode", ["blockCode"]],
  ];
  return <div className="rdp-analysis-grid">{fields.map(([label, keys]) => { const value = keys.map((key) => source[key]).find((item) => item !== undefined && item !== null && item !== ""); return <div key={label}><span>{label}</span><strong>{typeof value === "boolean" ? (value ? "Sì" : "No") : value ?? "—"}</strong></div>; })}</div>;
}

function V3Panel({ v3, canDecide, busy, onPreview, onConfirm }) {
  if (!v3) return null;
  const preview = v3.preview;
  return <section className="rdp-decisions rdp-v3-panel">
    <button type="button" className="primary-action rdp-v3-recalculate" onClick={onPreview} disabled={busy || !v3.flags?.["workspacemes.v3.preview"]}>{busy ? "RICALCOLO RDP…" : "RICALCOLA RDP"}</button>
    {preview && <>
      <p>Preview <strong>{preview.status}</strong> · DIRECT calcolati da Workspace, MP certificate da ProgreMES.</p>
      <div className="rdp-analysis-grid">{(v3.components || []).map((row) => <div key={row.id}>
        <span>{row.component_kind} · {row.calculation_owner}</span>
        <strong>{row.article_code} · {formatQuantity(row.required_quantity)} {row.unit_of_measure}</strong>
        <small>Disponibile {formatQuantity(row.on_hand_quantity)} · impegnato {formatQuantity(row.committed_quantity)} · arrivo {formatQuantity(row.incoming_quantity)} · scoperto {formatQuantity(row.uncovered_quantity)}</small>
        {row.formula_code && <small>Formula {row.formula_code} rev. {row.formula_revision} · batch {row.batch || "—"} · Station {row.station || "—"} · Filling {row.filling || "—"}</small>}
        {row.blocker_code && <small className="rdp-alert-blocking">{row.blocker_code}</small>}
      </div>)}</div>
      {!!v3.requirements?.length && <p>Fabbisogni automatici: {v3.requirements.length} · impegni: {v3.commitments?.length || 0}.</p>}
      {preview.status === "READY" && !v3.saga && canDecide && <button type="button" className="primary-action" onClick={onConfirm} disabled={busy || !v3.flags?.["workspacemes.v3.confirm"]}><Factory size={16}/>Conferma V3, genera OP e fabbisogni</button>}
    </>}
  </section>;
}

function DiagnosticActionDialog({ diagnostic, busy, canManage, onClose, onApply }) {
  const [reason, setReason] = useState("");
  const [confirmArchive, setConfirmArchive] = useState(false);
  if (!diagnostic) return null;
  const manageable = diagnosticIsManageable(diagnostic);
  const archivable = diagnosticCanBeArchived(diagnostic);
  const source = String(diagnostic.sourceSystem || "WorkspaceMES");
  return <div className="rdp-diagnostic-backdrop" role="presentation" onMouseDown={onClose}><section className="rdp-diagnostic-dialog" role="dialog" aria-modal="true" aria-label={`Risoluzione errore ${diagnostic.errorCode}`} onMouseDown={(event) => event.stopPropagation()}>
    <header><div><span className="rdp-eyebrow">Intervento sullo specifico errore</span><h2>{diagnostic.errorCode || "Errore WorkspaceMES"}</h2><p>Origine {source}{diagnostic.phase ? ` · Fase ${diagnostic.phase}` : ""}</p></div><button type="button" className="rdp-icon-button" onClick={onClose} disabled={busy} aria-label="Chiudi azione errore"><X/></button></header>
    <div className={`rdp-diagnostic-severity rdp-alert-${String(diagnostic.severity || "info").toLowerCase()}`}><AlertTriangle/><div><strong>{diagnostic.title || diagnostic.errorCode}</strong><p>{diagnostic.description || "Nessun dettaglio disponibile."}</p></div></div>
    <section className="rdp-required-action"><span>Azione richiesta</span><strong>{diagnostic.actionRequired || "Verificare la causa indicata e aggiornare lo stato solo dopo la correzione effettiva."}</strong></section>
    <dl className="rdp-diagnostic-meta"><div><dt>Entità</dt><dd>{diagnostic.entityType || "—"} {diagnostic.entityId || ""}</dd></div><div><dt>Articolo</dt><dd>{diagnostic.articleCode || "—"}</dd></div><div><dt>Stato</dt><dd>{diagnostic.status || "Open"}</dd></div><div><dt>Occorrenze</dt><dd>{diagnostic.occurrenceCount ?? "—"}</dd></div></dl>
    {canManage && archivable ? <>
      <label className="rdp-diagnostic-reason"><span>Nota operativa</span><textarea rows={3} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Descrivi l’intervento eseguito; obbligatoria per eliminare dallo stato operativo." disabled={busy}/></label>
      {confirmArchive ? <div className="rdp-diagnostic-confirm"><p>La diagnostica resterà nello storico con audit completo.</p><div><button type="button" className="secondary-action" onClick={() => setConfirmArchive(false)} disabled={busy}>Indietro</button><button type="button" className="rdp-cancel-action" onClick={() => onApply(diagnostic, "archive", reason.trim())} disabled={busy || !reason.trim()}>{busy ? "Aggiornamento…" : "Conferma elimina"}</button></div></div> : <div className="rdp-diagnostic-actions">{manageable && <><button type="button" className="secondary-action" onClick={() => onApply(diagnostic, "acknowledge", reason.trim())} disabled={busy}>Prendi in carico</button><button type="button" className="primary-action" onClick={() => onApply(diagnostic, "resolve", reason.trim())} disabled={busy}>{busy ? "Aggiornamento…" : "Segna come risolto"}</button></>}<button type="button" className="rdp-diagnostic-archive" onClick={() => setConfirmArchive(true)} disabled={busy}>Elimina dallo stato operativo</button></div>}
    </> : <p className="rdp-diagnostic-readonly">{archivable ? "Permesso diagnostics.manage richiesto per intervenire." : "La diagnostica è già eliminata dalla vista operativa e conservata nello storico."}</p>}
  </section></div>;
}

function DetailPanel({ detail, onClose, onDiagnostics, canDecide, canCancel, onDecision, onRetry, onCancel, onV3Preview, onV3Confirm, busy }) {
  const hasV3Preview = Boolean(detail?.v3?.preview);
  const outcomeLine = detail?.lines?.find((line) => !line.descriptive && !hasV3Preview && (blocking(line.diagnostics) || /BLOCKED|TO_RESOLVE/.test(String(line.mesStatus || line.mappingStatus || "").toUpperCase())));
  const [openLine, setOpenLine] = useState(outcomeLine?.id || detail?.lines?.[0]?.id || null);
  if (!detail) return null;
  return <div className="rdp-detail-backdrop" role="presentation" onMouseDown={onClose}><section className="rdp-detail" role="dialog" aria-modal="true" aria-label="Dettaglio RdP e OCT" onMouseDown={(event) => event.stopPropagation()}>
    <header><div><span className="rdp-eyebrow">Lineage commerciale e produttivo</span><h2>{detail.request ? rdpLabel(detail.request) : detail.orders.map((item) => item.label).join(", ")}</h2><p>{detail.orders.map((item) => `${item.label} · ${item.customer || "cliente non disponibile"}`).join(" | ")}</p></div><button type="button" className="rdp-icon-button" onClick={onClose} aria-label="Chiudi dettaglio"><X /></button></header>
    {detail.request && <div className="rdp-request-meta"><span>Stato {badge(detail.request.workspace_status || detail.request.stato, detail.request.stage === "blocked" ? "red" : "blue")}</span><span>Creata {formatDate(detail.request.created_at, true)}</span><span>Tentativi {detail.request.attempt_count ?? 0}</span><span>Contratto v{detail.request.contract_version || 2}</span>{!detail.request.sent_demand_snapshot_id && String(detail.request.workspace_status || detail.request.stato).toUpperCase() !== "CANCELLED" ? <button type="button" className="secondary-action" onClick={onRetry} disabled={busy}>{busy ? "Retry in corso…" : "Riprendi invio RdP"}</button> : null}{detail.cancellation?.allowed && <button type="button" className="rdp-cancel-action" onClick={onCancel} disabled={busy || !canCancel}><Ban size={16}/>Annulla RdP</button>}{detail.cancellation?.allowed && !canCancel && <small>Permesso rdp.cancel richiesto.</small>}</div>}
    {detail.request?.last_error_code && <div className="rdp-revision-alert"><AlertTriangle/><div><strong>ULTIMO INVIO NON RIUSCITO · {detail.request.last_error_code}</strong><p>La RdP è conservata senza duplicazioni. Consultare il Centro Diagnostico prima di un nuovo tentativo.</p></div></div>}
    {detail.revision?.modified && <div className="rdp-revision-alert"><AlertTriangle/><div><strong>OCT MODIFICATO IN MEXAL</strong><p>Aggiunte {detail.revision.added.length} · rimosse {detail.revision.removed.length} · quantità/UDM modificate {detail.revision.changed.length} · consegna {detail.revision.deliveryChanged ? "modificata" : "invariata"}.</p><small>Le opzioni “mantieni pianificazione + delta” e “integra e ripianifica” saranno abilitate soltanto quando esposte dal contratto MES.</small></div></div>}
    <div className="rdp-line-list">{detail.lines.map((line) => <article key={line.id} className={line.descriptive ? "rdp-line descriptive" : "rdp-line"}>
      <button type="button" className="rdp-line-summary" onClick={() => setOpenLine(openLine === line.id ? null : line.id)}>
        <span className="rdp-position">{line.position ?? "—"}</span><span><strong>{line.descriptive ? "Riga descrittiva" : line.articleCode}</strong><small>{line.description || "—"}</small></span>
        <span>{line.descriptive ? <><strong>Non produttiva</strong><small>Nessuna quantità da elaborare</small></> : <><strong>{line.quantity ?? "—"} {line.octUom || ""}</strong><small>UDM produzione {line.productionUom || "da risolvere"}</small></>}</span>
        {line.descriptive ? badge("OK · NON PRODUTTIVA", "green") : hasV3Preview ? badge("V3 · DISTINTA ESPLOSA", "green") : badge(line.mesStatus || line.mappingStatus, blocking(line.diagnostics) ? "red" : "neutral")}<ChevronRight size={18} />
      </button>
      {openLine === line.id && <div className="rdp-line-body">
        <div className="rdp-commercial"><h3>Dati commerciali OCT</h3><dl><div><dt>Posizione Mexal</dt><dd>{line.position ?? "—"}</dd></div><div><dt>Quantità completa</dt><dd>{line.descriptive ? "Non applicabile" : `${line.quantity ?? "—"} ${line.octUom || ""}`}</dd></div><div><dt>ProductionUom</dt><dd>{line.descriptive ? "Non applicabile" : line.productionUom || "da risolvere in MES"}</dd></div><div><dt>Conversione</dt><dd>{line.descriptive ? "Non applicabile" : line.conversion ? `${line.conversion.factor} · ${line.conversion.source}` : "Nessuna"}</dd></div></dl></div>
        {line.descriptive ? <div className="rdp-descriptive-ok"><CheckCircle2/><div><strong>Riga esclusa correttamente</strong><p>Testo informativo Mexal: non richiede mapping, UDM, analisi MES o lavorazione produttiva.</p></div></div> : hasV3Preview ? <div className="rdp-descriptive-ok"><CheckCircle2/><div><strong>Distinta prodotto finito elaborata</strong><p>Workspace ha esploso la distinta Mexal. I componenti DIRECT e gli FP analizzati da ProgreMES sono riportati nel ricalcolo V3.</p></div></div> : <><div className="rdp-mes"><h3>Analisi produttiva MES</h3><AnalysisGrid analysis={line.mesAnalysis} proposal={line.proposal} /></div><Diagnostics rows={line.diagnostics} onOpen={onDiagnostics} /></>}
      </div>}
    </article>)}</div>
    {detail.request && canDecide && detail.lines.some((line) => line.proposal && !line.proposal.confirmation_external_id) && <section className="rdp-decisions"><h3>Decisioni operatore disponibili</h3><p>Il backend attuale espone la pianificazione completa. Le altre decisioni saranno mostrate solo quando disponibili nel contratto MES.</p>{detail.lines.filter((line) => line.proposal && !line.proposal.confirmation_external_id).map((line) => <button type="button" className="primary-action" key={line.proposal.id} onClick={() => onDecision(line)}><Factory size={16}/>Pianificazione completa · {line.articleCode}</button>)}</section>}
    {detail.request && canDecide && detail.v2Decision?.available && <section className="rdp-decisions"><h3>Decisione operatore richiesta</h3><p>L’analisi produttiva v2 è completa e senza blocchi. La conferma creerà gli ordini di produzione attraverso il normale contratto ProgreMES.</p><button type="button" className="primary-action" onClick={() => onDecision({ kind: "v2", request: detail.request })}><Factory size={16}/>Genera ordini di produzione</button></section>}
    {detail.request && <V3Panel v3={detail.v3} canDecide={canDecide} busy={busy} onPreview={onV3Preview} onConfirm={onV3Confirm}/>}
  </section></div>;
}

function DecisionDialog({ decision, busy, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  if (!decision) return null;
  const v2 = decision.kind === "v2";
  const v3 = decision.kind === "v3";
  return <div className="rdp-dialog-backdrop"><section className="rdp-dialog" role="dialog" aria-modal="true" aria-label="Conferma pianificazione"><header><div><span className="rdp-eyebrow">Decisione operatore</span><h2>Genera ordini di produzione</h2></div><button type="button" onClick={onClose} disabled={busy}><X/></button></header><div className="rdp-no-netting"><ShieldAlert/><div><strong>Impatto produttivo</strong><p>{v3 ? "ProgreMES creerà gli OP; Workspace materializzerà atomicamente impegni e fabbisogni automatici dalla preview certificata." : v2 ? "ProgreMES applicherà la decisione v2 all’analisi corrente e creerà gli OP in modo idempotente." : `ProgreMES creerà o confermerà la pianificazione per ${decision.articleCode}, quantità ${decision.quantity} ${decision.productionUom || decision.octUom}.`}</p></div></div>{(v2 || v3) && <label className="rdp-cancel-reason"><span>Motivazione obbligatoria</span><textarea rows={3} minLength={5} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Indica il motivo della decisione produttiva…"/></label>}<div className="rdp-dialog-actions"><button type="button" className="secondary-action" onClick={onClose} disabled={busy}>Annulla</button><button type="button" className="primary-action" onClick={() => onConfirm(reason.trim())} disabled={busy || ((v2 || v3) && reason.trim().length < 5)}>{busy ? "Conferma…" : "Conferma e genera OP"}</button></div></section></div>;
}

function workbenchRows(payload) { return [...(payload.items || []), ...(payload.history || [])]; }

function CancelRequestDialog({ request, busy, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  if (!request) return null;
  const validReason = reason.trim().length >= 5;
  return <div className="rdp-dialog-backdrop" role="presentation"><section className="rdp-dialog rdp-cancel-dialog" role="dialog" aria-modal="true" aria-label="Conferma annullamento RdP">
    <header><div><span className="rdp-eyebrow">Annullamento controllato</span><h2>Annulla RdP</h2></div><button type="button" onClick={onClose} disabled={busy} aria-label="Chiudi"><X/></button></header>
    <div className="rdp-cancel-warning"><ShieldAlert/><div><strong>{rdpLabel(request)}</strong><p>Lo stato diventerà Annullata e la RdP sarà rimossa dagli elenchi operativi. OCT, tentativi, diagnostica, audit e lineage saranno conservati nello Storico RdP; l’OCT tornerà selezionabile e non verrà creata automaticamente una nuova RdP.</p></div></div>
    <label className="rdp-cancel-reason"><span>Motivo obbligatorio</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={5} maxLength={1000} rows={4} placeholder="Indica il motivo dell’annullamento…" required/></label>
    <label className="rdp-cancel-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}/><span>Confermo di voler annullare logicamente questa RdP senza cancellare i dati.</span></label>
    <div className="rdp-dialog-actions"><button type="button" className="secondary-action" onClick={onClose} disabled={busy}>Torna indietro</button><button type="button" className="rdp-cancel-action" onClick={() => onConfirm(reason.trim())} disabled={busy || !validReason || !confirmed}>{busy ? "Annullamento…" : "Conferma annullamento"}</button></div>
  </section></div>;
}

function PreviewDialog({ preview, busy, sendEnabled, onCancel, onConfirm }) {
  if (!preview) return null;
  return <div className="rdp-dialog-backdrop" role="presentation"><section className="rdp-dialog" role="dialog" aria-modal="true" aria-label="Anteprima RdP">
    <header><div><span className="rdp-eyebrow">Conferma controllata</span><h2>Anteprima RdP multi-OCT</h2></div><button type="button" onClick={onCancel} disabled={busy}><X /></button></header>
    <dl className="rdp-preview-summary"><div><dt>OCT</dt><dd>{preview.demand.orderCount}</dd></div><div><dt>Righe produttive</dt><dd>{preview.demand.itemCount}</dd></div><div><dt>Snapshot</dt><dd>#{preview.snapshot.id}</dd></div><div><dt>Stato</dt><dd>{preview.status}</dd></div></dl>
    <div className="rdp-preview-items">{preview.demand.orders.map((order) => <article key={order.orderId}><strong>{order.sigla}/{order.serie}/{order.numero}</strong><span>Revisione {order.commercialRevision}</span><span>Consegna {formatDate(order.requestedDeliveryDate)}</span></article>)}</div>
    {!sendEnabled && <div className="rdp-gate-off" role="alert"><ShieldAlert/><div><strong>Invio RdP Production non disponibile</strong><p>Uno o più gate WorkspaceMES/ProgreMES sono OFF. Verificare il Centro Diagnostico.</p></div></div>}
    <div className="rdp-dialog-actions rdp-preview-actions"><button type="button" className="secondary-action" onClick={onCancel} disabled={busy}>Annulla</button><button type="button" className="primary-action rdp-create-action" onClick={onConfirm} disabled={busy || !sendEnabled}>{busy ? <><RefreshCw className="rdp-spin" size={17}/>Invio in corso…</> : <><Send size={17}/>Crea RdP</>}</button></div>
  </section></div>;
}

export default function RdpWorkbench() {
  const { session, hasPermission } = useAuth();
  const accessToken = session?.access_token;
  const canCreate = hasPermission?.("rdp.create");
  const canDecide = hasPermission?.("rdp.decide");
  const canCancel = hasPermission?.("rdp.cancel");
  const canManageDiagnostics = hasPermission?.("diagnostics.manage");
  const [data, setData] = useState([]); const [tab, setTab] = useState("evaluation"); const [selected, setSelected] = useState([]);
  const [filters, setFilters] = useState({ search: "", ready: "" }); const [detail, setDetail] = useState(null);
  const [preview, setPreview] = useState(null); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [result, setResult] = useState(null);
  const [decision, setDecision] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [diagnosticTarget, setDiagnosticTarget] = useState(null);
  const [productionGates, setProductionGates] = useState(null);
  const [octRefresh, setOctRefresh] = useState(null);
  const refreshGeneration = useRef(0);
  const sendEnabled = productionGates?.allOn === true;

  useEffect(() => {
    if (result?.kind !== "production_order") return undefined;
    const timer = window.setTimeout(() => {
      window.location.assign(productionOrderProgremesPath(result));
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [result]);

  async function load() { setLoading(true); setError(""); try { const payload = await callWorkbench(accessToken, "progremes_workbench_list"); setData(workbenchRows(payload)); setProductionGates(payload.productionGates || null); } catch (e) { setProductionGates(null); setError(e.message); } finally { setLoading(false); } }
  useEffect(() => {
    if (!accessToken) return undefined;
    let active = true;
    const generation = ++refreshGeneration.current;
    async function initialize() {
      try {
        const initial = await callWorkbench(accessToken, "progremes_workbench_list");
        if (active && generation === refreshGeneration.current) {
          setData(workbenchRows(initial));
          setProductionGates(initial.productionGates || null);
        }
      } catch (loadError) {
        if (active && generation === refreshGeneration.current) {
          setProductionGates(null);
          setError(loadError.message);
        }
      } finally {
        if (active && generation === refreshGeneration.current) setLoading(false);
      }
      if (!active || generation !== refreshGeneration.current) return;
      try {
        const payload = await callWorkbench(accessToken, "progremes_oct_refresh");
        const jobId = Number(payload.refresh?.jobId);
        if (!active || generation !== refreshGeneration.current || !Number.isSafeInteger(jobId)) return;
        setOctRefresh({ jobId, status: payload.refresh?.status || "queued" });
        while (active && generation === refreshGeneration.current) {
          await new Promise((resolve) => window.setTimeout(resolve, 5000));
          if (!active || generation !== refreshGeneration.current) return;
          const statusPayload = await callWorkbench(accessToken, "progremes_oct_refresh_status", { jobId });
          const refresh = statusPayload.refresh || {};
          if (!active || generation !== refreshGeneration.current) return;
          setOctRefresh({ jobId, ...refresh });
          if (["completed", "failed", "cancelled"].includes(refresh.status)) {
            if (refresh.status === "completed") {
              const refreshed = await callWorkbench(accessToken, "progremes_workbench_list");
              if (active && generation === refreshGeneration.current) {
                setData(workbenchRows(refreshed));
                setProductionGates(refreshed.productionGates || null);
              }
            }
            return;
          }
        }
      } catch (refreshError) {
        if (active && generation === refreshGeneration.current) {
          setOctRefresh({ status: "failed", last_error: refreshError.message });
        }
      }
    }
    initialize();
    return () => { active = false; };
  }, [accessToken]);
  const visible = useMemo(() => data.filter((row) => {
    if (row.stage !== tab) return false;
    const haystack = `${row.label} ${row.customer} ${row.status}`.toLowerCase();
    if (filters.search && !haystack.includes(filters.search.toLowerCase())) return false;
    if (filters.ready === "ready" && !row.ready) return false;
    if (filters.ready === "blocked" && row.ready) return false;
    return true;
  }), [data, tab, filters]);
  const selectedRows = data.filter((row) => selected.includes(row.id));
  const selectionBlocked = selectedRows.some((row) => !row.ready || blocking(row.diagnostics));

  function toggle(row) { setSelected((current) => current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id]); setPreview(null); setResult(null); }
  async function openDetail(row) { setError(""); try { setDetail(await callWorkbench(accessToken, "progremes_workbench_detail", { orderId: row.orderId || row.id, requestId: row.requestId })); } catch (e) { setError(e.message); } }
  async function createPreview() { if (!sendEnabled || !selected.length || busy) return; setBusy(true); setError(""); try { setPreview(await callWorkbench(accessToken, "progremes_production_preview", { orderIds: selected })); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  async function sendRequest() { if (!sendEnabled || !preview || busy) return; setBusy(true); setError(""); try { const response = await callWorkbench(accessToken, "progremes_production_request", { orderIds: selected, snapshotId: preview.snapshot.id }); if (!response.requestId) throw new Error("ProgreMES ha elaborato la RdP senza restituire il riferimento Workspace."); let v3Error = null; try { await callWorkbench(accessToken, "workspacemes_v3_preview", { requestId: response.requestId }); } catch (previewError) { v3Error = previewError; } setPreview(null); setSelected([]); await load(); try { const outcome = await callWorkbench(accessToken, "progremes_workbench_detail", { requestId: response.requestId }); setResult({ ...response, rdpNumber: outcome.request?.rdp_number }); setDetail(outcome); if (v3Error) setError(`RdP creata, ma il ricalcolo V3 non è riuscito: ${v3Error.message}`); } catch (detailError) { setResult(response); setError(`RdP creata, ma il dettaglio dell’esito non è disponibile: ${detailError.message}`); } } catch (e) { setError(e.code === "DEMAND_CHANGED" ? "L’OCT è cambiato dopo l’anteprima: ripetere il precheck." : e.code === "RDP_IDEMPOTENCY_CONFLICT" ? "La selezione appartiene a una precedente generazione RdP. Aggiorna la schermata e crea una nuova anteprima." : e.message); } finally { setBusy(false); } }
  async function retryRequest() { if (!sendEnabled || !detail?.request?.id || busy) return; setBusy(true); setError(""); try { const response = await callWorkbench(accessToken, "progremes_production_retry", { requestId: detail.request.id }); setResult(response); setDetail(await callWorkbench(accessToken, "progremes_workbench_detail", { requestId: detail.request.id })); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  async function createV3Preview() { if (!detail?.request?.id || busy) return; setBusy(true); setError(""); try { await callWorkbench(accessToken, "workspacemes_v3_preview", { requestId: detail.request.id }); setDetail(await callWorkbench(accessToken, "progremes_workbench_detail", { requestId: detail.request.id })); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  async function confirmDecision(reason = "") { if ((!decision?.proposal?.id && !["v2", "v3"].includes(decision?.kind)) || busy) return; setBusy(true); setError(""); try { const response = decision.kind === "v3" ? await callWorkbench(accessToken, "workspacemes_v3_confirm", { previewId: decision.preview.id, reason }) : decision.kind === "v2" ? await callWorkbench(accessToken, "progremes_production_decide_v2", { requestId: decision.request.id, decision: "CompletePlanning", reason }) : await callWorkbench(accessToken, "progremes_production_confirm", { proposalId: decision.proposal.id }); const productionOrder = decision.kind === "v3" ? response.mes?.productionOrders?.[0] : confirmedProductionOrder(response); if (!productionOrder) throw new Error("ProgreMES ha confermato la decisione senza restituire l’OP generato."); setDecision(null); setResult({ kind: "production_order", status: response.workspaceStatus || response.status || response.mes?.status || "Planned", externalId: detail?.request?.external_id, productionOrder }); setDetail(await callWorkbench(accessToken, "progremes_workbench_detail", { requestId: detail.request.id })); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  async function cancelRequest(reason) {
    if (!cancelTarget?.id || !canCancel || busy) return;
    setBusy(true); setError("");
    try {
      const response = await callWorkbench(accessToken, "progremes_production_cancel", { requestId: cancelTarget.id, reason });
      const rdpNumber = cancelTarget.rdp_number ?? detail?.request?.rdp_number;
      setCancelTarget(null);
      setDetail(null);
      setTab("evaluation");
      setSelected([]);
      setResult({ ...response, kind: "cancelled", rdpNumber });
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  function openDiagnostic(row) { setDiagnosticTarget(row); }
  async function applyDiagnosticAction(row, diagnosticAction, reason) {
    if (!canManageDiagnostics || busy) return;
    setBusy(true); setError("");
    try {
      await callWorkbench(accessToken, "progremes_diagnostic_action", { diagnosticId: row.diagnosticId, diagnosticAction, reason });
      const requestId = detail?.request?.id;
      if (requestId) setDetail(await callWorkbench(accessToken, "progremes_workbench_detail", { requestId }));
      await load();
      setDiagnosticTarget(null);
    } catch (actionError) { setError(actionError.message); }
    finally { setBusy(false); }
  }

  return <div className="production-page rdp-workbench">
    <header className="rdp-header"><div><span className="rdp-eyebrow">WorkspaceMES</span><h1>RdP Workbench</h1><p>Gestione OCT, richieste di produzione, analisi MES e decisioni operative.</p></div><div className="rdp-header-controls"><nav className="rdp-tabs" aria-label="Stati Workbench">{TABS.map(([code,label]) => <button type="button" key={code} className={tab === code ? "active" : ""} onClick={() => setTab(code)}>{label}<span>{data.filter((row) => row.stage === code).length}</span></button>)}</nav><div className="rdp-header-actions"><BackgroundSyncStatus refresh={octRefresh}/><button type="button" className="secondary-action" onClick={load} disabled={loading}><RefreshCw className={loading ? "rdp-spin" : ""} size={17}/>Aggiorna</button></div></div></header>
    <section className={`rdp-toolbar ${tab === "evaluation" ? "rdp-toolbar-evaluation" : ""}`}><label><Search size={17}/><input value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Cerca OCT, cliente, stato…"/></label><select value={filters.ready} onChange={(e) => setFilters({ ...filters, ready: e.target.value })}><option value="">Pronti e bloccati</option><option value="ready">Solo pronti</option><option value="blocked">Solo bloccati</option></select>{tab === "evaluation" && <div className="rdp-selection-bar"><span><strong>{selected.length}</strong> OCT selezionati</span><button type="button" className="primary-action rdp-preview-action" onClick={createPreview} disabled={!canCreate || !sendEnabled || !selected.length || selectionBlocked || busy}>{busy ? "Verifica…" : "Verifica e crea anteprima"}</button>{!canCreate && <small>Permesso rdp.create richiesto.</small>}{!sendEnabled && <small>Invio RdP Production non disponibile: verificare i gate nel Centro Diagnostico.</small>}{selectionBlocked && <small>Rimuovere gli OCT bloccati prima di creare la RdP.</small>}</div>}</section>
    {error && <div className="production-message" role="alert"><span>{error}</span><button type="button" onClick={() => setError("")}><X size={16}/>Chiudi</button></div>}
    {result && <div className="rdp-success"><CheckCircle2/><div><strong>{result.kind === "cancelled" ? "RdP annullata logicamente" : result.kind === "production_order" ? "RdP andata a buon fine, OP generato." : "RdP ricevuta da ProgreMES"}</strong><p>{result.kind === "production_order" ? `${result.productionOrder?.number || result.productionOrder?.id ? `OP ${result.productionOrder.number || result.productionOrder.id} · ` : ""}apertura ordini di produzione…` : `${result.rdpNumber ? `RDP${result.rdpNumber}` : "RdP"} · Stato ${result.kind === "cancelled" ? "Annullata" : result.status || "Received"}`}</p></div></div>}
    <section className="rdp-oct-scroll" role="region" aria-label="Elenco OCT e RdP" tabIndex={0}>{loading ? <div className="production-loading">Caricamento OCT e RdP…</div> : <div className="rdp-oct-cards">{visible.map((row) => <OctOrderCard key={row.id} row={row} selectable={tab === "evaluation"} selected={selected.includes(row.id)} onToggle={() => toggle(row)} onOpen={() => openDetail(row)} onDiagnostic={openDiagnostic}/>) }{!visible.length && <div className="rdp-empty">Nessun elemento per i filtri e lo stato selezionati.</div>}</div>}</section>
    <DetailPanel key={detail?.request?.id || detail?.orders?.map((order) => order.id).join(":") || "none"} detail={detail} onClose={() => setDetail(null)} onDiagnostics={openDiagnostic} canDecide={canDecide} canCancel={canCancel} onDecision={setDecision} onRetry={retryRequest} onCancel={() => setCancelTarget(detail.request)} onV3Preview={createV3Preview} onV3Confirm={() => setDecision({ kind: "v3", preview: detail.v3.preview, request: detail.request })} busy={busy}/>
    <DiagnosticActionDialog key={diagnosticTarget?.diagnosticId || "none"} diagnostic={diagnosticTarget} busy={busy} canManage={canManageDiagnostics} onClose={() => setDiagnosticTarget(null)} onApply={applyDiagnosticAction}/>
    <PreviewDialog preview={preview} busy={busy} sendEnabled={sendEnabled} onCancel={() => setPreview(null)} onConfirm={sendRequest}/>
    <CancelRequestDialog request={cancelTarget} busy={busy} onClose={() => setCancelTarget(null)} onConfirm={cancelRequest}/>
    <DecisionDialog key={decision?.kind || decision?.proposal?.id || "none"} decision={decision} busy={busy} onClose={() => setDecision(null)} onConfirm={confirmDecision}/>
  </div>;
}
