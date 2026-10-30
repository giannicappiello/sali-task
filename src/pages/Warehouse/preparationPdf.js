import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
export function preparationPdf(preparation) {
  const v = preparation.verification,
    summary = v?.summary;
  if (!summary)
    throw new Error("Esegui il riscontro prima di generare la packing list.");
  const doc = new jsPDF(),
    source = preparation.source,
    ddt = preparation.ddt;
  const title = ddt ? "PACKING LIST" : "PACKING LIST · BOZZA";
  doc.setFontSize(18);
  doc.text(title, 14, 20);
  doc.setFontSize(10);
  const header = [
    `OCM ${source.series}/${source.number} · ${source.year}`,
    `Cliente: ${source.customerName} (${source.customerCode})`,
    `Destinazione: ${[source.destination?.code, source.destination?.address, source.destination?.postalCode, source.destination?.city].filter(Boolean).join(" · ") || "Come da OCM Mexal"}`,
    ddt
      ? `DDT ${ddt.series}/${ddt.number} del ${String(ddt.date).replace(/^(\d{4})(\d{2})(\d{2})$/, "$3/$2/$1")}`
      : "DDT non ancora emesso",
    `Colli: ${summary.totalPackages} · Pezzi: ${summary.totalPieces} · Bancali: ${summary.totalPallets}`,
  ];
  const headerLines = header.flatMap((line) => doc.splitTextToSize(line, 182));
  doc.text(headerLines, 14, 29);
  let y = 29 + headerLines.length * 4.1 + 12;
  if (summary.pallets.length) {
    autoTable(doc, {
      startY: y,
      head: [["Bancale", "Numero cartoni"]],
      body: summary.pallets.map((p) => [p.number, p.cartons]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [25, 73, 109] },
    });
    y = doc.lastAutoTable.finalY + 9;
  }
  for (const p of summary.packages) {
    if (y > 245) {
      doc.addPage();
      y = 20;
    }
    doc.setFontSize(11);
    doc.text(
      `Collo ${p.number} · ${p.palletNumber ? `Bancale ${p.palletNumber}` : "Senza bancale"} · ${p.pieces} ${p.pieces === 1 ? "pezzo" : "pezzi"}`,
      14,
      y,
    );
    autoTable(doc, {
      startY: y + 4,
      head: [["Articolo", "Descrizione", "Lotto", "Pezzi"]],
      body: p.contents.map((r) => [
        r.code,
        r.description,
        r.lotCode || "Non gestito",
        r.quantity,
      ]),
      styles: { fontSize: 8.5, overflow: "linebreak" },
      columnStyles: { 1: { cellWidth: 84 } },
      headStyles: { fillColor: [25, 73, 109] },
    });
    y = doc.lastAutoTable.finalY + 12;
  }
  const count = doc.getNumberOfPages();
  for (let i = 1; i <= count; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.text(`Allestimento ${preparation.id} · Pagina ${i}/${count}`, 14, 289);
  }
  doc.save(
    `Packing-list-${source.series}-${source.number}${ddt ? "" : "-BOZZA"}.pdf`,
  );
}
