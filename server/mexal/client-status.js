const CANCELLATION_FIELDS = [
  // Campo realmente valorizzato dall'installazione Mexal corrente.
  "conto_precanc",
  "gest_annullato",
  "annullato",
  "precancellato",
];

const CANCELLATION_VALUES = new Set(["S", "Y", "TRUE", "1"]);

export function isMexalClientActive(client = {}) {
  const rawFlag = CANCELLATION_FIELDS
    .map((field) => client?.[field])
    .find((value) => value !== undefined && value !== null && String(value).trim() !== "");

  return !CANCELLATION_VALUES.has(String(rawFlag ?? "N").trim().toUpperCase());
}
