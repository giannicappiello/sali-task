import { useEffect, useState } from "react";
import { ArrowLeft, Download, RefreshCw, Send } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { downloadOrderPdf, loadOrderDetail, submitOrderToMexal } from "../services/orderFulfillment";

function money(value) {
  return Number(value || 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

export default function OrderDetail() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState(null);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const result = await loadOrderDetail(orderId);
      setOrder(result.order);
      setLines(result.lines);
    } catch (loadError) {
      setError(loadError.message || "Errore caricamento ordine.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [orderId]);

  async function sendToMexal() {
    setSending(true);
    setError("");
    setMessage("");
    try {
      const result = await submitOrderToMexal(orderId, { force: order?.stato_sincronizzazione === "errore" });
      setMessage(result.skipped ? result.message : `Ordine inviato a Mexal. OCM: ${result.numero_ocm || "-"} · OCX: ${result.numero_ocx || "-"} · OCI: ${result.numero_oci || "-"}`);
      if (!result.skipped) {
        setOrder((current) => current ? {
          ...current,
          stato: "confermato",
          stato_sincronizzazione: "completato",
          numero_ocm: result.numero_ocm || current.numero_ocm || null,
          numero_ocx: result.numero_ocx || current.numero_ocx || null,
          numero_oci: result.numero_oci || current.numero_oci || null,
          errore_sincronizzazione: null,
        } : current);
      }
    } catch (sendError) {
      setError(sendError.message || "Invio a Mexal non riuscito.");
    } finally {
      setSending(false);
    }
  }

  if (loading) return <div className="orders-empty">Caricamento ordine...</div>;
  if (!order) return <div className="orders-empty">Ordine non trovato.</div>;

  const syncStatus = order.stato_sincronizzazione || "non_inviato";

  return (
    <div className="orders-page">
      <div className="orders-new-header">
        <button className="orders-secondary" type="button" onClick={() => navigate("/ordini/elenco")}>
          <ArrowLeft size={18} /> Torna agli ordini
        </button>
        <div>
          <h2>Ordine {order.numero_ordine || order.id}</h2>
          <p>{order.ragione_sociale_cliente || order.codice_cliente}</p>
        </div>
      </div>

      {error && <div className="orders-alert orders-alert-error">{error}</div>}
      {message && <div className="orders-alert orders-alert-success">{message}</div>}

      <section className="orders-panel orders-detail-summary">
        <div><span>Data</span><strong>{order.data_ordine || "-"}</strong></div>
        <div><span>Cliente</span><strong>{order.codice_cliente || "-"}</strong></div>
        <div><span>Agente</span><strong>{order.codice_agente_mexal || "-"}</strong></div>
        <div><span>Pagamento</span><strong>{order.descrizione_pagamento || order.codice_pagamento || "-"}</strong></div>
        <div><span>Stato invio</span><strong className={`orders-sync-badge ${syncStatus}`}>{syncStatus.replaceAll("_", " ")}</strong></div>
        <div><span>OCM</span><strong>{order.numero_ocm || "-"}</strong></div>
        <div><span>OCX</span><strong>{order.numero_ocx || "-"}</strong></div>
        <div><span>OCI</span><strong>{order.numero_oci || "-"}</strong></div>
        <div><span>Totale</span><strong>{money(order.totale)}</strong></div>
      </section>

      {order.errore_sincronizzazione && (
        <div className="orders-alert orders-alert-error">
          <strong>Ultimo errore Mexal:</strong> {order.errore_sincronizzazione}
        </div>
      )}

      <section className="orders-panel">
        <div className="orders-table-wrap">
          <table className="orders-table">
            <thead><tr><th>Codice</th><th>Descrizione</th><th>Q.tà</th><th>OCM</th><th>OCX</th><th>Sconto</th><th>Netto</th><th>Totale</th></tr></thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id}>
                  <td>{line.codice_articolo}</td><td>{line.descrizione}</td><td>{line.quantita}</td>
                  <td>{line.quantita_ocm || 0}</td><td>{line.quantita_ocx || 0}</td>
                  <td>{[line.sconto_commerciale, line.sconto_pagamento].filter(Boolean).join(" + ") || "-"}</td>
                  <td>{money(line.prezzo_netto)}</td><td>{money(line.totale_riga)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="orders-detail-actions">
        <button className="orders-secondary" type="button" onClick={() => downloadOrderPdf(order, lines)}>
          <Download size={18} /> Scarica PDF
        </button>
        <button className="orders-primary" type="button" disabled={sending || syncStatus === "in_corso" || syncStatus === "completato"} onClick={sendToMexal}>
          {sending || syncStatus === "in_corso" ? <RefreshCw className="spin" size={18} /> : <Send size={18} />}
          {syncStatus === "errore" ? "Riprova invio Mexal" : syncStatus === "completato" ? "Già inviato a Mexal" : "Invia a Mexal"}
        </button>
      </div>
    </div>
  );
}
