import { sanitizeContract } from "./order-contract-diagnostics.js";

function normalizeCode(value, pattern, label) {
  const code = String(value || "").trim().toUpperCase();
  if (!pattern.test(code)) throw Object.assign(new Error(`${label} non valido.`), { status: 400 });
  return code;
}

async function inspect(client, label, path) {
  try {
    return { label, path, ok: true, contract: sanitizeContract(await client.getJson(path)) };
  } catch (error) {
    return { label, path, ok: false, status: error?.status || error?.httpStatus || null, error: error?.message || String(error) };
  }
}

export async function runCommercialContractDiagnostics(client, values = {}) {
  const clientCode = normalizeCode(values.clientCode, /^501\.\d{5}$/, "Codice cliente");
  const agentCode = normalizeCode(values.agentCode, /^602\.\d{5}$/, "Codice agente");
  const productCode = normalizeCode(values.productCode, /^(?:IT|MKT|IMP)[A-Z0-9._-]+$/, "Codice prodotto");
  const encodedClient = encodeURIComponent(clientCode);
  const encodedAgent = encodeURIComponent(agentCode);
  const encodedProduct = encodeURIComponent(productCode);

  const candidates = [
    ["Anagrafica cliente", `/clienti/${encodedClient}?info=true`],
    ["Anagrafica cliente senza info", `/clienti/${encodedClient}`],
    ["Articolo completo", `/articoli/${encodedProduct}?info=true`],
    ["Agente", `/agenti/${encodedAgent}?info=true`],
    ["Agente dati generali", `/dati-generali/agenti/${encodedAgent}?info=true`],
    ["Provvigioni articolo", `/articoli/${encodedProduct}/provvigioni?codice_agente=${encodedAgent}`],
    ["Provvigioni agente-articolo", `/provvigioni?codice_agente=${encodedAgent}&codice_articolo=${encodedProduct}`],
    ["Help clienti", "/clienti/help.json"],
    ["Help articoli", "/articoli/help.json"],
    ["Help agenti", "/agenti/help.json"],
    ["Help provvigioni", "/provvigioni/help.json"],
  ];

  const probes = await Promise.all(candidates.map(([label, path]) => inspect(client, label, path)));
  return {
    generatedAt: new Date().toISOString(),
    references: { clientCode, agentCode, productCode },
    probes,
    successful: probes.filter((probe) => probe.ok).map((probe) => probe.label),
    privacy: "Risposta sanitizzata: dati personali, indirizzi, prezzi, importi, sconti, note e descrizioni non sono restituiti.",
  };
}
