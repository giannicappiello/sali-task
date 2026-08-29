/* global Buffer, process */
import { generateText, jsonSchema, Output } from "ai";
import {
  authorizeAIRequest,
  completeAIGeneration,
  failAIGeneration,
  startAIGeneration,
} from "./assistant.js";
import { applyDirectMexalProductFilters } from "../../shared/directProductCatalog.js";
import { distinctiveCustomerTokens, matchCustomer, matchProduct } from "../../shared/orderDocumentMatching.js";
import { parseOrderWorkbook } from "./order-excel.js";

const DEFAULT_MODEL = "openai/gpt-5.6-luna";
const MAX_FILE_BYTES = 2_800_000;
const HARD_DAILY_DOCUMENT_LIMIT = Math.max(1, Number(process.env.AI_ORDER_HARD_DAILY_LIMIT || 25));
const HARD_MAX_DOCUMENT_PAGES = Math.max(1, Number(process.env.AI_ORDER_HARD_MAX_PAGES || 20));
const EXCEL_MEDIA_BY_EXTENSION = new Map([
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".xls", "application/vnd.ms-excel"],
  [".xlsm", "application/vnd.ms-excel.sheet.macroenabled.12"],
]);
const ALLOWED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf", ...EXCEL_MEDIA_BY_EXTENSION.values()]);

const ORDER_DOCUMENT_SCHEMA = jsonSchema({
  type: "object",
  additionalProperties: false,
  required: ["documentType", "customer", "lines", "documentDate", "documentNumber", "notes", "warnings", "pageCount"],
  properties: {
    documentType: { type: "string", enum: ["OCT", "OCM", "OCX", "OCI", "NON_DETERMINATO"] },
    documentDate: { type: "string" },
    documentNumber: { type: "string" },
    pageCount: { type: "integer", minimum: 1 },
    customer: {
      type: "object",
      additionalProperties: false,
      required: ["code", "name", "alias", "vatNumber", "taxCode", "email", "address", "city", "confidence"],
      properties: {
        code: { type: "string" }, name: { type: "string" }, alias: { type: "string" }, vatNumber: { type: "string" }, taxCode: { type: "string" }, email: { type: "string" },
        address: { type: "string" }, city: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 1 },
      },
    },
    lines: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sourceText", "productCode", "ean", "sku", "description", "format", "package", "quantity", "unit", "confidence"],
        properties: {
          sourceText: { type: "string" }, productCode: { type: "string" }, ean: { type: "string" }, sku: { type: "string" }, description: { type: "string" }, format: { type: "string" }, package: { type: "string" },
          quantity: { type: "number", exclusiveMinimum: 0 }, unit: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    notes: { type: "string" },
    warnings: { type: "array", items: { type: "string" } },
  },
});

function parseFile(body) {
  const filename = String(body.fileName || "documento").replace(/[^a-zA-Z0-9._ -]/g, "").slice(0, 120) || "documento";
  const extension = filename.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] || "";
  const declaredMediaType = String(body.mediaType || "").toLowerCase();
  const mediaType = EXCEL_MEDIA_BY_EXTENSION.get(extension) || declaredMediaType;
  if (!ALLOWED_MEDIA_TYPES.has(mediaType)) throw Object.assign(new Error("Formato non supportato. Usa JPG, PNG, WebP, PDF, XLSX, XLS o XLSM."), { status: 400 });
  const raw = String(body.fileBase64 || "").replace(/^data:[^;]+;base64,/, "");
  if (!raw) throw Object.assign(new Error("Seleziona una foto o un documento."), { status: 400 });
  const data = Buffer.from(raw, "base64");
  if (!data.length || data.length > MAX_FILE_BYTES) throw Object.assign(new Error("Il file supera il limite di 2,8 MB. Riduci la foto o il PDF e riprova."), { status: 413 });
  return { data, mediaType, filename, isExcel: EXCEL_MEDIA_BY_EXTENSION.has(extension) };
}

function assertOrderModuleAllowed(auth, moduleCode) {
  if (auth.profile?.ruoli?.amministratore_workspace === true) return;
  const modules = new Set(auth.access?.modules || []);
  if (!modules.has(moduleCode)) throw Object.assign(new Error("Non sei autorizzato ad accedere a questo modulo Ordini."), { status: 403 });
}

async function assertOrderAISafetyLimit(auth) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const { count, error } = await auth.admin
    .from("ai_ordini_acquisizioni")
    .select("id", { count: "exact", head: true })
    .eq("utente_id", auth.profile.id)
    .gte("creata_il", start.toISOString());
  if (error) throw error;
  if (Number(count || 0) >= HARD_DAILY_DOCUMENT_LIMIT) {
    throw Object.assign(new Error("Soglia tecnica giornaliera di sicurezza raggiunta. Riprova domani."), { status: 429 });
  }
}

