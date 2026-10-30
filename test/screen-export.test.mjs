import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Window } = await import('happy-dom');
const PizZip = require('pizzip');
const { PDFDocument } = require('pdf-lib');
const base = new URL('../', import.meta.url).href;
const { captureCompleteReport, cloneContent, contentBlocks, tableHeaders } = await import(base+'shared/screen-export/capture.js');
const { buildReportPdf, buildReportDocx, buildReportXlsx, reportFileName } = await import(base+'shared/screen-export/formats.js');
const {sumColumns,formatColumnTotal,numericParts,hasExistingTotals,appendReportTotals}=await import(base+'shared/screen-export/totals.js');
const visible = node => !node.closest('[hidden],[aria-hidden="true"]');
function fixture() {
  const win = new Window({url:'https://example.test/clienti'});
  win.document.body.innerHTML = '<main><h1>Clienti Progre</h1><label>Filtro <input value="Roma"></label><section id="one"></section><section id="two"></section></main>';
  const state = [2,1];
  const history = [];
  function render(i) {
    const section = win.document.getElementById(i ? 'two' : 'one');
    section.innerHTML = `<h2>Elenco ${i+1}</h2><div class="table-wrap"><table><thead><tr><th>Codice</th><th>Descrizione</th><th>Azioni</th></tr></thead><tbody><tr><td>${i}-${state[i]}-A</td><td>Identico</td><td><button>Elimina</button></td></tr><tr><td>${i}-${state[i]}-B</td><td>Identico</td><td><button>Salva</button></td></tr></tbody></table></div><div class="pagination"><button class="prev" ${state[i]===0?'disabled':''}>Precedente</button><span>Pagina ${state[i]+1} di 5</span><button class="next" ${state[i]===4?'disabled':''}>Successiva</button></div>`;
    section.querySelector('.prev').onclick = () => {state[i]--;history.push([i,state[i]]);render(i);};
    section.querySelector('.next').onclick = () => {state[i]++;history.push([i,state[i]]);render(i);};
  }
  render(0);render(1);
  return {win,root:win.document.querySelector('main'),state,history};
}
test('collects every page of two lists, retains duplicate values and restores original pages',async()=>{
  const f = fixture();
  const report = await captureCompleteReport({root:f.root,title:'Clienti',isVisible:visible,settle:async()=>{}});
  assert.deepEqual(f.state,[2,1]);
  const tables=report.blocks.filter(b=>b.type==='table');
  assert.equal(tables.length,10);
  assert.equal(tables.flatMap(t=>t.rows).length,20);
  assert.deepEqual(tables.map(t=>t.rows[0][0]),['0-0-A','0-1-A','0-2-A','0-3-A','0-4-A','1-0-A','1-1-A','1-2-A','1-3-A','1-4-A']);
  assert.ok(tables.every(t=>t.headers.length===2 && t.rows.every(r=>r.length===2)));
  assert.ok(report.blocks.some(b=>b.text==='Filtro Roma'));
  assert.ok(!JSON.stringify(report).includes('Elimina'));
});
test('restores original page after cancellation and returns no partial report',async()=>{
  const f=fixture(); const controller=new AbortController();
  await assert.rejects(captureCompleteReport({root:f.root,title:'Test',signal:controller.signal,isVisible:visible,settle:async()=>{},progress:()=>controller.abort()}),{name:'AbortError'});
  assert.deepEqual(f.state,[2,1]);
});
test('recognizes legacy unmarked MES/Club pagination and excludes calendar navigation',async()=>{
  const f=fixture();
  f.root.querySelectorAll('.pagination').forEach(node=>node.className='d-flex');
  f.root.insertAdjacentHTML('beforeend','<div class="calendar"><button>Mese precedente</button><span>Ottobre 2026</span><button>Mese successivo</button></div>');
  const report=await captureCompleteReport({root:f.root,title:'MES',isVisible:visible,settle:async()=>{ f.root.querySelectorAll('.pagination').forEach(node=>node.className='d-flex'); }});
  assert.equal(report.blocks.filter(b=>b.type==='table').flatMap(t=>t.rows).length,20);
  assert.ok(!JSON.stringify(report.blocks).includes('Pagina 3 di 5'));
  assert.deepEqual(f.state,[2,1]);
});
test('pagers above the table also collect the entire list',async()=>{
  const f=fixture();
  const movePagers=()=>f.root.querySelectorAll('.pagination').forEach(pager=>pager.parentElement.prepend(pager));
  movePagers();
  const report=await captureCompleteReport({root:f.root,title:'MES Ordini',isVisible:visible,settle:async()=>movePagers()});
  assert.equal(report.blocks.filter(b=>b.type==='table').flatMap(t=>t.rows).length,20);
  assert.deepEqual(f.state,[2,1]);
});
test('column totals parse Italian money, client counts, negatives and decimal precision',()=>{
  const sums=sumColumns(['Codice','Importo','Clienti','Quantità','UDM'],[['00123','1.200,45 €','12','1,5','kg'],['00999','−200,05 €','8','2,5','kg'],['00111','0,10 €','0','3','pz']]);
  assert.deepEqual(sums[0],[]);
  assert.equal(formatColumnTotal(sums[1]),'1.000,50 €');
  assert.equal(formatColumnTotal(sums[2]),'20');
  assert.equal(formatColumnTotal(sums[3]),'4 kg · 3 pz');
  assert.equal(numericParts('12.50')[0].digits,2);
  assert.deepEqual(numericParts('28/10/2026'),[]);
  assert.deepEqual(numericParts('SALI DI ISCHIA IT0547 IT0547-TST'),[]);
  assert.deepEqual(numericParts('Nicola & C. CO0014 CO0015 +2 articoli'),[]);
  assert.deepEqual(sumColumns(['Cliente / articoli'],[['Nicola & C. CO0014 CO0015 +2 articoli'],['Milano 123 456']])[0],[]);
  assert.equal(formatColumnTotal(sumColumns(['Importo'],[['10,20 € 3 fatture'],['20,30 € 2 fatture']])[0]),'30,50 € · 5 fatture');
});
test('existing totals are preserved and exports add only the general total once',()=>{
  const win=new Window();win.document.body.innerHTML='<table><thead><tr><th>Cliente</th><th>Importo</th></tr></thead><tbody><tr><td>Roma</td><td>10,00 €</td></tr><tr><td>Totale</td><td>10,00 €</td></tr></tbody></table>';
  assert.equal(hasExistingTotals(win.document.querySelector('table')),true);
  const original={blocks:[{type:'table',key:'0',headers:['Cliente','Importo'],rows:[['Roma','10,00 €'],['Totale','10,00 €']]}]};
  appendReportTotals(original);assert.equal(original.blocks[0].rows.length,2);
  const report={blocks:[{type:'table',key:'0',headers:['Cliente','Importo'],rows:[['Roma','10,00 €']]},{type:'table',key:'0',headers:['Cliente','Importo'],rows:[['Milano','20,00 €']]}]};
  appendReportTotals(report);
  assert.deepEqual(report.blocks[0].rows.at(-1),['Roma','10,00 €']);
  assert.deepEqual(report.blocks[1].rows.at(-1),['Totale generale','30,00 €']);
  appendReportTotals(report);assert.equal(report.blocks[1].rows.length,2);
});
test('multilevel headers retain their actual numeric column positions',()=>{
  const win=new Window();win.document.body.innerHTML='<table><thead><tr><th rowspan="2">Cliente</th><th colspan="2">Importi</th></tr><tr><th>Gennaio</th><th>Febbraio</th></tr></thead><tbody><tr><td>Roma</td><td>10,00 €</td><td>20,00 €</td></tr></tbody></table>';
  const table=win.document.querySelector('table');
  assert.deepEqual(tableHeaders(table),['Cliente','Importi · Gennaio','Importi · Febbraio']);
  const report={blocks:contentBlocks(cloneContent(table,visible))};appendReportTotals(report);
  assert.deepEqual(report.blocks[0].rows.at(-1),['Totale generale','10,00 €','20,00 €']);
});
test('column controls do not change numeric header identities',()=>{
  const win=new Window();win.document.body.innerHTML='<table><thead><tr><th>Cliente<span data-column-control><button>↑</button><input></span></th><th>Importo<span data-column-control><button>↓</button><input></span></th></tr></thead><tbody><tr><td>Roma</td><td>10 €</td></tr></tbody></table>';
  assert.deepEqual(tableHeaders(win.document.querySelector('table')),['Cliente','Importo']);
});
test('reads current field values while omitting hidden data, password, AI and export UI',()=>{
  const win=new Window(); win.document.body.innerHTML='<main><h2>Ordine</h2><input aria-label="Cliente" value="prima"><input type="password" value="NON-ESPORTARE"><input aria-label="API token" value="SEGRETO"><p hidden>DATI NASCOSTI</p><p data-report-export>MENU EXPORT</p><dialog data-workspace-assistant>CHAT PRIVATA</dialog><p>Saldo 1.200,45 €</p></main>';
  win.document.querySelector('input').value='nuovo';
  const json=JSON.stringify(contentBlocks(cloneContent(win.document.querySelector('main'),visible)));
  assert.ok(json.includes('Cliente: nuovo'));assert.ok(json.includes('1.200,45'));
  for(const text of ['NON-ESPORTARE','SEGRETO','NASCOSTI','MENU EXPORT','CHAT PRIVATA']) assert.ok(!json.includes(text));
});
test('PDF, DOCX and XLSX include every record with A4 layout and no executable spreadsheet cells',async()=>{
  const f=fixture(); const report=await captureCompleteReport({root:f.root,title:'Clienti Roma & Progre',isVisible:visible,settle:async()=>{}});
  report.blocks.push({type:'table',headers:['Dato'],rows:[['=HYPERLINK("evil")'],['00123']]});
  const logo=fs.readFileSync(new URL('../public/progre-logo-white.png', import.meta.url));
  const docx=buildReportDocx(report,logo), xlsx=buildReportXlsx(report,logo), pdf=buildReportPdf(report);
  const word=new PizZip(await docx.arrayBuffer()), excel=new PizZip(await xlsx.arrayBuffer());
  const wordXml=word.file('word/document.xml').asText(),sheet=excel.file('xl/worksheets/sheet1.xml').asText();
  for(const value of ['0-0-A','0-4-B','1-0-A','1-4-B']) { assert.ok(wordXml.includes(value));assert.ok(sheet.includes(value)); }
  assert.ok(wordXml.includes('w:w="11906" w:h="16838"'));assert.ok(sheet.includes('paperSize="9"'));assert.ok(sheet.includes('fitToHeight="0"'));assert.ok(!sheet.includes('<f>'));assert.ok(sheet.includes('00123'));
  assert.equal(excel.file('xl/workbook.xml').asText().includes('Print_Area'),true);
  const parsed=await PDFDocument.load(pdf.output('arraybuffer'));assert.ok(parsed.getPageCount()>=2);assert.ok(Math.abs(parsed.getPage(0).getSize().height-841.89)<1);
  assert.ok(reportFileName(report,'pdf').endsWith('.pdf'));
});

