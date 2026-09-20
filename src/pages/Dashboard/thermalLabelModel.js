export function piecesInBox(quantity, piecesPerBox, index) {
  return piecesPerBox > 0 ? Math.max(0, Math.min(piecesPerBox, quantity - (index - 1) * piecesPerBox)) : null;
}
