import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { calculateOrderEconomics } from "./orderEconomics.js";

function money(value) {
  return Number(value || 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

function formatDate(value) {
  return value ? new Intl.DateTimeFormat("it-IT").format(new Date(`${value}T00:00:00`)) : "-";
}

function vatSummary(lines) {
  return lines.reduce((summary, line) => {
    const rate = Number(line.aliquota_iva || 0);
    const item = summary.get(rate) || { imponibile: 0, iva: 0 };
    item.imponibile += Number(line.imponibile_riga || 0);
    item.iva += Number(line.iva_riga || 0);
    summary.set(rate, item);
    return summary;
  }, new Map());
}

export function buildOrderPdfModel(order, lines) {
  const economics = calculateOrderEconomics(lines);
  return {
    lines: economics.righe,
    totals: economics,
    vat: [...vatSummary(economics.righe).entries()],
    documents: [order.numero_ocm, order.numero_ocx, order.numero_oci].filter(Boolean),
  };
}

async function getCompanyLogo() {
  try {
    const response = await fetch("/pwa-512x512.png");
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

export async function createOrderPdf(order, lines, { logo = null } = {}) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const model = buildOrderPdfModel(order, lines);
  const companyLogo = logo === null ? await getCompanyLogo() : logo;
  if (companyLogo) doc.addImage(companyLogo, "PNG", 14, 10, 18, 18);
  doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.text("PROGRE’ SRL", 36, 17);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.text("CONFERMA ORDINE", 36, 22);
  doc.setDrawColor(15, 23, 42); doc.line(14, 31, 196, 31);
  doc.setFontSize(9);
  doc.text(`Cliente: ${order.ragione_sociale_cliente || "-"}`, 14, 39);
  doc.text(`Codice cliente: ${order.codice_cliente || "-"}`, 14, 44);
  doc.text(`Destinazione: ${order.indirizzo_spedizione || "-"}`, 14, 49, { maxWidth: 100 });
  doc.text(`Documento: Ordine  ${model.documents.join(" · ") || "-"}`, 120, 39);
  doc.text(`Numero: ${order.numero_ordine || order.id}`, 120, 44);
  doc.text(`Data: ${formatDate(order.data_ordine)}`, 120, 49);
  doc.text(`Pagamento: ${order.descrizione_pagamento || order.codice_pagamento || "-"}`, 120, 54);
  doc.text(`Agente: ${order.codice_agente_mexal || "-"}`, 120, 59);

  autoTable(doc, {
    startY: 66,
    margin: { left: 10, right: 10, bottom: 28 },
    head: [["Codice", "EAN", "Descrizione", "U.M.", "Q.tà", "Listino", "Importo", "Sconto", "IVA"]],
    body: model.lines.map((line) => [
      line.codice_articolo || "-",
      line.ean || "-",
      line.descrizione || "-",
      line.unita_misura || "-",
      Number(line.quantita || 0).toLocaleString("it-IT"),
      money(line.prezzo_listino),
      money(line.imponibile_riga),
      line.sconto_commerciale || "-",
      `${line.aliquota_iva || 0}%`,
    ]),
    styles: { fontSize: 7, cellPadding: 1.6 },
    headStyles: { fillColor: [15, 23, 42] },
    columnStyles: { 0: { cellWidth: 18 }, 1: { cellWidth: 17 }, 2: { cellWidth: 51 }, 3: { cellWidth: 10 }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" }, 7: { cellWidth: 19 }, 8: { halign: "right" } },
    didDrawPage: () => { doc.setFontSize(7); doc.text(`PROGRE’ SRL · Ordine ${order.numero_ordine || order.id}`, 10, 290); },
  });

  let endY = doc.lastAutoTable?.finalY || 80;
  if (endY > 235) { doc.addPage(); endY = 24; }
  doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.text("Riepilogo IVA", 14, endY + 10);
  doc.setFont("helvetica", "normal");
  model.vat.forEach(([rate, values], index) => doc.text(`IVA ${rate}% · Imponibile ${money(values.imponibile)} · IVA ${money(values.iva)}`, 14, endY + 16 + index * 5));
  const totalsY = endY + 18 + model.vat.length * 5;
  doc.setFont("helvetica", "bold");
  [["Totale merce", model.totals.totale_imponibile], ["Totale imponibile", model.totals.totale_imponibile], ["Totale IVA", model.totals.totale_iva], ["Totale documento", model.totals.totale_documento], ["Totale da pagare", model.totals.totale_documento]].forEach(([label, value], index) => doc.text(`${label}: ${money(value)}`, 120, totalsY + index * 6));
  doc.setFont("helvetica", "normal"); doc.setFontSize(8);
  doc.text(`Note: ${order.commenti || "-"}`, 14, totalsY + 34, { maxWidth: 95 });
  doc.text("Trasporto: a cura del vettore / come da accordi", 14, totalsY + 45);
  doc.line(14, totalsY + 65, 88, totalsY + 65); doc.line(115, totalsY + 65, 190, totalsY + 65);
  doc.text("Firma cliente", 38, totalsY + 70); doc.text("Firma PROGRE’ SRL", 138, totalsY + 70);

  return doc;
}

export async function downloadOrderPdf(order, lines) {
  const doc = await createOrderPdf(order, lines);
  doc.save(`ordine-${order.numero_ordine || order.id}.pdf`);
}