test('visual capture retains KPI layout, SVG, fields and every paginated row',async()=>{
  const f=fixture();
  f.root.insertAdjacentHTML('afterbegin','<div class="kpi-grid" style="display:grid;grid-template-columns:1fr 1fr"><button class="kpi-card">Clienti 533</button><button class="kpi-card">Fatturato 12.000 €</button></div><svg width="200" height="80"><rect width="80" height="60" fill="green"/></svg><input aria-label="Password" value="SEGRETO"><input aria-label="Nome" value="Gianni">');
  const report=await captureCompleteReport({root:f.root,title:'Layout',visual:true,isVisible:visible,settle:async()=>{}});
  assert.deepEqual(f.state,[2,1]);
  assert.equal(report.visualRoot.querySelectorAll('.kpi-card').length,2);
  assert.equal(report.visualRoot.querySelectorAll('svg rect').length,1);
  assert.equal(report.visualRoot.querySelectorAll('tbody tr').length,20);
  assert.ok(report.visualRoot.textContent.includes('Gianni'));
  assert.ok(!report.visualRoot.textContent.includes('SEGRETO'));
  assert.equal(report.visualRoot.querySelectorAll('.pagination').length,0);
});

test('visual PDF, Word and Excel embed layout pages and Excel retains complete data',async()=>{
  const report={title:'Dashboard visiva',system:'Workspace',generatedAt:new Date().toISOString(),blocks:[{type:'table',headers:['Cliente','Importo'],rows:[['Roma','10,00 €'],['Totale generale','10,00 €']]}],visualPages:[{dataUrl:'data:image/png;base64,'+fs.readFileSync(new URL('../public/progre-logo-white.png',import.meta.url)).toString('base64'),width:1000,height:1200}]};
  const word=new PizZip(await buildReportDocx(report).arrayBuffer());
  assert.ok(word.file('word/media/screen0.png'));
  assert.ok(word.file('word/document.xml').asText().includes('r:embed="screen0"'));
  const excel=new PizZip(await buildReportXlsx(report).arrayBuffer());
  assert.ok(excel.file('xl/workbook.xml').asText().includes('name="Schermata"'));
  assert.ok(excel.file('xl/workbook.xml').asText().includes('name="Dati completi"'));
  assert.ok(excel.file('xl/worksheets/sheet1.xml').asText().includes('Totale generale'));
  assert.ok(excel.file('xl/drawings/drawing2.xml').asText().includes('screen0'));
  const pdf=await PDFDocument.load(buildReportPdf(report).output('arraybuffer'));
  assert.equal(pdf.getPageCount(),2);
});

