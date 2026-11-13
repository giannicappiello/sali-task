import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build,transformWithOxc} from 'vite';
import {Window} from 'happy-dom';
import {isClosedTask,isArchivedProject,matchesProjectStatus,archivedProjectHref} from '../src/lib/projectArchive.js';

test('closed and cancelled projects remain readable without reopening task states',()=>{
 const done={stato:'evaso',completato_at:'2026-11-12T10:00:00Z'};
 const cancelled={stato:'Annullata'};
 assert.ok(isClosedTask(cancelled));assert.ok(isArchivedProject({stato:'Attivo'},[done,cancelled]));
 assert.ok(isArchivedProject({stato:'Chiuso'},[]));assert.ok(!isArchivedProject({stato:'Attivo'},[]));
 assert.ok(matchesProjectStatus({},[done],'tutti','2026-11-13'));
 assert.ok(matchesProjectStatus({},[done],'completati','2026-11-13'));
 assert.ok(!matchesProjectStatus({},[done],'aperti','2026-11-13'));
 assert.ok(matchesProjectStatus({},[],'aperti','2026-11-13'));
 assert.ok(!matchesProjectStatus({},[{...done,deadline:'2026-11-13'}],'oggi','2026-11-13'));
 assert.ok(matchesProjectStatus({},[{stato:'da_evadere',deadline:'2026-11-13'}],'oggi','2026-11-13'));
 assert.ok(matchesProjectStatus({},[{stato:'da_evadere',deadline:'2026-11-12'}],'scaduti','2026-11-13'));
 const link=new URL(archivedProjectHref('project & 1','type=projects&search=chiuso'),'https://workspace.test');
 assert.equal(link.searchParams.get('project'),'project & 1');
 assert.equal(link.searchParams.get('returnTo'),'/activities/archive?type=projects&search=chiuso');
 assert.equal(done.stato,'evaso');
});

const win=new Window({url:'http://localhost'});
for(const name of ['window','document','navigator','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Event','MouseEvent','KeyboardEvent','ResizeObserver','MutationObserver'])Object.defineProperty(globalThis,name,{configurable:true,value:name==='window'?win:win[name]});
globalThis.requestAnimationFrame=callback=>setTimeout(callback,0);
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {default:React,act}=await import('react');
const {createRoot}=await import('react-dom/client');
const {MemoryRouter,Routes,Route}=await import('react-router-dom');
const fixture={auth:null,rows:{},writes:[]};globalThis.__ARCHIVED_PROJECTS_FIXTURE__=fixture;
const mocks={
 AuthContext:`export function useAuth(){return globalThis.__ARCHIVED_PROJECTS_FIXTURE__.auth}`,
 supabaseClient:`const f=globalThis.__ARCHIVED_PROJECTS_FIXTURE__;class Query{constructor(table){this.table=table;this.filters=[];this.operation='read';}select(){return this;}order(){return this;}limit(){return this;}eq(key,value){this.filters.push(row=>row[key]===value);return this;}in(key,values){this.filters.push(row=>values.includes(row[key]));return this;}single(){this.one=true;return this;}maybeSingle(){this.one=true;return this;}update(data){this.operation='update';this.data=data;return this;}insert(data){this.operation='insert';this.data=data;return this;}delete(){this.operation='delete';return this;}upsert(data){this.operation='insert';this.data=data;return this;}then(resolve,reject){let rows=(f.rows[this.table]||[]).filter(row=>this.filters.every(filter=>filter(row)));if(this.operation!=='read'){f.writes.push({table:this.table,operation:this.operation,data:this.data});if(this.operation==='update')rows.forEach(row=>Object.assign(row,this.data));if(this.operation==='insert')rows=Array.isArray(this.data)?this.data:[this.data];}return Promise.resolve({data:this.one?(rows[0]||null):rows,error:null}).then(resolve,reject);}}export const supabase={from:table=>new Query(table),rpc:async()=>({data:[],error:null}),auth:{getUser:async()=>({data:{user:{id:'auth-1'}}})},storage:{from:()=>({getPublicUrl:()=>({data:{publicUrl:''}})})}};`,
 workspaceCrmCatalog:`export async function loadWorkspaceProducts(){return {data:[],error:null}}`,
 crmWorkspaceCustomers:`export async function loadCrmCustomerDirectory(){return {directory:new Map(),error:null}};export function workspaceCustomerName(){return 'Cliente test'}`,
 useCustomerWorkspaceProducts:`export default function useCustomerWorkspaceProducts(){return {products:[],loading:false,error:null}}`,
 WorkspaceCustomerPicker:`export default function Picker(){return null}`,
 WorkspaceTaskKanban:`export default function Kanban(){return null}`,
};
await mkdir(new URL('../.tmp/',import.meta.url),{recursive:true});
await writeFile(new URL('../.tmp/archived-projects-entry.js',import.meta.url),"export {default as Projects} from '../src/pages/Projects/Projects.jsx';export {default as ActivityArchive} from '../src/pages/Activities/ActivityArchive.jsx';");
const result=await build({configFile:false,logLevel:'silent',plugins:[{
 name:'archived-project-test-fixtures',enforce:'pre',resolveId(source){for(const key of Object.keys(mocks))if(new RegExp('(?:^|/)'+key+'(?:\\.jsx?)?$').test(source))return '\0fixture:'+key;},load(id){if(id.startsWith('\0fixture:'))return mocks[id.slice(9)];},async transform(code,id){if(id.endsWith('.jsx'))return transformWithOxc(code,id,{jsx:{runtime:'automatic'}});}
}],build:{write:false,minify:false,lib:{entry:fileURLToPath(new URL('../.tmp/archived-projects-entry.js',import.meta.url)),formats:['es']},rollupOptions:{external:['react','react/jsx-runtime','react-dom/client','react-router-dom']}}});
await writeFile(new URL('../.tmp/archived-projects-ui.mjs',import.meta.url),(Array.isArray(result)?result[0]:result).output.find(item=>item.type==='chunk').code);
const {Projects,ActivityArchive}=await import(new URL('../.tmp/archived-projects-ui.mjs',import.meta.url).href);
const settle=()=>new Promise(resolve=>setTimeout(resolve,25));
let root,host;
function reset(canWrite=true){
 fixture.writes=[];fixture.auth={profile:{id:'user-1'},hasPermission:()=>canWrite,isAdmin:()=>true,userDepartmentIds:[],dataScope:{mode:'tutti'},canViewScopedData:()=>true};
 fixture.rows={utenti:[{id:'user-1',nome:'Test',attivo:true}],v4_progetti:[{id:'closed',titolo:'Progetto archiviato',descrizione:'Storico progetto',stato:'Attivo',creato_da:'user-1'},{id:'active',titolo:'Progetto attivo',stato:'Attivo',creato_da:'user-1'}],v4_fasi_progetto:[{id:'done',progetto_id:'closed',titolo:'Task conclusa',descrizione:'Dettagli storici',stato:'evaso',completato_at:'2026-11-12T10:00:00Z',creato_da:'user-1',deadline:'2026-11-12'},{id:'open',progetto_id:'active',titolo:'Task aperta',stato:'da_evadere',creato_da:'user-1',deadline:'2026-11-13'}]};
}
async function mount(path){host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>{root.render(React.createElement(MemoryRouter,{initialEntries:[path]},React.createElement(Routes,null,React.createElement(Route,{path:'/activities/projects',element:React.createElement(Projects)}),React.createElement(Route,{path:'/activities/archive',element:React.createElement(ActivityArchive)}))));await settle();});await act(settle);}
async function cleanup(){await act(async()=>root.unmount());host.remove();}
async function click(node){assert.ok(node);await act(async()=>{node.click();await settle();});await act(settle);}
const byText=text=>[...host.querySelectorAll('button')].find(node=>node.textContent.trim()===text);

