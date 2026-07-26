import { createMexalDocumentPdfFiles } from "../../src/modules/orders/services/orderPdf.js";

function text(value) {
  return String(value ?? "").trim();
}

export async function createOrderPdfAttachments({ order, lines, documents }) {
  const mexalDocuments = (documents || [])
    .filter((document) => text(document?.numero) && text(document?.serie))
    .map((document) => ({
      tipo_documento: text(document.tipo_documento).toUpperCase(),
      serie: text(document.serie),
      numero: text(document.numero),
    }));
  if (!mexalDocuments.length) throw new Error("Documenti Mexal non disponibili per il PDF ordine.");

  const files = await createMexalDocumentPdfFiles(
    { ...order, mexal_documents: mexalDocuments },
    lines || [],
  );
  return files.map((file) => ({
    filename: file.name,
    content: new Uint8Array(file.data),
    contentType: "application/pdf",
  }));
}

export async function loadOrderPdfEmailData({ supabase, orderId }) {
  const [
    { data: order, error: orderError },
    { data: lines, error: linesError },
    { data: documents, error: documentsError },
  ] = await Promise.all([
    supabase.from("ordini_testate").select("*").eq("id", orderId).single(),
    supabase.from("ordini_righe").select("*").eq("ordine_id", orderId).order("id"),
    supabase
      .from("ordini_documenti_mexal")
      .select("tipo_documento,serie,numero")
      .eq("ordine_id", orderId)
      .not("numero", "is", null)
      .order("tipo_documento"),
  ]);
  if (orderError) throw orderError;
  if (linesError) throw linesError;
  if (documentsError) throw documentsError;
  if (order?.stato_sincronizzazione !== "completato") {
    throw new Error("Ordine non completato in Mexal: PDF email non generabile.");
  }

  const attachments = await createOrderPdfAttachments({
    order,
    lines: lines || [],
    documents: documents || [],
  });
  return { order, attachments };
}
