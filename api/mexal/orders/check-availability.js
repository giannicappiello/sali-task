/* global process */
import { createClient } from "@supabase/supabase-js";
import {
  buildMexalClient,
  calculateAvailability,
  calculateStock,
  getArticleCode,
  loadFullArticle,
  verifyUser,
} from "../../../server/mexal/sync-products.js";

export const MAX_ORDER_LINES = 200;
export const AVAILABILITY_CONCURRENCY = 6;

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Variabile Vercel mancante: ${name}`);
  return value;
}

function quantity(value) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeLines(lines) {
  if (!Array.isArray(lines) || !lines.length) {
    throw Object.assign(new Error("lines è obbligatorio e non può essere vuoto."), { status: 400 });
  }
  if (lines.length > MAX_ORDER_LINES) {
    throw Object.assign(new Error(`Sono consentite al massimo ${MAX_ORDER_LINES} righe.`), { status: 400 });
  }

  const aggregated = new Map();
  for (const line of lines) {
    const productCode = String(line?.productCode ?? line?.codice_articolo ?? line?.codiceArticolo ?? "")
      .trim()
      .toUpperCase();
    if (!productCode) throw Object.assign(new Error("Codice prodotto obbligatorio."), { status: 400 });
    const requestedQuantity = quantity(line?.quantity ?? line?.quantita);
    if (requestedQuantity === null || requestedQuantity <= 0) {
      throw Object.assign(new Error(`Quantità non valida per l'articolo ${productCode}.`), { status: 400 });
    }
    aggregated.set(productCode, (aggregated.get(productCode) || 0) + requestedQuantity);
  }
  return [...aggregated].map(([productCode, requestedQuantity]) => ({ productCode, requestedQuantity }));
}

export function availabilityLine(productCode, requestedQuantity, article) {
  const availableQuantity = calculateAvailability(article, calculateStock(article));
  const confirmedQuantity = Math.min(requestedQuantity, Math.max(availableQuantity, 0));
  const missingQuantity = requestedQuantity - confirmedQuantity;
  return {
    productCode,
    requestedQuantity,
    availableQuantity,
    confirmedQuantity,
    missingQuantity,
    status: confirmedQuantity === requestedQuantity ? "available" : confirmedQuantity > 0 ? "partial" : "unavailable",
    message: null,
  };
}

export function importAvailabilityLine(productCode, requestedQuantity) {
  return { productCode, requestedQuantity, availableQuantity: null, confirmedQuantity: requestedQuantity, missingQuantity: 0, status: "import", message: null };
}

export function summarize(lines) {
  return lines.reduce((summary, line) => {
    summary.totalLines += 1;
    summary.requestedQuantity += line.requestedQuantity;
    summary.confirmedQuantity += line.confirmedQuantity || 0;
    summary.missingQuantity += line.missingQuantity || 0;
    if (line.status === "available") summary.availableLines += 1;
    if (line.status === "partial") summary.partialLines += 1;
    if (line.status === "unavailable") summary.unavailableLines += 1;
    if (line.status === "error") summary.errorLines += 1;
    return summary;
  }, { totalLines: 0, availableLines: 0, partialLines: 0, unavailableLines: 0, errorLines: 0, requestedQuantity: 0, confirmedQuantity: 0, missingQuantity: 0 });
}

export async function mapWithConcurrency(values, limit, mapper) {
  const results = new Array(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      results[index] = await mapper(values[index]);
    }
  }));
  return results;
}

function defaultSupabase() {
  return createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createCheckAvailabilityHandler({ supabaseFactory = defaultSupabase, mexalFactory = buildMexalClient } = {}) {
  return async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).json({ error: "Metodo non consentito." });
    const started = Date.now();
    try {
      const supabase = supabaseFactory();
      await verifyUser(req, supabase, { allowOrdersUser: true });
      const requestedLines = normalizeLines(req.body?.lines);
      const mexal = mexalFactory();
      const lines = await mapWithConcurrency(requestedLines, AVAILABILITY_CONCURRENCY, async ({ productCode, requestedQuantity }) => {
        // Imports are classified before stock lookup and never consume warehouse availability.
        if (productCode.trim().toUpperCase().startsWith("IMP")) return importAvailabilityLine(productCode, requestedQuantity);
        try {
          // Same point lookup and stock formula used by sync-stock-it; no catalogue scan or writes.
          const article = await loadFullArticle(mexal, productCode);
          if (!article || getArticleCode(article) !== productCode) {
            return { productCode, requestedQuantity, availableQuantity: null, confirmedQuantity: 0, missingQuantity: requestedQuantity, status: "error", message: "Articolo non trovato o non verificabile in Mexal." };
          }
          return availabilityLine(productCode, requestedQuantity, article);
        } catch {
          return { productCode, requestedQuantity, availableQuantity: null, confirmedQuantity: 0, missingQuantity: requestedQuantity, status: "error", message: "Impossibile verificare la disponibilità su Mexal." };
        }
      });
      const summary = summarize(lines);
      const status = summary.errorLines ? "completed_with_errors" : "completed";
      console.info("Mexal order availability checked", { requestedLines: requestedLines.length, checkedLines: lines.length, errors: summary.errorLines, durationMs: Date.now() - started });
      return res.status(200).json({ success: summary.errorLines === 0, status, checkedAt: new Date().toISOString(), warehouse: Number(mexal.magazzino) || mexal.magazzino, summary, lines });
    } catch (error) {
      console.warn("Mexal order availability failed", { durationMs: Date.now() - started, error: error?.message });
      return res.status(error.status || 500).json({ success: false, status: "failed", error: error.message || "Errore verifica disponibilità." });
    }
  };
}

export default createCheckAvailabilityHandler();
