import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { supabase } from "../../../lib/supabaseClient";
export { buildAvailabilityPreview } from "./availability";

async function getAccessToken() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session?.access_token) {
    throw new Error("Sessione scaduta. Effettua nuovamente l'accesso.");
  }
  return session.access_token;
}

async function postJson(url, body) {
  const token = await getAccessToken();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const raw = await response.text();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; }
  catch { payload = { error: raw || "Risposta API non valida." }; }

  if (!response.ok) {
    throw new Error(payload.error || `Errore API (${response.status}).`);
  }
  return payload;
}

export function submitOrderToMexal(orderId, { force = false } = {}) {
  return postJson("/api/mexal/submit-order", { orderId, force });
}

export function checkOrderAvailability(lines) {
  return postJson("/api/mexal/orders/check-availability", {
    lines: lines.map((line) => ({
      productCode: String(line.codice_articolo || "").replace(/\s+/g, ""),
      quantity: Number(line.quantita),
    })),
  });
}


export async function loadOrderDetail(orderId) {
  const [{ data: order, error: orderError }, { data: lines, error: linesError }] = await Promise.all([
    supabase.from("ordini_testate").select("*").eq("id", orderId).single(),
    supabase.from("ordini_righe").select("*").eq("ordine_id", orderId).order("id", { ascending: true }),
  ]);
  if (orderError) throw orderError;
  if (linesError) throw linesError;
  return { order, lines: lines || [] };
}

function money(value) {
  return Number(value || 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

export function downloadOrderPdf(order, lines) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.setFontSize(18);
  doc.text("PROGRE - Conferma ordine", 14, 18);
  doc.setFontSize(10);
  doc.text(`Ordine Workspace: ${order.numero_ordine || order.id}`, 14, 27);
  doc.text(`Data: ${order.data_ordine || "-"}`, 14, 33);
  doc.text(`Cliente: ${order.ragione_sociale_cliente || order.codice_cliente || "-"}`, 14, 39);
  doc.text(`Codice cliente: ${order.codice_cliente || "-"}`, 14, 45);
  doc.text(`Pagamento: ${order.descrizione_pagamento || order.codice_pagamento || "-"}`, 14, 51);
  doc.text(`Agente: ${order.codice_agente_mexal || "-"}`, 14, 57);

  autoTable(doc, {
    startY: 65,
    head: [["Codice", "Descrizione", "Q.tà", "Sconto", "Netto", "Totale", "Doc."]],
    body: lines.map((line) => [
      line.codice_articolo,
      line.descrizione,
      Number(line.quantita || 0).toLocaleString("it-IT"),
      [line.sconto_commerciale, line.sconto_pagamento].filter(Boolean).join(" + ") || "-",
      money(line.prezzo_netto),
      money(line.totale_riga),
      Number(line.quantita_ocx || 0) > 0 && Number(line.quantita_ocm || 0) > 0
        ? "OCM/OCX"
        : Number(line.quantita_ocx || 0) > 0 ? "OCX" : "OCM",
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [15, 23, 42] },
  });

  const endY = doc.lastAutoTable?.finalY || 80;
  doc.setFontSize(11);
  doc.text(`Totale imponibile: ${money(order.totale)}`, 14, endY + 10);
  if (order.commenti) {
    doc.setFontSize(9);
    doc.text("Note:", 14, endY + 19);
    doc.text(doc.splitTextToSize(order.commenti, 180), 14, endY + 25);
  }

  doc.save(`ordine-${order.numero_ordine || order.id}.pdf`);
}
