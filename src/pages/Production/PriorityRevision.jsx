import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowRight, Bot, CalendarClock, Check, Search } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import PriorityRevisionSummary from "../../components/PriorityRevisionSummary";
import { suggestMaterialDisengagements } from "./priority-material-suggestions";
import "./priority-revision.css";

const number = new Intl.NumberFormat("it-IT", { useGrouping: 'always',  maximumFractionDigits: 6 });
const initialDate = () => { const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset()); return now.toISOString().slice(0, 16); };
export function ProductionDependencies({ dependencies = [] }) {
  if (!dependencies.length) return null;
  return <section className="priority-notice" aria-label="Semilavorati da produrre">
    <h3>Semilavorati da produrre internamente</h3>
    <p>Miscelazione → disponibilità del semilavorato → confezionamento. Questi articoli non richiedono disimpegni da altre lavorazioni: occorre coprire le loro materie prime.</p>
    {dependencies.map(d => <p key={d.articleCode}><strong>{d.articleCode} · {number.format(d.required)} {d.unit}</strong><br />{d.description}</p>)}
    <p className="priority-help">Quantità previste dalla distinta confermata. Le scorte di semilavorato non riducono automaticamente quantità e materie prime della ricetta.</p>
  </section>;
}
export default function PriorityRevision({ compact = false, initialSearch }) {
  const { session } = useAuth();
  return <PriorityRevisionForm key={session?.access_token} token={session?.access_token} compact={compact} initialSearch={initialSearch} />;
}
export function PriorityRevisionForm({ token, compact = false, initialSearch }) {
  const [routeParams] = useSearchParams();
  const params = initialSearch === undefined ? routeParams : new URLSearchParams(initialSearch);
  const [query, setQuery] = useState(params.get("order") || "");
  const [orders, setOrders] = useState([]);
  const [selected, setSelected] = useState(null);
  const [materials, setMaterials] = useState([]);
  const [materialNote, setMaterialNote] = useState("");
  const [dependencies, setDependencies] = useState([]);
  const [planningBlock, setPlanningBlock] = useState("");
  const [releaseSupported, setReleaseSupported] = useState(false);
  const [quantities, setQuantities] = useState({});
  const [startAt, setStartAt] = useState(initialDate);
  const [reason, setReason] = useState("");
  const [revision, setRevision] = useState(null);
  const [proposal, setProposal] = useState(null);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const lock = useRef(false);
  const resultRef = useRef(null);
  const latestId = params.get("revision");
  const invalidate = () => { setRevision(null); setProposal(null); setAcknowledged(false); setMessage(""); };
  async function request(action, extra = {}) {
    const response = await fetch("/api/ai/assistant", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
    const data = await response.json();
    if (!response.ok || data.success === false) throw new Error(data.error || data.message || "Operazione non riuscita.");
    return data;
  }
  async function run(fn) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { await fn(); } catch (e) { setError(e.message); } finally { lock.current = false; setBusy(false); }
  }
  useEffect(() => {
    if (!latestId) return;
    let active = true;
    fetch("/api/ai/assistant", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "priority_status", id: latestId }) })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Revisione non disponibile"); return data; })
      .then(data => { if (active) setRevision(data); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [latestId, token]);
  function choose(order) { return run(async () => {
    invalidate(); setSelected(null); setMaterials([]); setQuantities({}); setDependencies([]); setPlanningBlock(""); setMaterialNote(""); setReleaseSupported(false);
    const data = await request("priority_materials", { orderNumber: order.orderNumber });
    setSelected(order); setMaterials(data.materials); setMaterialNote(data.note || ""); setReleaseSupported(data.reservationReleaseVersion >= 2 && data.bulkRoutingVersion >= 1);
    setDependencies(data.productionDependencies || []); setPlanningBlock(data.planningBlock || "");
    setQuantities(suggestMaterialDisengagements(data.materials, startAt));
  }); }
  function simulate() { return run(async () => {
    invalidate();
    const input = { orderNumber: selected.orderNumber, startAt, reason, materials: materials.map(m => ({ articleCode: m.articleCode,
      transfers: m.donors.map(d => ({ sourceOrderId: d.orderId, quantity: Number(quantities[`${m.articleCode}:${d.orderId}`] || 0) })).filter(x => x.quantity > 0) })) };
    const data = await request("priority_simulate", { input });
    setRevision(data); resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }); }
  function confirm() { return run(async () => {
    let pending = proposal;
    if (!pending) {
      const data = await request("priority_propose", { input: { targetId: revision.id, expectedHash: revision.expectedHash } });
      pending = data.controlledAction; setProposal(pending);
    }
    // User has explicitly reviewed and accepted this simulation; both paths use the same controlled action.
    const result = await request("controlled_decide", { proposalId: pending.id, decision: "confirm" });
    setMessage(result.answer); setProposal(null); setAcknowledged(false);
    const state = await request("priority_status", { id: revision.id }); setRevision(state);
  }); }
  return <div className="priority-page" data-screen-code="produzione.revisione_priorita" aria-busy={busy}>
    <section className="priority-intro">{!compact && <><CalendarClock size={26} aria-hidden="true" /><div><h2>Cambia priorità con una revisione coordinata</h2><p>Seleziona la lavorazione, scegli i materiali da recuperare e verifica le conseguenze prima di confermare. Nessun avvio automatico.</p></div></>}<button type="button" className="secondary-action" disabled={busy} onClick={() => run(async () => setHistory((await request("priority_history")).revisions))}>Storico revisioni</button></section>
    {error ? <div role="alert" className="priority-error">{error}</div> : null}
    {message ? <p role="status" className="priority-notice">{message}</p> : null}
    <fieldset disabled={busy || Boolean(proposal)} className="priority-section"><legend><span>1</span> Lavorazione da anticipare</legend>
      <form className="priority-search" onSubmit={e => { e.preventDefault(); run(async () => { invalidate(); setSelected(null); setMaterials([]); setOrders((await request("priority_lookup", { query })).orders); }); }}>
        <label>Cerca RdP, OP, OCT o prodotto<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Es. RDP160 o FPCOM55" /></label><button type="submit" className="primary-action" disabled={query.trim().length < 2}><Search size={17} /> Cerca lavorazione</button>
      </form>
      {orders.length ? <div className="priority-table priority-order-list" role="region" aria-label="Lavorazioni trovate" tabIndex={0}><table><thead><tr><th>OP / OCT</th><th>Prodotto / cliente</th><th>Quantità</th><th>Selezione</th></tr></thead><tbody>{orders.map(o => <tr key={o.orderId} aria-selected={selected?.orderId === o.orderId}><td><strong>{o.orderNumber}</strong><small>{o.oct}</small></td><td>{o.product}<small>{o.customer}</small></td><td>{number.format(o.quantity)}</td><td><button type="button" className="secondary-action" onClick={() => choose(o)}>{selected?.orderId === o.orderId ? "Selezionata" : "Seleziona"}</button></td></tr>)}</tbody></table></div> : null}
      {selected ? <div className="priority-selected"><Check size={19} /><strong>{selected.orderNumber} · {selected.product}</strong><small>Identificativo MES: {selected.orderId}</small></div> : <p className="priority-help">Seleziona l’OP preciso: una RdP può contenere più lavorazioni con suffissi diversi. Gli OCT non ancora confermati devono prima generare gli OP dal Workbench.</p>}
    </fieldset>
    {selected ? <fieldset disabled={busy || Boolean(proposal)} className="priority-section"><legend><span>2</span> Materiali e nuova priorità</legend>
      <div className="priority-fields"><label>Avvio desiderato (orario MES)<input type="datetime-local" value={startAt} onChange={e => { invalidate(); setStartAt(e.target.value); setQuantities(suggestMaterialDisengagements(materials, e.target.value)); }} /></label><label className="priority-reason">Motivazione<textarea maxLength={1000} value={reason} onChange={e => { invalidate(); setReason(e.target.value); }} placeholder="Perché anticipare questa lavorazione?" /></label></div>
      <p className="priority-notice">Proposta automatica: prima le lavorazioni non avviate con data più lontana. Puoi modificare le quantità; nessun disimpegno viene applicato prima della conferma.</p>
      <button type="button" className="secondary-action" onClick={() => window.dispatchEvent(new CustomEvent("workspace:priority-ai", { detail: { prompt: `Voglio anticipare ${selected.orderNumber} (OP MES ${selected.orderId}) dal ${startAt}. Leggi materiali e origini disponibili e proponi una revisione che limiti i ritardi sulle consegne. Motivo: ${reason || "da definire"}. Simula le conseguenze, senza applicare trasferimenti prima della mia conferma.` } }))}><Bot size={17} /> Proponi con IA</button>
      {!releaseSupported ? <p role="alert" className="priority-error">Aggiornare MES per abilitare la revisione con distinzione tra semilavorati da produrre e materiali da magazzino. Nessuna revisione verrà applicata con il vecchio motore.</p> : null}
      {planningBlock ? <p role="alert" className="priority-error">{planningBlock}</p> : null}
      <ProductionDependencies dependencies={dependencies} />
      <p className="priority-help">Disimpegna le quantità dalle origini selezionate. Alla destinazione viene assegnato solo il necessario: il resto riduce l’eccedenza o torna libero. Anche una destinazione già coperta può richiedere disimpegni.</p>
      {materialNote ? <p className="priority-help">{materialNote}</p> : null}
      {materials.map(m => {
        const total = m.donors.reduce((sum, d) => sum + Number(quantities[`${m.articleCode}:${d.orderId}`] || 0), 0);
        const minimum = m.minimumRelease ?? m.missing;
        return <details className="priority-material" key={m.articleCode} open={minimum > 0}>
          <summary><strong>{m.articleCode}</strong><span>Minimo da disimpegnare: {number.format(minimum)} {m.unit}</span><span>Selezionato: {number.format(total)} {m.unit}</span></summary>
          <p>Fabbisogno {number.format(m.required)} · Già riservato alla destinazione {number.format(m.reserved)} {m.unit}</p>
          <p>Fisico utilizzabile {number.format(m.physical)} · Prenotazioni totali {number.format(m.totalReserved ?? m.reserved + m.donors.reduce((s, d) => s + d.reserved, 0))} · Libero {number.format(m.free)} {m.unit}</p>
          {m.overbooked > 0 ? <p className="priority-notice"><strong>Eccedenza prenotazioni: {number.format(m.overbooked)} {m.unit}.</strong> È possibile risolverla disimpegnando le altre lavorazioni; la giacenza fisica non sarà modificata.</p> : null}
          {minimum > total ? <p className="priority-warning">Ancora da selezionare: {number.format(minimum - total)} {m.unit}</p> : <p className="priority-help">Selezione pronta per la verifica del motore MES.</p>}
          {!m.eligible ? <p className="priority-error">{m.blockReason}</p> : null}
          <div className="priority-table"><table><thead><tr><th>Origine</th><th>Riservato</th><th>Da disimpegnare ({m.unit})</th><th>Residuo / scoperto fisico</th><th>Vincoli</th></tr></thead><tbody>{m.donors.map(d => <tr key={d.orderId}><td><strong>{d.orderNumber}</strong><small>{d.product}</small></td><td>{number.format(d.reserved)}</td><td><input aria-label={`${m.articleCode} da ${d.orderNumber}`} type="number" min="0" max={d.reserved} step="0.000001" value={quantities[`${m.articleCode}:${d.orderId}`] || ""} disabled={!releaseSupported || !m.eligible || !d.eligible} onChange={e => { invalidate(); setQuantities(values => ({ ...values, [`${m.articleCode}:${d.orderId}`]: e.target.value })); }} /></td><td>{number.format(d.reserved - Number(quantities[`${m.articleCode}:${d.orderId}`] || 0))}<small>Scoperto: {number.format(Math.max(0, d.required - d.reserved + Number(quantities[`${m.articleCode}:${d.orderId}`] || 0)))} {m.unit}</small></td><td>{d.blockReason || "Non avviata"}</td></tr>)}</tbody></table></div>
          {!m.donors.length ? <p>Nessuna origine disponibile per il trasferimento.</p> : null}
        </details>;
      })}
      <button type="button" className="primary-action" onClick={simulate} disabled={!releaseSupported || Boolean(planningBlock) || !reason.trim() || !startAt || materials.some(m => !m.eligible)}><ArrowRight size={17} /> Simula revisione</button>
    </fieldset> : null}
    <section className="priority-section" ref={resultRef}><h2><span className="priority-step">3</span> Conseguenze e conferma</h2>
      {revision ? <><PriorityRevisionSummary revision={revision} />
        {proposal ? <button type="button" className="secondary-action" disabled={busy} onClick={() => run(async () => { setRevision(await request("priority_status", { id: revision.id })); setProposal(null); setAcknowledged(false); })}>Verifica esito prima di riprovare</button> : null}
        {revision.status === "PROPOSED" ? <div className="priority-confirm"><label><input type="checkbox" checked={acknowledged} disabled={busy || revision.confirmable === false} onChange={e => setAcknowledged(e.target.checked)} /> Ho verificato materiali sottratti, scoperti e nuove date delle lavorazioni coinvolte.</label><p>La conferma aggiorna gli impegni e il planning MES e riallinea i fabbisogni Workspace. Non genera nuovi OP né avvia produzioni.</p><button type="button" className="primary-action" disabled={busy || !acknowledged || revision.confirmable === false} onClick={confirm}>Conferma riallocazione e ripianifica</button></div> : <button type="button" className="secondary-action" disabled={busy} onClick={() => run(async () => setRevision(await request("priority_status", { id: revision.id })))}>Verifica esito / completa allineamento</button>}
      </> : <p className="priority-help">La simulazione mostrerà qui il confronto prima/dopo, i fabbisogni e le lavorazioni da ripianificare.</p>}
    </section>
    {history.length ? <section className="priority-section"><h2>Le tue revisioni recenti</h2><p>Apri una revisione per verificarne l’esito tra Workspace e MES.</p><div className="priority-table"><table><thead><tr><th>Revisione</th><th>Lavorazione</th><th>Stato MES</th><th>Dettaglio</th></tr></thead><tbody>{history.map(h => <tr key={h.id}><td>{h.number}</td><td>{h.snapshot.input.orderNumber}</td><td>{h.status === "MES_APPLIED" ? "Applicata in MES" : "Da confermare"}</td><td><button type="button" className="secondary-action" disabled={busy} onClick={() => run(async () => { setRevision(await request("priority_status", { id: h.id })); setAcknowledged(false); setProposal(null); })}>Apri revisione</button></td></tr>)}</tbody></table></div></section> : null}
    {busy ? <div className="priority-progress" role="status">Verifica Workspace–MES in corso… Non ripetere la conferma.</div> : null}
  </div>;
}
