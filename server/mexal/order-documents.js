export const ORDER_DOCUMENTS = Object.freeze({
  OCM: Object.freeze({ moduleCode: "M", quantityField: "quantita_ocm" }),
  OCX: Object.freeze({ moduleCode: "X", quantityField: "quantita_ocx" }),
  OCI: Object.freeze({ moduleCode: "I", quantityField: "quantita_oci" }),
});

export const DEFAULT_MEXAL_ORDER_DATE_FORMAT = "yyyymmdd";

export function normalizeArticleCode(value) { return String(value ?? "").trim().toUpperCase(); }
export function isImportArticle(line) { return normalizeArticleCode(line?.codice_articolo ?? line?.productCode).startsWith("IMP"); }

export function reconciliationFailure(error, expectedModule, response) {
  const status = Number(error?.status || error?.httpStatus || 0);
  if (status === 401 || status === 403) return { stato: "auth_error", errore: error.message };
  if (status === 404) return { stato: "missing", errore: error.message };
  if (status >= 500 || /timeout|timed? out|econnreset|eai_again/i.test(String(error?.message || ""))) return { stato: "temporary_error", errore: error.message };
  const actualModule = text(response?.cod_modulo || response?.dati?.cod_modulo || response?.documento?.cod_modulo);
  if (response && actualModule !== expectedModule) return { stato: "mismatch", errore: `cod_modulo Mexal ${actualModule || "mancante"}.` };
  return null;
}

export function classifyOrderLines(lines) {
  return (lines || []).reduce((documents, line) => {
    if (isImportArticle(line)) { documents.OCI.push({ ...line, quantita_documento: Number(line.quantita) || 0 }); return documents; }
    for (const kind of ["OCM", "OCX"]) {
      const quantity = Number(line[ORDER_DOCUMENTS[kind].quantityField]) || 0;
      if (quantity > 0) documents[kind].push({ ...line, quantita_documento: quantity });
    }
    return documents;
  }, { OCM: [], OCX: [], OCI: [] });
}

const text = (value) => String(value ?? "").trim();
const number = (value) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : undefined; };
const compact = (value) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined && item !== ""));
const matrix = (value) => value === undefined || value === null || value === "" ? undefined : [[1, value]];
export function formatMexalCommission(value) {
  const parsed = number(value);
  if (parsed === undefined) throw new Error("Percentuale provvigione non valida.");
  return String(parsed).replace(".", ",");
}

export function formatMexalNota(value, format) {
  const note = text(value);
  if (!note) return undefined;
  if (format === "scalar") return note;
  if (format === "typed-array") return [[1, note]];
  throw new Error("MEXAL_ORDER_NOTA_FORMAT deve essere scalar o typed-array.");
}