test('visual pagination avoids breaking a card or a table row that fits on A4',async()=>{
  const {layoutBands}=await import(base+'shared/screen-export/visual.js');
  assert.deepEqual(layoutBands(2200,1000,[{top:900,bottom:1100}]),[{y:0,height:900},{y:900,height:1000},{y:1900,height:300}]);
});

test('visual and data reports exclude column menus without changing the live selection',async()=>{
  const f=fixture();
  f.root.insertAdjacentHTML('afterbegin','<details open class="b2b-column-picker"><summary>Colonne visibili</summary><div><label><input type="checkbox" checked>Importo</label></div></details><details><summary>Nota</summary><div>CONTENUTO CHIUSO</div></details><div role="tooltip">COPERTURA</div>');
  const report=await captureCompleteReport({root:f.root,title:'Popup',visual:true,isVisible:visible,settle:async()=>{}});
  assert.equal(report.visualRoot.querySelectorAll('.b2b-column-picker,[role="tooltip"]').length,0);
  assert.ok(!report.visualRoot.textContent.includes('CONTENUTO CHIUSO'));
  assert.ok(!JSON.stringify(report.blocks).includes('Colonne visibili'));
  assert.equal(f.root.querySelector('.b2b-column-picker').open,true);
  assert.equal(f.root.querySelector('.b2b-column-picker input').checked,true);
});

