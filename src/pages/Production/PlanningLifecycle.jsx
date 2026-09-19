import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Bot, CalendarClock, Check, RefreshCw, ShieldCheck } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import PlanningVersionSummary from "../../components/PlanningVersionSummary";
import OdlReleaseChoices from "./OdlReleaseChoices";
import OdlShortages from "./OdlShortages";
import "./planning-lifecycle.css";
import { planningDate, planningStages as stageLabels, planningStatuses } from "./planning-display";
import { planningConfirmationError, planningOperation } from "./planning-confirmation";

const localDate = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()).replace(" ", "T");
const phaseLabels = { 0: "Miscelazione", 3: "Confezionamento", 7: "Astucciatura" };
const labels = { MIGRATE: "Attiva nuova pianificazione", RECALCULATE: "Applica revisione del piano", CONFIRM_PLAN: "Conferma piano", RELEASE_ODL: "Genera ODL", ROLLBACK: "Ripristina ultima revisione" };
export default function PlanningLifecycle({ release = false, compact = false, initialSearch }) {
  const { session, hasModuleAccess } = useAuth();
  return <PlanningLifecycleForm key={`${session?.access_token}:${release}`} token={session?.access_token} release={release} compact={compact} initialSearch={initialSearch} canUseAI={hasModuleAccess("assistente_ai")} />;
}
export function PlanningLifecycleForm({ token, release = false, canUseAI = false, compact = false, initialSearch }) {
  const [routeParams] = useSearchParams();
  const params = initialSearch === undefined ? routeParams : new URLSearchParams(initialSearch);
  const [state, setState] = useState(null), [version, setVersion] = useState(null), [proposal, setProposal] = useState(null);
  const [kind, setKind] = useState(release ? "RELEASE_ODL" : "RECALCULATE");
  const [startAt, setStartAt] = useState(localDate), [reason, setReason] = useState("");
  const [query, setQuery] = useState(""), [selected, setSelected] = useState(() => [...new Set((params.get("orders") || "").split(",").map(Number).filter(id => Number.isSafeInteger(id) && id > 0))]), [choices, setChoices] = useState({});
  const [horizons, setHorizons] = useState({ confirmationDays: 60, reviewDays: 30, releaseDays: 7 });
  const [backup, setBackup] = useState(false), [ack, setAck] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const busyRef = useRef(false), results = useRef(null);
  const [openedDetail, setOpenedDetail] = useState(0);
  useEffect(() => {
    if (!openedDetail || !results.current) return;
    results.current.focus({ preventScroll: true });
    results.current.scrollIntoView({ behavior: "auto", block: "start" });
  }, [openedDetail]);
  async function openDetail(id) {
    setVersion(await request("planning_get", { id }));
    setProposal(null); setAck(false);
    setOpenedDetail(value => value + 1);
  }
  const invalidate = () => { setVersion(null); setProposal(null); setAck(false); setBackup(false); };
  async function request(action, data = {}) {
    const response = await fetch("/api/workspace/planning", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action, ...data }) });
    const body = await response.json();
    if (!response.ok || body.error) throw new Error(body.error?.message || body.error || `Richiesta non riuscita (${response.status})`);
    return body;
  }
  async function run(work) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try { await work(); } catch (e) { setError(e.message); } finally { busyRef.current = false; setBusy(false); }
  }
  async function refresh() {
    const [next] = await Promise.all([
      request("planning_state").then(next => {
        setState(next);
        setKind(current => planningOperation(next.configuration.active, release, current));
        return next;
      }),
      version ? request("planning_get", { id: version.id }).then(setVersion) : Promise.resolve(),
    ]);
    return next;
  }
  useEffect(() => {
    let cancelled = false;
    request("planning_state").then(next => {
      if (cancelled) return;
      setState(next); setHorizons(next.configuration);
      setKind(current => planningOperation(next.configuration.active, release, current));
    }).catch(e => { if (!cancelled) setError(e.message); });
    if (params.get("version")) request("planning_get", { id: params.get("version") }).then(v => { if (!cancelled) setVersion(v); }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
    // Requests are scoped to this mounted authentication session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  const filtered = (state?.demands || []).filter(row => !["HISTORICAL", "CANCELLED"].includes(row.stage))
    .filter(row => [...Object.values(row), stageLabels[row.stage]].join(" ").toLocaleLowerCase("it-IT").includes(query.toLocaleLowerCase("it-IT")));
  const input = () => ({ kind, startAt, reason: release ? "Rilascio ODL da Workspace" : reason, confirmationDays: Number(horizons.confirmationDays), reviewDays: Number(horizons.reviewDays), releaseDays: Number(horizons.releaseDays),
    orderIds: selected.length ? selected : null, manualChoices: Object.entries(["MIGRATE", "RECALCULATE"].includes(kind) ? choices : {}).filter(([, c]) => c.notBefore).map(([id, c]) => ({ orderId: Number(id), notBefore: c.notBefore, resourceId: c.resourceId ? Number(c.resourceId) : null })) });
  async function simulate() { invalidate(); const next = await request("planning_simulate", { input: input() }); setVersion(next); results.current?.focus(); }
  async function confirm() {
    const result = await request("planning_propose", { input: { targetId: version.id, expectedHash: version.expectedHash, backupVerified: backup } });
    const prepared = result.controlledAction || result.action || result;
    if (version.kind === "RELEASE_ODL") await decide(prepared);
    else setProposal(prepared);
  }
  async function decide(prepared = proposal) {
    const id = prepared.proposalId || prepared.id;
    if (!id) throw new Error("Identificativo proposta mancante: ricaricare senza ripetere il rilascio.");
    const result = await request("controlled_decide", { proposalId: id, decision: "confirm" });
    const failure = planningConfirmationError(result);
    setProposal(null); setAck(false);
    try { await refresh(); }
    catch (e) { throw new Error([failure, `Aggiornamento dell'esito non riuscito: ${e.message}`].filter(Boolean).join(" "), { cause: e }); }
    if (failure) throw new Error(failure);
  }
  const status = !state ? "Stato da verificare" : state.configuration?.active ? "Nuovo sistema attivo" : "Sistema attuale conservato";
  const confirmationLabel = proposal?.tool === "MES_ODL_VERIFY" ? "Verifica ODL e copertura materiali"
    : version?.snapshot?.input?.allowMaterialShortage ? "Genera ODL con carenza e fabbisogni specifici" : labels[version?.kind];
  return <div className="planning-lifecycle" data-screen-code={release ? "produzione.rilascio_odl" : "produzione.versioni_piano"} aria-busy={busy}>
    {!compact && <section className="plan-intro"><CalendarClock aria-hidden="true" /><div><h2>{release ? "Storico ODL" : "Pianificare senza perdere lo storico"}</h2><p>{release ? "Consulta gli ODL, le revisioni e i fabbisogni. Per rilasciare o anticipare una lavorazione, apri il Planning e usa Genera ODL." : "Previsione RdP → conferma piano → rilascio ODL. Ogni modifica resta confrontabile con la versione precedente."}</p></div></section>}
    <nav className="plan-actions" aria-label="Pianificazione"><Link to={release ? "/versioni-piano-produzione" : "/rilascio-odl"}>{release ? "Versioni e revisioni del piano" : "Storico ODL"}</Link><Link to="/produzione/rdp-workbench">Workbench RdP</Link><Link to="/revisione-priorita-produzione">Revisione priorità</Link><button disabled={busy} onClick={() => run(refresh)}><RefreshCw size={16} />Aggiorna stato</button><button disabled={busy || !state?.configuration?.active} onClick={() => run(async () => { await request("planning_reconcile"); await refresh(); })}>Allinea stato Workspace</button>{canUseAI && !release && <button disabled={busy} onClick={() => window.dispatchEvent(new CustomEvent("workspace:priority-ai", { detail: { prompt: `Aiutami nella ${release ? "preparazione del rilascio ODL" : "revisione del piano"}. Leggi MES_PLAN_STATE e prepara una simulazione con MES_PLAN_SIMULATE. Spiega le conseguenze e attendi la conferma: nessuna attivazione, creazione lotti o avvio autonomo.` } }))}><Bot size={16} />Supporto IA</button>}</nav>
    {error && <div className="plan-notice plan-error" role="alert">{error}</div>}
    <div className="plan-kpis"><section><span>Modalità</span><strong>{status}</strong></section><section><span>Previsioni senza OP</span><strong>{state?.demands?.filter(x => x.stage === "FORECAST").length ?? "—"}</strong></section><section><span>ODL rilasciati</span><strong>{state?.odls?.filter(x => ["RELEASED", "RELEASED_WITH_SHORTAGE"].includes(x.status)).length ?? "—"}</strong></section></div>
    {!release && <><section className="plan-panel"><h2>Domande e ordini · {filtered.length}</h2><label>Ricerca totale<input type="search" placeholder="RdP, OP, stato, articolo…" value={query} onChange={e => setQuery(e.target.value)} /></label><p>Se non selezioni righe, la proposta considera l'intero orizzonte. Le modifiche manuali sono proposte, non spostamenti già applicati.</p>
      <div className="plan-table-wrap" tabIndex={0} role="region" aria-label="Domande e scelte manuali"><table><thead><tr><th>Selezione</th><th>RdP / OP</th><th>Fase</th><th>Richiesta originale</th><th>Stima</th><th>Confermata</th>{!release && <><th>Non prima di</th><th>Impianto preferito</th></>}</tr></thead><tbody>{filtered.map(row => {
        const id = row.productionOrderId ?? -row.id; return <tr key={row.id}><td><input aria-label={`Seleziona ${row.number}`} type="checkbox" disabled={busy || ["HISTORICAL", "CANCELLED"].includes(row.stage)} checked={selected.includes(id)} onChange={e => { setSelected(e.target.checked ? [...selected, id] : selected.filter(x => x !== id)); invalidate(); }} /></td><td><strong>{row.number}</strong>{row.octReference && <><br />OCT: {row.octReference}</>}<br />{row.articleCode} · {row.description}<br />{row.quantity} · {row.customer || "Cliente non associato"}</td><td>{stageLabels[row.stage] || row.stage}</td><td>{planningDate(row.requestedAt)}</td><td>{planningDate(row.estimatedAt)}</td><td>{planningDate(row.confirmedDeliveryAt, "Non confermata")}</td>{!release && <><td><input aria-label={`Avvio minimo ${row.number}`} type="datetime-local" disabled={busy || !["MIGRATE", "RECALCULATE"].includes(kind) || ["HISTORICAL", "CANCELLED"].includes(row.stage)} value={choices[id]?.notBefore || ""} onChange={e => { setChoices({ ...choices, [id]: { ...choices[id], notBefore: e.target.value } }); invalidate(); }} /></td><td><select aria-label={`Impianto ${row.number}`} disabled={busy || !["MIGRATE", "RECALCULATE"].includes(kind) || ["HISTORICAL", "CANCELLED"].includes(row.stage)} value={choices[id]?.resourceId || ""} onChange={e => { setChoices({ ...choices, [id]: { ...choices[id], resourceId: e.target.value } }); invalidate(); }}><option value="">Scelta automatica compatibile</option>{state?.resources?.map(resource => <option key={resource.id} value={resource.id}>{resource.code} · {resource.description}</option>)}</select></td></>}</tr>;
      })}{!filtered.length && <tr><td colSpan={release ? 6 : 8}>{state?.configuration?.active ? "Nessuna domanda corrispondente." : "Le lavorazioni pregresse saranno mostrate nell'anteprima di migrazione, senza modificarle."}</td></tr>}</tbody></table></div>
    </section>
    <section className="plan-panel"><h2>{release ? "Prepara il rilascio" : "Prepara una versione"}</h2>
      {!state?.configuration?.active && <p className="plan-notice">La pubblicazione del codice non cambia il piano. L'attivazione richiede anteprima, verifica del backup e conferma esplicita. Storico, lotti già assegnati e documenti restano conservati.</p>}
      <fieldset disabled={busy}><legend>Parametri del calcolo</legend><div className="plan-fields">
        <label>Operazione<select value={kind} onChange={e => { setKind(e.target.value); invalidate(); }}>{!state?.configuration?.active && !release ? <option value="MIGRATE">Migrazione dal piano attuale</option> : release ? <option value="RELEASE_ODL">Genera ODL</option> : <><option value="RECALCULATE">Rivedi piano e fattibilità</option><option value="CONFIRM_PLAN">Conferma piano / genera OP</option><option value="ROLLBACK">Ripristina ultima revisione, se ancora reversibile</option></>}</select></label>
        <label>Data di riferimento · ora italiana<input type="datetime-local" value={startAt} onChange={e => { setStartAt(e.target.value); invalidate(); }} /></label>
        {[['confirmationDays', 'Conferma OP · giorni'], ['reviewDays', 'Revisione · giorni'], ['releaseDays', 'Rilascio · giorni']].map(([key, name]) => <label key={key}>{name}<input type="number" min="1" max="365" value={horizons[key] ?? ""} onChange={e => { setHorizons({ ...horizons, [key]: e.target.value }); invalidate(); }} /></label>)}
      </div>{!release && <label className="plan-reason">Motivazione<textarea maxLength={1000} value={reason} onChange={e => { setReason(e.target.value); invalidate(); }} /></label>}</fieldset>
      <button className="plan-primary" disabled={busy || (!release && !reason.trim()) || !state || (release && !state.configuration.active)} onClick={() => run(simulate)}>{busy ? "Elaborazione…" : "Calcola anteprima senza applicare"}</button>
    </section>
    </>}
    {release && <nav className="plan-actions"><Link to="/produzione/progremes.Planning?workspaceMesWindow=1">Apri Planning · Genera ODL</Link></nav>}
    {release && state && !state.graphicalReleaseSupported && <p className="plan-notice">Aggiorna MES per usare il nuovo rilascio direttamente dal Planning.</p>}
    {version && <section className="plan-panel" ref={results} tabIndex={-1}><h2>Anteprima e confronto</h2><PlanningVersionSummary version={version} query={query}>
      {!!version.releaseOrders?.length && <div className="plan-notice">
        <h3>Stato attuale degli ODL della versione</h3>
        <p>{version.releaseOrders.filter(row => ["RELEASED", "RELEASED_WITH_SHORTAGE", "IN_PRODUCTION", "COMPLETED"].includes(row.status)).length} di {version.releaseOrders.length} ODL rilasciati o già in lavorazione. Gli esiti precedenti riportati sotto non annullano questi rilasci.</p>
        <details><summary>Dettaglio dei singoli ODL</summary>
          {version.releaseOrders.map(row => <p key={row.odlId}><strong>ODL {row.odlId} · OP {row.orderId}</strong>: {["RELEASED", "RELEASED_WITH_SHORTAGE"].includes(row.status) ? "Rilasciato" : row.status === "PREPARING" ? "Da riconciliare" : row.status}{row.error ? ` — ${row.error}` : ""}</p>)}
        </details>
      </div>}
      {!release && version.kind === "RELEASE_ODL" && version.status === "PROPOSED" && !!version.snapshot.blocks?.length && <OdlReleaseChoices key={version.id} version={version} busy={busy} shortageSupported={state?.materialShortageReleaseSupported === true} onRecalculate={(ids, allowMaterialShortage = false, shortageReason) => run(async () => {
        const previousInput = version.snapshot.input;
        setSelected(ids); setProposal(null); setAck(false);
        const next = await request("planning_simulate", { input: { ...previousInput, orderIds: ids, allowMaterialShortage, reason: shortageReason || previousInput.reason,
          startAt: previousInput.startAt < localDate() ? localDate() : previousInput.startAt } });
        setVersion(next); results.current?.focus();
      })} />}
      </PlanningVersionSummary>
      {version.auditError && <p className="plan-notice plan-error" role="alert">{version.auditError}</p>}
      {!!version.confirmationAttempts?.length && <div className="plan-notice"><h3>Esito delle conferme</h3>{version.confirmationAttempts.map(attempt => <p key={attempt.id} role={attempt.status === "failed" ? "alert" : undefined}><strong>{attempt.status === "executed" ? "Applicazione completata" : attempt.status === "failed" ? "Applicazione non riuscita" : attempt.status === "confirmed" ? "Esito da verificare" : attempt.status === "rejected" ? "Conferma annullata" : "Conferma preparata"}</strong> · {planningDate(attempt.occurred_at)}<br />{attempt.error || (attempt.status === "confirmed" ? "La richiesta è stata confermata, ma non risulta un esito definitivo. Non ripetere l'applicazione." : "")}<br /><small>Riferimento: {attempt.id}</small></p>)}</div>}
      {!release && version.kind !== "GRAPHICAL_RELEASE" && version.status === "PROPOSED" && <div className="plan-approval"><button disabled={busy} onClick={() => run(async () => { const previousInput = version.snapshot.input; invalidate(); setVersion(await request("planning_simulate", { input: { ...previousInput, startAt: previousInput.startAt < localDate() ? localDate() : previousInput.startAt } })); })}>Ricalcola proposta con i dati correnti</button>{version.kind === "MIGRATE" && <label><input type="checkbox" checked={backup} disabled={busy} onChange={e => { setBackup(e.target.checked); setProposal(null); }} />Ho verificato un backup ripristinabile del database MES e dei documenti.</label>}<label><input type="checkbox" disabled={busy} checked={ack} onChange={e => setAck(e.target.checked)} />Ho verificato lavorazioni protette, date proposte, copertura e avvisi.</label><button className="plan-primary" disabled={busy || version.actor?.startsWith("system:") || !ack || !!version.snapshot.blocks?.length || (version.kind === "MIGRATE" && !backup)} onClick={() => run(confirm)}><ShieldCheck size={16} />{version.kind === "RELEASE_ODL" ? (version.snapshot.input.allowMaterialShortage ? "Genera ODL con carenza e fabbisogni" : "Genera ODL") : `Prepara conferma: ${labels[version.kind]}`}</button></div>}
      {proposal && <div className="plan-notice"><p>Conferma finale: <strong>{confirmationLabel}</strong>. L'operazione sarà registrata nell'audit.</p><button className="plan-primary" disabled={busy} onClick={() => run(() => decide())}><Check size={16} />Conferma applicazione</button><button disabled={busy} onClick={() => setProposal(null)}>Non applicare</button></div>}
      {version.status === "APPLIED" && <p className="plan-notice" role="status">Versione applicata. Nessun avvio produzione automatico.</p>}
      {version.status === "APPLIED" && !!version.snapshot.shortages?.length && !version.snapshot.shortagesCoveredAtUtc && <div className="plan-notice"><p>ODL generati con fabbisogni specifici. Quando i materiali sono disponibili, prepara la verifica della copertura; non vengono creati nuovi lotti.</p><button disabled={busy} onClick={() => run(async () => { const p = await request("planning_verify", { input: { targetId: version.id, expectedHash: version.expectedHash } }); setProposal(p.controlledAction || p.action || p); })}>Verifica copertura dei fabbisogni</button></div>}
      {["PREPARING", "RECONCILIATION_REQUIRED"].includes(version.status) && <div className="plan-notice"><p>Rilascio non completato. Verificare i lotti esistenti in Mexal e riallinearli prima di continuare. Non ripetere la creazione dei lotti.</p><button disabled={busy} onClick={() => run(async () => { const p = await request("planning_verify", { input: { targetId: version.id, expectedHash: version.expectedHash } }); setProposal(p.controlledAction || p.action || p); })}>Verifica lotti riconciliati, senza generarli</button></div>}
    </section>}
    {release && <OdlShortages rows={state?.releaseShortages} busy={busy} onOpen={id => run(() => openDetail(id))} />}
    <section className="plan-panel"><h2>{release ? "Storico ODL" : "Storico delle versioni"}</h2><div className="plan-table-wrap"><table><thead><tr><th>Riferimento</th><th>Stato</th><th>Data</th><th>Informazioni</th><th>Dettaglio</th></tr></thead><tbody>{(release ? state?.odls : state?.versions)?.map(row => <tr key={row.id}><td>{release ? `ODL ${row.id} · OP ${row.productionOrderId} · batch ${row.batch} · ${phaseLabels[row.phase] || row.phase}` : row.kind}</td><td>{planningStatuses[row.status] || row.status}</td><td>{planningDate(row.createdAtUtc)}</td><td>{row.error || row.reason || row.actor}</td><td><button disabled={busy} onClick={() => run(() => openDetail(row.versionId || row.id))}>Apri</button></td></tr>)}</tbody></table></div></section>
  </div>;
}
