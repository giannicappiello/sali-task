export const PRODUCT_OPTION_KIND = Object.freeze({
  MEXAL: "mexal-product",
  LOCAL_IMPLANT: "local-implant",
});

export function productOptionCode(product) {
  return String(product?.codice_articolo || product?.codice_mexal || product?.codice || "").trim().toUpperCase();
}

export function productOptionKind(product) {
  return product?.option_kind === PRODUCT_OPTION_KIND.LOCAL_IMPLANT || product?.is_impianto
    ? PRODUCT_OPTION_KIND.LOCAL_IMPLANT
    : PRODUCT_OPTION_KIND.MEXAL;
}

export function productOptionKey(product) {
  const kind = productOptionKind(product);
  const identity = kind === PRODUCT_OPTION_KIND.LOCAL_IMPLANT
    ? String(product?.id || productOptionCode(product))
    : productOptionCode(product);
  return `${kind}:${identity}`;
}

export function productOptionTypeLabel(product) {
  return productOptionKind(product) === PRODUCT_OPTION_KIND.LOCAL_IMPLANT
    ? "Impianto locale"
    : "Articolo Mexal";
}

export function findMexalProductByCode(products, code) {
  const normalizedCode = String(code || "").trim().toUpperCase();
  return (products || []).find((product) =>
    productOptionKind(product) === PRODUCT_OPTION_KIND.MEXAL && productOptionCode(product) === normalizedCode
  ) || null;
}
