import { useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Camera, FileUp, Sparkles } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../../contexts/AuthContext";
import useBackNavigation from "../../../hooks/useBackNavigation";
import { useOrdersModule } from "../ordersModuleContext";

const MAX_BYTES = 2_800_000;
const EXCEL_EXTENSIONS = new Set(["xlsx", "xls", "xlsm"]);

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Impossibile leggere il file."));
    reader.readAsDataURL(file);
  });
}

async function prepareImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const item = new Image(); item.onload = () => resolve(item); item.onerror = reject; item.src = url;
    });
    const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d", { alpha: false }).drawImage(image, 0, 0, canvas.width, canvas.height);
    let quality = 0.88;
    let blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    while (blob?.size > MAX_BYTES && quality > 0.45) {
      quality -= 0.1;
      blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    }
    if (!blob) throw new Error("Impossibile preparare la foto.");
    return { file: new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }), preview: canvas.toDataURL("image/jpeg", 0.72) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function prepareFile(file) {
  if (!file) throw new Error("Seleziona un file.");
  if (file.type.startsWith("image/")) return prepareImage(file);
  const extension = file.name.toLowerCase().split(".").pop();
  if (file.type !== "application/pdf" && !EXCEL_EXTENSIONS.has(extension)) throw new Error("Usa una foto JPG/PNG/WebP, un PDF oppure un file Excel XLSX/XLS/XLSM.");
  if (file.size > MAX_BYTES) throw new Error("Il documento supera 2,8 MB. Riducilo e riprova.");
  return { file, preview: "" };
}

