/* global process */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildMexalClient } from "../server/mexal/sync-products.js";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
}

// Preserve only values that express the API contract, never business data.
// Matrix indexes are needed to identify root-vs-row fields; E/S, module codes
// and booleans are needed to compare order state behaviour.
const SAFE_TECHNICAL_KEYS = new Set(["stato", "cod_modulo", "sospeso", "evadibile", "tipo_riga", "tp_riga", "indice", "index"]);
function safeTechnicalValue(value, key, indexInMatrix) {
  if (typeof value === "boolean") return value;
  if (indexInMatrix && typeof value === "number" && Number.isInteger(value)) return value;
  if (!SAFE_TECHNICAL_KEYS.has(String(key || "").toLowerCase()) || typeof value !== "string") return undefined;
  const normalized = value.trim();
  return /^(?:E|S|[A-Z]{1,3}|true|false)$/i.test(normalized) ? normalized : undefined;
}

// Preserve field names, array/matrix dimensions and primitive types while never
// writing document values, customers, prices, credentials or headers.
export function sanitizeMexalContract(value, key = "", indexInMatrix = false) {
  if (Array.isArray(value)) return value.map((item, index) => sanitizeMexalContract(item, key, index === 0));
  if (value === null) return { type: "null" };
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([childKey, item]) => [childKey, sanitizeMexalContract(item, childKey)]));
  const safe = safeTechnicalValue(value, key, indexInMatrix);
  if (safe !== undefined) return { type: typeof value, value: safe };
  return { type: typeof value };
}

async function getSanitized(client, resource) {
  try {
    return { resource, response: sanitizeMexalContract(await client.getJson(resource)) };
  } catch (error) {
    return { resource, error: { name: error?.name || "Error", message: String(error?.message || "Richiesta fallita").replace(/https?:\/\/\S+/g, "[URL REDACTED]") } };
  }
}

async function main() {
  const requestedDocuments = [
    ["ocm_manual_e", argument("--ocm-e")],
    ["ocm_workspace_s", argument("--ocm-s")],
    ["ocx", argument("--ocx")],
    ["oci", argument("--oci")],
  ].filter(([, reference]) => reference);
  if (!requestedDocuments.length) throw new Error("Uso: npm run mexal:capture-order-contract -- --ocm-e OC+1+16531 [--ocm-s OC+1+16532] [--ocx OC+1+16533] [--oci OC+1+16534]");
  const client = buildMexalClient();
  const documents = Object.fromEntries(await Promise.all(requestedDocuments.map(async ([label, reference]) => [label, await getSanitized(client, `/documenti/ordini-clienti/${encodeURIComponent(reference)}`)])));
  const help = {
    ordini_clienti: await getSanitized(client, "/documenti/ordini-clienti/help.json"),
    righe: await getSanitized(client, "/documenti/ordini-clienti/righe/help.json"),
  };
  const output = { generated_at: new Date().toISOString(), sanitization: "field names, array shape and primitive types only; values and headers omitted", documents, help };
  const directory = resolve("diagnostics", "mexal");
  await mkdir(directory, { recursive: true });
  const filename = resolve(directory, "order-contract-sanitized.json");
  await writeFile(filename, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Contratto sanitizzato salvato in: ${filename}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  main().catch((error) => { console.error("Acquisizione contratto Mexal fallita:", error?.message || error); process.exitCode = 1; });
}
