export function calculatePackagingTotals(actual) {
  const number = value => value === '' || value == null ? null : Number(value);
  const pieces = number(actual.piecesPerBox);
  const boxes = number(actual.boxesPerLayer);
  const layers = number(actual.layersPerPallet);
  const pallets = number(actual.pallets);
  const piecesPerPallet = [pieces, boxes, layers].some(value => value == null) ? null : pieces * boxes * layers;
  const produced = pieces == null || pallets == null || (pallets > 0 && piecesPerPallet == null)
    ? null
    : (piecesPerPallet ?? 0) * pallets + pieces * Number(actual.incompletePalletFullBoxes || 0) + Number(actual.incompletePalletPiecesPerBox || 0);
  return { piecesPerPallet, produced };
}
