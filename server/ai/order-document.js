/* global Buffer, process */
import { generateText, jsonSchema, Output } from "ai";
import {
  authorizeAIRequest,
  completeAIGeneration,
  failAIGeneration,
  startAIGeneration,
} from "./assistant.js";

const DEFAULT_MODEL = "openai/gpt-5.6-luna";
const MAX_FILE_BYTES = 2_800_000;
const HARD_DAILY_DOCUMENT_LIMIT = Math.max(1, Number(process.env.AI_ORDER_HARD_DAILY_LIMIT || 25));
const HARD_MAX_DOCUMENT_PAGES = Math.max(1, Number(process.env.AI_ORDER_HARD_MAX_PAGES || 20));
const ALLOWED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

const ORDER_DOCUMENT_SCHEMA = jsonSchema({
  type: "object",
  additionalProperties: false,
  required: ["documentType", "customer", "lines", "documentDate", "documentNumber", "notes", "warnings", "pageCount"],
  properties: {
    documentType: { type: "string", enum: ["OCM", "OCX", "OCI", "NON_DETERMINATO"] },
    documentDate: { type: "string" },
    documentNumber: { type: "string" },
    pageCount: { type: "integer", minimum: 1 },
    customer: {
      type: "object",
      additionalProperties: false,
      required: ["code", "name", "vatNumber", "taxCode", "address", "city", "confidence"],
      properties: {
        code: { type: "string" }, name: { type: "string" }, vatNumber: { type: "string" }, taxCode: { type: "string" },
        address: { type: "string" }, city: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 1 },
      },
    },
    lines: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sourceText", "productCode", "ean", "description", "quantity", "unit", "confidence"],
        properties: {
          sourceText: { type: "string" }, productCode: { type: "string" }, ean: { type: "string" }, description: { type: "string" },
          quantity: { type: "number", exclusiveMinimum: 0 }, unit: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    notes: { type: "string" },
    warnings: { type: "array", items: { type: "string" } },
  },
});

