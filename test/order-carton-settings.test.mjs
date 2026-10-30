import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { transformWithOxc } from 'vite';
const { Window } = await import(process.env.WORKSPACE_TEST_DOM_MODULE || 'happy-dom');

test('configurazione reale: selezione referenze, salvataggio, modifica, disattivazione ed eliminazione', async () => {
  const window = new Window();
  for (const key of ['window','document','navigator','HTMLElement','HTMLInputElement','Event','MouseEvent','Node']) Object.defineProperty(globalThis,key,{configurable:true,value:key==='window'?window:window[key]});
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  window.workspaceConfirm=async()=>true;
  const { createElement, act }=await import('react');
  const { createRoot }=await import('react-dom/client');
  let saved=[];
  const writes=[];
  globalThis.__cartonTestDb={from(table){
    const q={filters:[], select(){return q;},eq(key,value){q.filters.push([key,value]);return q;},order(){return q;},
      range(){return Promise.resolve({data:table==='ordini_prodotti_cache'?[{codice_articolo:'A',descrizione:'Articolo Alpha'},{codice_articolo:'B',descrizione:'Articolo Beta'}]:saved,error:null});},
      upsert(payload){q.payload=payload;return q;},
      single(){const row={...q.payload,id:q.payload.id||'rule-1'};saved=[row];writes.push(row);return Promise.resolve({data:row,error:null});},
      delete(){q.deleting=true;return q;},
      then(resolve,reject){if(q.deleting)saved=[];return Promise.resolve({data:[],error:null}).then(resolve,reject);}};
    return q;
  }};
  const file=new URL('../src/modules/integrations/components/OrderCartonSettings.jsx',import.meta.url);
  let source=await fs.readFile(file,'utf8');
  source=source.replace(/import \{ supabase \} from [^;]+;/,'const supabase=globalThis.__cartonTestDb;')
    .replace(/import '\.\/order-carton-settings.css';/,'')
    .replace("'../../orders/services/orderCartonRules.js'",JSON.stringify(new URL('../src/modules/orders/services/orderCartonRules.js',import.meta.url).href));
  let {code}=await transformWithOxc(source,file.pathname,{jsx:{runtime:'automatic'}});
  code=code.replaceAll('"react"',JSON.stringify(import.meta.resolve('react'))).replaceAll('"react/jsx-runtime"',JSON.stringify(import.meta.resolve('react/jsx-runtime')));
  const {default:Settings}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
  const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
  const button=label=>[...container.querySelectorAll('button')].find(el=>el.textContent===label);
  const click=async el=>{assert.ok(el,'element exists');await act(async()=>{el.click();});};
  const fill=async(el,value)=>{await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new window.Event('input',{bubbles:true}));el.dispatchEvent(new window.Event('change',{bubbles:true}));});};
  try {
    await act(async()=>{root.render(createElement(Settings,{moduleCode:'ph'}));await new Promise(resolve=>setTimeout(resolve,15));});
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,15));});
    assert.match(container.textContent,/Gestione Cartonaggi/);
    await fill(container.querySelector('input[type=number]'),'6');
    await click(container.querySelector('.carton-product-list input'));
    await click(button('Salva regola'));
    assert.equal(writes.length,1);assert.equal(writes[0].modulo_ordini,'ph');assert.equal(writes[0].valore,6);assert.deepEqual(writes[0].prodotti,['A']);
    await click(button('Modifica'));
    await click(container.querySelector('.carton-rule-editor > label input[type=checkbox]'));
    await click(button('Salva regola'));
    assert.equal(writes[1].attiva,false);
    await click(button('Elimina'));
    assert.equal(saved.length,0);assert.match(container.textContent,/Nessuna limitazione configurata/);
  } finally {await act(async()=>root.unmount());delete globalThis.__cartonTestDb;await window.happyDOM.close();}
});
