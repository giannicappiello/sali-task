import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { supplySources, SOURCE_EXTENSIONS } from '../../hosting/ai-development/source-discovery.mjs';
import { createSourceTools } from './development-agent.js';

const snapshot = files => ({ files: Object.fromEntries(Object.entries(files).map(([path, text]) => [path, Buffer.from(text).toString('base64')])) });
test('a component preloads its local services/styles/imports from the same snapshot', () => {
  const source = snapshot({
    'src/Hr.jsx': "import './hr.css'; import { load } from './service'; import View from './View'; import React from 'react';",
    'src/hr.css': '.hr {}', 'src/service.js': 'export const load = 1;',
    'src/View/index.jsx': "import '../unrelated.js';", 'src/unrelated.js': 'not needed yet',
  });
  const supplied = {};
  assert.deepEqual(supplySources(source, Object.keys(source.files), supplied, ['src/Hr.jsx']), ['src/Hr.jsx', 'src/hr.css', 'src/service.js', 'src/View/index.jsx']);
  assert.equal(supplied['src/unrelated.js'], undefined);
  assert.throws(() => supplySources(source, Object.keys(source.files), supplied, ['src/Hr.jsx']), /già disponibili/);
});
test('discovery rejects out-of-revision and sensitive paths and bounds payload size', () => {
  const source = snapshot({ 'src/a.js': 'a', '.env': 'secret', 'src/b.js': 'x'.repeat(200001) });
  const index = Object.keys(source.files);
  for (const path of ['../a.js', '.env', 'absent.js']) assert.throws(() => supplySources(source, index, {}, [path]), /fuori dalla revisione/);
  assert.throws(() => supplySources(source, index, {}, ['src/b.js']), /troppo grande/);
  assert.throws(() => supplySources(source, index, { existing: 'x'.repeat(1800000) }, ['src/a.js']), /Contesto sorgenti completo/);
  assert.ok(SOURCE_EXTENSIONS.test('worker.mjs'));
});
test('batch source reads acquire all missing dependencies in one pass', async () => {
  const state = createSourceTools({ index: ['a.js', 'b.js', 'c.js'], files: { 'a.js': 'known' } });
  const result = await state.tools.SOURCE_READ_MANY.execute({ paths: ['a.js', 'b.js', 'c.js', '../secret'] });
  assert.equal(result[0].content, 'known');
  assert.deepEqual([...state.requiredFiles], ['b.js', 'c.js']);
  assert.ok(result[3].error);
});
