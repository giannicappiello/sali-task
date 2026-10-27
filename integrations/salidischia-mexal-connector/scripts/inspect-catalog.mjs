import {mkdir,writeFile} from 'node:fs/promises';
import {mexalTransport} from '../src/clients.mjs';
const mexal=mexalTransport();
const root=process.env.WOO_URL.replace(/\/+$/,'');
const headers={Authorization:`Basic ${Buffer.from(`${process.env.WOO_CONSUMER_KEY}:${process.env.WOO_CONSUMER_SECRET}`).toString('base64')}`};
async function woo(path){const r=await fetch(`${root}/wp-json/wc/v3/${path}`,{headers,redirect:'error',signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(`Woo HTTP ${r.status}`);return r.json();}
const result={listini:(await mexal.request('/dati-generali/listini')).data,tax:await woo('settings/tax/woocommerce_prices_include_tax'),products:[]};
for(const sku of ['IT0017','IT0007','IT0478']){
 const article=(await mexal.request(`/articoli/${sku}`)).data;
 const stock=(await mexal.request(`/articoli/${sku}/progressivi`)).data;
 const products=await woo(`products?sku=${sku}&_fields=id,sku,type,regular_price,sale_price,price,tax_status,tax_class,manage_stock,stock_quantity,stock_status`);
 result.products.push({sku,article,stock,products});
}
await mkdir('.private',{recursive:true});await writeFile('.private/catalog-inspection.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({listini:[...new Map(result.listini.dati.map(r=>[r.id,{id:r.id,name:r.descrizione,iva:r.gest_con_iva}])).values()],tax:result.tax.value,products:result.products.map(x=>({sku:x.sku,prices:x.article.prz_listino,woo:x.products}))},null,2));
