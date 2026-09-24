import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('src/App.jsx', 'utf8');
const layout = fs.readFileSync('src/components/Layout.jsx', 'utf8');
const assistant = fs.readFileSync('src/components/ContextualAIAssistant.jsx', 'utf8');
const assistantCss = fs.readFileSync('src/components/unified-assistant.css', 'utf8');
const hr = fs.readFileSync('src/modules/hr/HrModule.jsx', 'utf8');
const hrCss = fs.readFileSync('src/modules/hr/hr.css', 'utf8');
const pwa = fs.readFileSync('vite.config.js', 'utf8');

test('settings HR uses the production route and shared contextual assistant', () => {
  assert.match(app, /path="settings\/hr" element={<SettingsAccessGuard adminOnly><HrModule key="hr-config" configuration \/><\/SettingsAccessGuard>} \/>/);
  assert.match(layout, /<ContextualAIAssistant title=\{screenHeader\?\.title \|\| currentPage\.title\}/);
  assert.match(assistant, /import ['"]\.\/unified-assistant\.css['"]/);
  assert.match(hr, /import ['"]\.\/hr\.css['"]/);
});

test('shared assistant panel keeps chat content bounded and readable', () => {
  assert.match(assistantCss, /width:min\(960px,100vw\)/);
  assert.match(assistantCss, /min-width:0;min-height:0;max-height:none;height:100%;overflow:hidden/);
  assert.match(assistantCss, /overflow-wrap:anywhere;word-break:break-word/);
  assert.match(assistantCss, /overflow-x:hidden;overflow-y:auto/);
});

test('HR configuration layout prevents card children from forcing overlap', () => {
  assert.match(hrCss, /\.hr-page\{[^}]*width:100%;min-width:0/);
  assert.match(hrCss, /\.hr-master-detail>\*\{min-width:0\}/);
  assert.match(hrCss, /\.hr-controls>\*\{min-width:0\}/);
});

test('PWA shell is configured to clean old published assets', () => {
  assert.match(pwa, /cleanupOutdatedCaches: true/);
  assert.match(pwa, /cacheId: "workspace-assets-v3"/);
});
