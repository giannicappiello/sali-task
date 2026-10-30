import PizZip from 'pizzip';
import { buildAssistantPdf, drawContentPageFrame } from '../../src/pages/AIAssistant/assistantPdf.js';

const NAVY = '112640', GREEN = '169158', INK = '1F2D44', PALE = 'EEF7F3';
const xml = value => [...String(value ?? '')].filter(char => char.charCodeAt(0) >= 32 || ['\n','\r','\t'].includes(char)).join('').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const date = value => new Date(value).toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export function reportFileName(report, extension) {
  const name = report.title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90) || 'report';
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(report.generatedAt));
  return `${name}-${day}.${extension}`;
}
export function reportMarkdown(report) {
  const cell = value => String(value ?? '').replaceAll('|', '/').replace(/[\r\n]+/g, ' ');
  return [`# ${report.title}`, `Esportazione completa ${report.system} · ${date(report.generatedAt)}`, ...report.blocks.map(block => block.type === 'table'
    ? `| ${(block.headers.length ? block.headers : block.rows[0]?.map((_, i) => `Colonna ${i + 1}`) || []).map(cell).join(' | ')} |\n| ${(block.headers.length ? block.headers : block.rows[0] || []).map(() => '---').join(' | ')} |\n${block.rows.map(row => `| ${row.map(cell).join(' | ')} |`).join('\n')}`
    : `${block.type === 'heading' ? '## ' : ''}${block.text}`)].join('\n\n');
}

export function buildReportPdf(report, { logoDataUrl, managedLetterhead = false } = {}) {
  if (report.visualPages?.length) return buildVisualPdf(report,{logoDataUrl,managedLetterhead});
  return buildAssistantPdf({ content: reportMarkdown(report), generatedAt: new Date(report.generatedAt), author: report.system,
    logoDataUrl, managedLetterhead, reportLabel: 'REPORT', footerLabel: `Report ${report.system} - esportazione completa` });
}

