import { useState } from "react";
import MaterialTransferSummary from "../../components/MaterialTransferSummary";
import "./material-reallocation.css";

export default function MaterialReallocationPanel({ accessToken }) {
  const [orderNumber, setOrder] = useState("");
  const [articleCode, setArticle] = useState("");
  const [preview, setPreview] = useState(null);
  const [quantities, setQuantities] = useState({});
  const [reason, setReason] = useState("");
  const [proposal, setProposal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const invalidate = () => { setPreview(null); setProposal(null); setQuantities({}); setMessage(""); };
  async function request(action, extra = {}) {
    const response = await fetch("/api/ai/assistant", {
      method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || result.message || "Operazione non disponibile.");
    return result;
  }
  async function run(operation) {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try { await operation(); } catch (e) { setError(e.message); setProposal(null); }
    finally { setBusy(false); }
  }
  function lookup() {
    return run(async () => {
      invalidate();
      const result = await request("material_allocation_preview", { orderNumber, articleCode });
      setPreview(result.preview);
    });
  }
  const transfers = Object.entries(quantities).map(([id, value]) => ({ sourceOrderId: Number(id), quantity: Number(value) })).filter(row => row.quantity > 0);
  const total = transfers.reduce((sum, row) => sum + row.quantity, 0);
  function propose() {
    return run(async () => {
      const result = await request("material_allocation_propose", { input: {
        orderNumber: preview.orderNumber, articleCode: preview.articleCode, targetId: String(preview.orderId),
        expectedHash: preview.hash, reason, transfers,
      } });
      setProposal(result.controlledAction);
    });
  }
  function decide(decision) {
    return run(async () => {
      const result = await request("controlled_decide", { proposalId: proposal.id, decision });
      setMessage(result.controlledAction?.result?.message || result.answer);
      setProposal(null); setPreview(null); setQuantities({});
    });
  }
  return <details className="material-reallocation">
    <summary>Priorità produzione · Rialloca materie prime impegnate</summary>
    <p>Libera materiale da ordini pianificati a favore di una RdP. Non modifica il fisico e non preleva da lavorazioni avviate. Sono richiesti i permessi operativi MES e di proposta/conferma.</p>
    <fieldset disabled={busy || Boolean(proposal)}>
      <div className="material-reallocation-fields">
        <label>RdP destinazione (numero completo)<input value={orderNumber} onChange={e => { invalidate(); setOrder(e.target.value); }} placeholder="Es. RDP160-03" /></label>
        <label>Materia prima<input value={articleCode} onChange={e => { invalidate(); setArticle(e.target.value); }} placeholder="Es. MP2323" /></label>
        <button type="button" className="secondary-action" onClick={lookup} disabled={!orderNumber.trim() || !articleCode.trim()}>Verifica impegni MES</button>
      </div>
      {preview ? <div>
        <p><strong>{preview.orderNumber} · {preview.product} · {preview.articleCode}</strong></p>
        <p>Fabbisogno: {preview.required} {preview.unit} · Fisico: {preview.physical} · Libero: {preview.free} · Già riservato: {preview.reserved} · Da recuperare: <strong>{preview.missing}</strong></p>
        {!preview.eligible ? <p role="alert">{preview.blockReason}</p> : null}
        <div className="material-reallocation-table"><table><thead><tr><th>Ordine origine</th><th>Riservato</th><th>Da trasferire</th><th>Riserva residua</th><th>Vincoli</th></tr></thead><tbody>
          {preview.donors.map(donor => <tr key={donor.orderId}>
            <td><strong>{donor.orderNumber}</strong><br />{donor.product}</td><td>{donor.reserved} {preview.unit}</td>
            <td><input aria-label={`Quantità da ${donor.orderNumber}`} type="number" min="0" max={donor.reserved} step="0.000001" value={quantities[donor.orderId] || ""} disabled={!donor.eligible || !preview.eligible} onChange={e => setQuantities(current => ({ ...current, [donor.orderId]: e.target.value }))} /></td>
            <td>{donor.reserved - Number(quantities[donor.orderId] || 0)}</td><td>{donor.blockReason || "Pianificato, non avviato"}</td>
          </tr>)}
        </tbody></table></div>
        {!preview.donors.length ? <p>Nessuna prenotazione da trasferire.</p> : null}
        <label>Motivazione<textarea value={reason} maxLength={1000} onChange={e => setReason(e.target.value)} /></label>
        <p>Totale selezionato: {total} {preview.unit}. Le origini perderanno questa disponibilità.</p>
        <button type="button" className="primary-action" disabled={!preview.eligible || !total || total > preview.missing + 1e-9 || !reason.trim()} onClick={propose}>Prepara trasferimento da confermare</button>
      </div> : null}
    </fieldset>
    {proposal ? <section aria-label="Conferma riallocazione">
      <MaterialTransferSummary evidence={proposal.preview?.evidence} />
      <p>Motivo: {proposal.preview?.reason}</p>
      {proposal.state === "proposed" ? <div className="material-reallocation-fields">
        <button type="button" className="secondary-action" disabled={busy} onClick={() => decide("reject")}>Annulla proposta</button>
        <button type="button" className="primary-action" disabled={busy} onClick={() => decide("confirm")}>Conferma disimpegno e trasferimento</button>
      </div> : <p>Stato proposta: {proposal.state}. Ricaricare la verifica prima di una nuova operazione.<button type="button" onClick={() => setProposal(null)}>Torna alla verifica</button></p>}
    </section> : null}
    {busy ? <p role="status">Verifica / applicazione in corso…</p> : null}
    {message ? <p role="status">{message}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </details>;
}