function cleanSearchValue(value) { return String(value || "").replace(/[%_*,()]/g, " ").replace(/\s+/g, " ").trim(); }

async function visibleCustomerShortlist(auth, extractions) {
  const requests = [];
  const seen = new Set();
  const add = (key, builder) => {
    if (!key || seen.has(key)) return;
    seen.add(key); requests.push(builder());
  };
  for (const extraction of extractions) {
    const customer = extraction?.customer || {};
    const code = cleanSearchValue(customer.code); const vat = cleanSearchValue(customer.vatNumber); const tax = cleanSearchValue(customer.taxCode); const email = cleanSearchValue(customer.email);
    if (code) add(`code:${code}`, () => auth.scoped.rpc("visible_mexal_clients_for_me").eq("codice_cliente", code).limit(5));
    if (vat) {
      const compactVat = vat.replace(/\s+/g, "").replace(/^IT/i, "");
      add(`vat:${compactVat}`, () => auth.scoped.rpc("visible_mexal_clients_for_me").ilike("partita_iva", `%${compactVat}%`).limit(10));
    }
    if (tax) {
      add(`tax-json:${tax}`, () => auth.scoped.rpc("visible_mexal_clients_for_me").contains("json_mexal", { codice_fiscale: tax }).limit(10));
      add(`tax-data:${tax}`, () => auth.scoped.rpc("visible_mexal_clients_for_me").contains("dati_mexal", { codice_fiscale: tax }).limit(10));
    }
    if (email) add(`email:${email}`, () => auth.scoped.rpc("visible_mexal_clients_for_me").ilike("email", email).limit(10));
    distinctiveCustomerTokens([customer.name, customer.alias].filter(Boolean).join(" ")).slice(0, 3).forEach((token) => {
      const safe = cleanSearchValue(token);
      add(`name:${safe}`, () => auth.scoped.rpc("visible_mexal_clients_for_me").ilike("ragione_sociale", `%${safe}%`).limit(60));
    });
  }
  if (!requests.length) return [];
  const results = await Promise.all(requests);
  const error = results.find((result) => result.error)?.error;
  if (error) throw error;
  const shortlisted = [...new Map(results.flatMap((result) => result.data || []).map((customer) => [customer.codice_cliente, customer])).values()];
  if (shortlisted.length) return shortlisted;
  const fallback = await auth.scoped.rpc("visible_mexal_clients_for_me").limit(5000);
  if (fallback.error) throw fallback.error;
  return fallback.data || [];
}

async function visibleCatalog(auth, extractions) {
  const customersPromise = visibleCustomerShortlist(auth, extractions);
  const productsPromise = applyDirectMexalProductFilters(auth.scoped
    .from("prodotti")
    .select("id,codice_mexal,codice,nome,ean,json_mexal"))
    .order("nome").limit(10000);
  const implantsPromise = auth.scoped.from("ordini_impianti")
    .select("id,codice,descrizione")
    .eq("attivo", true).order("descrizione");
  const [customers, productsResult, implantsResult] = await Promise.all([customersPromise, productsPromise, implantsPromise]);
  if (productsResult.error) throw productsResult.error;
  if (implantsResult.error) throw implantsResult.error;
  const products = [
    ...(productsResult.data || []).map((item) => ({ ...item, codice_articolo: item.codice_mexal || item.codice, descrizione: item.nome })),
    ...(implantsResult.data || []).filter((item) => String(item.codice || "").trim().toUpperCase().startsWith("IMP")).map((item) => ({ ...item, codice_articolo: item.codice, is_impianto: true })),
  ];
  return { customers, products };
}

function resolveExtraction(extraction, catalog) {
  const customerResolution = matchCustomer(extraction.customer, catalog.customers);
  return {
    ...extraction,
    customerCandidates: customerResolution.candidates,
    customerMatch: customerResolution.match,
    lines: extraction.lines.map((line) => {
      const productResolution = matchProduct(line, catalog.products);
      return { ...line, productCandidates: productResolution.candidates, productMatch: productResolution.match };
    }),
  };
}

function forRequestedOrderModule(extraction, moduleCode) {
  return moduleCode === "ordini_private" ? { ...extraction, documentType: "OCT" } : extraction;
}

