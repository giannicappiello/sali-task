import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveUiSourceContext } from './ui-source-context.js';
import { developmentTools } from './development-jobs.js';
import { createSourceTools, generateDevelopmentChange } from './development-agent.js';

const context = { system: 'mes', surface: 'popup', path: '/pianificazione-produzione', title: 'RDP29 · Batch 1', recordId: '5444', selection: 'batchNumber: 1', visibleSummary: 'MP2066 mancante' };
test('popup is located without a separate URL; candidate paths are repository-specific', () => {
  const target = resolveUiSourceContext(context);
  assert.equal(target.parentPath, context.path);
  assert.equal(target.repository, 'mes');
  assert.ok(target.sourceCandidates.includes('Modules/APS/Components/ProductionBatchPanel.razor'));
  assert.match(target.navigation, /non richiede un URL/);
  assert.equal(target.recordId, '5444');
  assert.equal(resolveUiSourceContext(null), null);
  const local = resolveUiSourceContext({ ...context, system: 'workspace', path: '/activities/dashboard', title: 'Foglio di produzione' });
  assert.ok(local.sourceCandidates.includes('src/pages/Dashboard/PreparationActions.jsx'));
  assert.ok(local.sourceCandidates.every(path => path.startsWith('src/')));
  const hr = resolveUiSourceContext({ system: 'workspace', surface: 'popup', path: '/settings/hr', title: 'Scheda e accordi · Dipendente', screenCode: '', targetCode: '' });
  assert.ok(hr.sourceCandidates.includes('src/modules/hr/HrModule.jsx'));
  assert.equal(hr.repository, 'workspace');
});
test('admin development job automatically persists popup context even if model omits it', async () => {
  let row;
  const auth = { screenContext: context, conversationId: 'conversation', profile: { id: 'admin', ruoli: { amministratore_workspace: true } }, admin: {
    from: () => ({ insert: value => { row = value; return { select: () => ({ single: async () => ({ data: value }) }) }; } })
  } };
  const tools = developmentTools(auth);
  assert.equal((await tools.CODE_LOCATE_UI.execute()).target.repository, 'mes');
  await tools.CODE_CHANGE_REQUEST.execute({ repository: 'mes', instruction: 'Compatta i testi di questo popup.', publish: false });
  assert.equal(row.instruction, 'Compatta i testi di questo popup.');
  assert.equal(row.result.requestContext.recordId, '5444');
  assert.equal(row.result.requestContext.visibleSummary, 'MP2066 mancante');
  assert.equal(row.publish_requested, false);
  assert.equal(row.conversation_id, 'conversation');
  assert.equal(developmentTools({ profile: { ruoli: {} } }).CODE_LOCATE_UI, undefined);
});
test('developer preloads existing popup components without an AI call or invented file', async () => {
  const requestContext = resolveUiSourceContext(context);
  const path = 'Modules/APS/Components/ProductionBatchPanel.razor';
  const result = await generateDevelopmentChange({}, { repository: 'mes', result: { requestContext } }, { index: [path], files: {} });
  assert.deepEqual(result.requiredFiles, [path]);
  assert.deepEqual(result.edits, []);
});
test('developer can find component files and locate visible strings with honest search scope', async () => {
  const path = 'Modules/APS/Components/ProductionBatchPanel.razor';
  const state = createSourceTools({ index: [path, 'Modules/APS/Pages/Planner.razor'], files: { [path]: '<dialog>\n<h2>Produzione batch</h2>\n</dialog>' } });
  assert.deepEqual((await state.tools.SOURCE_FIND_FILES.execute({ query: 'ProductionBatch' })).paths, [path]);
  const search = await state.tools.SOURCE_SEARCH.execute({ text: 'Produzione batch' });
  assert.equal(search.matches[0].line, 2);
  assert.equal(search.matches[0].path, path);
  assert.equal(search.suppliedFiles, 1);
  assert.equal(search.repositoryFiles, 2);
  assert.deepEqual((await state.tools.SOURCE_SEARCH.execute({ text: 'assente' })).matches, []);
});
