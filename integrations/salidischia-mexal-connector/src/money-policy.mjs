// User policy: euro and first decimal must match. Never use a floating epsilon
// or a distance-only tolerance (62.09 and 62.10 belong to different buckets).
export function sameFirstDecimal(a,b){
  return Number.isSafeInteger(a)&&Number.isSafeInteger(b)&&a>=0&&b>=0&&Math.floor(a/10)===Math.floor(b/10);
}
export function moneyVerification(plan,totalCents,taxCents){
  const sourceTotalCents=plan.sourceTotals?.totalCents??plan.totalCents;
  const sourceTaxCents=plan.sourceTotals?.taxCents??plan.taxCents;
  if(!sameFirstDecimal(totalCents,sourceTotalCents)||!sameFirstDecimal(totalCents,plan.totalCents)||!sameFirstDecimal(taxCents,sourceTaxCents)||!sameFirstDecimal(taxCents,plan.taxCents))throw Error('Totali Mexal diversi dal sito alla prima cifra decimale.');
  return{policy:'first_decimal',sourceTotalCents,mexalTotalCents:totalCents,sourceTaxCents,mexalTaxCents:taxCents,totalDifferenceCents:totalCents-sourceTotalCents,taxDifferenceCents:taxCents-sourceTaxCents};
}
