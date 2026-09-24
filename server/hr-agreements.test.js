import test from 'node:test';
import assert from 'node:assert/strict';
import { agreementValues, agreementDisplay, overtimeValue } from '../src/modules/hr/hrAgreements.js';
test('agreements preserve free text and do not value missing amounts as zero', () => {
  const c={agreement_fields:{agreed_pay:'CCNL B2',start_time:'a turni',overtime_rate:''},overtime_mode:'paid',overtime_rate:null,overtime_percent:25};
  assert.equal(agreementDisplay(c,'agreed_pay'), 'CCNL B2');
  assert.equal(agreementValues(c).start_time, 'a turni');
  assert.equal(overtimeValue(c,2), 'Da definire');
  assert.equal(agreementValues({weekdays:[1,2],agreed_pay:0}).weekdays,'1,2');
  assert.equal(agreementDisplay({agreed_pay:0},'agreed_pay'),'0');
  assert.notEqual(overtimeValue({...c,overtime_rate:0},2),'Da definire');
});

test('separate overtime is an explicit boolean and missing amounts remain undefined', () => {
  assert.equal(agreementValues({}).overtime_separate,false);
  assert.equal(agreementValues({overtime_separate:false}).overtime_separate,false);
  assert.equal(agreementValues({overtime_separate:true}).overtime_separate,true);
  assert.equal(agreementDisplay({overtime_separate:true},'overtime_separate'),'Sì');
  assert.equal(overtimeValue({overtime_separate:true,overtime_rate:20,overtime_percent:25},2),(50).toLocaleString('it-IT',{style:'currency',currency:'EUR'}));
});