export default function AIOrderImport() {
  const { session } = useAuth();
  const { moduleCode, basePath } = useOrdersModule();
  const navigate = useNavigate();
  const location = useLocation();
  const goBack = useBackNavigation(`${basePath}/elenco`);
  const [document, setDocument] = useState(null);
  const [preview, setPreview] = useState("");
  const [result, setResult] = useState(null);
  const [orderPreviews, setOrderPreviews] = useState([]);
  const [activeOrder, setActiveOrder] = useState(0);
  const [reviewStates, setReviewStates] = useState([]);
  const [workbookReport, setWorkbookReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const workspaceModuleCode = moduleCode === "ph" ? "ordini_ph" : "ordini_pr";
  const requestedOrderType = new URLSearchParams(location.search).get("tipo") === "prenotazione" ? "prenotazione" : "standard";
  const requestedOrderLabel = requestedOrderType === "prenotazione" ? "Ordine prenotazione" : "Nuovo ordine";

  async function chooseFile(file) {
    setError(""); setResult(null); setOrderPreviews([]); setReviewStates([]); setWorkbookReport(null); setActiveOrder(0);
    try {
      const prepared = await prepareFile(file);
      if (prepared.file.size > MAX_BYTES) throw new Error("La foto è ancora troppo grande. Inquadrala più da vicino e riprova.");
      setDocument(prepared.file); setPreview(prepared.preview);
    } catch (fileError) {
      setDocument(null); setPreview(""); setError(fileError.message);
    }
  }

  async function analyze() {
    if (!document || loading) return;
    setLoading(true); setError("");
    try {
      const dataUrl = await readAsDataUrl(document);
      const response = await fetch("/api/mexal/automation", {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token || ""}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ai_order_document", moduleCode: workspaceModuleCode, fileName: document.name, mediaType: document.type, fileBase64: dataUrl }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) throw new Error(payload.error || "Lettura AI non riuscita.");
      const extraction = payload.extraction;
      const previews = (extraction.orders?.length ? extraction.orders : [extraction]).map((order) => ({ ...order, usage: payload.usage }));
      const states = previews.map((order) => ({
        customerCode: order.customerMatch?.status === "matched" ? order.customerMatch.proposedId || "" : "",
        lineChoices: order.lines.map((line) => ({ code: line.productMatch?.status === "matched" ? line.productMatch.proposedId || "" : "", quantity: line.quantity })),
        orderType: order.documentType || "NON_DETERMINATO",
      }));
      setOrderPreviews(previews); setReviewStates(states); setWorkbookReport(extraction.workbook || null); setActiveOrder(0); setResult(previews[0]);
    } catch (requestError) {
      setError(requestError.message || "Lettura AI non riuscita.");
    } finally {
      setLoading(false);
    }
  }

  const reviewState = reviewStates[activeOrder] || { customerCode: "", lineChoices: [], orderType: "NON_DETERMINATO" };
  const customerCode = reviewState.customerCode;
  const lineChoices = reviewState.lineChoices;
  const orderType = reviewState.orderType;
  function updateReview(patch) {
    setReviewStates((current) => current.map((item, index) => index === activeOrder ? { ...item, ...patch } : item));
  }
  function selectOrder(index) { setActiveOrder(index); setResult(orderPreviews[index]); }

  const selectedLines = useMemo(() => (result?.lines || []).map((line, index) => ({
    productCode: lineChoices[index]?.code || "", quantity: Math.max(0, Number(lineChoices[index]?.quantity || 0)), sourceText: line.sourceText,
  })).filter((line) => line.productCode && line.quantity > 0), [result, lineChoices]);

  function openDraft() {
    const customer = result.customerCandidates?.find((item) => item.code === customerCode);
    const missing = (result.lines?.length || 0) - selectedLines.length;
    const notes = [result.notes, `Documento acquisito con AI: ${document?.name || "-"}. Tipo rilevato: ${orderType}.`, missing ? `${missing} riga/e non abbinate da verificare manualmente.` : ""].filter(Boolean).join("\n");
    const search = requestedOrderType === "prenotazione" ? "?tipo=prenotazione" : "";
    navigate(`${basePath}/nuovo${search}`, { state: { aiDraft: { customerCode: customer?.code || "", lines: selectedLines, comments: notes, detectedDocumentType: orderType } } });
  }

  return <div className="orders-page ai-order-import">
    <div className="orders-order-header">
      <button className="orders-secondary" type="button" onClick={goBack}><ArrowLeft size={17} /> Torna agli ordini</button>
      <div><h2><Sparkles size={22} /> Genera ordine con AI</h2><p>Scatta una foto o carica un documento: il sistema prepara una bozza da controllare.</p></div>
    </div>

    <section className="orders-panel ai-order-upload">
      <div className="ai-order-requested-type"><span>Tipo di ordine da generare</span><strong>{requestedOrderLabel}</strong></div>
      <div className="ai-order-upload-actions">
        <label className="orders-primary"><Camera size={19} /> Scatta foto<input hidden type="file" accept="image/*" capture="environment" onChange={(event) => void chooseFile(event.target.files?.[0])} /></label>
        <label className="orders-secondary"><FileUp size={19} /> Carica documento<input hidden type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.xlsx,.xls,.xlsm" onChange={(event) => void chooseFile(event.target.files?.[0])} /></label>
      </div>
      {document && <div className="ai-order-selected-file">{preview ? <img src={preview} alt="Anteprima documento" /> : <FileUp size={36} />}<div><strong>{document.name}</strong><span>{(document.size / 1024).toLocaleString("it-IT", { maximumFractionDigits: 0 })} KB</span></div></div>}
      <button className="orders-primary" type="button" disabled={!document || loading} onClick={analyze}>{loading ? "Lettura in corso…" : "Riconosci cliente e prodotti"}</button>
      <small>Formati: JPG, PNG, WebP, PDF, XLSX, XLS o XLSM fino a 2,8 MB. Tutti i fogli Excel utili vengono analizzati; il file non viene archiviato.</small>
    </section>

    {error && <div className="orders-alert"><AlertTriangle size={18} /> {error}</div>}

    {result && <>
      {orderPreviews.length > 1 && <section className="orders-panel ai-order-workbook-orders">
        <h3>Ordini distinti nel workbook</h3>
        <p>I fogli con cliente, numero o data ordine differenti restano separati. Controlla una preview alla volta.</p>
        <div>{orderPreviews.map((order, index) => <button type="button" className={activeOrder === index ? "orders-primary" : "orders-secondary"} key={order.previewId || index} onClick={() => selectOrder(index)}>Ordine {index + 1}{order.documentNumber ? ` · ${order.documentNumber}` : ""}</button>)}</div>
      </section>}
      {workbookReport && <section className="orders-panel ai-order-workbook-report">
        <h3>Fogli analizzati</h3>
        <div className="ai-order-sheet-grid">
          {(workbookReport.includedSheets || []).map((sheet) => <div className="status-badge success" key={`included-${sheet.sheetName}`}><strong>{sheet.sheetName}</strong><span>{sheet.lineCount} righe incluse{sheet.hidden ? " · foglio nascosto analizzato" : ""}</span></div>)}
          {(workbookReport.excludedSheets || []).map((sheet) => <div className="status-badge neutral" key={`excluded-${sheet.sheetName}`}><strong>{sheet.sheetName}</strong><span>Escluso: {sheet.reason}</span></div>)}
        </div>
      </section>}
      <section className="orders-panel ai-order-review">
        <h3>Cliente riconosciuto</h3>
        <p><strong>Letto:</strong> {result.customer.name || "Nome non leggibile"} {result.customer.vatNumber ? `· P. IVA ${result.customer.vatNumber}` : ""}</p>
        <div className={`orders-alert ai-match-status ${result.customerMatch?.status || "unmatched"}`}>
          <strong>{result.customerMatch?.status || "unmatched"}</strong>
          <span>{Math.round(Number(result.customerMatch?.confidence || 0) * 100)}% · {result.customerMatch?.reason || "Nessuna motivazione disponibile."}</span>
          {result.customerMatch?.status !== "matched" ? <small>Conferma esplicitamente uno dei candidati; non verrà creato alcun nuovo cliente.</small> : null}
        </div>
        {(result.customerMatch?.alternatives || []).length > 0 && <ul className="ai-match-alternatives">{result.customerMatch.alternatives.map((item) => <li key={item.identifier}><strong>{item.identifier} · {item.label}</strong><span>{Math.round(item.confidence * 100)}% · {item.reason}</span></li>)}</ul>}
        <select value={customerCode} onChange={(event) => updateReview({ customerCode: event.target.value })}>
          <option value="">Da selezionare manualmente nel formulario</option>
          {(result.customerCandidates || []).map((item) => <option key={item.code} value={item.code}>{item.code} · {item.name} · corrispondenza {Math.round(item.score * 100)}%</option>)}
        </select>
      </section>
      <section className="orders-panel ai-order-review">
        <h3>Prodotti e quantità</h3>
        <div className="ai-order-lines">{result.lines.map((line, index) => <div className="ai-order-line" key={`${line.sourceText}-${index}`}>
          <div><strong>{line.description || line.sourceText}</strong><span>Testo letto: {line.sourceText}</span><small>Codice: {line.productCode || "—"} · EAN: {line.ean || "—"}{line.sheetName ? ` · ${line.sheetName}, riga ${line.rowNumber}` : ""}</small></div>
          <div className={`ai-match-status ${line.productMatch?.status || "unmatched"}`}><strong>{line.productMatch?.status || "unmatched"}</strong><span>{Math.round(Number(line.productMatch?.confidence || 0) * 100)}% · {line.productMatch?.reason || "Nessun abbinamento affidabile."}</span><small>Proposto: {line.productMatch?.proposedId || "nessuno"}</small></div>
          {(line.productMatch?.alternatives || []).length > 0 && <ul className="ai-match-alternatives">{line.productMatch.alternatives.map((item) => <li key={item.identifier}><strong>{item.identifier} · {item.label}</strong><span>{Math.round(item.confidence * 100)}% · {item.reason}</span></li>)}</ul>}
          <label>Prodotto<select value={lineChoices[index]?.code || ""} onChange={(event) => updateReview({ lineChoices: lineChoices.map((item, itemIndex) => itemIndex === index ? { ...item, code: event.target.value } : item) })}>
            <option value="">Non abbinato</option>{(line.productCandidates || []).map((item) => <option key={item.code} value={item.code}>{item.code} · {item.description} · {Math.round(item.score * 100)}%</option>)}
          </select></label>
          <label>Quantità<input type="number" min="0.01" step="0.01" value={lineChoices[index]?.quantity ?? ""} onChange={(event) => updateReview({ lineChoices: lineChoices.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item) })} /></label>
        </div>)}</div>
      </section>
      <section className="orders-panel ai-order-review">
        <h3>Tipo documento rilevato</h3>
        <select value={orderType} onChange={(event) => updateReview({ orderType: event.target.value })}><option value="NON_DETERMINATO">Non determinato</option><option value="OCM">OCM</option><option value="OCX">OCX</option><option value="OCI">OCI · prenotazione</option></select>
        <p className="orders-alert">Il tipo rilevato descrive il documento acquisito. La bozza manterrà la scelta “{requestedOrderLabel}” effettuata prima del caricamento.</p>
        {(result.warnings || []).length > 0 && <ul>{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
        <button className="orders-primary" type="button" onClick={openDraft}>Apri e controlla la bozza</button>
        {result.usage ? <small>Costo di questa lettura: {Number(result.usage?.cost || 0).toLocaleString("it-IT", { style: "currency", currency: "USD", minimumFractionDigits: 4 })}</small> : <small>Import Excel deterministico: nessun costo AI.</small>}
      </section>
    </>}
  </div>;
}
