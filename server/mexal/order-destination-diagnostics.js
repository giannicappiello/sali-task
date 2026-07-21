const text = (value) => String(value ?? "").trim();

function normalizeInteger(value, label) {
  const normalized = text(value);
  if (!/^\d+$/.test(normalized)) throw Object.assign(new Error(`${label} non valido.`), { status: 400 });
  return normalized;
}

function normalizeClientCode(value) {
  const code = text(value).toUpperCase();
  if (code && !/^501\.\d{5}$/.test(code)) throw Object.assign(new Error("Codice cliente non valido."), { status: 400 });
  return code;
}

function collectDestinationFields(value, path = "", output = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectDestinationFields(item, `${path}[${index}]`, output));
    return output;
  }
  if (!value || typeof value !== "object") return output;

  for (const [key, item] of Object.entries(value)) {
    const fieldPath = path ? `${path}.${key}` : key;
    if (/(dest|sped|indir|anag|conto|ragione|denomin|localit|comune|cap|provinc|nazione)/i.test(key)) {
      output.push({ path: fieldPath, value: item });
    }
    collectDestinationFields(item, fieldPath, output);
  }
  return output;
}

export async function runOrderDestinationDiagnostics(client, values = {}) {
  const year = normalizeInteger(values.year, "Anno");
  const series = normalizeInteger(values.series, "Serie");
  const number = normalizeInteger(values.number, "Numero");
  const clientCode = normalizeClientCode(values.clientCode);
  const reference = `OC+${series}+${number}`;
  const resource = `/documenti/ordini-clienti/${encodeURIComponent(reference)}`;
  const document = await client.getJson(resource);
  const destinationFields = collectDestinationFields(document);

  return {
    generatedAt: new Date().toISOString(),
    reference,
    requestedYear: year,
    expectedClientCode: clientCode || null,
    destinationFields,
    document,
    notice: "Risultato amministrativo completo dell'ordine Mexal. Non condividere pubblicamente il JSON: può contenere dati del cliente.",
  };
}
