/* global process */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildMexalClient } from "../server/mexal/sync-products.js";
import { ORDER_DOCUMENTS, buildMexalOrderDocument, classifyOrderLines } from "../server/mexal/order-documents.js";
import { compareMexalPayloads } from "./mexal-diagnose-order.mjs";

const loadedEnvironmentSources = new Map();

function loadEnvironmentFile(filename) {
  const filePath = resolve(filename);
  if (!existsSync(filePath)) return false;

  const content = readFileSync(filePath, "utf8");

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;

    const name = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!process.env[name]) {
      process.env[name] = value;
      loadedEnvironmentSources.set(name, filename);
    }
  }

  return true;
}

function loadEnvironment() {
  const loadedFiles = [".env", ".env.local"].filter(loadEnvironmentFile);

  if (!process.env.SUPABASE_URL && process.env.VITE_SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.VITE_SUPABASE_URL;
    loadedEnvironmentSources.set("SUPABASE_URL", loadedEnvironmentSources.get("VITE_SUPABASE_URL") || "variabile Vite");
  }

  if (!process.env.SUPABASE_ANON_KEY && process.env.VITE_SUPABASE_ANON_KEY) {
    process.env.SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
    loadedEnvironmentSources.set("SUPABASE_ANON_KEY", loadedEnvironmentSources.get("VITE_SUPABASE_ANON_KEY") || "variabile Vite");
  }

  console.log(`Configurazione locale caricata da: ${loadedFiles.length ? loadedFiles.join(", ") : "variabili di sistema"}`);
}

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Variabile locale mancante: ${name}. Aggiungila in .env.local.`);
  return value;
}

function validateConfiguration() {
  const requiredNames = [
    "SUPABASE_URL",
    "MEXAL_BASE_URL",
    "MEXAL_USERNAME",
    "MEXAL_PASSWORD",
    "MEXAL_AZIENDA",
    "MEXAL_ANNO",
    "MEXAL_MAGAZZINO",
  ];

  const missing = requiredNames.filter((name) => !String(process.env[name] || "").trim());
  const hasSupabaseKey = Boolean(
    String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim() ||
      String(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "").trim()
  );

  if (!hasSupabaseKey) missing.push("SUPABASE_SERVICE_ROLE_KEY oppure VITE_SUPABASE_ANON_KEY");

  if (missing.length) {
    throw new Error(`Configurazione locale incompleta. Variabili mancanti: ${missing.join(", ")}.`);
  }

  const visibleNames = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ANON_KEY",
    "MEXAL_BASE_URL",
    "MEXAL_USERNAME",
    "MEXAL_PASSWORD",
    "MEXAL_AZIENDA",
    "MEXAL_ANNO",
    "MEXAL_MAGAZZINO",
  ];

  console.log("Variabili disponibili:");
  for (const name of visibleNames) {
    if (!String(process.env[name] || "").trim()) continue;
    const source = loadedEnvironmentSources.get(name) || "variabile di sistema";
    console.log(`- ${name}: OK (${source})`);
  }
}

function text(value) {
  return String(value ?? "").trim();
}

function getSupabaseKey() {
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (serviceRoleKey) return serviceRoleKey;

  const anonKey = String(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "").trim();
  if (!anonKey) {
    throw new Error("Variabile locale mancante: SUPABASE_SERVICE_ROLE_KEY oppure VITE_SUPABASE_ANON_KEY");
  }

  console.warn("ATTENZIONE: viene usata la chiave anon. Se Supabase blocca la lettura per RLS, aggiungi SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  return anonKey;
}

async function run() {
  loadEnvironment();
  validateConfiguration();

  const [orderId, rawKind, rawSigla, rawSerie, rawNumero] = process.argv.slice(2);
  const kind = text(rawKind).toUpperCase();
  const sigla = text(rawSigla).toUpperCase();
  const serie = text(rawSerie);
  const numero = text(rawNumero);

  if (!orderId || !Object.hasOwn(ORDER_DOCUMENTS, kind) || !sigla || !serie || !numero) {
    throw new Error("Uso: npm run mexal:diagnose-order -- <orderId> <OCM|OCX|OCI> <sigla> <serie> <numero>");
  }

  const supabase = createClient(required("SUPABASE_URL"), getSupabaseKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [{ data: order, error: orderError }, { data: lines, error: linesError }, { data: config, error: configError }] = await Promise.all([
    supabase.from("ordini_testate").select("*").eq("id", orderId).single(),
    supabase.from("ordini_righe").select("*").eq("ordine_id", orderId).order("id"),
    supabase.from("ordini_configurazione_documenti").select("serie_ocm,serie_ocx,serie_oci,id_magazzino").eq("id", 1).maybeSingle(),
  ]);

  if (orderError) throw new Error(`Lettura ordine Supabase fallita: ${orderError.message}`);
  if (linesError) throw new Error(`Lettura righe ordine Supabase fallita: ${linesError.message}`);
  if (configError) throw new Error(`Lettura configurazione documenti fallita: ${configError.message}`);

  const options = {
    serie: config?.[`serie_${kind.toLowerCase()}`] || 1,
    magazzino: config?.id_magazzino || 5,
  };

  const classifiedLines = classifyOrderLines(lines || []);
  const postPayload = buildMexalOrderDocument(order, kind, classifiedLines[kind] || [], options);
  if (!postPayload) throw new Error(`L'ordine non contiene righe per ${kind}.`);

  const resource = `/documenti/ordini-clienti/${encodeURIComponent(sigla)}+${encodeURIComponent(serie)}+${encodeURIComponent(numero)}`;
  const getPayload = await buildMexalClient().getJson(resource);
  const comparison = compareMexalPayloads(getPayload, postPayload);
  const result = {
    generated_at: new Date().toISOString(),
    order_id: orderId,
    document_kind: kind,
    resource,
    get_payload: getPayload,
    post_payload: postPayload,
    comparison,
  };

  const outputDir = resolve("diagnostics", "mexal");
  await mkdir(outputDir, { recursive: true });
  const outputFile = resolve(outputDir, `${kind}-${sigla}-${serie}-${numero}.json`);
  await writeFile(outputFile, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  console.log(`Diagnostica completata: ${outputFile}`);
  console.log(JSON.stringify(comparison, null, 2));
}

run().catch((error) => {
  console.error("Diagnostica Mexal fallita:", error?.message || error);
  process.exitCode = 1;
});