function packageBase(zip, overrides) {
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>${overrides}</Types>`);
}
function relation(id, type, target) { return `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`; }
function relations(body) { return `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`; }
const wordNs = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
function wordParagraph(text, style = 'Normal', extra = '') { return `<w:p><w:pPr><w:pStyle w:val="${style}"/>${extra}</w:pPr><w:r><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`; }
function wordLogo() {
  return '<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="2159000" cy="770000"/><wp:docPr id="1" name="Progre"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="1" name="Progre"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="logo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2159000" cy="770000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
}
export function buildReportDocx(report, logoBytes) {
  const zip = new PizZip();
  const section = '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1587" w:right="907" w:bottom="1134" w:left="907" w:header="425" w:footer="425"/>';
  const coverContent = `${wordParagraph('PROGRE', 'Brand')}${logoBytes ? wordLogo() : ''}${wordParagraph('WORKSPACE + PROGREMES / MES', 'CoverSmall')}${wordParagraph('REPORT', 'CoverSmall', '<w:spacing w:before="2000"/>')}${wordParagraph(report.title, 'CoverTitle')}${wordParagraph('Esportazione completa della schermata', 'CoverSmall')}${wordParagraph(`Data di elaborazione: ${date(report.generatedAt)}`, 'CoverSmall', '<w:spacing w:before="2400"/>')}${wordParagraph(`Preparato da: ${report.system}`, 'CoverSmall')}`;
  const cover = `<w:tbl><w:tblPr><w:tblW w:w="10092" w:type="dxa"/><w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="10092"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="13000" w:hRule="atLeast"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="10092" w:type="dxa"/><w:shd w:fill="${NAVY}"/><w:tcMar><w:top w:w="500" w:type="dxa"/><w:left w:w="500" w:type="dxa"/><w:bottom w:w="500" w:type="dxa"/><w:right w:w="500" w:type="dxa"/></w:tcMar></w:tcPr>${coverContent}</w:tc></w:tr></w:tbl><w:p><w:pPr><w:sectPr>${section}</w:sectPr></w:pPr></w:p>`;
  // Tables remain editable Word tables. Prevent individual rows splitting over pages.
  const body = report.visualPages?.length ? report.visualPages.map(wordVisualImage).join('') : report.blocks.map(block => {
    if (block.type !== 'table') return wordParagraph(block.text, block.type === 'heading' ? 'Heading1' : 'Normal');
    const count = Math.max(block.headers.length, ...block.rows.map(row => row.length), 1);
    const width = Math.floor(10092 / count);
    return `<w:tbl><w:tblPr><w:tblW w:w="10092" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${['top','left','bottom','right','insideH','insideV'].map(side => `<w:${side} w:val="single" w:sz="4" w:color="D6E1EF"/>`).join('')}</w:tblBorders></w:tblPr><w:tblGrid>${Array.from({length: count}, () => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${[...(block.headers.length ? [{ cells: block.headers, header: true }] : []), ...block.rows.map(cells => ({cells}))].map((row, i) => `<w:tr><w:trPr><w:cantSplit/>${row.header ? '<w:tblHeader/>' : ''}</w:trPr>${row.cells.map(cell => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:shd w:fill="${row.header ? NAVY : i % 2 ? PALE : 'FFFFFF'}"/><w:tcMar><w:top w:w="80" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tcMar></w:tcPr>${wordParagraph(cell, row.header ? 'TableHeader' : 'TableText')}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>${wordParagraph('')}`;
  }).join('');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${wordNs}><w:body>${cover}${body}<w:sectPr><w:headerReference w:type="default" r:id="header"/><w:footerReference w:type="default" r:id="footer"/>${section}<w:pgNumType w:start="1"/></w:sectPr></w:body></w:document>`);
  const styles = [['Normal', INK, 20], ['Brand', 'FFFFFF', 52], ['CoverTitle', 'FFFFFF', 48], ['CoverSmall', 'FFFFFF', 22], ['Heading1', NAVY, 26], ['TableHeader', 'FFFFFF', 17], ['TableText', INK, 17]];
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8"?><w:styles ${wordNs}>${styles.map(([name, color, size]) => `<w:style w:type="paragraph" w:styleId="${name}"><w:name w:val="${name}"/><w:pPr><w:spacing w:after="100"/>${name.startsWith('Cover') || name === 'Brand' ? `<w:shd w:fill="${NAVY}"/>` : ''}${name === 'Heading1' ? '<w:keepNext/>' : ''}</w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:color w:val="${color}"/><w:sz w:val="${size}"/>${['Brand','CoverTitle','Heading1','TableHeader'].includes(name) ? '<w:b/>' : ''}</w:rPr></w:style>`).join('')}</w:styles>`);
  zip.file('word/header.xml', `<?xml version="1.0" encoding="UTF-8"?><w:hdr ${wordNs}>${wordParagraph('PROGRE     |     WORKSPACE + PROGREMES / MES', 'TableHeader', `<w:shd w:fill="${NAVY}"/>`)}</w:hdr>`);
  zip.file('word/footer.xml', `<?xml version="1.0" encoding="UTF-8"?><w:ftr ${wordNs}>${wordParagraph(`Report ${report.system} - esportazione completa`, 'TableText')}<w:p><w:r><w:t>Pagina </w:t></w:r><w:fldSimple w:instr="PAGE"/><w:r><w:t> di </w:t></w:r><w:fldSimple w:instr="SECTIONPAGES"/></w:p></w:ftr>`);
  zip.file('_rels/.rels', relations(relation('document', 'officeDocument', 'word/document.xml')));
  zip.file('word/_rels/document.xml.rels', relations(relation('styles','styles','styles.xml') + relation('header','header','header.xml') + relation('footer','footer','footer.xml') + (logoBytes ? relation('logo','image','media/progre.png') : '')));
  if (logoBytes) zip.file('word/media/progre.png', logoBytes);
  if (report.visualPages?.length) {
    report.visualPages.forEach((page,i)=>zip.file('word/media/screen'+i+'.png',page.dataUrl.split(',')[1],{base64:true}));
    zip.file('word/_rels/document.xml.rels',zip.file('word/_rels/document.xml.rels').asText().replace('</Relationships>',report.visualPages.map((_,i)=>relation('screen'+i,'image','media/screen'+i+'.png')).join('')+'</Relationships>'));
  }
  packageBase(zip, [['document','document.main'],['styles','styles'],['header','header'],['footer','footer']].map(([file, type]) => `<Override PartName="/word/${file}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${type}+xml"/>`).join(''));
  return new Blob([zip.generate({ type: 'uint8array', compression: 'DEFLATE' })], { type: MIME_DOCX });
}

const columnName = n => { let name = ''; for (n++; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name; return name; };
export function buildReportXlsx(report, logoBytes) {
  const zip = new PizZip();
  const data = [{cells:[logoBytes ? '' : 'PROGRE | WORKSPACE + PROGREMES / MES'],style:1}, {cells:[report.title],style:2}, {cells:[`Esportazione completa · ${date(report.generatedAt)} · ${report.system}`],style:0}, {cells:[]}];
  for (const block of report.blocks) {
    if (block.type !== 'table') data.push({cells:[block.text],style:block.type === 'heading' ? 2 : 0, merge:true});
    else { if (block.headers.length) data.push({cells:block.headers,style:1}); block.rows.forEach((cells,i) => data.push({cells,style:i % 2 ? 3 : 0})); data.push({cells:[]}); }
  }
  const count = Math.max(1, ...data.map(row => row.cells.length));
  const merges = data.flatMap((row,i) => row.cells.length === 1 && count > 1 ? [`<mergeCell ref="A${i+1}:${columnName(count-1)}${i+1}"/>`] : []);
  const rows = data.map((row,i) => `<row r="${i+1}" ht="${Math.max(i === 0 && logoBytes ? 60 : 23, Math.min(300, Math.ceil(Math.max(0,...row.cells.map(cell => String(cell).length)) / (row.cells.length === 1 ? count * 24 : 24)) * 14))}" customHeight="1">${row.cells.map((value,c) => `<c r="${columnName(c)}${i+1}" t="inlineStr" s="${row.style || 0}"><is><t xml:space="preserve">${xml(value)}</t></is></c>`).join('')}</row>`).join('');
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="23"/><cols><col min="1" max="${count}" width="24" customWidth="1"/></cols><sheetData>${rows}</sheetData>${merges.length ? `<mergeCells count="${merges.length}">${merges.join('')}</mergeCells>` : ''}<printOptions horizontalCentered="1"/><pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="${count > 6 ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/><headerFooter><oddHeader>&amp;LPROGRE&amp;R${xml(report.title).replaceAll('&amp;', '&amp;&amp;')}</oddHeader><oddFooter>&amp;LEsportazione completa&amp;RPagina &amp;P di &amp;N</oddFooter></headerFooter>${logoBytes ? '<drawing r:id="drawing"/>' : ''}</worksheet>`);
  if (logoBytes) {
    zip.file('xl/media/progre.png', logoBytes);
    zip.file('xl/worksheets/_rels/sheet1.xml.rels', relations(relation('drawing','drawing','../drawings/drawing1.xml')));
    zip.file('xl/drawings/_rels/drawing1.xml.rels', relations(relation('logo','image','../media/progre.png')));
    zip.file('xl/drawings/drawing1.xml', '<?xml version="1.0" encoding="UTF-8"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>95250</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>47625</xdr:rowOff></xdr:from><xdr:ext cx="1524000" cy="571500"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="Progre"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="logo"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1524000" cy="571500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>');
  }
  zip.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="10"/><color rgb="FF${INK}"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><b/><sz val="14"/><color rgb="FF${NAVY}"/><name val="Arial"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF${NAVY}"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF${PALE}"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4">${[[0,0],[1,2],[2,0],[0,3]].map(([font,fill]) => `<xf numFmtId="0" fontId="${font}" fillId="${fill}" borderId="0" xfId="0" applyAlignment="1" applyFill="1" applyFont="1"><alignment vertical="top" wrapText="1"/></xf>`).join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report Progre" sheetId="1" r:id="sheet1"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">'Report Progre'!$A$1:$${columnName(count-1)}$${data.length}</definedName><definedName name="_xlnm.Print_Titles" localSheetId="0">'Report Progre'!$1:$3</definedName></definedNames></workbook>`);
  zip.file('_rels/.rels', relations(relation('workbook','officeDocument','xl/workbook.xml')));
  zip.file('xl/_rels/workbook.xml.rels', relations(relation('sheet1','worksheet','worksheets/sheet1.xml')+relation('styles','styles','styles.xml')));
  packageBase(zip, `${logoBytes ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : ''}<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`);
  if (report.visualPages?.length) addWorkbookVisuals(zip,report);
  return new Blob([zip.generate({type:'uint8array',compression:'DEFLATE'})], {type:MIME_XLSX});
}

export const reportBrand = { navy: NAVY, green: GREEN };


function wordVisualImage(page, index) {
  const width=6408000, height=Math.round(width*page.height/page.width);
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/>${index ? '<w:pageBreakBefore/>' : ''}</w:pPr><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="${width}" cy="${height}"/><wp:docPr id="${index+2}" name="Schermata ${index+1}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${index+2}" name="Schermata ${index+1}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="screen${index}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

function addWorkbookVisuals(zip,report) {
  const pages=report.visualPages, width=6408000, stride=40;
  const anchors=pages.map((page,i)=>{
    zip.file(`xl/media/screen${i}.png`,page.dataUrl.split(',')[1],{base64:true});
    const height=Math.round(width*page.height/page.width);
    return `<xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${i*stride}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="${width}" cy="${height}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${i+1}" name="Schermata ${i+1}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="screen${i}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`;
  }).join('');
  zip.file('xl/drawings/drawing2.xml',`<?xml version="1.0" encoding="UTF-8"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchors}</xdr:wsDr>`);
  zip.file('xl/drawings/_rels/drawing2.xml.rels',relations(pages.map((_,i)=>relation(`screen${i}`,'image',`../media/screen${i}.png`)).join('')));
  zip.file('xl/worksheets/_rels/sheet2.xml.rels',relations(relation('drawing','drawing','../drawings/drawing2.xml')));
  zip.file('xl/worksheets/sheet2.xml',`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols><col min="1" max="10" width="9.4" customWidth="1"/></cols><sheetData>${Array.from({length:pages.length*stride},(_,i)=>`<row r="${i+1}" ht="18" customHeight="1"/>`).join('')}</sheetData><printOptions horizontalCentered="1"/><pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/><headerFooter><oddHeader>&amp;LPROGRE&amp;R${xml(report.title).replaceAll('&amp;', '&amp;&amp;')}</oddHeader><oddFooter>&amp;LStruttura della schermata&amp;RPagina &amp;P di &amp;N</oddFooter></headerFooter>${pages.length>1 ? `<rowBreaks count="${pages.length-1}" manualBreakCount="${pages.length-1}">${pages.slice(1).map((_,i)=>`<brk id="${(i+1)*stride}" min="0" max="16383" man="1"/>`).join('')}</rowBreaks>` : ''}<drawing r:id="drawing"/></worksheet>`);
  let workbook=zip.file('xl/workbook.xml').asText().replaceAll('Report Progre','Dati completi').replaceAll('localSheetId="0"','localSheetId="1"');
  workbook=workbook.replace('<sheets>','<sheets><sheet name="Schermata" sheetId="2" r:id="screen"/>').replace('</definedNames>',`<definedName name="_xlnm.Print_Area" localSheetId="0">'Schermata'!$A$1:$J$${pages.length*stride}</definedName></definedNames>`);
  zip.file('xl/workbook.xml',workbook);
  zip.file('xl/_rels/workbook.xml.rels',zip.file('xl/_rels/workbook.xml.rels').asText().replace('</Relationships>',relation('screen','worksheet','worksheets/sheet2.xml')+'</Relationships>'));
  zip.file('[Content_Types].xml',zip.file('[Content_Types].xml').asText().replace('</Types>','<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/drawings/drawing2.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>'));
}

function buildVisualPdf(report,{logoDataUrl,managedLetterhead=false}={}) {
  const doc=buildAssistantPdf({content:`# ${report.title}`,generatedAt:new Date(report.generatedAt),author:report.system,logoDataUrl,managedLetterhead,reportLabel:'REPORT',footerLabel:''});
  report.visualPages.forEach((page,i)=>{
    if (i) {doc.addPage();if(!managedLetterhead)drawContentPageFrame(doc,logoDataUrl);}
    else doc.setPage(2);
    doc.addImage(page.dataUrl,'PNG',16,32,178,178*page.height/page.width,undefined,'FAST');
  });
  const count=report.visualPages.length;
  for(let i=0;i<count;i++){
    doc.setPage(i+2);doc.setFillColor(255,255,255);doc.rect(16,284,178,10,'F');doc.setDrawColor(220,228,239);doc.line(16,283,194,283);
    doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(108,121,144);
    doc.text(`Report ${report.system} - struttura della schermata`,16,289);doc.text(`Pagina ${i+1} di ${count}`,194,289,{align:'right'});
  }
  return doc;
}
