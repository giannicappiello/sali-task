import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import path from 'node:path';
import {productPhotos} from '../hosting/document-gateway/product-photos.mjs';
import {createSheetHandler} from '../server/direct-product-sheets.js';
test('NAS matches exact article filenames and never substitutes variants',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'nas-photos-'));await mkdir(path.join(root,'FotoProdotti'));
 for(const [name,text]of [['IT0019.png','original'],['IT0019_1.jpg','variant'],['IT0035.jpg','photo'],['Salidischia.pdf','logo']])await writeFile(path.join(root,'FotoProdotti',name),text);
 const rows=await productPhotos(root);assert.equal(rows.find(p=>p.code==='IT0019').path,'FotoProdotti/IT0019.png');assert.equal(rows.find(p=>p.code==='IT0035').path,'FotoProdotti/IT0035.jpg');assert.ok(!rows.some(p=>p.code==='SALIDISCHIA'));
});
test('Photo API ignores Mexal photos and reports a missing NAS original',async()=>{
 const db={from(){return{select(){return this;},eq(){return this;},async single(){return{data:{codice_mexal:'IT0019',immagine_catalogo_url:'https://mexal.test/thumbnail.jpg'},error:null};}};}};
 const response=()=>({code:200,setHeader(){},status(code){this.code=code;return this;},json(data){this.data=data;return this;}});
 const request={method:'POST',headers:{},body:{action:'photo',productId:'10000000-0000-4000-8000-000000000050'}};
 let res=response();await createSheetHandler({identity:async()=>({db}),photoSources:async()=>[{code:'IT0019',url:'https://nas.test/original.png'}]})(request,res);assert.equal(res.data.url,'https://nas.test/original.png');
 res=response();await createSheetHandler({identity:async()=>({db}),photoSources:async()=>[]})(request,res);assert.equal(res.code,404);assert.match(res.data.error,/NAS/);assert.ok(!res.data.url);
});
