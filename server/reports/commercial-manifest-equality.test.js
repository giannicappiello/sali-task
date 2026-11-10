import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { readFileSync } from 'node:fs';

const manifest=()=>[
  {key:'synthetic-a',name:'Synthetic A',kind:'agent',network:'prof',source:'fatture',agentCodes:['synthetic-a']},
  {key:'synthetic-group',name:'Synthetic group',kind:'group',network:'prof',source:'fatture',agentCodes:['synthetic-a','synthetic-b']},
];
const reordered=value=>Array.isArray(value)?value.map(reordered):value&&typeof value==='object'
  ?Object.fromEntries(Object.entries(value).reverse().map(([k,v])=>[k,reordered(v)])):value;

test('production guard uses structural equality without changing other guards',()=>{
  const source=readFileSync(new URL('./commercial-service.js',import.meta.url),'utf8');
  assert.match(source,/import \{ isDeepStrictEqual \} from 'node:util'/);
  assert.match(source,/requireThat\(isDeepStrictEqual\(buildReportManifest\(recipients\).targets,batch.manifest\),'Perimetro report variato\.',409\)/);
  assert.match(source,/recipientsFingerprint\(recipients\)===batch.recipients_hash/);
  assert.match(source,/batch\?\.policy_hash===POLICY_HASH/);
});

test('JSONB property reordering is equal, including nested object keys',()=>{
  const original=manifest(),persisted=reordered(original);
  assert.notEqual(JSON.stringify(original),JSON.stringify(persisted));
  assert.ok(isDeepStrictEqual(original,persisted));
  const nested=[{details:{a:1,b:{c:2,d:3}},...original[0]}];
  assert.ok(isDeepStrictEqual(nested,reordered(nested)));
});

for(const field of ['key','name','kind','network','source'])test(`reject changed ${field}`,()=>{
  const original=manifest(),changed=manifest();changed[0][field]='different';
  assert.equal(isDeepStrictEqual(original,changed),false);
});

test('reject missing or additional fields, including undefined and type changes',()=>{
  const original=manifest();
  for(const modify of [v=>delete v[0].name,v=>v[0].extra=true,v=>v[0].name=undefined,v=>v[0].name=null,v=>v[0].key=42]){
    const changed=manifest();modify(changed);assert.equal(isDeepStrictEqual(original,changed),false);
  }
});

test('preserve array order and all membership and perimeter checks',()=>{
  const original=manifest();
  for(const modify of [v=>v.reverse(),v=>v.pop(),v=>v.push(v[0]),v=>v[1].agentCodes.reverse(),v=>v[1].agentCodes.pop(),v=>v[1].agentCodes.push('synthetic-c'),v=>v[0].agentCodes[0]='synthetic-other']){
    const changed=manifest();modify(changed);assert.equal(isDeepStrictEqual(original,changed),false);
  }
});
