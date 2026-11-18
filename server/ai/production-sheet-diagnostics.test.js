import test from 'node:test';
import assert from 'node:assert/strict';
import { productionSheetMaterialRows } from './production-sheet-diagnostics.js';
test('material diagnostics preserve lot assignments as text without exposing active HTML or guessing shortages', () => {
  const html = '<table><tr><td>Data</td><td>Header</td></tr><tr><td><b>MP2044</b></td><td>Texapon &amp; SLES<script>secret()</script></td><td>4.499,775</td><td>Lotto: 6330 - 795,000 KG<br>Lotto: 6707 - 3.704,775 KG</td></tr></table>';
  assert.deepEqual(productionSheetMaterialRows(html), [{ articleCode: 'MP2044', cells: ['MP2044', 'Texapon & SLES', '4.499,775', 'Lotto: 6330 - 795,000 KG Lotto: 6707 - 3.704,775 KG'] }]);
  assert.deepEqual(productionSheetMaterialRows(null), []);
});
