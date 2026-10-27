// Explicit aliases only. A suffix is never stripped unless it is configured.
export function resolveMexalSku(sku,aliases={}){
 if(!aliases||typeof aliases!=='object'||Array.isArray(aliases))throw Error('Mappa SKU Mexal non valida.');
 if(!Object.hasOwn(aliases,sku))return sku;
 const target=aliases[sku];
 if(typeof target!=='string'||!target.trim()||target!==target.trim()||/[\\/\r\n?#]/.test(target)||target.includes('..')||(target!==sku&&Object.hasOwn(aliases,target)))throw Error('Abbinamento SKU Mexal non valido.');
 return target;
}
