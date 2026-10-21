import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Window } from 'happy-dom';
import { stableSortTableRows, TABLE_COLUMN_QUERY_EVENT, tableValueMatches } from '../src/components/tableColumnControls.js';

const source = (await readFile(process.env.TABLE_CONTROLS_SOURCE || new URL('../src/components/GlobalTableColumnControls.jsx', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*?;\r?\n/gm, '')
  .replace('export default function', 'function');

function mount() {
  const window = new Window();
  const document = window.document;
  // Happy DOM implements table/cell collections but not section.rows yet.
  Object.defineProperty(window.HTMLTableSectionElement.prototype, 'rows', {
    configurable: true, get() { return this.querySelectorAll(':scope > tr'); },
  });
  const frames = new Map();
  const sets = [];
  let serial = 0, cleanup;
  class TrackedSet extends Set { constructor(...args) { super(...args); sets.push(this); } }
  window.requestAnimationFrame = callback => { frames.set(++serial, callback); return serial; };
  window.cancelAnimationFrame = id => frames.delete(id);
  document.body.innerHTML = '<table><thead><tr><th>Nome</th><th>Quantità</th></tr></thead><tbody><tr><td>Beta</td><td>20</td></tr><tr><td>Alfa</td><td>10</td></tr></tbody></table>';
  const table = document.querySelector('table');
  new Function('useEffect', 'window', 'document', 'MutationObserver', 'Element', 'HTMLInputElement', 'HTMLSelectElement', 'CustomEvent', 'Set',
    'stableSortTableRows', 'TABLE_COLUMN_QUERY_EVENT', 'tableValueMatches', `${source}\nGlobalTableColumnControls();`)(
    effect => { cleanup = effect(); }, window, document, window.MutationObserver, window.Element, window.HTMLInputElement,
    window.HTMLSelectElement, window.CustomEvent, TrackedSet, stableSortTableRows, TABLE_COLUMN_QUERY_EVENT, tableValueMatches);
  assert.equal(table.querySelectorAll('[data-column-control]').length, 2, 'Controls must actually mount before testing their lifecycle');
  return { window, document, table, frames, sets: [...sets],
    async settle(limit = 8) {
      for (let i = 0; i < limit; i++) {
        await new Promise(resolve => setTimeout(resolve, 5));
        if (!frames.size) return i;
        const callbacks = [...frames.values()]; frames.clear();
        callbacks.forEach(callback => callback());
      }
      throw new Error(`Table observer did not become idle after ${limit} animation frames`);
    },
    async close() { cleanup(); await window.happyDOM.close(); },
  };
}

test('an unchanged table becomes idle instead of scheduling frames forever', async () => {
  const h = mount();
  try { await h.settle(); assert.equal(h.frames.size, 0); }
  finally { await h.close(); }
});

test('navigation releases detached tables while global controls remain mounted', async () => {
  const h = mount();
  try {
    h.table.remove();
    await h.settle();
    assert.equal(h.sets.some(set => set.has(h.table)), false, 'Detached table is still held by a long-lived Set');
  } finally { await h.close(); }
});

test('sorting, filtering and new rows still work and return to idle', async () => {
  const h = mount();
  try {
    await h.settle();
    h.table.querySelector('[data-sort-button]').click();
    await h.settle();
    assert.equal(h.table.tBodies[0].rows[0].cells[0].textContent, 'Alfa');
    const filter = h.table.querySelector('input');
    filter.value = 'beta';
    filter.dispatchEvent(new h.window.Event('input', { bubbles: true }));
    assert.deepEqual([...h.table.tBodies[0].rows].filter(row => !row.hidden).map(row => row.cells[0].textContent), ['Beta']);
    const row = h.document.createElement('tr'); row.innerHTML = '<td>Beta nuova</td><td>30</td>';
    h.table.tBodies[0].append(row);
    await h.settle();
    assert.equal(row.hidden, false);
    assert.equal(h.table.querySelectorAll('[data-column-control]').length, 2);
  } finally { await h.close(); }
  assert.equal(h.table.querySelectorAll('[data-column-control]').length, 0);
});
