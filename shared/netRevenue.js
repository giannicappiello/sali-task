const number = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
export function invoiceNetAmount(row, lineNet = null) {
 const net=number(row.totale_imponibile),gross=number(row.totale_documento),vat=number(row.totale_iva);
 return net ?? (gross!==null&&vat!==null ? gross-vat : number(lineNet));
}
export function netSalesLineAmount(line,order={}) {
 const raw=number(line.line_revenue);
 if(line.metadati?.display_revenue_basis==='net')return raw;
 const explicit=number(line.net_line_revenue ?? line.metadati?.net_line_revenue);
 if(explicit!==null)return explicit;
 const amazon=order.raw_summary?.provider==='amazon_sp_api'||/^Amazon_|^A[A-Z0-9]{8,}$/.test(String(order.marketplace||''));
 if(!amazon)return raw;
 const proof=(order.raw_summary?.net_line_amounts||[]).find(row=>String(row.external_line_id)===String(line.external_line_id));
 if(proof)return number(proof.net_amount);
 const tax=(order.raw_summary?.tax_collection?.lines||[]).find(row=>String(row.external_line_id)===String(line.external_line_id));
 if(raw!==null&&Number.isSafeInteger(tax?.tax_cents)&&tax.tax_cents>=0)return Math.round((raw-tax.tax_cents/100)*100)/100;
 return null;
}
export function asNetSalesLine(line,order) {
 const net=netSalesLineAmount(line,order),amazon=order?.raw_summary?.provider==='amazon_sp_api'||/^Amazon_|^A[A-Z0-9]{8,}$/.test(String(order?.marketplace||''));
 return {...line,line_revenue:net,...(amazon?{unit_price:net!==null&&number(line.quantity)>0?net/Number(line.quantity):null}:{}),metadati:{...line.metadati,display_revenue_basis:'net'}};
}
