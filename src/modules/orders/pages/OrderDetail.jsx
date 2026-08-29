import { useEffect, useState } from "react";
import { ArrowLeft, Download, Edit3, OctagonX, RefreshCw, Send, Trash2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../../lib/supabaseClient";
import { useAuth } from "../../../contexts/AuthContext";
import useBackNavigation from "../../../hooks/useBackNavigation";
import { useOrdersModule } from "../ordersModuleContext";
import { deleteOrder, downloadOrderPdf, enqueueOrderConfirmationEmail, loadOrderDetail, recoverOrderSync, stopOrderSync, submitOrderToMexal, updateOrder } from "../services/orderFulfillment";
import { getOrderDisplayStatus, hasMexalDocuments } from "../services/orderDisplayStatus";
import { quantitiesForOrderLine } from "../services/availability";
import { buildWritableOrderPayload } from "../services/orderPayload";
import useOrdersAccess from "./useOrdersAccess";
import { isPrivateOrderModule, orderModuleDefinition, orderModuleFilter } from "../services/orderModules";

function money(value) {
  return Number(value || 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

function childStatusClass(document) {
  if (document.stato_operativo === "EVASO") return "evaso";
  if (document.stato_operativo === "APERTO") return "inviato-mexal";
  return "errore";
}

export default function OrderDetail() {
  const { moduleCode, basePath } = useOrdersModule();
  const { isAdminUser } = useAuth();
  const { canWriteOrders } = useOrdersAccess(moduleCode);
  const { orderId } = useParams();
  const privateOrder = isPrivateOrderModule(moduleCode);
  const navigate = useNavigate();
  const goBack = useBackNavigation(`${basePath}/elenco`);
  const [order, setOrder] = useState(null);
  const [lines, setLines] = useState([]);
  const [agentName, setAgentName] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [mexalSendingEnabled, setMexalSendingEnabled] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    setOrder(null);
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

      const sendingEnabled = configResult.data?.invia_automaticamente_mexal !== false;
      let loadedOrder = result.order;
      const hasConfirmedQuantities = (result.lines || []).some((line) => privateOrder
        ? Number(line.quantita || 0) > 0
        : Number(line.quantita_ocm || 0) > 0 || Number(line.quantita_ocx || 0) > 0 || Number(line.quantita_oci || 0) > 0);

      const isDraft = String(loadedOrder.stato || "").trim().toLowerCase() === "bozza";
      if (canWriteOrders && !privateOrder && !isDraft && !sendingEnabled && hasConfirmedQuantities && loadedOrder.stato_sincronizzazione !== "completato") {
        const moduleFilter = orderModuleFilter(moduleCode);
        const { data: closedOrder, error: closeError } = await supabase
          .from("ordini_testate")
          .update({
            stato_sincronizzazione: "completato",
            errore_sincronizzazione: null,
          })
          .eq("id", orderId)
          .or(moduleFilter)
          .select("*")
          .single();
        if (closeError) throw closeError;
        loadedOrder = { ...loadedOrder, ...closedOrder };
      }

      setOrder(loadedOrder);
      setLines(result.lines);
      setAgentName(loadedOrder.agente_nome || "-");
      setMexalSendingEnabled(sendingEnabled);
    } catch (loadError) {
      console.error("Errore caricamento dettaglio ordine:", loadError);
      setError(loadError.message || "Errore caricamento ordine.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [orderId, moduleCode, canWriteOrders]);

  async function sendToMexal() {
    setSending(true);
    setError("");
    setMessage("");
    try {
      const result = await submitOrderToMexal(orderId, moduleCode);
      setMessage(result.skipped ? result.message : privateOrder
        ? `OCT inviato a Mexal: ${result.numero_oct || "-"}`
        : `Ordine inviato a Mexal. OCM: ${result.numero_ocm || "-"} · OCX: ${result.numero_ocx || "-"} · OCI: ${result.numero_oci || "-"}`);
      if (!result.skipped) {
        await load();
      }
    } catch (sendError) {
      setError(sendError.message || "Invio a Mexal non riuscito.");
    } finally {
      setSending(false);
    }
  }

  async function confirmDraft() {
    if (confirming || !isDraft) return;
    if (!await window.workspaceConfirm(`Confermare e inviare questo ${privateOrder ? "OCT" : "ordine PH"} senza modificarlo?`)) return;
    setConfirming(true);
    setError("");
    setMessage("");
    try {
      const reservation = order.tipo_ordine === "prenotazione";
      const confirmedLines = lines.map((line) => ({
        ordine_id: orderId,
        codice_articolo: line.codice_articolo,
        descrizione: line.descrizione,
        quantita: line.quantita,
        ...(privateOrder
          ? { quantita_disponibile: 0, quantita_ocm: 0, quantita_ocx: 0, quantita_oci: 0 }
          : quantitiesForOrderLine(line, null, true, { reservation, skipAvailability: true })),
        prezzo_listino: line.prezzo_listino,
        codice_iva_mexal: line.codice_iva_mexal || null,
        aliquota_iva: line.aliquota_iva,
        imponibile_riga: line.imponibile_riga,
        iva_riga: line.iva_riga,
        sconto_percentuale: line.sconto_percentuale,
        sconto_commerciale: line.sconto_commerciale || null,
        sconto_pagamento: line.sconto_pagamento || null,
        origine_prezzo: line.origine_prezzo || null,
        origine_sconto: line.origine_sconto || null,
        regola_prezzo_id: line.regola_prezzo_id || null,
        regola_sconto_id: line.regola_sconto_id || null,
        regola_pagamento_id: line.regola_pagamento_id || null,
        dettaglio_calcolo: line.dettaglio_calcolo || {},
        prezzo_netto: line.prezzo_netto,
        totale_riga: line.totale_riga,
      }));
      await updateOrder(orderId, buildWritableOrderPayload(order), confirmedLines);
      const { error: confirmError } = await supabase.rpc("conferma_ordine_workspace", { p_ordine_id: orderId });
      if (confirmError) throw confirmError;
      try {
        await enqueueOrderConfirmationEmail(orderId, moduleCode);
      } catch (emailError) {
        console.error("Accodamento email conferma ordine non riuscito:", emailError);
      }
      const result = await submitOrderToMexal(orderId, moduleCode);
      setMessage(result.skipped
        ? result.message
        : privateOrder
          ? `OCT confermato e inviato a Mexal: ${result.numero_oct || "-"}`
          : `Ordine confermato e inviato a Mexal. OCM: ${result.numero_ocm || "-"} · OCX: ${result.numero_ocx || "-"} · OCI: ${result.numero_oci || "-"}`);
      await load();
    } catch (confirmError) {
      setError(confirmError.message || "Conferma e invio dell'ordine non riusciti.");
      await load();
    } finally {
      setConfirming(false);
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
    if (deleting || !await window.workspaceConfirm("Stai per eliminare definitivamente questo ordine e tutti i collegamenti presenti nel Workspace. L'operazione non può essere annullata. Continuare?")) return;
    setDeleting(true); setError("");
    try { await deleteOrder(orderId, moduleCode); navigate(`${basePath}/elenco`, { replace: true, state: { message: "Ordine eliminato." } }); }
    catch (deleteError) { setError(deleteError.message || "Impossibile eliminare l'ordine."); }
    finally { setDeleting(false); }
  }

  async function downloadPdf() {
    if (downloadingPdf) return;
    setDownloadingPdf(true);
    setError("");
    try { await downloadOrderPdf(order, lines); }
    catch (pdfError) { setError(pdfError.message || "Impossibile generare il PDF dell'ordine."); }
    finally { setDownloadingPdf(false); }
  }

  if (loading) return <div className="orders-empty">Caricamento ordine...</div>;
  if (!order) return <div className="orders-page"><div className="orders-alert orders-alert-error">{error || "Ordine non trovato."}</div><button className="orders-secondary" type="button" onClick={goBack}><ArrowLeft size={18} /> Torna agli ordini</button></div>;

  const syncStatus = order.stato_sincronizzazione || "non_inviato";
  const displayStatus = getOrderDisplayStatus(order);
  const isClosed = displayStatus.closed;
  const hasMexalDocument = hasMexalDocuments(order);
  const isDraft = String(order.stato || "").trim().toLowerCase() === "bozza";
  const canEdit = canWriteOrders && (isDraft || (!isClosed && !hasMexalDocument && ["non_avviato", "non_inviato", "errore", "annullato", "arrestato"].includes(syncStatus)));
  const canDelete = isAdminUser;

  return (
    <div className="orders-page">
      <div className="orders-new-header">
        <button className="orders-secondary" type="button" onClick={goBack}><ArrowLeft size={18} /> Torna agli ordini</button>
        <div><h2>Ordine {order.numero_ordine_visualizzato || order.numero_ordine || order.id}</h2><p>{order.ragione_sociale_cliente || order.codice_cliente}</p></div>
      </div>

      {error && <div className="orders-alert orders-alert-error">{error}</div>}
      {message && <div className="orders-alert orders-alert-success">{message}</div>}

      <section className="orders-panel orders-detail-summary">
        <div><span>Data</span><strong>{order.data_ordine || "-"}</strong></div>
        <div><span>Cliente</span><strong>{order.codice_cliente || "-"}</strong></div>
        <div><span>Agente</span><strong>{agentName || "-"}</strong></div>
        <div><span>Pagamento</span><strong>{order.descrizione_pagamento || order.codice_pagamento || "-"}</strong></div>
        <div><span>Stato</span><strong className={`orders-sync-badge ${displayStatus.className}`}>{displayStatus.label}</strong></div>
        <div><span>Ultimo tentativo</span><strong>{order.ultimo_tentativo_sync ? new Date(order.ultimo_tentativo_sync).toLocaleString("it-IT") : "-"}</strong></div>
        {(privateOrder ? ["OCT"] : ["OCM", "OCX", "OCI"]).map((kind) => {
          const document = order.mexal_documents?.find((item) => item.tipo_documento === kind);
          const value = document?.numero || order[`numero_${kind.toLowerCase()}`];
          return <div key={kind}><span>{kind}</span><strong>{value ? `${document?.serie || "-"}/${value}` : "-"}</strong></div>;
        })}
        <div><span>Totale imponibile</span><strong>{money(order.totale_imponibile ?? order.totale)}</strong></div>
        <div><span>Totale IVA</span><strong>{money(order.totale_iva)}</strong></div>
        <div><span>Totale documento</span><strong>{money(order.totale_documento ?? order.totale)}</strong></div>
      </section>

      {order.mexal_documents?.length > 0 && <section className="orders-panel">
        <h3>Documenti ordine Mexal</h3>
        <p>{privateOrder ? "Il documento OCT contiene tutte le righe confermate nell’ordine Private." : "Ogni documento figlio contiene esclusivamente i prodotti assegnati al proprio tipo OCM, OCX o OCI."}</p>
        <div className="orders-child-documents">
          {order.mexal_documents.map((document) => <article className="orders-child-document" key={document.id || document.tipo_documento}>
            <div className="orders-child-document-header">
              <div>
                <span>{document.modulo || orderModuleDefinition(moduleCode).mexalModule}</span>
                <h4>Ordine {document.tipo_documento}</h4>
                <p>{`${document.serie || "-"}/${document.numero || "-"}${document.anno ? ` · ${document.anno}` : ""}`}</p>
              </div>
              <div>
                <span className={`orders-status ${childStatusClass(document)}`}>{document.stato_operativo || "APERTO"}</span>
                <small>{document.ultimo_sync_mexal ? `Controllato ${new Date(document.ultimo_sync_mexal).toLocaleString("it-IT")}` : "Non ancora controllato"}</small>
              </div>
            </div>
            <div className="orders-table-wrap"><table className="orders-table">
              <thead><tr><th>Codice</th><th>Descrizione</th><th>Quantità</th><th>Prezzo</th><th>Sconto</th></tr></thead>
              <tbody>{(document.righe || []).map((line) => <tr key={line.id || `${document.tipo_documento}-${line.posizione}`}>
                <td>{line.codice_articolo || "-"}</td>
                <td>{line.descrizione || "-"}</td>
                <td>{Number(line.quantita || 0).toLocaleString("it-IT")}</td>
                <td>{money(line.prezzo)}</td>
                <td>{line.sconto || "-"}</td>
              </tr>)}</tbody>
            </table></div>
            {!document.righe?.length && <p className="orders-child-document-empty">Nessun prodotto salvato per questo documento.</p>}
          </article>)}
        </div>
      </section>}

      {order.errore_sincronizzazione && <div className="orders-alert orders-alert-error"><strong>Ultimo errore Mexal:</strong> {order.errore_sincronizzazione}</div>}

      <section className="orders-panel">
        <div className="orders-table-wrap">
          <table className="orders-table">
            <thead><tr><th>Codice</th><th>Descrizione</th><th>Q.tà</th>{!privateOrder && <><th>OCM</th><th>OCX</th><th>OCI</th></>}<th>Listino</th><th>Sconto commerciale</th><th>Netto</th><th>Imponibile</th><th>IVA</th><th>Totale</th></tr></thead>
            <tbody>{lines.map((line) => <tr key={line.id}><td>{line.codice_articolo}</td><td>{line.descrizione}</td><td>{line.quantita}</td>{!privateOrder && <><td>{line.quantita_ocm || 0}</td><td>{line.quantita_ocx || 0}</td><td>{line.quantita_oci || 0}</td></>}<td>{money(line.prezzo_listino)}</td><td>{line.sconto_commerciale || "-"}</td><td>{money(line.prezzo_netto)}</td><td>{money(line.imponibile_riga)}</td><td>{money(line.iva_riga)} ({line.aliquota_iva || 0}%)</td><td>{money(line.totale_riga)}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <div className="orders-detail-actions">
        <button className="orders-secondary orders-download-pdf-mobile" type="button" disabled={downloadingPdf} onClick={downloadPdf}><Download size={18} /> {downloadingPdf ? "Generazione PDF..." : "SCARICA PDF"}</button>
        {canEdit && <button className="orders-secondary" type="button" onClick={() => navigate(`${basePath}/modifica/${orderId}`)}><Edit3 size={18} /> MODIFICA ORDINE</button>}
        {canWriteOrders && ["ph", "private"].includes(moduleCode) && isDraft && <button className="orders-primary" type="button" disabled={confirming} onClick={confirmDraft}>{confirming ? <RefreshCw className="spin" size={18} /> : <Send size={18} />}{confirming ? "CONFERMA E INVIO..." : privateOrder ? "CONFERMA E CREA OCT" : "CONFERMA ORDINE"}</button>}
        {canDelete && <button className="orders-danger" type="button" disabled={deleting} onClick={removeOrder}><Trash2 size={18} /> {deleting ? "Eliminazione definitiva..." : "ELIMINA DEFINITIVAMENTE"}</button>}
        {canWriteOrders && syncStatus === "in_corso" && <button className="orders-danger" type="button" disabled={stopping} onClick={requestStop}><OctagonX size={18} /> {stopping ? "Richiesta..." : "ARRESTA INVIO"}</button>}
        {canWriteOrders && (privateOrder || mexalSendingEnabled) && !isClosed && !["in_corso", "arresto_richiesto", "completato"].includes(syncStatus) && !hasMexalDocument && <button className="orders-primary" type="button" disabled={sending} onClick={sendToMexal}>{sending ? <RefreshCw className="spin" size={18} /> : <Send size={18} />}{["errore", "arrestato"].includes(syncStatus) ? "RIPROVA INVIO" : privateOrder ? "CREA E INVIA OCT" : "INVIA A MEXAL"}</button>}
        {syncStatus === "arresto_richiesto" && <span className="orders-sync-inline in_corso">Arresto richiesto: attesa della POST Mexal in corso.</span>}
      </div>
    </div>
  );
}
