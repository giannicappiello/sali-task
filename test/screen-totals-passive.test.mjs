import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { installTableTotals, registerTableSummary, registerTableTotals, sumColumns } from '../shared/screen-export/totals.js';
const settle=()=>new Promise(resolve=>setTimeout(resolve,850));
function fixture(dialog=false){
 const win=new Window({url:'https://example.test/ecommerce'});
 win.HTMLElement.prototype.getClientRects=function(){return [{}];};
 win.document.body.innerHTML=`<main><section ${dialog?'role="dialog"':''}><h2>Ordini evasi</h2><table><thead><tr><th>Cliente</th><th>Importo</th></tr></thead><tbody><tr><td>Cliente A</td><td>12,00 €</td></tr></tbody></table><div class="pagination"><button>Precedente</button><span>Pagina 2 di 5</span><button>Successiva</button></div></section></main>`;
 let clicks=0;
 win.document.querySelectorAll('button').forEach(button=>button.onclick=()=>{clicks++;});
 const table=win.document.querySelector('table'),root=win.document.querySelector('section');
 return {win,table,root,clicks:()=>clicks};
}
for(const dialog of [false,true])test(`automatic totals never paginate or lock ${dialog?'a popup':'the online orders list'}`,async()=>{
 const f=fixture(dialog),stop=installTableTotals({doc:f.win.document});
 try{
  await settle();
  assert.match(f.table.querySelector('tfoot').textContent,/Totale pagina12,00 €/);
  assert.match(f.table.querySelector('tfoot').textContent,/Totale generaleNon disponibile/);
  // Simulate data changes, sorting, and a normal manual page change.
  f.table.querySelector('td').textContent='Cliente B';
  f.table.querySelector('th').setAttribute('aria-sort','descending');
  f.win.document.dispatchEvent(new f.win.Event('change'));
  await settle();await settle();
  assert.equal(f.clicks(),0);
  assert.ok(!f.root.inert);
  assert.equal(f.win.document.querySelector('.progre-totals-progress,.progre-totals-reading'),null);
  assert.equal(f.win.document.querySelector('.pagination span').textContent,'Pagina 2 di 5');
 }finally{stop();await f.win.happyDOM.close();}
});
test('complete dataset and server summary totals remain available without UI traversal',async()=>{
 const f=fixture(),stop=installTableTotals({doc:f.win.document});
 try{
  const remove=registerTableTotals(f.table,()=>[['Cliente A','12,00 €'],['Cliente B','18,00 €']]);
  await settle();assert.match(f.table.querySelector('tfoot').textContent,/Totale generale30,00 €/);
  remove();
  registerTableSummary(f.table,headers=>sumColumns(headers,[['Tutti','45,00 €']]));
  await settle();assert.match(f.table.querySelector('tfoot').textContent,/Totale generale45,00 €/);
  assert.equal(f.clicks(),0);
 }finally{stop();await f.win.happyDOM.close();}
});
test('failed providers and late responses after cleanup never start a page capture',async()=>{
 const f=fixture(),stop=installTableTotals({doc:f.win.document});
 try{
  registerTableSummary(f.table,()=>{throw new Error('offline');});
  await settle();assert.match(f.table.querySelector('tfoot').textContent,/Non disponibile/);
  assert.equal(f.clicks(),0);
 }finally{stop();await f.win.happyDOM.close();}
 const late=fixture();let resolve;
 registerTableTotals(late.table,()=>new Promise(done=>{resolve=done;}));
 const cleanup=installTableTotals({doc:late.win.document});
 await settle();cleanup();resolve([['Cliente A','12,00 €']]);await settle();
 assert.equal(late.table.querySelector('tfoot'),null);assert.equal(late.clicks(),0);
 await late.win.happyDOM.close();
});
