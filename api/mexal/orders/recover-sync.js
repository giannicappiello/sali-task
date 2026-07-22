import { createClient } from "@supabase/supabase-js";
import { buildMexalClient, verifyUser } from "../../../server/mexal/sync-products.js";
import { runOrderContractDiagnostics } from "../../../server/mexal/order-contract-diagnostics.js";
import { runCommercialContractDiagnostics } from "../../../server/mexal/commercial-contract-diagnostics.js";
import { runOrderDestinationDiagnostics } from "../../../server/mexal/order-destination-diagnostics.js";
import { runCommissionDiagnostics } from "../../../server/mexal/commission-diagnostics.js";
import { runCommissionRulesDiagnostics } from "../../../server/mexal/commission-rules-diagnostics.js";
import { downloadFullMexalHelp } from "../../../server/mexal/full-help-download.js";
import { syncCommissionCategories } from "../../../server/mexal/sync-commission-categories.js";
import { runListPriceCommissionsDiagnostics } from "../../../server/mexal/list-price-commissions-diagnostics.js";

const required = (name) => {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Variabile Vercel mancante: ${name}`);
  return value;
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non consentito." });

  try {
    const admin = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
    const authorization = await verifyUser(req, admin, { allowOrdersUser: true });

    if (req.body?.action === "order-contract-diagnostics") {
      if (!authorization?.isAdmin) return res.status(403).json({ error: "Diagnostica riservata agli amministratori." });
      const result = await runOrderContractDiagnostics(buildMexalClient(), req.body?.leftReference, req.body?.rightReference);
      return res.status(200).json(result);
    }

    if (req.body?.action === "commercial-contract-diagnostics") {
      if (!authorization?.isAdmin) return res.status(403).json({ error: "Diagnostica riservata agli amministratori." });
      const result = await runCommercialContractDiagnostics(buildMexalClient(), {
        clientCode: req.body?.clientCode,
        agentCode: req.body?.agentCode,
        productCode: req.body?.productCode,
      });
      return res.status(200).json(result);
    }

    if (req.body?.action === "order-destination-diagnostics") {
      if (!authorization?.isAdmin) return res.status(403).json({ error: "Diagnostica riservata agli amministratori." });
      const result = await runOrderDestinationDiagnostics(buildMexalClient(), {
        year: req.body?.year,
        series: req.body?.series,
        number: req.body?.number,
        clientCode: req.body?.clientCode,
      });
      return res.status(200).json(result);
    }

    if (req.body?.action === "commission-rules-diagnostics") {
      if (!authorization?.isAdmin) return res.status(403).json({ error: "Diagnostica riservata agli amministratori." });
      const result = await runCommissionRulesDiagnostics(buildMexalClient());
      return res.status(200).json(result);
    }

    if (req.body?.action === "full-help-download") {
      if (!authorization?.isAdmin) return res.status(403).json({ error: "Download help Mexal riservato agli amministratori." });
      const result = await downloadFullMexalHelp(buildMexalClient());
      return res.status(200).json(result);
    }

    if (req.body?.action === "list-price-commissions-diagnostics") {
      if (!authorization?.isAdmin) return res.status(403).json({ error: "Diagnostica provvigioni listini riservata agli amministratori." });
      const { summary } = await runListPriceCommissionsDiagnostics(buildMexalClient());
      return res.status(200).json(summary);
    }

    if (req.body?.action === "download-list-price-commissions") {
      if (!authorization?.isAdmin) return res.status(403).json({ error: "Download provvigioni listini riservato agli amministratori." });
      const { payload } = await runListPriceCommissionsDiagnostics(buildMexalClient());
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", "attachment; filename=\"mexal-provvigioni-listini.json\"");
      return res.status(200).send(JSON.stringify(payload));
    }

    if (req.body?.action === "sync-commission-categories") {
      if (!authorization?.isAdmin) return res.status(403).json({ error: "Sincronizzazione categorie provvigionali riservata agli amministratori." });
      const result = await syncCommissionCategories({ mexal: buildMexalClient(), supabase: admin });
      return res.status(200).json(result);
    }

    if (req.body?.action === "commission-diagnostics") {
      if (!authorization?.isAdmin) return res.status(403).json({ error: "Diagnostica riservata agli amministratori." });
      const result = await runCommissionDiagnostics(buildMexalClient(), admin, {
        productCode: req.body?.productCode,
        clientCode: req.body?.clientCode,
        manualReference: req.body?.manualReference,
        workspaceReference: req.body?.workspaceReference,
      });
      return res.status(200).json(result);
    }

    const orderId = String(req.body?.orderId || "").trim();
    if (!orderId) return res.status(400).json({ error: "orderId obbligatorio." });
    const { data, error } = await admin.rpc("recupera_sync_ordine_scaduta", { p_ordine_id: orderId });
    if (error) throw error;
    return res.status(200).json({ recovered: data === true });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || "Impossibile recuperare lo stato." });
  }
}