test('archive opens a completed project, reads without writes, then saves an authorized task edit',async()=>{
 reset();await mount('/activities/archive?type=projects&search=archiviato');
 await click([...host.querySelectorAll('a')].find(node=>node.textContent==='Apri progetto e task'));
 try{
 assert.match(host.textContent,/Progetto archiviato/);assert.doesNotMatch(host.textContent,/Progetto attivo/);
 assert.equal(byText('Tutti').className,'active');
 assert.match(host.querySelector('.planning-return-link').textContent,/archivio/);
 await click(host.querySelector('.phase-card-main'));
 const field=host.querySelector('form.workspace-phase-dialog textarea');
 assert.ok(field);assert.equal(field.value,'Dettagli storici');assert.ok(byText('Salva'));
 assert.equal(fixture.writes.length,0);assert.equal(fixture.rows.v4_fasi_progetto[0].stato,'evaso');
 await act(async()=>{
  Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(field,'Descrizione aggiornata');
  field.dispatchEvent(new window.Event('input',{bubbles:true}));await settle();
 });
 await act(async()=>{host.querySelector('form.workspace-phase-dialog').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await settle();});await act(settle);
 assert.ok(fixture.writes.some(write=>write.table==='v4_fasi_progetto'&&write.operation==='update'&&write.data.descrizione==='Descrizione aggiornata'));
 assert.equal(fixture.rows.v4_fasi_progetto[0].stato,'evaso');
 }finally{await cleanup();}
});

test('closed projects can be listed and read with no write permission',async()=>{
 reset(false);await mount('/activities/projects');
 try{
 assert.doesNotMatch(host.textContent,/Progetto archiviato/);
 await click(byText('Archiviati'));assert.match(host.textContent,/Progetto archiviato/);assert.doesNotMatch(host.textContent,/Progetto attivo/);
 await click(host.querySelector('.phase-card-main'));
 assert.ok([...host.querySelectorAll('fieldset')].some(field=>field.disabled));assert.equal(byText('Salva'),undefined);assert.equal(fixture.writes.length,0);
 }finally{await cleanup();}
});

test('all projects filter includes both open and archived projects',async()=>{
 reset();await mount('/activities/projects');try{await click(byText('Tutti'));assert.match(host.textContent,/Progetto archiviato/);assert.match(host.textContent,/Progetto attivo/);assert.equal(fixture.writes.length,0);}finally{await cleanup();}
});

test.after(async()=>{await win.happyDOM.close();});
