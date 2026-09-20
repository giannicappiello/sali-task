import { displayDate } from '../../lib/displayDate.js';
import { specificationSections, specificationComponentFields, specificationFileRequest, isSpecificationImage } from '../../../shared/productSpecification.js';
import { specificationAttachmentContent } from './specificationAttachmentContent.js';

async function imageData(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Foto non disponibile');
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  return { data: canvas.toDataURL('image/jpeg', 0.9), width: canvas.width, height: canvas.height };
}

export async function createProductSpecificationPdf({ article, specification, photoUrl, components = [], dirty, request, loadImage = imageData, logoBytes }) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF();
  if (!logoBytes) {
    const response = await fetch('/progre-logo-white.png', { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Logo Progré non disponibile. Riprova a generare il capitolato.');
    logoBytes = new Uint8Array(await response.arrayBuffer());
  }
  const logo = doc.getImageProperties(logoBytes);
  const warnings = [];
  let y = 40;
  const title = 'Capitolato prodotto';
  const status = dirty || !specification.version ? 'BOZZA - dati non salvati' : `Revisione ${specification.version}`;
  const text = value => String(value ?? '').replace(/[\u2010-\u2015]/g, '-');
  const componentLabel = code => { const component = components.find(c => c.code === code); return component?.description ? `${code} - ${component.description}` : code; };
  const fieldValue = (name, type) => {
    const value = specification.data[name];
    if (value === '__NONE__' || (!value && ({ cartonCode: 'cartonPresent', leafletCode: 'leafletPresent' }[name]) && specification.data[({ cartonCode: 'cartonPresent', leafletCode: 'leafletPresent' }[name])] === 'no')) return 'Non previsto';
    if (!value) return 'Da definire';
    if (type === 'yesno') return value === 'yes' ? 'Sì' : 'No';
    if (Object.hasOwn(specificationComponentFields, name)) return componentLabel(value);
    if (name === 'additionalComponents') return value.split('\n').map(componentLabel).join('\n');
    return value;
  };
  const room = height => { if (y + height > 276) { doc.addPage(); y = 40; } };
  const paragraph = (value, size = 10) => {
    doc.setFontSize(size); doc.setTextColor(35, 49, 70);
    for (const line of doc.splitTextToSize(text(value), 174)) { room(6); doc.text(line, 18, y); y += 6; }
  };
  async function photo(url, caption, fallback) {
    try {
      let image;
      try { image = await loadImage(url); }
      catch (cause) { if (!fallback) throw cause; image = await fallback(); }
      const scale = Math.min(174 / image.width, 70 / image.height);
      const w = image.width * scale, h = image.height * scale;
      room(h + 8); doc.addImage(image.data, 'JPEG', 18 + (174 - w) / 2, y, w, h); y += h + 5;
      paragraph(caption, 9); y += 3;
    } catch {
      warnings.push(`Immagine non inclusa: ${caption}.`);
      paragraph(`Immagine non disponibile: ${caption}`, 9);
    }
  }
  paragraph(`${article.articleCode} - ${article.description || ''}`, 15); y += 4;
  if (photoUrl) await photo(photoUrl, `Foto prodotto ${article.articleCode}`);
  async function attachments(section) {
    for (const attachment of specification.attachments.filter(a => a.section === section)) {
      const caption = attachment.caption || attachment.name;
      if (isSpecificationImage(attachment.path)) {
        try {
          const { url } = await request(...specificationFileRequest(article.articleCode, attachment));
          await photo(url, caption, async () => {
            const blob = await specificationAttachmentContent(article.articleCode, attachment, request);
            const localUrl = URL.createObjectURL(blob);
            try { return await loadImage(localUrl); }
            finally { URL.revokeObjectURL(localUrl); }
          });
        } catch { warnings.push(`Allegato non disponibile: ${attachment.name}.`); paragraph(`Allegato non disponibile: ${caption}`); }
      } else paragraph(`Allegato: ${attachment.name}${attachment.caption ? ` - ${attachment.caption}` : ''}`, 9);
    }
  }
  await attachments('product');
  for (const section of specificationSections) {
    room(24);
    doc.setFont('helvetica', 'bold'); paragraph(section.title, 12); doc.setFont('helvetica', 'normal');
    autoTable(doc, {
      startY: y, margin: { left: 18, right: 18, top: 40, bottom: 21 },
      body: section.fields.map(([name, label, type]) => [text(label), text(fieldValue(name, type))]),
      theme: 'grid', styles: { font: 'helvetica', fontSize: 9, cellPadding: 3, overflow: 'linebreak', lineColor: [215, 226, 240] },
      columnStyles: { 0: { cellWidth: 58, fillColor: [243, 247, 252], textColor: [45, 68, 98] }, 1: { cellWidth: 116 } },
    });
    y = doc.lastAutoTable.finalY + 8;
    await attachments(section.id);
  }
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page); doc.setFillColor(27, 72, 123); doc.rect(0, 0, 210, 29, 'F');
    doc.addImage(logoBytes, 'PNG', 18, 5, 45, 45 * logo.height / logo.width);
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text(title, 77, 13);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(text(`${article.articleCode} | ${status}`), 77, 22);
    doc.setTextColor(90, 106, 125); doc.setFontSize(8);
    doc.text(`Generato il ${displayDate(new Date())}`, 18, 287); doc.text(`${page} / ${pages}`, 192, 287, { align: 'right' });
  }
  doc.setProperties({ title: `${title} ${article.articleCode}`, subject: status, creator: 'Progré Workspace' });
  return { blob: doc.output('blob'), warnings, fileName: `Capitolato_${article.articleCode.replace(/[^a-z0-9_-]/gi, '_')}_${dirty || !specification.version ? 'bozza' : `rev${specification.version}`}.pdf` };
}
