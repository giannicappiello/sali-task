import { useEffect, useState } from "react";
import { ArrowLeft, Download, Edit3, OctagonX, RefreshCw, Send, Trash2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../../lib/supabaseClient";
import { useOrdersModule } from "../ordersModuleContext";
import { deleteOrder, downloadOrderPdf, loadOrderDetail, recoverOrderSync, stopOrderSync, submitOrderToMexal } from "../services/orderFulfillment";

function money(value) {
  return Number(value || 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

export default function OrderDetail() {
  const { moduleCode, basePath } = useOrdersModule();
  const { orderId } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState(null);
  const [lines, setLines] = useState([]);
  const [agentName, setAgentName] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [mexalSendingEnabled, setMexalSendingEnabled] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      await recoverOrderSync(orderId, moduleCode);
      const [result, configResult] = await Promise.all([
        loadOrderDetail(orderId, moduleCode),
        supabase
          .from("ordini_moduli_configurazione")
          .select("invia_automaticamente_mexal")
          .eq("modulo_ordini", moduleCode)
          .maybeSingle(),
      ]);
      if (configResult.error) throw configResult.error;
      setOrder(result.order);
      setLines(result.lines);
      setAgentName(result.order.agente_nome || "-");
      setMexalSendingEnabled(configResult.data?.invia_automaticamente_mexal !== false);
    } catch (loadError) {
      setError(loadError.message || "Errore caricamento ordine.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [orderId, moduleCode]);

  async function sendToMexal() {
    setSending(true);
    setError("");
    setMessage("");
    try {
      const result = await submitOrderToMexal(orderId, moduleCode);
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

  async function requestStop() {
    if (stopping) return;
    setStopping(true); setError("");
    try { setMessage((await stopOrderSync(orderId, moduleCode)).message); await load(); }
    catch (stopError) { setError(stopError.message || "Impossibile richiedere l'arresto."); }
    finally { setStopping(false); }
  }

  async function removeOrder() {
    if (deleting || !window.confirm("Stai per eliminare definitivamente questo ordine. L’operazione non può essere annullata.")) return;
    setDeleting(true); setError("");
    try { await deleteOrder(orderId, moduleCode); navigate(`${basePath}/elenco`, { replace: true, state: { message: "Ordine eliminato." } }); }
    catch (deleteError) { setError(deleteError.message || "Impossibile eliminare l'ordine."); }
    finally { setDeleting(false); }
  }

  async function downloadPdf() {
    if (downloadingPdf) return;
    setDownloadingPdf(true);
    setError("");
    try {
      await downloadOrderPdf(order, lines);
    } catch (pdfError) {
      setError(pdfError.message || "Impossibile generare il PDF dell'ordine.");
    } finally {
      setDownloadingPdf(false);
    }
  }

  if (loading) return <div className="orders-empty">Caricamento ordine...</div>;
  if (!order) return <div className="orders-empty">Ordine non trovato.</div>;

  const syncStatus = order.stato_sincronizzazione || "non_inviato";
  const hasMexalDocument = Boolean(order.numero_ocm || order.numero_ocx || order.numero_oci);
  const canEdit = !hasMexalDocument && ["non_avviato", "non_inviato", "errore", "annullato", "arrestato"].includes(syncStatus);
  const canDelete = canEdit;

  return (
    <div className="orders-page">
      <div className="orders-new-header">
        <button className="orders-secondary" type="button" onClick={() => navigate(`${basePath}/elenco`)}>
          <ArrowLeft size={18} /> Torna agli ordini
        </button>
        <div>
          <h2>Ordine {order.numero_ordine_visualizzato || order.numero_ordine || order.id}</h2>
          <p>{order.ragione_sociale_cliente || order.codice_cliente}</p>
        </div>
      </div>

      {error && <div className="orders-alert orders-alert-error">{error}</div>}
      {message && <div className="orders-alert orders-alert-success">{message}</div>}

      <section className="orders-panel orders-detail-summary">
        <div><span>Data</span><strong>{order.data_ordine || "-"}</strong></div>
        <div><span>Cliente</span><strong>{order.codice_cliente || "-"}</strong></div>
        <div><span>Agente</span><strong>{agentName || "-"}</strong></div>
        <div><span>Pagamento</span><strong>{order.descrizione_pagamento || order.codice_pagamento || "-"}</strong></div>
        <div><span>Stato invio</span><strong className={`orders-sync-badge ${syncStatus}`}>{syncStatus.replaceAll("_", " ")}</strong></div>
        <div><span>Ultimo tentativo</span><strong>{order.ultimo_tentativo_sync ? new Date(order.ultimo_tentativo_sync).toLocaleString("it-IT") : "-"}</strong></div>
        {["OCM", "OCX", "OCI"].map((kind) => {
          const document = order.mexal_documents?.find((item) => item.tipo_documento === kind);
          const value = document?.numero || order[`numero_${kind.toLowerCase()}`];
          return <div key={kind}><span>{kind}</span><strong>{value ? `${document?.serie || "-"}/${value}` : "-"}</strong></div>;
        })}
        <div><span>Totale imponibile</span><strong>{money(order.totale_imponibile ?? order.totale)}</strong></div>
        <div><span>Totale IVA</span><strong>{money(order.totale_iva)}</strong></div>
        <div><span>Totale documento</span><strong>{money(order.totale_documento ?? order.totale)}</strong></div>
      </section>

      {order.errore_sincronizzazione && (
        <div className="orders-alert orders-alert-error">
          <strong>Ultimo errore Mexal:</strong> {order.errore_sincronizzazione}
        </div>
      )}

      <section className="orders-panel">
        <div className="orders-table-wrap">
          <table className="orders-table">
            <thead><tr><th>Codice</th><th>Descrizione</th><th>Q.tà</th><th>OCM</th><th>OCX</th><th>Listino</th><th>Sconto commerciale</th><th>Netto</th><th>Imponibile</th><th>IVA</th><th>Totale</th></tr></thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id}>
                  <td>{line.codice_articolo}</td><td>{line.descrizione}</td><td>{line.quantita}</td>
                  <td>{line.quantita_ocm || 0}</td><td>{line.quantita_ocx || 0}</td>
                  <td>{money(line.prezzo_listino)}</td>
                  <td>{line.sconto_commerciale || "-"}</td>
                  <td>{money(line.prezzo_netto)}</td><td>{money(line.imponibile_riga)}</td>
                  <td>{money(line.iva_riga)} ({line.aliquota_iva || 0}%)</td><td>{money(line.totale_riga)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="orders-detail-actions">
        <button className="orders-secondary orders-download-pdf-mobile" type="button" disabled={downloadingPdf} onClick={downloadPdf}>
          <Download size={18} /> {downloadingPdf ? "Generazione PDF..." : "SCARICA PDF"}
        </button>
        {canEdit && <button className="orders-secondary" type="button" onClick={() => navigate(`${basePath}/modifica/${orderId}`)}><Edit3 size={18} /> MODIFICA ORDINE</button>}
        {canDelete && <button className="orders-danger" type="button" disabled={deleting} onClick={removeOrder}><Trash2 size={18} /> {deleting ? "Eliminazione..." : "ELIMINA ORDINE"}</button>}
        {syncStatus === "in_corso" && <button className="orders-danger" type="button" disabled={stopping} onClick={requestStop}><OctagonX size={18} /> {stopping ? "Richiesta..." : "ARRESTA INVIO"}</button>}
        {mexalSendingEnabled && !["in_corso", "arresto_richiesto", "completato"].includes(syncStatus) && !hasMexalDocument && <button className="orders-primary" type="button" disabled={sending || syncStatus === "in_corso" || syncStatus === "completato"} onClick={sendToMexal}>
          {sending || syncStatus === "in_corso" ? <RefreshCw className="spin" size={18} /> : <Send size={18} />}
          {["errore", "arrestato"].includes(syncStatus) ? "RIPROVA INVIO" : "INVIA A MEXAL"}
        </button>
        }
        {syncStatus === "arresto_richiesto" && <span className="orders-sync-inline in_corso">Arresto richiesto: attesa della POST Mexal in corso.</span>}
      </div>
    </div>
  );
}
