import test from "node:test";
import assert from "node:assert/strict";
import { availableControlledActions, CONTROLLED_AI_ACTIONS, decideControlledAction, proposeControlledAction } from "./controlled-actions.js";

test('legacy labels without executors are never offered even to an administrator', () => {
  const available = availableControlledActions({ profile: { ruoli: { amministratore_workspace: true } }, capabilities: { progremes: true } });
  for (const tool of ['RDP_UPDATE', 'OP_UPDATE', 'PLANNING_CRITERIA_UPDATE', 'LOT_DOCUMENT_LINK', 'PURCHASE_PROPOSAL_CREATE', 'MONITOR_RULE_CREATE']) assert.equal(available[tool], undefined);
  assert.ok(available.MES_PLAN_APPLY);
  assert.ok(available.MES_PRIORITY_REVISE);
});

test("manual planning exposes only its two tools without granting arbitrary AI actions", () => {
  const actions = availableControlledActions({ manualPlanning: true, profile: { ruoli: {} }, capabilities: {} });
  assert.deepEqual(Object.keys(actions).sort(), ["MES_ODL_VERIFY", "MES_PLAN_APPLY"]);
});

test("manual decision cannot consume a different tool or an AI-originated proposal", async () => {
  for (const pending of [{ tool: "LOT_OVERRIDE", action: "manual_planning" }, { tool: "MES_PLAN_APPLY", action: "mes_plan_apply" }]) {
    const chain = { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: pending }; } };
    const auth = { manualPlanning: true, profile: { id: "operator" }, scoped: { from: () => chain, rpc: () => assert.fail("Must not decide") } };
    await assert.rejects(decideControlledAction(auth, { proposalId: "id", decision: "confirm" }), /pianificazione manuale/);
  }
});

test("le azioni operative MES sono esplicite e la forzatura lotto è distruttiva", () => {
  assert.equal(CONTROLLED_AI_ACTIONS.LOT_OVERRIDE.system, "mes");
  assert.equal(CONTROLLED_AI_ACTIONS.LOT_OVERRIDE.risk, "destructive");
  assert.equal(CONTROLLED_AI_ACTIONS.UI_CONFIGURE_VIEW.system, "workspace");
  assert.equal(CONTROLLED_AI_ACTIONS.MES_UI_CONFIGURE_VIEW.system, "mes");
});

test("un profilo senza AI di bozza non riceve strumenti di scrittura", () => {
  assert.deepEqual(availableControlledActions({ profile: { ruoli: {} }, capabilities: { role_ai_level: "analisi", progremes: true } }), {});
});

test("le azioni MES non sono esposte senza accesso ProgreMES", () => {
  const actions = availableControlledActions({ profile: { ruoli: {} }, capabilities: { role_ai_level: "conferma", progremes: false } });
  assert.ok(actions.UI_CONFIGURE_VIEW);
  assert.equal(actions.OP_UPDATE, undefined);
  assert.equal(actions.MES_UI_CONFIGURE_VIEW, undefined);
});

test('model cannot propose actions outside the current business and AI write scope', () => {
  const auth = {profile:{ruoli:{}},capabilities:{role_ai_level:'conferma',progremes:true,allowed_modules:['prodotti']},access:{module_levels:{prodotti:'lettura',progremes:'scrittura'}}};
  assert.equal(availableControlledActions(auth).ARTICLE_UPDATE,undefined);
  assert.equal(availableControlledActions(auth).OP_UPDATE,undefined);
  assert.equal(availableControlledActions(auth).ACCESS_ROLE_UPDATE,undefined);
  auth.access.module_levels.prodotti='scrittura';
  assert.ok(availableControlledActions(auth).ARTICLE_UPDATE);
});

test('confirmation rechecks permissions after a proposal was created', async () => {
  for (const level of ['analisi', 'bozza', 'conferma']) {
    const pending = { id:'proposal', tool:'ARTICLE_UPDATE', status:'proposed' };
    const chain = {select(){return this;},eq(){return this;},async maybeSingle(){return {data:pending};}};
    const auth = {profile:{id:'operator',ruoli:{}},capabilities:{role_ai_level:level,allowed_modules:['prodotti']},access:{module_levels:{prodotti:level === 'conferma' ? 'lettura' : 'scrittura'}},scoped:{from:()=>chain,rpc:()=>assert.fail('Revoked or draft-only access must not mutate')}};
    await assert.rejects(decideControlledAction(auth,{proposalId:'proposal',decision:'confirm'}), error => error.status === 403);
  }
});

test('invalid decision does not silently reject a proposal', async () => {
  await assert.rejects(decideControlledAction({}, {proposalId:'proposal',decision:'approve'}), error => error.status === 400);
});

test('layout preview binds the database version instead of trusting a supplied version', async () => {
  for (const current of [null, { current_version: 7 }]) {
    let captured;
    const chain = { select(){return this;}, eq(){return this;}, is(){return this;}, async maybeSingle(){return {data:current};} };
    const auth = {profile:{id:'admin',ruoli:{amministratore_workspace:true}},scoped:{
      from:()=>chain, rpc:async (_name,params)=>{captured=params.p_payload;return {data:{id:'proposal'}};},
    }};
    await proposeControlledAction(auth,'UI_CONFIGURE_VIEW',{targetType:'screen',targetCode:'tasks',scopeType:'global',expectedVersion:999});
    assert.equal(captured.expectedVersion,current?.current_version ?? 0);
  }
});
