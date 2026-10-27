import {mkdir,writeFile} from 'node:fs/promises';
export async function backupCatalogProduct(product){
 await mkdir('data/catalog-backups',{recursive:true});
 try{await writeFile(`data/catalog-backups/${product.id}.json`,JSON.stringify({at:new Date().toISOString(),product},null,2),{flag:'wx'});}
 catch(error){if(error.code!=='EEXIST')throw error;}
}
