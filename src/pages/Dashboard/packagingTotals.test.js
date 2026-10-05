import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePackagingTotals } from './packagingTotals.js';

test('includes full pallets, full boxes and pieces from the incomplete box', () => {
  const input = { piecesPerBox: '12', boxesPerLayer: '10', layersPerPallet: '5', pallets: '2', incompletePalletFullBoxes: '8', incompletePalletPiecesPerBox: '7', incompletePalletCount: 3, incompletePalletPartialBoxes: 2 };
  assert.deepEqual(calculatePackagingTotals(input), { piecesPerPallet: 600, produced: 1303 });
  assert.deepEqual(calculatePackagingTotals({ ...input, piecesPerBox: '10' }), { piecesPerPallet: 500, produced: 1087 });
});
test('supports loose boxes without full pallets and clears totals for missing data', () => {
  assert.deepEqual(calculatePackagingTotals({ piecesPerBox: 12, boxesPerLayer: 0, layersPerPallet: 0, pallets: 0, incompletePalletFullBoxes: 8, incompletePalletPiecesPerBox: 7 }), { piecesPerPallet: 0, produced: 103 });
  assert.deepEqual(calculatePackagingTotals({ piecesPerBox: 12, boxesPerLayer: '', layersPerPallet: 5, pallets: 1 }), { piecesPerPallet: null, produced: null });
});