export function formatMexalOrderDate(value, format = DEFAULT_MEXAL_ORDER_DATE_FORMAT) {
  const isoDate = text(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error("data_ordine deve essere una data valida nel formato YYYY-MM-DD.");
  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (parsed.getUTCFullYear() !== Number(year) || parsed.getUTCMonth() !== Number(month) - 1 || parsed.getUTCDate() !== Number(day)) {
    throw new Error("data_ordine deve essere una data valida nel formato YYYY-MM-DD.");
  }
  const italianDate = `${day}/${month}/${year}`;
  if (format === "dd/mm/yyyy") return italianDate;
  if (format === "yyyymmdd") return `${year}${month}${day}`;
  if (format === "iso") return isoDate;
  if (format === "typed-array-dd/mm/yyyy") return [[1, italianDate]];
  throw new Error("MEXAL_ORDER_DATE_FORMAT deve essere dd/mm/yyyy, yyyymmdd, iso o typed-array-dd/mm/yyyy.");
}

export function normalizeMexalUnitType(value) {
  return text(value) || "1";
}

export function buildRootMatrixRows(lines, magazzino, defaultAgentCode) {
  const fields = {
    id_riga: (_line, index) => index,
    tp_riga: () => "R",
    codice_articolo: (line) => normalizeArticleCode(line.codice_articolo),
    quantita: (line) => number(line.quantita_documento),
    prezzo: (line) => number(line.prezzo_listino ?? line.prezzo_unitario ?? line.prezzo),
    sconto: (line) => text(line.sconto_commerciale),
    id_mag_riga: (line) => number(line.id_mag_riga ?? magazzino),
    tp_um_articolo: (line) => normalizeMexalUnitType(line.tp_um_articolo),
    cod_iva: (line) => text(line.cod_iva ?? line.codice_iva_mexal),
    tipo_stato_riga: () => "E",
  };
  const result = Object.fromEntries(Object.entries(fields).map(([field, value]) => [field,
    lines.map((line, index) => [index + 1, value(line, index + 1)]).filter(([, item]) => item !== undefined && item !== ""),
  ]).filter(([, values]) => values.length));

  const commissionRows = lines.map((line, index) => [index + 1, number(line.provvigione_percentuale ?? line.perc_provv)]).filter(([, value]) => value !== undefined);
  if (commissionRows.length) {
    result.perc_provv = commissionRows;
    result.cod_agente = lines.map((line, index) => [index + 1, 1, text(line.codice_agente_mexal || line.cod_agente || defaultAgentCode)]).filter((row) => row[2]);
    result.tipo_provv = commissionRows.flatMap(([index]) => [1, 2, 3, 4, 5].map((position) => [index, position, "%"]));
    result.formula_pr = commissionRows.map(([index, percentage]) => [index, 1, formatMexalCommission(percentage)]);
    result.calc_formula_pr = commissionRows.map(([index, percentage]) => [index, 1, percentage]);
  }
  return result;
}

function transportFields(order) {
  const transport = order?.trasporto_mexal && typeof order.trasporto_mexal === "object" ? order.trasporto_mexal : {};
  const stringField = (...values) => text(values.find((value) => value !== undefined && value !== null && value !== ""));
  const numberField = (...values) => number(values.find((value) => value !== undefined && value !== null && value !== ""));
  return compact({
    tp_trasporto: matrix(stringField(transport.tp_trasporto, transport.tipo_trasporto, order.tp_trasporto, order.tipo_trasporto)),
    cod_vettore: matrix(stringField(transport.cod_vettore, transport.codice_vettore, order.cod_vettore, order.codice_vettore)),
    tp_porto: matrix(stringField(transport.tp_porto, transport.tipo_porto, order.tp_porto, order.tipo_porto)),
    tp_spese_sped: matrix(stringField(transport.tp_spese_sped, transport.tipo_spese_spedizione, order.tp_spese_sped, order.tipo_spese_spedizione)),
    val_spese_sped: matrix(numberField(transport.val_spese_sped, transport.spese_spedizione, order.val_spese_sped, order.spese_spedizione)),
  });
}

function destinationFields(order) {
  const destination = order?.destinazione_mexal && typeof order.destinazione_mexal === "object" ? order.destinazione_mexal : {};
  const destinationAccount = text(order.cod_anag_sped || destination.cod_anag_sped);

  // Contratto verificato su OCM manuale: cod_anag_sped e' una matrice contenente
  // il codice anagrafico interno Mexal (es. "754"). id_ind_sped resta omesso
  // quando la risposta GET lo espone come array vuoto.
  if (!destinationAccount) return {};
  return { cod_anag_sped: matrix(destinationAccount) };
}

export function buildMexalOrderDocument(order, kind, lines, { serie = 1, magazzino = 5, notaFormat = "typed-array", dateFormat = DEFAULT_MEXAL_ORDER_DATE_FORMAT, causale = 1 } = {}) {
  const document = ORDER_DOCUMENTS[kind];
  if (!document || !lines?.length) return null;
  const paymentId = number(order.id_pagamento ?? order.codice_pagamento_mexal ?? order.codice_pagamento);
  return compact({
    sigla: "OC", serie: number(serie), numero: 0, cod_conto: text(order.codice_cliente), data_documento: formatMexalOrderDate(order.data_ordine, dateFormat),
    cod_modulo: document.moduleCode, id_causale: number(causale) ? [[1, number(causale)]] : undefined, id_magazzino: number(magazzino), codice_agente: text(order.codice_agente_mexal),
    nota: formatMexalNota(order.note_mexal || `Workspace n. ${order.numero_ordine_visualizzato || order.id}`, notaFormat),
    id_pagamento: paymentId, ...destinationFields(order), ...transportFields(order), ...buildRootMatrixRows(lines, magazzino, order.codice_agente_mexal),
  });
}
