import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateLineConditions } from '../src/modules/orders/services/priceEngine.js';
import { applyOrderPaymentDiscountPolicy } from '../src/modules/orders/services/orderPaymentPolicy.js';
import { calculateOrderEconomics } from '../src/modules/orders/services/orderEconomics.js';
import { applyOrderShipping } from '../src/modules/orders/services/orderShipping.js';
import { mexalLineDiscount } from '../server/mexal/order-documents.js';
const args={customer:{codice_listino:'1',categoria_sconti:2},product:{prezzo_listino:100,categoria_sconto:7},payment:{codice_pagamento:'BB',sconto:'5'},paymentRules:[{id:7,codice_pagamento:'BB',sconto:'8',is_active:true}],discountMatrix:[{cod_cat_cli:2,cod_cat_art:7,sconto:'10',is_active:true}],quantity:2};
for(const moduleCode of ['prof','ph']) {
 test(moduleCode+': ignora sconto del pagamento e regole, conserva condizioni commerciali',()=>{
  const line=calculateLineConditions({...args,moduleCode});
  assert.equal(line.sconto_commerciale,'10');assert.equal(line.sconto_pagamento,'');
  assert.equal(line.prezzo_netto,90);assert.equal(line.regola_pagamento_id,null);
  assert.equal(line.dettaglio_calcolo.codice_pagamento,'BB');
  assert.equal(mexalLineDiscount(line),'10');
  const fallback=calculateLineConditions({...args,moduleCode,paymentRules:[]});
  assert.equal(fallback.prezzo_netto,90);
 });
 test(moduleCode+': ricalcola vecchia bozza senza duplicare sconti, porto franco sul nuovo netto',()=>{
  const old={quantita:2,prezzo_listino:100,aliquota_iva:22,sconto_commerciale:'10+5',sconto_pagamento:'5',sconto_pagamento_percentuale:5,regola_pagamento_id:7,dettaglio_calcolo:{sconto_commerciale:'10',sconto_pagamento:'5'}};
  const line=applyOrderPaymentDiscountPolicy(old,moduleCode);
  const totals=calculateOrderEconomics(applyOrderShipping([line],{importo_minimo_porto_franco:175,addebito_spedizione:10},{moduleCode}));
  assert.equal(totals.righe.length,1);assert.equal(totals.totale_imponibile,180);assert.equal(totals.totale_iva,39.6);assert.equal(totals.totale_documento,219.6);
  assert.equal(mexalLineDiscount(line),'10');assert.equal(line.sconto_pagamento_percentuale,null);
  assert.equal(calculateOrderEconomics(totals.righe).totale_documento,219.6);
  assert.equal(applyOrderPaymentDiscountPolicy(line,moduleCode).sconto_commerciale,'10');
 });
}
test('Private e storico conservano lo sconto pagamento',()=>{
 assert.equal(calculateLineConditions({...args,moduleCode:'private'}).prezzo_netto,82.8);
 assert.equal(calculateLineConditions(args).prezzo_netto,82.8);
 const historical={quantita:2,prezzo_listino:100,aliquota_iva:22,sconto_commerciale:'10',sconto_pagamento:'5'};
 assert.equal(applyOrderPaymentDiscountPolicy(historical,'private'),historical);
 assert.equal(calculateOrderEconomics([historical]).totale_imponibile,171);
 assert.equal(mexalLineDiscount(historical),'10+5');
});