test('visual and data exports contain one grand total and no native page totals',async()=>{
  const report={blocks:[{type:'table',key:'0',headers:['Cliente','Importo'],rows:[['Roma','10 €'],['Totale pagina','10 €'],['Totale generale','30 €']]},{type:'table',key:'0',headers:['Cliente','Importo'],rows:[['Milano','20 €'],['Totale pagina','20 €'],['Totale generale','30 €']]}]};
  appendReportTotals(report);
  const values=report.blocks.flatMap(block=>block.rows).flat();
  assert.equal(values.filter(value=>value==='Totale pagina').length,0);
  assert.equal(values.filter(value=>value==='Totale generale').length,1);
  const win=new Window();win.document.body.innerHTML='<main>'+[0,1].map(()=>'<table data-export-table-index="0"><thead><tr><th>Cliente</th><th>Importo</th></tr></thead><tbody><tr><td>Roma</td><td>10 €</td></tr></tbody><tfoot><tr><td>Totale pagina</td><td>10 €</td></tr><tr><td>Totale generale</td><td>30 €</td></tr></tfoot></table>').join('')+'</main>';
  report.visualRoot=win.document.querySelector('main');
  const {addVisualTotals}=await import(base+'shared/screen-export/visual.js');addVisualTotals(report);
  assert.ok(!report.visualRoot.textContent.includes('Totale pagina'));
  assert.equal(report.visualRoot.querySelectorAll('tfoot tr').length,1);
  assert.ok(report.visualRoot.querySelector('tfoot').textContent.includes('30 €'));
});
