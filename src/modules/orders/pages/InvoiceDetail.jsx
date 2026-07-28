import { useEffect, useState } from "react";
import { ArrowLeft, LockKeyhole } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../../lib/supabaseClient";
import { useOrdersModule } from "../ordersModuleContext";

function money(value) {
  return Number(value || 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

function formatDate(value) {
  if (!value) return "-";
  const [year, month, day] = String(value).slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

export default function InvoiceDetail() {
  const { invoiceId } = useParams();
  const navigate = useNavigate();
  const { basePath } = useOrdersModule();
  const [invoice, setInvoice] = useState(null);
  const [lines, setLines] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      supabase.from("mexal_fatture_vendita").select("*").eq("id", invoiceId).single(),
      supabase.from("mexal_fatture_vendita_righe").select("*").eq("fattura_id", invoiceId).order("posizione"),
    ]).then(([header, detail]) => {
      if (header.error || detail.error) setError((header.error || detail.error).message);
      setInvoice(header.data || null);
      setLines(detail.data || []);
    });
  }, [invoiceId]);

  if (error) return <div className="orders-panel"><p className="orders-alert orders-alert-error">{error}</p></div>;
  if (!invoice) return <div className="orders-empty">Caricamento fattura...</div>;

  return <div className="orders-page">
    <button type="button" className="orders-secondary" onClick={() => navigate(`${basePath}/fatture`)}><ArrowLeft size={17} /> Torna alle fatture</button>
    <div className="orders-panel" style={{ marginTop: 16 }}>
      <div className="orders-section-heading">
        <div><h2>{`FTE ${invoice.serie}/${invoice.numero}`}</h2><p>{invoice.ragione_sociale_cliente || invoice.codice_cliente}</p></div>
        <span className="orders-status inviato-mexal"><LockKeyhole size={14} /> Sola lettura</span>
      </div>
      <div className="orders-summary-grid">
        <div><span>Data</span><strong>{formatDate(invoice.data_documento)}</strong></div>
        <div><span>Cliente</span><strong>{invoice.ragione_sociale_cliente || "-"}</strong><small>{invoice.codice_cliente}</small></div>
        <div><span>Agente</span><strong>{invoice.agente_nome || "-"}</strong><small>{invoice.codice_agente_mexal || ""}</small></div>
        <div><span>Pagamento Mexal</span><strong>{invoice.id_pagamento || "-"}</strong></div>
      </div>
      {invoice.nota && <div className="orders-alert"><strong>Nota:</strong> {invoice.nota}</div>}
      <div className="orders-table-wrap">
        <table className="orders-table">
          <thead><tr><th>Riga</th><th>Codice</th><th>Prodotto</th><th>Quantità</th><th>Prezzo</th><th>Sconto</th><th>IVA</th></tr></thead>
          <tbody>{lines.map((line) => <tr key={line.id}>
            <td>{line.posizione}</td><td>{line.codice_articolo || "-"}</td><td>{line.descrizione || "-"}</td>
            <td>{Number(line.quantita || 0).toLocaleString("it-IT")}</td><td>{money(line.prezzo_unitario)}</td>
            <td>{line.sconto || "-"}</td><td>{line.aliquota_iva == null ? "-" : `${Number(line.aliquota_iva).toLocaleString("it-IT")}%`}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="orders-totals">
        <div><span>Imponibile</span><strong>{money(invoice.totale_imponibile)}</strong></div>
        <div><span>IVA</span><strong>{money(invoice.totale_iva)}</strong></div>
        <div><span>Totale fattura</span><strong>{money(invoice.totale_documento)}</strong></div>
      </div>
    </div>
  </div>;
}
