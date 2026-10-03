import test from 'node:test';
import assert from 'node:assert/strict';
import { getProgremesScreenLevels, isProgremesScreenAuthorized } from './progremes-sso.js';

test('MES uses effective Workspace screen levels without department filters', async () => {
  const levels = {'progremes.StoricoProduzioni':'amministrazione','progremes.MonitoraggioTempi':'lettura','progremes.PlanningProduction':'nessuno'};
  const admin = {from(){throw Error('Unexpected department query');},async rpc(name,args){
    assert.equal(name,'workspace_progremes_screen_levels_for_user');
    assert.deepEqual(args,{target_user_id:'maria'});return {data:levels};
  }};
  const result=await getProgremesScreenLevels(admin,'maria');
  assert.equal(isProgremesScreenAuthorized(result,'progremes.StoricoProduzioni'),true);
  assert.equal(isProgremesScreenAuthorized(result,'progremes.MonitoraggioTempi'),true);
  assert.equal(isProgremesScreenAuthorized(result,'progremes.PlanningProduction'),false);
  assert.equal(isProgremesScreenAuthorized(result,'progremes.Unknown'),false);
});
test('a denied sibling screen never inherits another screen permission', () => {
  const levels={'progremes.Ordini.Produzione':'scrittura','progremes.Ordini.Cliente':'nessuno'};
  assert.equal(isProgremesScreenAuthorized(levels,'progremes.Ordini.Produzione'),true);
  assert.equal(isProgremesScreenAuthorized(levels,'progremes.Ordini.Cliente'),false);
});
test('authorization lookup errors fail closed', async () => {
  await assert.rejects(getProgremesScreenLevels({rpc:async()=>({error:{message:'offline'}})},'maria'),{status:503});
});
