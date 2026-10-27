// Same policy as the website connector: compare euro and first decimal.
// A one-cent difference across a tenth boundary must still be rejected.
export function sameFirstDecimal(a,b) {
  return Number.isSafeInteger(a) && Number.isSafeInteger(b) && a>=0 && b>=0 && Math.floor(a/10)===Math.floor(b/10);
}
