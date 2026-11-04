const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const source = fs.readFileSync(process.env.BCF_SOURCE || path.join(__dirname,'../src/pages/Warehouse/OrderPreparation.jsx'),'utf8').replace(/\r\n/g,'\n');
const loadStart = source.indexOf('    async (refresh = false');
const loadEnd = source.indexOf('\n    },\n    [id, accept]',loadStart);
const load = source.slice(loadStart,loadEnd)+'\n    }';
const perform = source.slice(source.indexOf('  async function perform(operation,'),source.indexOf('  const scan = async'));

function fixture({status=409,refreshFails=false}={}) {
  const state={error:'',notice:'',loading:false,loadingTransitions:[],confirm:true,busy:false,pending:null,calls:[]};
  const original={id:'preparation',version:1};
  const current={current:original};
  const noop=()=>{};
  const deps={
    crypto,current,lock:{current:false},id:original.id,
    setBusy:value=>{state.busy=value;},setError:value=>{state.error=value;},
    setNotice:value=>{state.notice=value;},setLoading:value=>{state.loading=value;state.loadingTransitions.push(value);},
    setPending:value=>{state.pending=value;},setCartonPrompt:noop,setCanWrite:noop,setCanConfigure:noop,
    accept:value=>{current.current=value;state.confirm=false;},
    preparationApi:async(operation)=>{
      state.calls.push(operation);
      if(operation==='export') throw Object.assign(new Error('Disponibilità FIFO cambiata: ripeti il riscontro.'),{status});
      if(refreshFails) throw new Error('Connessione interrotta');
      return {preparation:{...original,version:2},canWrite:true,canConfigure:false};
    },
  };
  const run=new Function(...Object.keys(deps),`const load=${load};${perform};return {perform,load};`)(...Object.values(deps));
  return {state,current,...run};
}

test('409 retains the business error and refreshes the version without removing the order view',async()=>{
  const f=fixture();
  const result=await f.perform('export');
  assert.equal(f.state.error,'Disponibilità FIFO cambiata: ripeti il riscontro.');
  assert.deepEqual(f.state.calls,['export','get']);
  assert.deepEqual(f.state.loadingTransitions,[]);
  assert.equal(f.current.current.version,2);
  assert.equal(f.state.confirm,false);
  assert.equal(f.state.busy,false);
  assert.equal(f.state.pending,null);
  assert.equal(result.status,409);
});

test('a failed refresh retains both the original rejection and refresh failure without retrying emission',async()=>{
  const f=fixture({refreshFails:true});
  await f.perform('export');
  assert.match(f.state.error,/Disponibilità FIFO cambiata/);
  assert.match(f.state.error,/Connessione interrotta/);
  assert.deepEqual(f.state.calls,['export','get']);
  assert.equal(f.state.busy,false);
  assert.equal(f.current.current.version,1);
});

test('other failures retain existing retry semantics and do not refresh the preparation',async()=>{
  const f=fixture({status:503});
  await f.perform('export');
  assert.deepEqual(f.state.calls,['export']);
  assert.equal(f.state.pending.operation,'export');
  assert.match(f.state.error,/Disponibilità FIFO cambiata/);
});

test('an explicit refresh still clears prior feedback and shows loading',async()=>{
  const f=fixture();f.state.error='precedente';f.state.notice='precedente';
  await f.load();
  assert.equal(f.state.error,'');assert.equal(f.state.notice,'');
  assert.deepEqual(f.state.loadingTransitions,[true,false]);
});

