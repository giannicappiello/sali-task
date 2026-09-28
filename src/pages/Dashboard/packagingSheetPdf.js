import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { displayDate } from '../../lib/displayDate.js';

const number = value => Number(value || 0).toLocaleString('it-IT', { maximumFractionDigits: 3 });

// Use the original sheet data, including the selected batch's quantities and lot.
export function packagingSheetPdf(sheet) {
  const doc = new jsPDF();
  const blue = [23, 65, 116];
  let y = 16;
  doc.setProperties({ title: `Foglio confezionamento ${sheet.numeroOrdine} - ${sheet.codiceProdottoFinito}` });
  function text(value, { bold = false, size = 10 } = {}) {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(String(value ?? ''), 178);
    const height = lines.length * size * 0.42;
    if (y + height > 278) { doc.addPage(); y = 16; }
    doc.text(lines, 16, y);
    y += height + 2;
  }
  function section(title, body, head) {
    if (y > 248) { doc.addPage(); y = 16; }
    y += 3;
    doc.setTextColor(...blue);
    text(title, { bold: true, size: 11 });
    doc.setTextColor(23, 43, 73);
    autoTable(doc, {
      startY: y, margin: { left: 16, right: 16, top: 16, bottom: 18 },
      head: head ? [head] : undefined, body,
      theme: 'grid', rowPageBreak: 'avoid',
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 2, textColor: [23, 43, 73], lineColor: [219, 229, 242], lineWidth: 0.2 },
      headStyles: { fillColor: [240, 245, 252], textColor: blue, fontStyle: 'bold' },
    });
    y = doc.lastAutoTable.finalY + 5;
  }
  doc.setTextColor(...blue);
  text('PROGRÉ · Foglio di confezionamento', { bold: true, size: 17 });
  text(sheet.numeroOrdine, { bold: true, size: 12 });
  doc.setTextColor(23, 43, 73);
  text(`Cliente: ${sheet.cliente || ''}`);
  text(`Generato: ${displayDate(sheet.generatoIl, true)} · Stampato: ${displayDate(sheet.stampatoIl, true)}`, { size: 9 });
  section(`${sheet.codiceProdottoFinito} · ${sheet.descrizioneProdottoFinito}`, [
    [`Da confezionare: ${number(sheet.quantitaDaConfezionare)} PZ`, `Lotto: ${sheet.lottoProduzione || 'Da assegnare da Mexal (CL)'}`],
    ['Scadenza: __________________', 'Responsabile qualità: __________________'],
  ]);
  for (const warning of sheet.avvisi || []) text(warning);
  for (const [label, rows] of [['Semilavorato', sheet.semilavorati], ['Packaging', sheet.packaging]]) {
    section(label, (rows || []).map(row => [row.codice, row.descrizione, row.unitaMisura,
      number(row.quantitaRichiesta), number(row.quantitaDisponibile), sheet.magazziniOperativi]),
    ['Codice', 'Descrizione', 'UM', 'Quantità', 'Disponibile', 'Magazzini']);
  }
  section('Riempimento', [[`Volume: ${number(sheet.volumeMl)} ml`, `Densità: ${number(sheet.densita)}`, `Peso unitario: ${number(sheet.pesoUnitarioGr)} g`]]);
  section('Confezionamento e imballo', [
    [`Pezzi per collo: ${sheet.pezziPerCollo > 0 ? number(sheet.pezziPerCollo) : '________________'}`, 'Cartoni per strato: ________________'],
    ['Strati per pallet: ________________', 'Pezzi per pallet: ________________'],
    ['Numero pallet: ________________', 'Totale pezzi: ________________'],
  ]);
  section('Note e conferma operativa', [
    ['Note operatore: ________________________________________________________'],
    ['Operatore confezionamento / firma: _______________________________________'],
    ['Responsabile qualità / firma: ____________________________________________'],
  ]);
  return doc.output('blob');
}