function normalized(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

function compact(value) {
  return normalized(value).replace(/\s+/g, "");
}

function fiscalKey(value) {
  const key = compact(value);
  return /^IT\d{11}$/.test(key) ? key.slice(2) : key;
}

function tokenSimilarity(left, right) {
  const a = new Set(normalized(left).split(" ").filter((token) => token.length > 1));
  const b = new Set(normalized(right).split(" ").filter((token) => token.length > 1));
  if (!a.size || !b.size) return 0;
  const shared = [...a].filter((token) => b.has(token)).length;
  return shared / Math.max(a.size, b.size);
}

export function rankCustomerCandidates(extracted, customers) {
  const sourceCode = compact(extracted?.code);
  const sourceVat = fiscalKey(extracted?.vatNumber);
  const sourceTax = compact(extracted?.taxCode);
  return (customers || []).map((customer) => {
    const code = compact(customer.codice_cliente);
    const vat = fiscalKey(customer.partita_iva);
    const tax = compact(customer.codice_fiscale);
    let score = tokenSimilarity(extracted?.name, customer.ragione_sociale);
    if (sourceCode && sourceCode === code) score = Math.max(score, 1);
    if (sourceVat && sourceVat === vat) score = Math.max(score, 0.99);
    if (sourceTax && sourceTax === tax) score = Math.max(score, 0.98);
    return { code: customer.codice_cliente, name: customer.ragione_sociale, city: customer.localita || "", vatNumber: customer.partita_iva || "", score };
  }).filter((item) => item.score >= 0.2).sort((a, b) => b.score - a.score).slice(0, 5);
}

export function rankProductCandidates(extracted, products) {
  const sourceCode = compact(extracted?.productCode);
  const sourceEan = compact(extracted?.ean);
  const sourceText = compact([extracted?.sourceText, extracted?.description].filter(Boolean).join(" "));
  return (products || []).map((product) => {
    const code = product.codice_articolo || product.codice_mexal || product.codice;
    const productCode = compact(code);
    const productEan = compact(product.ean);
    let score = tokenSimilarity(extracted?.description || extracted?.sourceText, product.descrizione || product.nome);
    if (sourceCode && sourceCode === productCode) score = Math.max(score, 1);
    if (sourceEan && sourceEan === productEan) score = Math.max(score, 1);
    if (productEan.length >= 8 && sourceText.includes(productEan)) score = Math.max(score, 0.99);
    if (productCode.length >= 3 && sourceText.includes(productCode)) score = Math.max(score, 0.97);
    return { code, description: product.descrizione || product.nome || code, ean: product.ean || "", score };
  }).filter((item) => item.code && item.score >= 0.18).sort((a, b) => b.score - a.score).slice(0, 5);
}

function parseFile(body) {
  const mediaType = String(body.mediaType || "").toLowerCase();
  if (!ALLOWED_MEDIA_TYPES.has(mediaType)) throw Object.assign(new Error("Formato non supportato. Usa JPG, PNG, WebP o PDF."), { status: 400 });
  const raw = String(body.fileBase64 || "").replace(/^data:[^;]+;base64,/, "");
  if (!raw) throw Object.assign(new Error("Seleziona una foto o un documento."), { status: 400 });
  const data = Buffer.from(raw, "base64");
  if (!data.length || data.length > MAX_FILE_BYTES) throw Object.assign(new Error("Il file supera il limite di 2,8 MB. Riduci la foto o il PDF e riprova."), { status: 413 });
  return { data, mediaType, filename: String(body.fileName || "documento").replace(/[^a-zA-Z0-9._ -]/g, "").slice(0, 120) || "documento" };
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

async function visibleCatalog(auth) {
  const customersPromise = auth.scoped.rpc("visible_mexal_clients_for_me");
  let productsResult = await auth.scoped
    .from("ordini_prodotti_cache")
    .select("codice_articolo,descrizione,ean")
    .eq("mostra_in_app", true)
    .limit(10000);
  if (productsResult.error && /(?:column|schema cache).*\bean\b|\bean\b.*does not exist/i.test(productsResult.error.message || "")) {
    productsResult = await auth.scoped
      .from("ordini_prodotti_cache")
      .select("codice_articolo,descrizione")
      .eq("mostra_in_app", true)
      .limit(10000);
  }
  const customersResult = await customersPromise;
  if (customersResult.error) throw customersResult.error;
  if (productsResult.error) throw productsResult.error;
  return { customers: customersResult.data || [], products: productsResult.data || [] };
}

export async function handleAIOrderDocument(req) {
  if (req.method !== "POST") throw Object.assign(new Error("Metodo non consentito."), { status: 405 });
  const auth = await authorizeAIRequest(req, { bypassAIEntitlements: true });
  const body = req.body || {};
  const moduleCode = body.moduleCode === "ordini_ph" ? "ordini_ph" : "ordini_pr";
  assertOrderModuleAllowed(auth, moduleCode);
  if (body.action === "ai_order_capabilities") return { allowed: true, limits: { maxFileBytes: MAX_FILE_BYTES, dailyDocuments: HARD_DAILY_DOCUMENT_LIMIT, maxPages: HARD_MAX_DOCUMENT_PAGES } };

  await assertOrderAISafetyLimit(auth);
  const file = parseFile(body);
  const model = process.env.AI_VISION_MODEL || process.env.AI_MODEL || DEFAULT_MODEL;
  const { data: acquisition, error: acquisitionError } = await auth.admin.from("ai_ordini_acquisizioni").insert({
    utente_id: auth.profile.id, modulo_codice: moduleCode, nome_file: file.filename, tipo_file: file.mediaType, dimensione_byte: file.data.length,
  }).select("id").single();
  if (acquisitionError) throw acquisitionError;
  const generationId = await startAIGeneration(auth.admin, { profileId: auth.profile.id, conversationId: null, type: "riconoscimento_ordine", model });
  await auth.admin.from("ai_ordini_acquisizioni").update({ generazione_id: generationId }).eq("id", acquisition.id);

  let result;
  try {
    result = await generateText({
      model,
      system: "Leggi il documento commerciale senza inventare dati. Estrai cliente, righe prodotto e quantità. Usa stringhe vuote per i campi assenti. Il tipo è OCI solo per prenotazioni esplicite; OCM per evasione immediata esplicita; OCX per backorder esplicito; altrimenti NON_DETERMINATO. Le quantità devono essere positive. Segnala dubbi e testo illeggibile nelle warnings.",
      messages: [{ role: "user", content: [
        { type: "text", text: "Estrai i dati necessari per preparare una bozza d’ordine nel gestionale." },
        { type: "file", mediaType: file.mediaType, data: file.data, filename: file.filename },
      ] }],
      output: Output.object({ name: "OrdineAcquisito", description: "Dati estratti da una richiesta d’ordine", schema: ORDER_DOCUMENT_SCHEMA }),
      maxOutputTokens: 2200,
      providerOptions: { gateway: { user: auth.profile.id, tags: ["app:sali-task", "feature:riconoscimento-ordine", `module:${moduleCode}`] } },
    });
    const extraction = result.output;
    if (extraction.pageCount > HARD_MAX_DOCUMENT_PAGES) throw Object.assign(new Error(`Il documento contiene ${extraction.pageCount} pagine; la soglia tecnica è ${HARD_MAX_DOCUMENT_PAGES}.`), { status: 400 });
    const catalog = await visibleCatalog(auth);
    const matched = {
      ...extraction,
      customerCandidates: rankCustomerCandidates(extraction.customer, catalog.customers),
      lines: extraction.lines.map((line) => ({ ...line, productCandidates: rankProductCandidates(line, catalog.products) })),
    };
    const usage = await completeAIGeneration(auth.admin, { generationId, profileId: auth.profile.id, result });
    await auth.admin.from("ai_ordini_acquisizioni").update({ stato: "completata", esito: matched, completata_il: new Date().toISOString() }).eq("id", acquisition.id);
    return { acquisitionId: acquisition.id, extraction: matched, usage };
  } catch (error) {
    await failAIGeneration(auth.admin, generationId, error);
    await auth.admin.from("ai_ordini_acquisizioni").update({ stato: "errore", errore: String(error?.message || "Errore").slice(0, 1000), completata_il: new Date().toISOString() }).eq("id", acquisition.id);
    throw error;
  }
}
