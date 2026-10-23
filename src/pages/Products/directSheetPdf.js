import { TEMPLATE_FIELDS, fieldLabel, generationContent, sheetValues, templateBoxText } from '../../../shared/directProductSheet.js';

// The PDF and editor use the same point coordinates, font and wrapping metrics.
export function textBoxLayout(doc, box, page, values) {
  const width = page.width * box.width / 100 - 8, height = page.height * box.height / 100 - 8;
  doc.setFont(box.font, box.bold ? 'bold' : 'normal'); doc.setFontSize(box.fontSize);
  const value = templateBoxText(box, values);
  const text = value;
  const lines = doc.splitTextToSize(text, Math.max(1, width));
  const lineHeight = box.fontSize * 1.2, textHeight = lines.length * lineHeight;
  const overflow = textHeight > height + 0.01 || lines.some(line => doc.getTextWidth(line) > width + 0.1);
  return { lines, lineHeight, textHeight, overflow, width, height };
}
export async function photoData(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Foto prodotto non disponibile per il PDF.');
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) throw new Error('La foto prodotto non è un’immagine valida.');
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas'), ratio = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.round(bitmap.width * ratio); canvas.height = Math.round(bitmap.height * ratio);
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', .92);
  } finally { bitmap.close(); }
}
export async function buildDirectSheetPdf({ layout, values, loadPhoto = photoData }) {
  const { jsPDF } = await import('jspdf');
  const first = layout.pages[0], doc = new jsPDF({ unit: 'pt', format: [first.width, first.height], orientation: first.width > first.height ? 'landscape' : 'portrait' });
  doc.setProperties({ title: `Scheda tecnica ${values.code} - ${values.name}`, subject: 'Scheda tecnica prodotto' });
  const overflow = [], missing = [];
  const hasPhotoBox = layout.boxes.some(b => b.field === 'photo');
  const photo = hasPhotoBox && values.photo ? await loadPhoto(values.photo) : null;
  for (const [index, page] of layout.pages.entries()) {
    if (index) doc.addPage([page.width, page.height], page.width > page.height ? 'landscape' : 'portrait');
    if (page.background) doc.addImage(page.background, 'JPEG', 0, 0, page.width, page.height);
    for (const box of layout.boxes.filter(b => b.page === page.id)) {
      const x = page.width * box.x / 100 + 4, y = page.height * box.y / 100 + 4;
      const width = page.width * box.width / 100 - 8, height = page.height * box.height / 100 - 8;
      if (box.field === 'photo') {
        if (photo) {
          const props = doc.getImageProperties(photo), scale = Math.min(width / props.width, height / props.height);
          doc.addImage(photo, 'JPEG', x + (width - props.width * scale) / 2, y + (height - props.height * scale) / 2, props.width * scale, props.height * scale);
        } else missing.push('Foto prodotto');
        continue;
      }
      const measure = textBoxLayout(doc, box, page, values), label = TEMPLATE_FIELDS.find(f => f.key === box.field).label;
      if (measure.overflow) overflow.push(`${label} (pagina ${index + 1})`);
      if (!String(values[box.field] || '').trim()) missing.push(label);
      const offset = box.vertical === 'middle' ? Math.max(0, (height - measure.textHeight) / 2) : box.vertical === 'bottom' ? Math.max(0, height - measure.textHeight) : 0;
      doc.setTextColor(box.color);
      const tx = box.align === 'right' ? x + width : box.align === 'center' ? x + width / 2 : x;
      doc.text(measure.lines, tx, y + offset, { baseline: 'top', align: box.align, lineHeightFactor: 1.2, maxWidth: width });
    }
  }
  if (overflow.length) throw new Error(`Testo fuori casella: ${[...new Set(overflow)].join(', ')}. Amplia le caselle o riduci il carattere nel template.`);
  return { doc, missing: [...new Set(missing)] };
}
function imageElement(data) {
  return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('Immagine del template non valida.')); img.src = data; });
}
export async function renderSheetJpeg({ layout, values, photo, scale = 2 }) {
  if (layout.pages.length !== 1) throw new Error('Il template deve contenere una sola pagina per lingua.');
  const { jsPDF } = await import('jspdf'), measureDoc = new jsPDF({ unit: 'pt' });
  const page = layout.pages[0], canvas = document.createElement('canvas');
  canvas.width = Math.round(page.width * scale); canvas.height = Math.round(page.height * scale);
  const ctx = canvas.getContext('2d'); ctx.scale(scale, scale); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, page.width, page.height);
  if (page.background) ctx.drawImage(await imageElement(page.background), 0, 0, page.width, page.height);
  const photoImage = photo ? await imageElement(photo) : null, overflow = [];
  for (const box of layout.boxes) {
    const x = page.width * box.x / 100 + 4, y = page.height * box.y / 100 + 4;
    const width = page.width * box.width / 100 - 8, height = page.height * box.height / 100 - 8;
    if (box.field === 'photo') {
      if (photoImage) { const ratio = Math.min(width / photoImage.width, height / photoImage.height); ctx.drawImage(photoImage, x + (width - photoImage.width * ratio) / 2, y + (height - photoImage.height * ratio) / 2, photoImage.width * ratio, photoImage.height * ratio); }
      continue;
    }
    const measured = textBoxLayout(measureDoc, box, page, values);
    if (measured.overflow) overflow.push(fieldLabel(box.field, values.__language));
    ctx.font = `${box.bold ? 'bold ' : ''}${box.fontSize}px ${ { helvetica: 'Arial', times: '"Times New Roman"', courier: '"Courier New"' }[box.font] }`;
    ctx.fillStyle = box.color; ctx.textBaseline = 'top'; ctx.textAlign = box.align === 'justify' ? 'left' : box.align;
    const offset = box.vertical === 'middle' ? Math.max(0, (height - measured.textHeight) / 2) : box.vertical === 'bottom' ? Math.max(0, height - measured.textHeight) : 0;
    measured.lines.forEach((line, index) => {
      const yy = y + offset + index * measured.lineHeight;
      if (box.align === 'justify' && index !== measured.lines.length - 1 && line.trim().includes(' ')) {
        const words = line.trim().split(/\s+/), gap = (width - words.reduce((sum, word) => sum + ctx.measureText(word).width, 0)) / (words.length - 1);
        let xx = x; for (const word of words) { ctx.fillText(word, xx, yy); xx += ctx.measureText(word).width + gap; }
      } else ctx.fillText(line, box.align === 'right' ? x + width : box.align === 'center' ? x + width / 2 : x, yy);
    });
  }
  if (overflow.length) throw new Error(`${values.__language || 'IT'}: testo fuori casella (${overflow.join(', ')}). Modifica il template prima di generare.`);
  return canvas.toDataURL('image/jpeg', .94);
}
export async function generateSheetFiles({ layout, product, sheet, translations, languages, format, loadPhoto = photoData, onProgress = () => {} }) {
  if (!languages.length || new Set(languages).size !== languages.length) throw new Error('Seleziona almeno una lingua, senza duplicati.');
  if (!['jpeg', 'pdf'].includes(format)) throw new Error('Formato file non valido.');
  const values = sheetValues(product), code = String(values.code).trim().toUpperCase();
  if (!/^(IT|MKT)[A-Z0-9_-]+$/.test(code)) throw new Error('Il codice articolo contiene caratteri non consentiti nel nome file.');
  const contents = languages.map(language => ({ language, content: generationContent(sheet, translations, language, product) }));
  onProgress('Caricamento foto prodotto…');
  const photo = layout.boxes.some(b => b.field === 'photo') && values.photo ? await loadPhoto(values.photo) : null;
  const pages = [];
  for (const [index, { language, content }] of contents.entries()) {
    onProgress(`Generazione ${language} · ${index + 1}/${contents.length}…`);
    await new Promise(resolve => setTimeout(resolve, 0));
    pages.push({ language, data: await renderSheetJpeg({ layout, values: { ...values, ...content, __language: language }, photo }) });
  }
  onProgress('Preparazione file…');
  if (format === 'jpeg') return Promise.all(pages.map(async page => ({ name: `${code}_${page.language}.jpeg`, languages: [page.language], blob: await (await fetch(page.data)).blob() })));
  const { jsPDF } = await import('jspdf'), page = layout.pages[0];
  const doc = new jsPDF({ unit: 'pt', format: [page.width, page.height], orientation: page.width > page.height ? 'landscape' : 'portrait' });
  doc.setProperties({ title: `${code} - Scheda tecnica - ${languages.join(', ')}` });
  pages.forEach((item, index) => { if (index) doc.addPage([page.width, page.height], page.width > page.height ? 'landscape' : 'portrait'); doc.addImage(item.data, 'JPEG', 0, 0, page.width, page.height); });
  return [{ name: `${code}.pdf`, languages, blob: doc.output('blob') }];
}
export async function jpegBackground(file) {
  if (file.type !== 'image/jpeg' || file.size > 10 * 1024 * 1024) throw new Error('Carica un JPEG di massimo 10 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas'), ratio = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.round(bitmap.width * ratio); canvas.height = Math.round(bitmap.height * ratio);
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/jpeg', .88);
    if (data.length > 3000000) throw new Error('JPEG troppo grande: riduci la risoluzione del file.');
    return { data, landscape: bitmap.width > bitmap.height };
  } finally { bitmap.close(); }
}
