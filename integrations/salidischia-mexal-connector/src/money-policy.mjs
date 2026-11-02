// Historical policy retained solely to read verification proofs produced before
// November 2, 2026. New imports use the absolute ten-cent policy below.
export function sameFirstDecimal(a,b){
  return Number.isSafeInteger(a)&&Number.isSafeInteger(b)&&a>=0&&b>=0&&Math.floor(a/10)===Math.floor(b/10);
}
// Current user policy: an absolute difference of at most EUR 0.10, in either direction.
export function withinTenCents(a,b){
  return Number.isSafeInteger(a)&&Number.isSafeInteger(b)&&a>=0&&b>=0&&Math.abs(a-b)<=10;
}
export function moneyVerification(plan,totalCents,taxCents){
  const sourceTotalCents=plan.sourceTotals?.totalCents??plan.totalCents;
  const sourceTaxCents=plan.sourceTotals?.taxCents??plan.taxCents;
  if(!withinTenCents(totalCents,sourceTotalCents)||!withinTenCents(totalCents,plan.totalCents)||!withinTenCents(taxCents,sourceTaxCents)||!withinTenCents(taxCents,plan.taxCents))throw Error('Totali Mexal diversi dal sito oltre la tolleranza di 10 centesimi.');
  return{policy:'ten_cents',sourceTotalCents,mexalTotalCents:totalCents,sourceTaxCents,mexalTaxCents:taxCents,totalDifferenceCents:totalCents-sourceTotalCents,taxDifferenceCents:taxCents-sourceTaxCents};
}
