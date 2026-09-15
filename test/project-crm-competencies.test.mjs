import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesCrmCompetency, projectRulesForCrm, resolveRuleBlocker, crmTypeFromPath } from '../src/lib/crmCompetencies.js';

test('CRM competencies are multiple and do not replace department associations', () => {
  const template = { id: 'a', attivo: true, competenze_crm: ['conto_terzi', 'b2b'], reparto_id: 'lab' };
  assert.equal(matchesCrmCompetency(template, 'conto_terzi'), true);
  assert.equal(matchesCrmCompetency(template, 'b2b'), true);
  assert.equal(matchesCrmCompetency(template, 'online'), false);
  assert.equal(matchesCrmCompetency(template, ''), true);
  assert.equal(matchesCrmCompetency({ competenze_crm: [] }, 'b2b'), false);
  assert.equal(template.reparto_id, 'lab');
});
test('only enabled checklist phases in the current CRM are generated, in configured order', () => {
  const rules = [{ id:'r1',tipo_progetto_id:'p',template_id:'a',ordine:3 },{ id:'r2',tipo_progetto_id:'p',template_id:'b',ordine:1 },{ id:'r3',tipo_progetto_id:'p',template_id:'c',ordine:2 }];
  const templates = [{ id:'a',attivo:true,competenze_crm:['b2b'] },{ id:'b',attivo:true,competenze_crm:['online'] },{ id:'c',attivo:false,competenze_crm:['b2b'] }];
  assert.deepEqual(projectRulesForCrm(rules,templates,'p','b2b').map(r=>r.id),['r1']);
  assert.deepEqual(projectRulesForCrm(rules,templates,'p','').map(r=>r.id),['r2','r1']);
});
test('excluded dependencies resolve to an included ancestor without inventing another dependency', () => {
  const rules=[{id:'r1'}, {id:'r2',dipende_da_id:'r1'}, {id:'r3',dipende_da_id:'r2'}];
  assert.equal(resolveRuleBlocker(rules[2],rules,new Map([['r1','phase1']]),'phaseOther'),'phase1');
  assert.equal(resolveRuleBlocker(rules[2],rules,new Map(),'phaseOther'),null);
  assert.equal(resolveRuleBlocker(rules[0],rules,new Map(),'phasePrevious'),'phasePrevious');
  assert.equal(resolveRuleBlocker({dipende_da_id:'cycle'},[{id:'cycle',dipende_da_id:'cycle'}],new Map(),null),null);
});
test('CRM return links retain their section and generic Workspace stays unfiltered', () => {
  assert.equal(crmTypeFromPath('/crm/brand-direct/progetti'),'brand_direct');
  assert.equal(crmTypeFromPath('/crm/b2b/pipeline/123'),'b2b');
  assert.equal(crmTypeFromPath('/crm/online?period=month'),'online');
  assert.equal(crmTypeFromPath('/crm/conto-terzi'),'conto_terzi');
  assert.equal(crmTypeFromPath('/activities/projects'),'');
});
