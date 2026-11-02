import {pages,unwrap} from '../order-preparation-mexal.js';

const fields=['sigla','cod_modulo','serie','numero','data_documento','data_ult_mod','id_riga','tp_riga','codice_articolo','quantita','id_magazzino','id_mag_riga','id_mag_da_riga','tipo_stato_riga','id_lotto','qta_lotto','nr_righe_lotto','pos_righe_lotto'];
function technical(document) {
  return Object.fromEntries(Object.entries(unwrap(document)||{}).filter(([key])=>fields.includes(key)||/orig|rif_testata|ordine|residu|evad/.test(key)));
}
export async function preparationDdtDiagnostics(client,row) {
  const docs=await pages(client,'/documenti/movimenti-magazzino',[
    {campo:'sigla',condizione:'=',valore:'BC'},
    {campo:'cod_conto',condizione:'=',valore:row.source.customerCode},
    {campo:'nota',condizione:'contiene',valore:`ALL:${row.id}`},
  ]);
  const actual=await Promise.all(docs.map(d=>client.getJson('/documenti/movimenti-magazzino/'+encodeURIComponent(`BC+${d.serie}+${d.numero}+${d.cod_conto}`))));
  let currentOrder;
  try {currentOrder=technical(await client.getJson('/documenti/ordini-clienti/'+encodeURIComponent(row.source.reference)));}
  catch(error){currentOrder={error:error.message};}
  let history;
  try {history=await client.orderHistory(row.source);}catch(error){history={error:error.message};}
  return {readOnly:true,id:row.id,status:row.status,error:row.error,source:{reference:row.source.reference,year:row.source.year},expected:technical(row.export_payload),actual:actual.map(technical),currentOrder,history};
}
