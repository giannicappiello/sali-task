const EPSILON = 0.009;

function numeric(value, fallback = 0) {
  const parsed = Number(
    String(value ?? "")
      .replace(/%/g, "")
      .replace(",", ".")
      .trim()
  );
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function roundCurrency(value) {
  return Math.round((numeric(value) + Number.EPSILON) * 100) / 100;
}

export function parseDiscountSequence(value) {
  if (value === null || value === undefined || value === "") return [];
  return String(value)
    .replace(/%/g, "")
    .replace(/,/g, ".")
    .split("+")
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isFinite(part));
}

export function applySequentialDiscounts(listPrice, discountSequence) {
  return parseDiscountSequence(discountSequence).reduce(
    (price, percentage) => price * (1 - percentage / 100),
    numeric(listPrice)
  );
}

export function calculateOrderLineEconomics(line) {
  const quantita = numeric(line.quantita_documento ?? line.quantita);
  const prezzoListino = numeric(line.prezzo_listino ?? line.prezzo_unitario ?? line.prezzo);
  const scontoCommerciale = String(line.sconto_commerciale ?? line.sconto ?? "").trim();
  const aliquotaIva = numeric(line.aliquota_iva ?? line.iva_percentuale ?? line.iva);
  const prezzoNettoUnitario = applySequentialDiscounts(prezzoListino, scontoCommerciale);
  const imponibileRiga = roundCurrency(prezzoNettoUnitario * quantita);
  const ivaRiga = roundCurrency(imponibileRiga * aliquotaIva / 100);
  const totaleRiga = roundCurrency(imponibileRiga + ivaRiga);

  return {
    ...line,
    quantita,
    prezzo_listino: prezzoListino,
    sconto_commerciale: scontoCommerciale,
    prezzo_netto: prezzoNettoUnitario,
    aliquota_iva: aliquotaIva,
    imponibile_riga: imponibileRiga,
    iva_riga: ivaRiga,
    totale_riga: totaleRiga,
  };
}

export function calculateOrderEconomics(lines) {
  const righe = (lines || []).map(calculateOrderLineEconomics);
  const totaleImponibile = roundCurrency(righe.reduce((sum, line) => sum + line.imponibile_riga, 0));
  const totaleIva = roundCurrency(righe.reduce((sum, line) => sum + line.iva_riga, 0));
  return {
    righe,
    totale_imponibile: totaleImponibile,
    totale_iva: totaleIva,
    totale_documento: roundCurrency(totaleImponibile + totaleIva),
  };
}

function firstMexalTotal(value) {
  if (Array.isArray(value)) {
    const first = value[0];
    if (Array.isArray(first)) return numeric(first[first.length - 1]);
  }
  return numeric(value);
}

export function reconcileMexalTotals(workspaceTotals, mexalDocument, tolerance = EPSILON) {
  const mexal = {
    totale_iva: firstMexalTotal(mexalDocument?.tot_iva),
    totale_documento: firstMexalTotal(mexalDocument?.tot_documento),
  };
  const workspace = {
    totale_iva: roundCurrency(workspaceTotals?.totale_iva),
    totale_documento: roundCurrency(workspaceTotals?.totale_documento),
  };
  const differenze = {
    totale_iva: roundCurrency(workspace.totale_iva - mexal.totale_iva),
    totale_documento: roundCurrency(workspace.totale_documento - mexal.totale_documento),
  };
  return {
    workspace,
    mexal,
    differenze,
    coincide: Math.abs(differenze.totale_iva) <= tolerance && Math.abs(differenze.totale_documento) <= tolerance,
  };
}

export function assertMexalTotalsMatch(workspaceTotals, mexalDocument, tolerance = EPSILON) {
  const result = reconcileMexalTotals(workspaceTotals, mexalDocument, tolerance);
  if (!result.coincide) {
    const error = new Error(`Totali Workspace/Mexal non coincidenti: IVA ${result.differenze.totale_iva}, documento ${result.differenze.totale_documento}.`);
    error.code = "MEXAL_TOTALS_MISMATCH";
    error.reconciliation = result;
    throw error;
  }
  return result;
}
