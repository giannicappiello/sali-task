/* global process */
import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildMexalClient } from "../server/mexal/sync-products.js";
import { ORDER_DOCUMENTS, buildMexalOrderDocument, classifyOrderLines } from "../server/mexal/order-documents.js";
import { compareMexalPayloads } from "./mexal-diagnose-order.mjs";

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Variabile ambiente mancante: ${name}`);
  return value;
}

function text(value) {
  return String(value ?? "").trim();
}

async function run() {
  const [orderId, rawKind, rawSigla, rawSerie, rawNumero] = process.argv.slice(2);
  const kind = text(rawKind).toUpperCase();
  const sigla = text(rawSigla).toUpperCase();
  const serie = text(rawSerie);
  const numero = text(rawNumero);

  if (!orderId || !Object.hasOwn(ORDER_DOCUMENTS, kind) || !sigla || !serie || !numero) {
    throw new Error("Uso: npm run mexal:diagnose-order -- <orderId> <OCM|OCX|OCI> <sigla> <serie> <numero>");
  }

  const supabase = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [{ data: order, error: orderError }, { data: lines, error: linesError }, { data: config, error: configError }] = await Promise.all([
    supabase.from("ordini_testate").select("*").eq("id", orderId).single(),
    supabase.from("ordini_righe").select("*").eq("ordine_id", orderId).order("id"),
    supabase.from("ordini_configurazione_documenti").select("serie_ocm,serie_ocx,serie_oci,id_magazzino").eq("id", 1).maybeSingle(),
  ]);

  if (orderError) throw orderError;
  if (linesError) throw linesError;
  if (configError) throw configError;

  const options = {
    serie: config?.[`serie_${kind.toLowerCase()}`] || 1,
    magazzino: config?.id_magazzino || 5,
  };
  const postPayload = buildMexalOrderDocument(order, kind, classifyOrderLines(lines)[kind], options);
  if (!postPayload) throw new Error(`L'ordine non contiene righe per ${kind}.`);

  const resource = `/documenti/ordini-clienti/${encodeURIComponent(sigla)}+${encodeURIComponent(serie)}+${encodeURIComponent(numero)}`;
  const getPayload = await buildMexalClient().getJson(resource);
  const comparison = compareMexalPayloads(getPayload, postPayload);
  const result = {
    generated_at: new Date().toISOString(),
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
