import { createOrderPdf } from "./orderPdf.js";

const safe = (value) => String(value ?? "").trim().replace(/[^a-zA-Z0-9_-]+/g, "-");

export async function createPfPreviewPdfFiles(documents = []) {
  return Promise.all(documents.map(async (document, index) => {
    const month = String(document.month || "").slice(0, 7);
    const order = {
      party_kind: "supplier",
      codice_cliente: document.supplierCode || document.supplierId,
      ragione_sociale_cliente: document.supplierName,
      partita_iva: document.supplierVatNumber,
      codice_fiscale: document.supplierTaxCode,
      indirizzo_fatturazione: document.supplierAddress,
      cap: document.supplierPostalCode,
      comune: document.supplierCity,
      provincia: document.supplierProvince,
      telefono: document.supplierPhone,
      data_ordine: new Date().toISOString().slice(0, 10),
      numero_ordine_visualizzato: `PF 1/ANTEPRIMA ${index + 1}`,
      causale_trasporto: "Proposta fornitore",
      commenti: `ANTEPRIMA NON EMESSA - consegne ${month} - prezzi e IVA valorizzati da Mexal`,
      valuta: "EUR",
    };
    const lines = (document.lines || []).map((line) => ({
      codice_articolo: line.articleCode,
      descrizione: line.description,
      unita_misura: line.unitOfMeasure,
      quantita: line.quantity,
      prezzo_listino: 0,
      aliquota_iva: 0,
      data_consegna: line.requiredAt,
    }));
    const pdf = await createOrderPdf(order, lines, { document: { type: "PF", serie: 1, numero: "ANTEPRIMA" } });
    return { name: `anteprima-PF-${safe(document.supplierCode || document.supplierId)}-${safe(month)}.pdf`,
      data: pdf.output("arraybuffer") };
  }));
}
