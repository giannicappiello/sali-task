function text(value) {
  return String(value ?? "").trim();
}

function number(value) {
  const parsed = Number(text(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value) {
  if (value === null || value === undefined || text(value) === "") return null;
  const parsed = Number(text(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1_000_000) / 1_000_000;
}

export function applyMexalDiscount(amount, discount) {
  const raw = text(discount);
  if (!raw) return roundMoney(amount);
  if (/^SC\.?\s*MERCE$/i.test(raw)) return 0;
  const percentages = raw.split("+").map((part) => {
    const normalized = part.trim().replace("%", "").replace(",", ".");
    if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) && parsed >= -100 && parsed <= 100 ? parsed : null;
  });
  if (percentages.some((value) => value === null)) return null;
  return roundMoney(percentages.reduce(
    (net, percentage) => net * (1 - (percentage / 100)),
    Number(amount),
  ));
}

function matrixMap(value, valueIndex = 1) {
  const result = new Map();
  if (!Array.isArray(value)) return result;
  for (const row of value) {
    if (!Array.isArray(row) || row.length <= valueIndex) continue;
    result.set(Number(row[0]), row[valueIndex]);
  }
  return result;
}

function matrixNumbers(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(Array.isArray)
    .map((row) => nullableNumber(row[row.length - 1]))
    .filter((item) => item !== null && item >= -100 && item <= 100);
}

function firstLineMatrix(detail, keys) {
  for (const key of keys) {
    if (detail?.[key] !== undefined) return matrixMap(detail[key]);
  }
  return new Map();
}

export function invoiceLines(detail) {
  const documentDiscounts = matrixNumbers(detail.sc_merce_doc);
  const sigla = text(detail.sigla).toUpperCase();
  const moduleCode = text(detail.cod_modulo).toUpperCase();
  const pricesIncludeVat = ["CO", "OC"].includes(sigla) && moduleCode === "X";
  const fields = {
    id_riga: matrixMap(detail.id_riga),
    tipo_riga: matrixMap(detail.tp_riga),
    codice_articolo: matrixMap(detail.codice_articolo),
    descrizione: matrixMap(detail.descr_articolo),
    quantita: matrixMap(detail.quantita),
    prezzo_unitario: matrixMap(detail.prezzo),
    sconto: matrixMap(detail.sconto),
    aliquota_iva: matrixMap(detail.cod_iva),
    codice_agente_mexal: matrixMap(detail.cod_agente, 2),
    prezzo_netto_mexal: firstLineMatrix(detail, ["prezzo_netto", "prezzo_scontato"]),
    valore_netto_mexal: firstLineMatrix(detail, ["imponibile_riga", "importo_netto_riga", "valore_netto_riga"]),
  };
  const positions = [...new Set(
    Object.values(fields).flatMap((values) => [...values.keys()]),
  )];
  return positions.sort((a, b) => a - b).map((position) => {
    const quantita = number(fields.quantita.get(position));
    const prezzoUnitario = number(fields.prezzo_unitario.get(position));
    const sconto = text(fields.sconto.get(position)) || null;
    const valoreLordo = roundMoney(quantita * prezzoUnitario);
    const prezzoNettoMexal = nullableNumber(fields.prezzo_netto_mexal.get(position));
    const valoreNettoMexal = nullableNumber(fields.valore_netto_mexal.get(position));
    const valoreNettoRiga = prezzoNettoMexal === null
      ? applyMexalDiscount(valoreLordo, sconto)
      : roundMoney(quantita * prezzoNettoMexal);
    const valoreNettoConScontoDocumento = valoreNettoRiga === null
      ? null
      : roundMoney(documentDiscounts.reduce(
        (net, percentage) => net * (1 - (percentage / 100)),
        valoreNettoRiga,
      ));
    const aliquotaIva = nullableNumber(fields.aliquota_iva.get(position));
    const valoreNettoCalcolato = valoreNettoConScontoDocumento === null
      ? null
      : pricesIncludeVat && aliquotaIva > 0
        ? roundMoney(valoreNettoConScontoDocumento / (1 + aliquotaIva / 100))
        : valoreNettoConScontoDocumento;
    const valoreNetto = valoreNettoMexal ?? valoreNettoCalcolato;
    const prezzoNettoUnitario = prezzoNettoMexal ?? (
      valoreNetto === null || quantita === 0 ? null : roundMoney(valoreNetto / quantita)
    );
    const origineValoreNetto = valoreNettoMexal !== null
      ? "mexal"
      : pricesIncludeVat && aliquotaIva > 0
        ? "calcolato_sconti_scorporo_iva"
        : documentDiscounts.length
          ? "calcolato_sconti_documento"
          : prezzoNettoMexal !== null
            ? "mexal_prezzo_netto"
      : valoreNettoCalcolato !== null
        ? (sconto ? "calcolato_da_sconto" : "prezzo_pieno")
        : "non_disponibile";
    const scontoEquivalente = valoreLordo === 0 || valoreNetto === null
      ? null
      : roundMoney((1 - (valoreNetto / valoreLordo)) * 100);

    return {
      posizione: position,
      tipo_riga: text(fields.tipo_riga.get(position)) || null,
      codice_articolo: text(fields.codice_articolo.get(position)) || null,
      descrizione: text(fields.descrizione.get(position)) || null,
      quantita,
      prezzo_unitario: prezzoUnitario,
      sconto,
      sconto_percentuale_equivalente: scontoEquivalente,
      valore_lordo: valoreLordo,
      prezzo_netto_unitario: prezzoNettoUnitario,
      valore_netto: valoreNetto,
      valore_netto_origine: origineValoreNetto,
      aliquota_iva: aliquotaIva,
      codice_agente_mexal: text(fields.codice_agente_mexal.get(position)) || text(detail.codice_agente) || null,
      dati_mexal: Object.fromEntries(
        [
          ...Object.entries(fields).map(([key, values]) => [key, values.get(position) ?? null]),
          ["sconti_merce_documento", documentDiscounts],
          ["prezzo_include_iva", pricesIncludeVat],
        ],
      ),
    };
  });
}

export function isRequestedSalesDocument(item) {
  const sigla = text(item?.sigla).toUpperCase();
  const moduleCode = text(item?.cod_modulo).toUpperCase();
  return sigla === "FT" || (["CO", "OC"].includes(sigla) && moduleCode === "X");
}