export async function handleAIOrderDocument(req) {
  if (req.method !== "POST") throw Object.assign(new Error("Metodo non consentito."), { status: 405 });
  const auth = await authorizeAIRequest(req, { bypassAIEntitlements: true });
  const body = req.body || {};
  const requestedModule = String(body.moduleCode || "").trim();
  const moduleCode = ["ordini_pr", "ordini_ph", "ordini_private"].includes(requestedModule) ? requestedModule : "ordini_pr";
  assertOrderModuleAllowed(auth, moduleCode);
  if (body.action === "ai_order_capabilities") return { allowed: true, limits: { maxFileBytes: MAX_FILE_BYTES, dailyDocuments: HARD_DAILY_DOCUMENT_LIMIT, maxPages: HARD_MAX_DOCUMENT_PAGES } };

  await assertOrderAISafetyLimit(auth);
  const file = parseFile(body);
  const model = process.env.AI_VISION_MODEL || process.env.AI_MODEL || DEFAULT_MODEL;
  const { data: acquisition, error: acquisitionError } = await auth.admin.from("ai_ordini_acquisizioni").insert({
    utente_id: auth.profile.id, modulo_codice: moduleCode, nome_file: file.filename, tipo_file: file.mediaType, dimensione_byte: file.data.length,
  }).select("id").single();
  if (acquisitionError) throw acquisitionError;
  let generationId = null;
  if (!file.isExcel) {
    generationId = await startAIGeneration(auth.admin, { profileId: auth.profile.id, conversationId: null, type: "riconoscimento_ordine", model });
    await auth.admin.from("ai_ordini_acquisizioni").update({ generazione_id: generationId }).eq("id", acquisition.id);
  }

  let result;
  try {
    if (file.isExcel) {
      const workbook = parseOrderWorkbook(file.data, { fileName: file.filename });
      if (!workbook.orders.length) throw Object.assign(new Error("Nel workbook non sono state trovate righe prodotto utilizzabili."), { status: 400, details: workbook.excludedSheets });
      const catalog = await visibleCatalog(auth, workbook.orders);
      const matchedOrders = workbook.orders.map((order) => resolveExtraction(forRequestedOrderModule(order, moduleCode), catalog));
      const matched = { ...matchedOrders[0], orders: matchedOrders, workbook: { includedSheets: workbook.includedSheets, excludedSheets: workbook.excludedSheets }, warnings: [...workbook.warnings, ...(matchedOrders[0]?.warnings || [])] };
      await auth.admin.from("ai_ordini_acquisizioni").update({ stato: "completata", esito: matched, completata_il: new Date().toISOString() }).eq("id", acquisition.id);
      return { acquisitionId: acquisition.id, extraction: matched, usage: null };
    }
    result = await generateText({
      model,
      system: moduleCode === "ordini_private"
        ? "Leggi il documento commerciale senza inventare dati. Estrai cliente, righe prodotto e quantità. Questo flusso crea esclusivamente un OCT: imposta sempre documentType a OCT e non classificare le righe in altri documenti. Usa stringhe vuote per i campi assenti. Le quantità devono essere positive. Segnala dubbi e testo illeggibile nelle warnings."
        : "Leggi il documento commerciale senza inventare dati. Estrai cliente, righe prodotto e quantità. Usa stringhe vuote per i campi assenti. Il tipo è OCI solo per prenotazioni esplicite; OCM per evasione immediata esplicita; OCX per backorder esplicito; altrimenti NON_DETERMINATO. Le quantità devono essere positive. Segnala dubbi e testo illeggibile nelle warnings.",
      messages: [{ role: "user", content: [
        { type: "text", text: "Estrai i dati necessari per preparare una bozza d’ordine nel gestionale." },
        { type: "file", mediaType: file.mediaType, data: file.data, filename: file.filename },
      ] }],
      output: Output.object({ name: "OrdineAcquisito", description: "Dati estratti da una richiesta d’ordine", schema: ORDER_DOCUMENT_SCHEMA }),
      maxOutputTokens: 2200,
      providerOptions: { gateway: { user: auth.profile.id, tags: ["app:sali-task", "feature:riconoscimento-ordine", `module:${moduleCode}`] } },
    });
    const extraction = forRequestedOrderModule(result.output, moduleCode);
    if (extraction.pageCount > HARD_MAX_DOCUMENT_PAGES) throw Object.assign(new Error(`Il documento contiene ${extraction.pageCount} pagine; la soglia tecnica è ${HARD_MAX_DOCUMENT_PAGES}.`), { status: 400 });
    const catalog = await visibleCatalog(auth, [extraction]);
    const matched = resolveExtraction(extraction, catalog);
    const usage = await completeAIGeneration(auth.admin, { generationId, profileId: auth.profile.id, result });
    await auth.admin.from("ai_ordini_acquisizioni").update({ stato: "completata", esito: matched, completata_il: new Date().toISOString() }).eq("id", acquisition.id);
    return { acquisitionId: acquisition.id, extraction: matched, usage };
  } catch (error) {
    if (generationId) await failAIGeneration(auth.admin, generationId, error);
    await auth.admin.from("ai_ordini_acquisizioni").update({ stato: "errore", errore: String(error?.message || "Errore").slice(0, 1000), completata_il: new Date().toISOString() }).eq("id", acquisition.id);
    throw error;
  }
}
