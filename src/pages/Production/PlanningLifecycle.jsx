import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Bot, CalendarClock, Check, RefreshCw, ShieldCheck } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import PlanningVersionSummary from "../../components/PlanningVersionSummary";
import "./planning-lifecycle.css";
import { planningDate, planningStages as stageLabels, planningStatuses } from "./planning-display";

const localDate = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()).replace(" ", "T");
const phaseLabels = { 0: "Miscelazione", 3: "Confezionamento", 7: "Astucciatura" };
const labels = { MIGRATE: "Attiva nuova pianificazione", RECALCULATE: "Applica revisione del piano", CONFIRM_PLAN: "Conferma piano", RELEASE_ODL: "Genera ODL", ROLLBACK: "Ripristina ultima revisione" };
export default function PlanningLifecycle({ release = false }) {
  const { session, hasModuleAccess } = useAuth();
  return <PlanningLifecycleForm key={`${session?.access_token}:${release}`} token={session?.access_token} release={release} canUseAI={hasModuleAccess("assistente_ai")} />;
}
export function PlanningLifecycleForm({ token, release = false, canUseAI = false }) {
  const [params] = useSearchParams();
  const [state, setState] = useState(null), [version, setVersion] = useState(null), [proposal, setProposal] = useState(null);
  const [kind, setKind] = useState(release ? "RELEASE_ODL" : "RECALCULATE");
  const [startAt, setStartAt] = useState(localDate), [reason, setReason] = useState("");
  const [query, setQuery] = useState(""), [selected, setSelected] = useState([]), [choices, setChoices] = useState({});
  const [horizons, setHorizons] = useState({ confirmationDays: 60, reviewDays: 30, releaseDays: 7 });
  const [backup, setBackup] = useState(false), [ack, setAck] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const busyRef = useRef(false), results = useRef(null);
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
  async function refresh() { const next = await request("planning_state"); setState(next); return next; }
  useEffect(() => {
    let cancelled = false;
    request("planning_state").then(next => {
      if (cancelled) return;
      setState(next); setHorizons(next.configuration);
      if (!next.configuration.active && !release) setKind("MIGRATE");
    }).catch(e => { if (!cancelled) setError(e.message); });
    if (params.get("version")) request("planning_get", { id: params.get("version") }).then(v => { if (!cancelled) setVersion(v); }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
    // Requests are scoped to this mounted authentication session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  const filtered = (state?.demands || []).filter(row => [...Object.values(row), stageLabels[row.stage]].join(" ").toLocaleLowerCase("it-IT").includes(query.toLocaleLowerCase("it-IT")));
  const input = () => ({ kind, startAt, reason, confirmationDays: Number(horizons.confirmationDays), reviewDays: Number(horizons.reviewDays), releaseDays: Number(horizons.releaseDays),
    orderIds: selected.length ? selected : null, manualChoices: Object.entries(["MIGRATE", "RECALCULATE"].includes(kind) ? choices : {}).filter(([, c]) => c.notBefore).map(([id, c]) => ({ orderId: Number(id), notBefore: c.notBefore, resourceId: c.resourceId ? Number(c.resourceId) : null })) });
  async function simulate() { invalidate(); const next = await request("planning_simulate", { input: input() }); setVersion(next); results.current?.focus(); }
  async function confirm() {
    const result = await request("planning_propose", { input: { targetId: version.id, expectedHash: version.expectedHash, backupVerified: backup } });
    setProposal(result.controlledAction || result.action || result);
  }
  async function decide() {
    const id = proposal.proposalId || proposal.id;
    if (!id) throw new Error("Identificativo proposta mancante: ricaricare senza ripetere il rilascio.");
    await request("controlled_decide", { proposalId: id, decision: "confirm" });
    setProposal(null); setAck(false);
    setVersion(await request("planning_get", { id: version.id })); await refresh();
  }
  const status = !state ? "Stato da verificare" : state.configuration?.active ? "Nuovo sistema attivo" : "Sistema attuale conservato";
  return <div className="planning-lifecycle" data-screen-code={release ? "produzione.rilascio_odl" : "produzione.versioni_piano"} aria-busy={busy}>
    <section className="plan-intro"><CalendarClock aria-hidden="true" /><div><h2>{release ? "Dalla capacità alla produzione" : "Pianificare senza perdere lo storico"}</h2><p>{release ? "Gli ODL rilasciano le fasi degli OP: materiali e lotti vengono verificati prima dell'avvio. Nessun avvio produzione automatico." : "Previsione RdP → conferma piano → rilascio ODL. Ogni modifica resta confrontabile con la versione precedente."}</p></div></section>
    <nav className="plan-actions" aria-label="Pianificazione"><Link to={release ? "/versioni-piano-produzione" : "/rilascio-odl"}>{release ? "Versioni e revisioni del piano" : "Rilascio ODL"}</Link><Link to="/produzione/rdp-workbench">Workbench RdP</Link><Link to="/revisione-priorita-produzione">Revisione priorità</Link><button disabled={busy} onClick={() => run(refresh)}><RefreshCw size={16} />Aggiorna stato</button><button disabled={busy || !state?.configuration?.active} onClick={() => run(async () => { await request("planning_reconcile"); await refresh(); })}>Allinea stato Workspace</button>{canUseAI && <button disabled={busy} onClick={() => window.dispatchEvent(new CustomEvent("workspace:priority-ai", { detail: { prompt: `Aiutami nella ${release ? "preparazione del rilascio ODL" : "revisione del piano"}. Leggi MES_PLAN_STATE e prepara una simulazione con MES_PLAN_SIMULATE. Spiega le conseguenze e attendi la conferma: nessuna attivazione, creazione lotti o avvio autonomo.` } }))}><Bot size={16} />Supporto IA</button>}</nav>
    {error && <div className="plan-notice plan-error" role="alert">{error}</div>}
    <div className="plan-kpis"><section><span>Modalità</span><strong>{status}</strong></section><section><span>Previsioni senza OP</span><strong>{state?.demands?.filter(x => x.stage === "FORECAST").length ?? "—"}</strong></section><section><span>ODL rilasciati</span><strong>{state?.odls?.filter(x => x.status === "RELEASED").length ?? "—"}</strong></section></div>
    <section className="plan-panel"><h2>{release ? "Prepara il rilascio" : "Prepara una versione"}</h2>
      {!state?.configuration?.active && <p className="plan-notice">La pubblicazione del codice non cambia il piano. L'attivazione richiede anteprima, verifica del backup e conferma esplicita. Storico, lotti già assegnati e documenti restano conservati.</p>}
      <fieldset disabled={busy}><legend>Parametri del calcolo</legend><div className="plan-fields">
        <label>Operazione<select value={kind} onChange={e => { setKind(e.target.value); invalidate(); }}>{!state?.configuration?.active && !release ? <option value="MIGRATE">Migrazione dal piano attuale</option> : release ? <option value="RELEASE_ODL">Genera ODL</option> : <><option value="RECALCULATE">Rivedi piano e fattibilità</option><option value="CONFIRM_PLAN">Conferma piano / genera OP</option><option value="ROLLBACK">Ripristina ultima revisione, se ancora reversibile</option></>}</select></label>
        <label>Data di riferimento · ora italiana<input type="datetime-local" value={startAt} onChange={e => { setStartAt(e.target.value); invalidate(); }} /></label>
        {[['confirmationDays', 'Conferma OP · giorni'], ['reviewDays', 'Revisione · giorni'], ['releaseDays', 'Rilascio · giorni']].map(([key, name]) => <label key={key}>{name}<input type="number" min="1" max="365" value={horizons[key] ?? ""} onChange={e => { setHorizons({ ...horizons, [key]: e.target.value }); invalidate(); }} /></label>)}
      </div><label className="plan-reason">Motivazione<textarea maxLength={1000} value={reason} onChange={e => { setReason(e.target.value); invalidate(); }} /></label></fieldset>
      <button className="plan-primary" disabled={busy || !reason.trim() || !state || (release && !state.configuration.active)} onClick={() => run(simulate)}>{busy ? "Elaborazione…" : "Calcola anteprima senza applicare"}</button>
    </section>
    <section className="plan-panel"><h2>Domande e ordini · {filtered.length}</h2><label>Ricerca totale<input type="search" placeholder="RdP, OP, stato, articolo…" value={query} onChange={e => setQuery(e.target.value)} /></label><p>Se non selezioni righe, la proposta considera l'intero orizzonte. Le modifiche manuali sono proposte, non spostamenti già applicati.</p>
      <div className="plan-table-wrap" tabIndex={0} role="region" aria-label="Domande e scelte manuali"><table><thead><tr><th>Selezione</th><th>RdP / OP</th><th>Fase</th><th>Richiesta originale</th><th>Stima</th><th>Confermata</th>{!release && <><th>Non prima di</th><th>Impianto preferito</th></>}</tr></thead><tbody>{filtered.map(row => {
        const id = row.productionOrderId ?? -row.id; return <tr key={row.id}><td><input aria-label={`Seleziona ${row.number}`} type="checkbox" disabled={busy || ["HISTORICAL", "CANCELLED"].includes(row.stage)} checked={selected.includes(id)} onChange={e => { setSelected(e.target.checked ? [...selected, id] : selected.filter(x => x !== id)); invalidate(); }} /></td><td><strong>{row.number}</strong>{row.octReference && <><br />OCT: {row.octReference}</>}<br />{row.articleCode} · {row.description}<br />{row.quantity} · {row.customer || "Cliente non associato"}</td><td>{stageLabels[row.stage] || row.stage}</td><td>{planningDate(row.requestedAt)}</td><td>{planningDate(row.estimatedAt)}</td><td>{planningDate(row.confirmedDeliveryAt, "Non confermata")}</td>{!release && <><td><input aria-label={`Avvio minimo ${row.number}`} type="datetime-local" disabled={busy || !["MIGRATE", "RECALCULATE"].includes(kind) || ["HISTORICAL", "CANCELLED"].includes(row.stage)} value={choices[id]?.notBefore || ""} onChange={e => { setChoices({ ...choices, [id]: { ...choices[id], notBefore: e.target.value } }); invalidate(); }} /></td><td><select aria-label={`Impianto ${row.number}`} disabled={busy || !["MIGRATE", "RECALCULATE"].includes(kind) || ["HISTORICAL", "CANCELLED"].includes(row.stage)} value={choices[id]?.resourceId || ""} onChange={e => { setChoices({ ...choices, [id]: { ...choices[id], resourceId: e.target.value } }); invalidate(); }}><option value="">Scelta automatica compatibile</option>{state?.resources?.map(resource => <option key={resource.id} value={resource.id}>{resource.code} · {resource.description}</option>)}</select></td></>}</tr>;
      })}{!filtered.length && <tr><td colSpan={release ? 6 : 8}>{state?.configuration?.active ? "Nessuna domanda corrispondente." : "Le lavorazioni pregresse saranno mostrate nell'anteprima di migrazione, senza modificarle."}</td></tr>}</tbody></table></div>
    </section>
    {version && <section className="plan-panel" ref={results} tabIndex={-1}><h2>Anteprima e confronto</h2><PlanningVersionSummary version={version} query={query} />
      {version.status === "PROPOSED" && <div className="plan-approval"><button disabled={busy} onClick={() => run(async () => { const previousInput = version.snapshot.input; invalidate(); setVersion(await request("planning_simulate", { input: { ...previousInput, startAt: previousInput.startAt < localDate() ? localDate() : previousInput.startAt } })); })}>Ricalcola proposta con i dati correnti</button>{version.kind === "MIGRATE" && <label><input type="checkbox" checked={backup} disabled={busy} onChange={e => { setBackup(e.target.checked); setProposal(null); }} />Ho verificato un backup ripristinabile del database MES e dei documenti.</label>}<label><input type="checkbox" disabled={busy} checked={ack} onChange={e => setAck(e.target.checked)} />Ho verificato lavorazioni protette, date proposte, copertura e avvisi.</label><button className="plan-primary" disabled={busy || version.actor?.startsWith("system:") || !ack || !!version.snapshot.blocks?.length || (version.kind === "MIGRATE" && !backup)} onClick={() => run(confirm)}><ShieldCheck size={16} />Prepara conferma: {labels[version.kind]}</button></div>}
      {proposal && <div className="plan-notice"><p>Conferma finale: <strong>{labels[version.kind] || "Verifica ODL"}</strong>. L'operazione sarà registrata nell'audit.</p><button className="plan-primary" disabled={busy} onClick={() => run(decide)}><Check size={16} />Conferma applicazione</button><button disabled={busy} onClick={() => setProposal(null)}>Non applicare</button></div>}
      {version.status === "APPLIED" && <p className="plan-notice" role="status">Versione applicata. Nessun avvio produzione automatico.</p>}
      {["PREPARING", "RECONCILIATION_REQUIRED"].includes(version.status) && <div className="plan-notice"><p>Rilascio non completato. Verificare i lotti esistenti in Mexal e riallinearli prima di continuare. Non ripetere la creazione dei lotti.</p><button disabled={busy} onClick={() => run(async () => { const p = await request("planning_verify", { input: { targetId: version.id, expectedHash: version.expectedHash } }); setProposal(p.controlledAction || p.action || p); })}>Verifica lotti riconciliati, senza generarli</button></div>}
    </section>}
    <section className="plan-panel"><h2>{release ? "Registro ODL" : "Storico delle versioni"}</h2><div className="plan-table-wrap"><table><thead><tr><th>Riferimento</th><th>Stato</th><th>Data</th><th>Informazioni</th><th>Dettaglio</th></tr></thead><tbody>{(release ? state?.odls : state?.versions)?.map(row => <tr key={row.id}><td>{release ? `ODL ${row.id} · OP ${row.productionOrderId} · batch ${row.batch} · ${phaseLabels[row.phase] || row.phase}` : row.kind}</td><td>{planningStatuses[row.status] || row.status}</td><td>{planningDate(row.createdAtUtc)}</td><td>{row.error || row.reason || row.actor}</td><td><button disabled={busy} onClick={() => run(async () => { setVersion(await request("planning_get", { id: row.versionId || row.id })); setProposal(null); setAck(false); })}>Apri</button></td></tr>)}</tbody></table></div></section>
  </div>;
}
