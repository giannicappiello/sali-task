import assert from 'node:assert/strict';
import test from 'node:test';
import {applyDatasetTableQuery} from '../../src/components/tableColumnControls.js';
import {ACCOUNT_COLUMNS, ONLINE_ACCOUNT_COLUMNS} from '../../src/modules/crm/crmCustomerColumns.js';

const query=(sortColumn,direction='desc',filters={})=>({sortColumn,direction,filters});
test('tutti i CRM ordinano numericamente l’intero elenco prima della prima pagina',()=>{
  const rows=Array.from({length:620},(_,index)=>({nome:`Cliente ${index}`,invoice_total:index+0.25,invoice_count:2}));
  rows.push({nome:'Massimo oltre pagina',invoice_total:12345.67,invoice_count:1});
  rows.unshift({nome:'Senza importo',invoice_total:null});
  for(const columns of [ACCOUNT_COLUMNS,ONLINE_ACCOUNT_COLUMNS]){
    const index=columns===ACCOUNT_COLUMNS?2:3;
    const sorted=applyDatasetTableQuery(rows,columns,query(index));
    assert.equal(sorted.slice(0,50)[0].nome,'Massimo oltre pagina');
    assert.equal(sorted.at(-1).nome,'Senza importo');
    assert.equal(applyDatasetTableQuery(rows,columns,query(index,'asc')).at(-1).nome,'Senza importo');
    const filtered=applyDatasetTableQuery(rows,columns,query(index,'desc',{0:'oltre pagina'}));
    assert.equal(filtered.length,1);
    assert.equal(filtered[0].invoice_total,12345.67);
  }
});
test('importi, frequenza e date usano valori reali senza influenze delle etichette',()=>{
  const rows=[
    {nome:'a',invoice_total:998.22,invoice_count:99,order_total:9.5,average_gap_days:175,last_purchase:'2026-01-01'},
    {nome:'b',invoice_total:1000,invoice_count:1,order_total:1000,average_gap_days:20,last_purchase:'2026-10-27'},
    {nome:'c',invoice_total:-3.25,invoice_count:1,order_total:0,average_gap_days:3.5,last_purchase:null},
  ];
  const names=index=>applyDatasetTableQuery(rows,ACCOUNT_COLUMNS,query(index)).map(row=>row.nome);
  assert.deepEqual(names(2),['b','a','c']);
  assert.deepEqual(names(3),['b','a','c']);
  assert.deepEqual(names(4),['b','a','c']);
  assert.deepEqual(names(5),['a','b','c']);
  assert.equal(applyDatasetTableQuery(rows,ACCOUNT_COLUMNS,query(2,'desc',{2:'99 fatture'}))[0].nome,'a');
});
