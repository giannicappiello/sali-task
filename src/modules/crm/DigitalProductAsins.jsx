import { CrmDetailTable } from './CrmKpiDetail';
import { productAsinRows } from './digitalProductReconciliation.js';
import { displayAmounts } from './digitalDashboardModel.js';
export default function DigitalProductAsins({ product }) {
  return <details><summary>{product.name} · Dettaglio ASIN</summary><CrmDetailTable rows={productAsinRows(product)} columns={[
    {key:'asin',label:'ASIN',value:row=>row.asin},
    {key:'sku',label:'SKU Amazon',value:row=>row.sku},
    {key:'quantity',label:'Quantità',value:row=>`${row.quantity.toLocaleString('it-IT')}${row.unknownQuantity ? ' (parziale)' : ''}`},
    {key:'count',label:'Ordini',value:row=>row.count},
    {key:'amount',label:'Importo righe',value:row=>displayAmounts(row.amounts)},
  ]}/></details>;
}
