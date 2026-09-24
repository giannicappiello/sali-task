import test from 'node:test';
import assert from 'node:assert/strict';
import { configuredProductionSections as select } from './production-sections.js';
const codes=['rdp-workbench','fabbisogni-acquisto','diagnostica'];
const screens=codes.map(c => ({codice:c,nome:c,percorso:'/produzione/'+c,attiva:true}));
const links=codes.map((c,i) => ({modulo_codice:'progremes',schermata_codice:c,ordine:i,visibile_menu:true}));
const permissions={hasPermission:()=>true,isAdminUser:true,customerScoped:false,hasScreenAccess:()=>true,hasAreaAccess:()=>true,hasExplicitScreenGrant:()=>false};
test('removed module association does not reappear even for admins',()=>assert.deepEqual(select([],screens,[],permissions),[]));
test('hidden or inactive screens are excluded',()=>assert.deepEqual(select([],screens.map(s=>({...s,attiva:false})),links,permissions),[]));
test('module order and visibility govern local cards',()=>assert.deepEqual(select([],screens,links.map((l,i)=>({...l,visibile_menu:i!==1,ordine:-i})),permissions).map(s=>s.code),['diagnostica','rdp-workbench']));
test('permissions still apply to configured cards',()=>assert.deepEqual(select([],screens,links,{...permissions,hasPermission:()=>false,isAdminUser:false}),[]));
test('customers cannot see global purchasing or diagnostics',()=>assert.deepEqual(select([],screens,links,{...permissions,customerScoped:true,isAdminUser:false}).map(s=>s.code),['rdp-workbench']));
test('screen denial is respected',()=>assert.deepEqual(select([],screens,links,{...permissions,hasScreenAccess:()=>false}),[]));

const progress={codice:'workspace.production.progress',nome:'Ordini e avanzamento',percorso:'/produzione/ordini-avanzamento',attiva:true};
const progressLink={modulo_codice:'progremes',schermata_codice:progress.codice,ordine:5,visibile_menu:true};
test('commercial screen is discoverable and keeps its own access decision',()=>{
 assert.equal(select([],[progress],[progressLink],permissions)[0].path,progress.percorso);
 assert.deepEqual(select([],[progress],[progressLink],{...permissions,hasScreenAccess:()=>false}),[]);
 assert.deepEqual(select([],[progress],[progressLink],{...permissions,hasPermission:()=>false}),[]);
});
test('new MES screen uses discovered catalog identity and never substitutes legacy planning',()=>{
 const screen={codice:'progremes.PlanningProduction',nome:'Pianificazione e produzione',percorso:'/produzione/progremes.PlanningProduction',attiva:true};
 const link={...progressLink,schermata_codice:screen.codice};
 const remote=[{code:screen.codice,name:screen.nome}];
 assert.deepEqual(select(remote,[screen],[link],permissions),remote);
 assert.deepEqual(select(remote,[screen],[link],{...permissions,hasScreenAccess:()=>false}),[]);
 assert.deepEqual(select([],[screen],[link],permissions),[]);
});

test('configured initial local screen opens directly, but hidden or denied screens do not', async()=>{
 const {productionInitialPath}=await import('./production-sections.js');
 const initial={...progressLink,predefinita:true};
 const visible=select([],[progress],[initial],permissions);
 assert.equal(productionInitialPath(visible,[progress],[initial]),progress.percorso);
 assert.equal(productionInitialPath([],[progress],[initial]),'');
 assert.equal(productionInitialPath(visible,[progress],[{...initial,predefinita:false}]),'');
 assert.equal(productionInitialPath(visible,[progress],[{...initial,visibile_menu:false}]),'');
});
test('initial MES screen resolves to authenticated Workspace route', async()=>{
 const {productionInitialPath}=await import('./production-sections.js');
 const screen={codice:'progremes.PlanningProduction',attiva:true,percorso:'/pianificazione-produzione'};
 const link={modulo_codice:'progremes',schermata_codice:screen.codice,predefinita:true,visibile_menu:true};
 assert.equal(productionInitialPath([{code:screen.codice}],[screen],[link]),'/produzione/progremes.PlanningProduction');
});
