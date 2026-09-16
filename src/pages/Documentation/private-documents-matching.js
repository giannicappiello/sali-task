const sameId = (left, right) => Number(left || 0) > 0 && Number(left) === Number(right);

export function documentsForLot(documents, lot) {
  return (documents || []).filter((document) => {
    if (document.associationType === "Articolo") return true;
    // A lot-specific document must never leak to another lot sharing the same order.
    if (document.lotCode) return document.lotCode.toLowerCase() === String(lot.lotCode || "").toLowerCase();
    if (document.stockLotId) return sameId(document.stockLotId, lot.stockLotId);
    if (document.productionId) return sameId(document.productionId, lot.productionId);
    return sameId(document.productionOrderId, lot.productionOrderId);
  });
}
