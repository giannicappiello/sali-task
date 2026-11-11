import { assert, integer, validatePacking, isPackingProductCode } from './orderPreparation.js';

export function palletQuantity(piecesPerCarton, boxesPerPallet) {
  const pieces = integer(piecesPerCarton, 'Pezzi per collo');
  const boxes = integer(boxesPerPallet, 'Colli per bancale', 1, 2000);
  return integer(pieces * boxes, 'Pezzi per bancale');
}

// One capture is saved atomically under one replay-safe event, even for batches.
export function appendPreparationScan(state, product, body, event, actor, makeId, at) {
  assert(isPackingProductCode(product.code), 'Solo gli articoli IT e MKT possono essere inseriti nei colli.');
  state = structuredClone(state);
  const mode = body.mode;
  assert(['piece', 'carton', 'pallet'].includes(mode), 'Modalità non valida.');
  const units = integer(body.units ?? 1, 'Quantità', 1, 10000);
  let pack = state.packages.find(item => item.id === body.packageId);
  let palletId = body.palletId || pack?.palletId;
  assert(mode !== 'pallet' || state.pallets.some(item => item.id === palletId), 'Seleziona un bancale.');
  assert(!pack || pack.palletId === palletId || mode !== 'pallet', 'Collo e bancale non corrispondenti.');
  if (!pack) {
    assert(body.createPackage === true && state.pallets.some(item => item.id === palletId), 'Collo non valido.');
    pack = { id: body.packageId, number: Math.max(0, ...state.packages.map(item => item.number)) + 1, palletId };
    state.packages.push(pack);
  }
  assert(!pack.closed, 'Riapri il collo prima di aggiungere prodotti.');
  const quantity = mode === 'piece' ? 1 : integer(product.piecesPerCarton, 'Pezzi per collo');
  const boxesPerPallet = mode === 'pallet' ? integer(product.boxesPerPallet, 'Colli per bancale', 1, 2000) : 1;
  if (mode === 'pallet') {
    palletQuantity(quantity, boxesPerPallet);
    assert(!state.scans.some(scan => scan.packageId === pack.id), 'Per leggere un bancale seleziona un collo vuoto.');
    assert(!state.packages.some(item => item.palletId === palletId && item.id !== pack.id), 'La lettura Bancale richiede un bancale vuoto.');
  }
  const count = mode === 'pallet' ? boxesPerPallet * units : units;
  assert(state.scans.length + count <= 10000 && state.packages.length + (mode === 'piece' ? 0 : count - 1) <= 2000 && state.pallets.length + (mode === 'pallet' ? units - 1 : 0) <= 200, 'Preparazione troppo estesa.');
  for (let index = 0; index < count; index++) {
    if (mode === 'pallet' && index > 0 && index % boxesPerPallet === 0) {
      palletId = makeId();
      state.pallets.push({id:palletId,number:Math.max(0,...state.pallets.map(item=>item.number))+1});
    }
    if (index && mode !== 'piece') {
      pack = { id: makeId(), number: Math.max(0, ...state.packages.map(item => item.number)) + 1, palletId };
      state.packages.push(pack);
    }
    state.scans.push({ id: index ? makeId() : event, operationId: event, packageId: pack.id,
      barcode: product.scannedValue, code: product.code, mode, quantity, actor, at,
      ...(mode !== 'piece' ? { specificationVersion: product.packagingSpecificationVersion,
        piecesPerCarton: quantity, ...(mode === 'pallet' ? { boxesPerPallet, piecesPerPallet: quantity * boxesPerPallet } : {}) } : {}),
    });
  }
  state.confirmedLots = false;
  return validatePacking(state);
}
