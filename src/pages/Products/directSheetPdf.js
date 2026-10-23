import { TEMPLATE_FIELDS, fieldLabel, generationContent, sheetValues, templateBoxText, photoSourceRect } from '../../../shared/directProductSheet.js';

import { SHEET_EXPORT_DPI, jpegWithDpi } from '../../../shared/directSheetResolution.js';

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
  if (!url) return null;
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Foto prodotto non disponibile per il PDF.');
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) throw new Error('La foto prodotto non è un’immagine valida.');
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas'), ratio = Math.min(1, 5000 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.round(bitmap.width * ratio); canvas.height = Math.round(bitmap.height * ratio);
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', .98);
  } finally { bitmap.close(); }
}
export async function buildDirectSheetPdf({ layout, values, loadPhoto = photoData, pdfDocument, logo }) {
  const { jsPDF } = await import('jspdf');
  const first = layout.pages[0], doc = pdfDocument || new jsPDF({ unit: 'pt', format: [first.width, first.height], orientation: first.width > first.height ? 'landscape' : 'portrait' });
  doc.setProperties({ title: `Scheda tecnica ${values.code} - ${values.name}`, subject: 'Scheda tecnica prodotto' });
  const overflow = [], missing = [];
  const hasPhotoBox = layout.boxes.some(b => b.field === 'photo');
  const photo = hasPhotoBox ? await loadPhoto(values.photo) : null;
  for (const [index, page] of layout.pages.entries()) {
    if (index || pdfDocument) doc.addPage([page.width, page.height], page.width > page.height ? 'landscape' : 'portrait');
    if (page.background) doc.addImage(page.background, 'JPEG', 0, 0, page.width, page.height);
    if(page.logoMask){const r=page.logoMask;doc.setFillColor(255,255,255);doc.rect(page.width*r.x/100,page.height*r.y/100,page.width*r.width/100,page.height*r.height/100,'F');}
  if(page.logo && logo){const r=page.logo,x=page.width*r.x/100,y=page.height*r.y/100,w=page.width*r.width/100,h=page.height*r.height/100;doc.setFillColor(255,255,255);doc.rect(x,y,w,h,'F');const props=doc.getImageProperties(logo.previewDataUrl),ratio=Math.min(w/props.width,h/props.height);doc.addImage(logo.previewDataUrl,'PNG',x+(w-props.width*ratio)/2,y+(h-props.height*ratio)/2,props.width*ratio,props.height*ratio);}
    for (const box of layout.boxes.filter(b => b.page === page.id)) {
      const x = page.width * box.x / 100 + 4, y = page.height * box.y / 100 + 4;
      const width = page.width * box.width / 100 - 8, height = page.height * box.height / 100 - 8;
      if (box.field === 'photo') {
        if (photo) {
          const cropped = box.crop ? await croppedPhoto(photo, box.crop) : photo;
          const props = doc.getImageProperties(cropped), scale = Math.min(width / props.width, height / props.height);
          doc.addImage(cropped, 'JPEG', x + (width - props.width * scale) / 2, y + (height - props.height * scale) / 2, props.width * scale, props.height * scale);
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
  const warnings = overflow.length ? [`Testo fuori casella: ${[...new Set(overflow)].join(', ')}. La generazione prosegue.`] : [];
  return { doc, missing: [...new Set(missing)], warnings };
}
function imageElement(data) {
  return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('Immagine del template non valida.')); img.src = data; });
}
async function croppedPhoto(data, crop) {
  const img = await imageElement(data), rect = photoSourceRect(img.width, img.height, crop), canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(rect[2])); canvas.height = Math.max(1, Math.round(rect[3]));
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, ...rect, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', .98);
}
export async function renderSheetJpeg({ layout, values, photo, scale = SHEET_EXPORT_DPI / 72, logo, onWarning = () => {} }) {
  if (layout.pages.length !== 1) throw new Error('Il template deve contenere una sola pagina per lingua.');
  const { jsPDF } = await import('jspdf'), measureDoc = new jsPDF({ unit: 'pt' });
  const page = layout.pages[0], canvas = document.createElement('canvas');
  canvas.width = Math.round(page.width * scale); canvas.height = Math.round(page.height * scale);
  const ctx = canvas.getContext('2d'); ctx.scale(scale, scale); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, page.width, page.height);
  if (page.background) ctx.drawImage(await imageElement(page.background), 0, 0, page.width, page.height);
  if(page.logoMask){const r=page.logoMask;ctx.fillStyle='#fff';ctx.fillRect(page.width*r.x/100,page.height*r.y/100,page.width*r.width/100,page.height*r.height/100);}
  if(page.logo && logo){const img=await imageElement(logo.previewDataUrl),r=page.logo,x=page.width*r.x/100,y=page.height*r.y/100,w=page.width*r.width/100,h=page.height*r.height/100,ratio=Math.min(w/img.width,h/img.height);ctx.fillStyle='#fff';ctx.fillRect(x,y,w,h);ctx.drawImage(img,x+(w-img.width*ratio)/2,y+(h-img.height*ratio)/2,img.width*ratio,img.height*ratio);}
  const photoImage = photo ? await imageElement(photo) : null, overflow = [];
  for (const box of layout.boxes) {
    const x = page.width * box.x / 100 + 4, y = page.height * box.y / 100 + 4;
    const width = page.width * box.width / 100 - 8, height = page.height * box.height / 100 - 8;
    if (box.field === 'photo') {
      if (photoImage) { const rect = photoSourceRect(photoImage.width, photoImage.height, box.crop), ratio = Math.min(width / rect[2], height / rect[3]); ctx.drawImage(photoImage, ...rect, x + (width - rect[2] * ratio) / 2, y + (height - rect[3] * ratio) / 2, rect[2] * ratio, rect[3] * ratio); }
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
  if (overflow.length) onWarning(`${values.__language || 'IT'}: testo fuori casella (${[...new Set(overflow)].join(', ')}). La generazione prosegue.`);
  return canvas.toDataURL('image/jpeg', .98);
}
export async function generateSheetFiles({ layout, product, sheet, translations, languages, format, loadPhoto = photoData, onProgress = () => {}, loadLogo = async () => null }) {
  if (layout.pages.length !== 1) throw new Error('Il template deve contenere una sola pagina per lingua.');
  if (!languages.length || new Set(languages).size !== languages.length) throw new Error('Seleziona almeno una lingua, senza duplicati.');
  if (!['jpeg', 'pdf'].includes(format)) throw new Error('Formato file non valido.');
  const values = sheetValues(product), code = String(values.code).trim().toUpperCase();
  if (!/^(IT|MKT)[A-Z0-9_-]+$/.test(code)) throw new Error('Il codice articolo contiene caratteri non consentiti nel nome file.');
  const contents = languages.map(language => ({ language, content: generationContent(sheet, translations, language, product) }));
  onProgress('Caricamento foto prodotto…');
  const photo = layout.boxes.some(b => b.field === 'photo') ? await loadPhoto(values.photo) : null;
  const logo = layout.pages.some(page=>page.logo) ? await loadLogo() : null;
  const pages = []; let pdfDocument;
  for (const [index, { language, content }] of contents.entries()) {
    onProgress(`Generazione ${language} · ${index + 1}/${contents.length}…`);
    await new Promise(resolve => setTimeout(resolve, 0));
    const warnings = [];
    if (format === 'pdf') {
      const result = await buildDirectSheetPdf({ layout, values: { ...values, ...content, __language: language }, loadPhoto: async () => photo, pdfDocument, logo });
      pdfDocument = result.doc;
      warnings.push(...result.warnings.map(message => language + ': ' + message));
      pages.push({ language, warnings });
    } else pages.push({ language, warnings, data: await renderSheetJpeg({ layout, values: { ...values, ...content, __language: language }, photo, logo, onWarning: message => warnings.push(message) }) });
  }
  onProgress('Preparazione file…');
  if (format === 'jpeg') return Promise.all(pages.map(async page => ({ name: `${code}_${page.language}.jpeg`, languages: [page.language], warnings: page.warnings, blob: new Blob([jpegWithDpi(await (await fetch(page.data)).arrayBuffer())], { type: 'image/jpeg' }) })));
  pdfDocument.setProperties({ title: `${code} - Scheda tecnica - ${languages.join(', ')}` });
  let blob=pdfDocument.output('blob');
  if(logo && layout.pages[0].logo){
    const {PDFDocument,rgb}=await import('pdf-lib'),output=await PDFDocument.load(await blob.arrayBuffer()),[embedded]=await output.embedPdf(logo.pdfBytes,[0]),r=layout.pages[0].logo;
    for(const page of output.getPages()){const size=page.getSize(),x=size.width*r.x/100,w=size.width*r.width/100,h=size.height*r.height/100,y=size.height*(1-r.y/100)-h,ratio=Math.min(w/embedded.width,h/embedded.height);page.drawRectangle({x,y,width:w,height:h,color:rgb(1,1,1)});page.drawPage(embedded,{x:x+(w-embedded.width*ratio)/2,y:y+(h-embedded.height*ratio)/2,width:embedded.width*ratio,height:embedded.height*ratio});}
    blob=new Blob([await output.save()],{type:'application/pdf'});
  }
  return [{ name: code + '.pdf', languages, warnings: pages.flatMap(item => item.warnings), blob }];
}
export async function jpegBackground(file) {
  if (file.type !== 'image/jpeg' || file.size > 10 * 1024 * 1024) throw new Error('Carica un JPEG di massimo 10 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    if (Math.max(bitmap.width, bitmap.height) <= 5000 && file.size * 4 / 3 + 64 <= 3000000) {
      const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Lettura JPEG non riuscita.')); reader.readAsDataURL(file); });
      return { data, landscape: bitmap.width > bitmap.height };
    }
    const canvas = document.createElement('canvas'), ratio = Math.min(1, 5000 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.round(bitmap.width * ratio); canvas.height = Math.round(bitmap.height * ratio);
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/jpeg', .98);
    if (data.length > 3000000) throw new Error('JPEG troppo grande: riduci la risoluzione del file.');
    return { data, landscape: bitmap.width > bitmap.height };
  } finally { bitmap.close(); }
}
