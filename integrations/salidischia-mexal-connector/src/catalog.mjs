import {createHash} from 'node:crypto';
import {resolveMexalSku} from './sku.mjs';

function number(value,label){
 if(value===null||value===undefined||value===''||!Number.isFinite(Number(value)))throw Error(`${label} non valido.`);
 return Number(value);
}
function matrix(value,label){
 if(!Array.isArray(value))throw Error(`${label} mancante.`);
 const result=new Map();
 for(const row of value){if(!Array.isArray(row)||row.length!==2||!Number.isSafeInteger(row[0])||result.has(row[0]))throw Error(`${label} ambiguo.`);result.set(row[0],row[1]);}
 return result;
}
export function verifyCatalogProduct(saved,product,snapshot){
 if(!saved||saved.id!==product.id||Number(saved.regular_price)!==Number(snapshot.price)||saved.sale_price!==''||saved.stock_quantity!==snapshot.quantity||saved.stock_status!==snapshot.status||saved.manage_stock!==true||saved.backorders!=='no'||saved.meta_data?.find(x=>x.key==='_sdi_mexal_catalog_v1')?.value?.hash!==snapshot.hash)throw Error('Rilettura prodotto non coerente.');
}
export function warehouseStock(progressives,sku,warehouse=5){
 const ids=matrix(progressives.id_magazzino,'Magazzini');
 const codes=matrix(progressives.cod_articolo,'Codici articolo');
 const units=matrix(progressives.um_principale,'Unità');
 const columns=['qta_inventario','qta_carico','qta_scarico','qta_ord_imp'].map(k=>matrix(progressives[k],k));
 if(!Number.isSafeInteger(progressives.num_prog_art)||progressives.num_prog_art!==ids.size)throw Error('Progressivi incompleti.');
 for(const col of columns)for(const key of col.keys())if(!ids.has(key))throw Error('Progressivo senza magazzino.');
 let physical=0,committed=0;
 for(const [row,id] of ids){
  if(String(codes.get(row)).trim()!==sku)throw Error('SKU dei progressivi diverso.');
  if(Number(id)!==warehouse)continue;
  if(String(units.get(row)).trim()!=='PZ')throw Error('Giacenza non espressa in pezzi.');
  physical+=number(columns[0].get(row)??0,'Inventario')+number(columns[1].get(row)??0,'Carico')-number(columns[2].get(row)??0,'Scarico');
  committed+=number(columns[3].get(row)??0,'Impegnato');
 }
 if(!Number.isInteger(physical)||!Number.isInteger(committed))throw Error('Quantità frazionaria in pezzi.');
 return {physical,committed,sellable:Math.max(0,physical-Math.max(0,committed))};
}
export function catalogSnapshot(article,progressives,sku,mexalSku=sku){
 if(String(article.codice).trim()!==mexalSku)throw Error('SKU Mexal diverso.');
 const raw=matrix(article.prz_listino,'Listini').get(1);
 const amount=number(raw,'Prezzo listino 1');
 if(amount<=0)throw Error('Prezzo listino 1 assente o non positivo.');
 const price=(Math.round((amount+Number.EPSILON)*100)/100).toFixed(2);
 // Mexal returns {} (HTTP 200) for a valid article with no progressives.
 // Accept it only with the independent, warehouse-scoped article totals at zero.
 if(progressives && Object.keys(progressives).length===0){
  if(String(article.um_principale).trim()!=='PZ'||['qta_inventario','qta_carico','qta_scarico'].some(k=>number(article[k],k)!==0))throw Error('Progressivi vuoti senza giacenza zero verificata.');
  progressives={num_prog_art:0,id_magazzino:[],cod_articolo:[],um_principale:[],qta_inventario:[],qta_carico:[],qta_scarico:[],qta_ord_imp:[]};
 }
 const stock=warehouseStock(progressives,mexalSku,5);
 const snapshot={version:1,sku,...(mexalSku!==sku?{mexalSku}:{}),warehouse:5,list:1,price,physical:stock.physical,quantity:stock.sellable,minimum:10,
  status:stock.physical<10||stock.sellable===0?'outofstock':'instock'};
 return {...snapshot,hash:createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')};
}
export function catalogPatch(product,snapshot){
 if(product.sku!==snapshot.sku)throw Error('Abbinamento prodotto non valido.');
 if(!['simple','variation'].includes(product.type))throw Error('Tipo prodotto da verificare manualmente.');
 if(product.tax_status!=='taxable'||product.tax_class!=='')throw Error('Regime IVA prodotto da verificare manualmente.');
 const previous=product.meta_data?.find(x=>x.key==='_sdi_mexal_catalog_v1')?.value;
 if(previous?.hash===snapshot.hash&&Number(product.regular_price)===Number(snapshot.price)&&!product.sale_price&&product.manage_stock===true&&product.stock_quantity===snapshot.quantity&&product.stock_status===snapshot.status&&product.backorders==='no')return null;
 return {regular_price:snapshot.price,sale_price:'',date_on_sale_from:null,date_on_sale_to:null,manage_stock:true,stock_quantity:snapshot.quantity,stock_status:snapshot.status,backorders:'no',
  meta_data:[{key:'_sdi_mexal_catalog_v1',value:snapshot}]};
}

export async function runCatalog({woo,mexal,dryRun=true,onResult=()=>{},onlyIds=null,beforeWrite=async()=>{},aliases={},excludedIds=[]}){
 if(onlyIds!==null&&(!Array.isArray(onlyIds)||!onlyIds.length||onlyIds.some(id=>!Number.isSafeInteger(id)||id<1)))throw Error('Selezione prodotti non valida.');
 if(!Array.isArray(excludedIds)||excludedIds.some(id=>!Number.isSafeInteger(id)||id<1))throw Error('Esclusioni catalogo non valide.');
 if((await woo.taxSetting()).value!=='yes')throw Error('WooCommerce deve ricevere prezzi IVA inclusa.');
 if(mexal.warehouse!==5)throw Error('La lettura Mexal deve usare il magazzino 5.');
 if(!dryRun){const status=await woo.connectorStatus();if(status.catalog_guard_version!==1||status.authenticated_key_id!==3)throw Error('Protezione catalogo non attiva.');}
 const products=[];
 for(let page=1;page<=200;page++){
  const rows=await woo.products(page);if(!Array.isArray(rows))throw Error('Catalogo non valido.');
  for(const p of rows){
   if(p.type==='variable'){
    for(let vpage=1;vpage<=200;vpage++){const variants=await woo.variations(p.id,vpage);if(!Array.isArray(variants))throw Error('Varianti non valide.');products.push(...variants.map(v=>({...v,type:'variation',parent_id:p.id})));if(variants.length<100)break;if(vpage===200)throw Error('Troppe varianti.');}
   }else products.push(p);
  }
  if(rows.length<100)break;if(page===200)throw Error('Catalogo troppo grande.');
 }
 if(onlyIds!==null){const selected=products.filter(p=>onlyIds.includes(p.id));if(selected.length!==new Set(onlyIds).size)throw Error('Prodotto selezionato non trovato.');products.splice(0,products.length,...selected);}
 const cache=new Map(),results=[],pending=[];
 let nextProduct=0;
 async function consume(){
 while(nextProduct<products.length){
  const product=products[nextProduct++];
  const sku=String(product.sku||'').trim();
  let row={id:product.id,sku,publication:product.status};
  if(excludedIds.includes(product.id)){row.mode='excluded';row.reason='Prodotto non acquistabile, escluso dal titolare.';}
  else if(!sku||!['simple','variation'].includes(product.type)){row.mode='skipped';row.reason=!sku?'SKU assente':`Tipo ${product.type}`;}
  else try{
   const mexalSku=resolveMexalSku(sku,aliases);
   if(!cache.has(mexalSku))cache.set(mexalSku,(async()=>({article:(await mexal.request(`/articoli/${encodeURIComponent(mexalSku)}`)).data,progressives:(await mexal.request(`/articoli/${encodeURIComponent(mexalSku)}/progressivi`)).data}))());
   const source=await cache.get(mexalSku),snapshot=catalogSnapshot(source.article,source.progressives,sku,mexalSku),patch=catalogPatch(product,snapshot);
   if(mexalSku!==sku)row.mexalSku=mexalSku;
   row={...row,price:snapshot.price,physical:snapshot.physical,quantity:snapshot.quantity,status:snapshot.status};
   if(!patch)row.mode='unchanged';
   else if(dryRun){row.mode='preview';row.before={price:product.regular_price,sale:product.sale_price,quantity:product.stock_quantity,status:product.stock_status};}
   else{
    row.mode='pending';pending.push({product,patch,snapshot,row});
   }
  }catch(error){
   const inactive=['draft','pending','private'].includes(product.status);
   const missingMapping=/HTTP 404|Prezzo listino 1 (?:non valido|assente o non positivo)/.test(error.message);
   row.mode=inactive&&missingMapping?'unmapped':'attention-required';row.reason=error.message;
  }
  results.push(row);if(row.mode!=='pending')onResult(row);
 }
 }
 await Promise.all(Array.from({length:4},()=>consume()));
 const groups=new Map();for(const item of pending){const parent=item.product.parent_id||null;if(!groups.has(parent))groups.set(parent,[]);groups.get(parent).push(item);}
 const batches=[];for(const [parent,items]of groups)for(let i=0;i<items.length;i+=10)batches.push({parent,items:items.slice(i,i+10)});
 let nextBatch=0;
 async function saveBatches(){while(nextBatch<batches.length){
  const {parent,items}=batches[nextBatch++];let requestError=null;
  try{for(const item of items)await beforeWrite(item.product);await woo.productBatch(items.map(x=>({id:x.product.id,...x.patch})),parent);}
  catch(error){requestError=error;}
  // A batch may partially succeed or time out after saving. Never infer success
  // from its HTTP status; reconcile each item with an independent GET.
  let saved=[];try{saved=await woo.productsByIds(items.map(x=>x.product.id),parent);if(!Array.isArray(saved))throw Error('Rilettura lotto non valida.');}
  catch(error){requestError=error;}
  for(const item of items){try{verifyCatalogProduct(saved.find(p=>p.id===item.product.id),item.product,item.snapshot);item.row.mode='updated';}
   catch(error){item.row.mode='attention-required';item.row.reason=requestError?.message||error.message;}
   onResult(item.row);
  }
 }}
 await saveBatches();
 results.sort((a,b)=>a.id-b.id);
 return {dryRun,products:products.length,results};
}
