/* global Buffer, process */
import { createHash, randomUUID } from "node:crypto";
import { planningCall, planningConfirmSchema, assertPlanningConfirmation, reconcilePlanning } from "./planning-lifecycle.js";
import { priorityCall, priorityConfirmSchema, assertPriorityConfirmation, reconcilePriority, checkPriorityWorkspace } from "./priority-revision.js";
import { HMAC_HEADERS, signProductionMessage } from "../progremes-production-hmac.js";
import { assertClosureSnapshot, findProductionForClosure } from "./production-closure.js";
import { assertMaterialReallocation, previewMaterialReallocation, materialReallocationSchema } from "./material-reallocation.js";

const text = { type: "string", maxLength: 500 };
const identifier = { type: "string", minLength: 1, maxLength: 160 };
const filters = {
  type: "array", maxItems: 8, items: {
    type: "object", additionalProperties: false, required: ["field", "operator", "value"],
    properties: { field: identifier, operator: { type: "string", enum: ["eq", "neq", "contains", "gte", "lte", "in"] }, value: {} },
  },
};
const block = {
  type: "object", additionalProperties: false, required: ["id", "type", "width"],
  properties: {
    id: identifier, type: { type: "string", enum: ["system-content", "text", "panel", "notice", "button", "links", "divider", "kpi", "data-table"] },
    width: { type: "string", enum: ["full", "half", "third"] }, locked: { type: "boolean" }, title: text, text,
    label: text, href: text, variant: { type: "string", enum: ["primary", "secondary", "danger", "info", "warning"] },
    dataset: { type: "string", enum: ["products", "documents", "orders", "projects", "tasks"] },
    aggregate: { type: "string", enum: ["count", "sum", "average"] }, field: identifier,
    columns: { type: "array", maxItems: 12, items: identifier }, filters,
    limit: { type: "integer", minimum: 1, maximum: 100 },
    table: {
      type: "object", additionalProperties: false,
      properties: {
        hiddenColumns: { type: "array", maxItems: 30, items: text },
        visibleColumns: { type: "array", maxItems: 30, items: text },
        hiddenCards: { type: "array", maxItems: 30, items: text },
        defaultFilters: { type: "object", additionalProperties: { type: "string" } },
        defaultSort: { type: "object", additionalProperties: false, properties: { column: text, direction: { type: "string", enum: ["asc", "desc"] } } },
      },
    },
  },
};

const mesBlock = {
  type: "object", additionalProperties: false, required: ["id", "type", "width"],
  properties: {
    id: identifier, type: { type: "string", enum: ["system-content", "text", "panel", "notice", "button", "links", "divider"] },
    width: { type: "string", enum: ["full", "half", "third"] }, locked: { type: "boolean" }, title: text, text,
    label: text, href: text, variant: { type: "string", enum: ["primary", "secondary", "danger", "info", "warning"] },
    items: { type: "array", maxItems: 20, items: { type: "object", additionalProperties: false, required: ["label", "href"], properties: { label: text, href: text } } },
  },
};

const externalEntitySchema = (entityLabel) => ({
  type: "object", additionalProperties: false, required: ["targetId", "reason", "changes"],
  properties: {
    targetId: identifier, targetLabel: text, reason: text,
    changes: { type: "object", minProperties: 1, additionalProperties: true },
    expectedVersion: { type: ["string", "number", "null"] }, entity: { type: "string", const: entityLabel },
  },
});

export const CONTROLLED_AI_ACTIONS = Object.freeze({
  MES_PLAN_APPLY: { system: "mes", risk: "destructive", permission: "progremes.write", schema: planningConfirmSchema },
  MES_ODL_VERIFY: { system: "mes", risk: "write", permission: "progremes.write", schema: planningConfirmSchema },
  MES_MATERIAL_REALLOCATE: { system: "mes", risk: "destructive", permission: "progremes.write", schema: materialReallocationSchema },
  MES_PRIORITY_REVISE: { system: "mes", risk: "destructive", permission: "progremes.write", schema: priorityConfirmSchema },
  MES_PRODUCTION_FORCE_CLOSE: { system: "mes", risk: "destructive", permission: "progremes.write", schema: {
    type: "object", additionalProperties: false,
    required: ["targetId", "productionId", "productionOrderId", "orderNumber", "articleCode", "phase", "expectedStatus", "expectedStart", "expectedProducedQuantity", "expectedScrapQuantity", "reason", "slAndClAlreadyRegistered"],
    properties: {
      targetId: identifier, productionId: { type: "integer", minimum: 1 }, productionOrderId: { type: "integer", minimum: 1 },
      orderNumber: identifier, articleCode: identifier, phase: { type: "string", enum: ["Semilavorato", "Confezionamento", "Astucciatura"] },
      expectedStatus: { type: "string", enum: ["InProduzione", "Sospeso"] }, expectedStart: identifier,
      expectedProducedQuantity: { type: "number", exclusiveMinimum: 0 }, expectedScrapQuantity: { type: "number", minimum: 0 },
      reason: { type: "string", minLength: 1, maxLength: 1000 }, slAndClAlreadyRegistered: { type: "boolean", const: true },
    },
  } },
  UI_CONFIGURE_VIEW: { system: "workspace", risk: "write", permission: "settings.manage", schema: {
    type: "object", additionalProperties: false, required: ["targetType", "targetCode", "scopeType", "layout", "reason"],
    properties: {
      targetType: { type: "string", enum: ["screen", "module", "menu"] }, targetCode: identifier,
      scopeType: { type: "string", enum: ["global", "role", "department", "user"] }, scopeId: { type: ["string", "null"] }, reason: text,
      layout: { type: "object", additionalProperties: false, required: ["version", "blocks"], properties: {
        version: { type: "integer", const: 1 },
        presentation: { type: "object", additionalProperties: false, properties: { title: text, description: text } },
        blocks: { type: "array", minItems: 1, maxItems: 40, items: block },
      } },
    },
  } },
  MES_UI_CONFIGURE_VIEW: { system: "mes", risk: "write", permission: "progremes.write", schema: {
    type: "object", additionalProperties: false, required: ["targetCode", "layout", "reason"],
    properties: {
      targetCode: identifier, reason: text,
      layout: { type: "object", additionalProperties: false, required: ["version", "blocks"], properties: {
        version: { type: "integer", const: 1 },
        presentation: { type: "object", additionalProperties: false, properties: { title: text, description: text } },
        blocks: { type: "array", minItems: 1, maxItems: 40, items: mesBlock },
      } },
    },
  } },
  ACCESS_ROLE_UPDATE: { system: "workspace", risk: "write", permission: "settings.manage", schema: {
    type: "object", additionalProperties: false, required: ["roleId", "reason"], properties: {
      roleId: identifier, reason: text,
      dataScope: { type: "string", enum: ["propri", "team", "tutti"] },
      accessLevel: { type: "string", enum: ["lettura", "scrittura", "amministrazione"] },
      aiLevel: { type: "string", enum: ["nessuno", "analisi", "bozza", "conferma"] },
      moduleLevels: { type: "array", maxItems: 30, items: { type: "object", additionalProperties: false, required: ["module", "level"], properties: { module: identifier, level: { type: "string", enum: ["lettura", "scrittura", "amministrazione"] } } } },
    },
  } },
  MONITOR_RULE_CREATE: { system: "workspace", risk: "write", permission: null, schema: {
    type: "object", additionalProperties: false, required: ["name", "dataset", "condition", "frequencyMinutes"], properties: {
      name: text, dataset: { type: "string", enum: ["orders", "rdp", "op", "lots", "documents", "materials", "synchronizations"] },
      condition: { type: "object", additionalProperties: true }, frequencyMinutes: { type: "integer", minimum: 5, maximum: 10080 },
      notificationMode: { type: "string", enum: ["on_change", "on_match", "daily_summary"] }, active: { type: "boolean" },
    },
  } },
  ARTICLE_UPDATE: { system: "workspace", risk: "write", permission: "products.write", schema: externalEntitySchema("article") },
  DOCUMENT_METADATA_UPDATE: { system: "workspace", risk: "write", permission: "documentation.write", schema: externalEntitySchema("document") },
  FORMULA_CREATE_REVISION: { system: "mes", risk: "write", permission: "progremes.write", schema: externalEntitySchema("formula") },
  PLANNING_CRITERIA_UPDATE: { system: "mes", risk: "write", permission: "progremes.write", schema: externalEntitySchema("planning") },
  RDP_UPDATE: { system: "mes", risk: "write", permission: "progremes.write", schema: externalEntitySchema("rdp") },
  OP_UPDATE: { system: "mes", risk: "write", permission: "progremes.write", schema: externalEntitySchema("op") },
  LOT_OVERRIDE: { system: "mes", risk: "destructive", permission: "progremes.write", schema: externalEntitySchema("lot") },
  LOT_DOCUMENT_LINK: { system: "mes", risk: "write", permission: "progremes.write", schema: externalEntitySchema("lot_document") },
  PURCHASE_PROPOSAL_CREATE: { system: "mes", risk: "write", permission: "progremes.write", schema: externalEntitySchema("purchase") },
});

function canPropose(auth, descriptor) {
  if (auth.manualPlanning === true) return [CONTROLLED_AI_ACTIONS.MES_PLAN_APPLY, CONTROLLED_AI_ACTIONS.MES_ODL_VERIFY].includes(descriptor);
  const level = String(auth.capabilities?.role_ai_level || (auth.profile?.ruoli?.amministratore_workspace ? "conferma" : "analisi"));
  if (!auth.profile?.ruoli?.amministratore_workspace && !["bozza", "conferma"].includes(level)) return false;
  if (descriptor.system === "mes" && auth.capabilities?.progremes !== true) return false;
  return true;
}

export function availableControlledActions(auth) {
  return Object.fromEntries(Object.entries(CONTROLLED_AI_ACTIONS).filter(([, descriptor]) => canPropose(auth, descriptor)));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  return value;
}

export async function proposeControlledAction(auth, tool, input, { correlationId = randomUUID() } = {}) {
  const descriptor = CONTROLLED_AI_ACTIONS[tool];
  if (!descriptor || !canPropose(auth, descriptor)) throw Object.assign(new Error("Azione AI non autorizzata per questo profilo."), { status: 403 });
  if (["MES_PLAN_APPLY", "MES_ODL_VERIFY"].includes(tool)) input = assertPlanningConfirmation(input, await planningCall(auth, "get", { id: input.targetId }), tool === "MES_ODL_VERIFY");
  if (tool === "MES_PRIORITY_REVISE") input = assertPriorityConfirmation(input, await checkPriorityWorkspace(auth, await priorityCall(auth, "get", { id: input.targetId })));
  if (tool === "MES_MATERIAL_REALLOCATE") {
    const current = await previewMaterialReallocation(auth, input);
    const evidence = assertMaterialReallocation(input, current);
    input = { orderNumber: current.orderNumber, articleCode: current.articleCode,
      targetId: String(current.orderId), expectedHash: current.hash,
      transfers: input.transfers.map(({ sourceOrderId, quantity }) => ({ sourceOrderId, quantity })),
      reason: input.reason.trim(), evidence };
  }
  if (tool === "MES_PRODUCTION_FORCE_CLOSE") {
    const current = await findProductionForClosure(auth, input.orderNumber);
    assertClosureSnapshot(input, current.items);
  }
  const canonical = JSON.stringify(stableValue(input || {}));
  const idempotencyKey = createHash("sha256").update(`${auth.profile.id}:${tool}:${canonical}`).digest("hex");
  const { data, error } = await auth.scoped.rpc(auth.manualPlanning ? "propose_workspace_manual_planning_action" : "propose_workspace_ai_action", {
    p_tool: tool, p_payload: input, p_request_id: randomUUID(), p_correlation_id: correlationId, p_idempotency_key: idempotencyKey,
  });
  if (error) throw error;
  const proposal = Array.isArray(data) ? data[0] : data;
  return { requiresConfirmation: true, changed: false, controlledAction: {
    id: proposal.id, tool, risk: descriptor.risk, system: descriptor.system, state: proposal.status,
    target: proposal.target, preview: input,
  } };
}

function requiredEnvironment(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw Object.assign(new Error(`Configurazione server mancante: ${name}`), { status: 500 });
  return value;
}

async function executeExternalAction(auth, pending) {
  const path = String(process.env.PROGREMES_AI_ACTION_PATH || "/api/workspace/ai/actions/apply");
  // Evidence remains in the durable audit. MES already owns the immutable snapshot;
  // its confirmation contract needs only the identifier, hash and backup attestation.
  const actionInput = ["MES_PLAN_APPLY", "MES_ODL_VERIFY"].includes(pending.tool)
    ? { targetId: pending.payload_summary.targetId, expectedHash: pending.payload_summary.expectedHash,
      backupVerified: pending.payload_summary.backupVerified === true }
    : pending.payload_summary;
  const payload = Buffer.from(JSON.stringify({
    actionId: pending.id, tool: pending.tool, target: pending.target, input: actionInput,
    idempotencyKey: pending.idempotency_key, requestId: pending.request_id, correlationId: pending.correlation_id,
    actor: `workspace:${auth.profile.id}`, confirmed: true,
  }));
  const timestamp = Math.floor(Date.now() / 1000); const eventId = pending.request_id;
  let result = null; let failure = null;
  try {
    const response = await fetch(new URL(path, requiredEnvironment("PROGREMES_URL")), {
      // Full-plan migration writes hundreds of phases. Leave room in the 300s
      // route budget for validation and authoritative readback after this call.
      method: "POST", signal: AbortSignal.timeout(pending.tool === "MES_PLAN_APPLY" ? 120000
        : ["MES_PRIORITY_REVISE", "MES_ODL_VERIFY"].includes(pending.tool) ? 55000
          : Number(process.env.PROGREMES_API_TIMEOUT_MS || 15000)), body: payload,
      headers: { "Content-Type": "application/json", [HMAC_HEADERS.timestamp]: String(timestamp), [HMAC_HEADERS.eventId]: eventId,
        [HMAC_HEADERS.signature]: signProductionMessage({ method: "POST", path, timestamp, eventId, body: payload, secret: requiredEnvironment("PROGREMES_INTEGRATION_SECRET") }) },
    });
    result = await response.json().catch(() => ({}));
    if (!response.ok || result?.applied !== true) failure = result?.error || result?.code || `ProgreMES ha risposto con stato ${response.status}.`;
  } catch (error) { failure = error?.message || "ProgreMES non raggiungibile."; }
  if (["MES_PLAN_APPLY", "MES_ODL_VERIFY"].includes(pending.tool)) {
    try {
      result = await planningCall(auth, "get", { id: pending.payload_summary.targetId });
      failure = result.status === "APPLIED" ? null : [failure, `Stato MES ${result.status}: consultare il dettaglio della versione prima di ripetere l'operazione.`].filter(Boolean).join(" ");
      if (!failure) await reconcilePlanning(auth);
    } catch (error) { failure = [failure, `Esito da verificare nello storico del piano: ${error.message}`].filter(Boolean).join(" "); }
  }
  if (pending.tool === "MES_PRIORITY_REVISE") {
    try {
      result = await reconcilePriority(auth, pending.payload_summary.targetId);
      failure = result.status === "COMPLETED" ? null : failure || result.message || "Revisione non completata: verificare lo storico, senza ripetere i trasferimenti.";
    } catch (error) { failure = `Esito da riconciliare: ${error.message}. Verificare la revisione prima di ripetere.`; }
  }
  if (failure && pending.tool === "MES_MATERIAL_REALLOCATE") {
    // Verify the durable MES audit after a timeout. Never repeat the transfer blindly.
    try {
      const resultPath = "/api/workspace/ai/materials/result";
      const resultBody = Buffer.from(JSON.stringify({ idempotencyKey: pending.idempotency_key, actor: `workspace:${auth.profile.id}` }));
      const resultTime = Math.floor(Date.now() / 1000), resultId = randomUUID();
      const response = await fetch(new URL(resultPath, requiredEnvironment("PROGREMES_URL")), {
        method: "POST", body: resultBody, signal: AbortSignal.timeout(10000),
        headers: { "Content-Type": "application/json", [HMAC_HEADERS.timestamp]: String(resultTime), [HMAC_HEADERS.eventId]: resultId,
          [HMAC_HEADERS.signature]: signProductionMessage({ method: "POST", path: resultPath, timestamp: resultTime, eventId: resultId, body: resultBody, secret: requiredEnvironment("PROGREMES_INTEGRATION_SECRET") }) },
      });
      const verified = await response.json();
      if (response.ok && verified.applied === true) { result = { ...verified, verifiedAfterTimeout: true }; failure = null; }
    } catch { /* Uncertain outcome remains visible; no second write. */ }
    if (failure) failure = `Esito riallocazione non confermato: ${failure} Verificare impegni e audit MES prima di ripetere.`;
  }
  if (failure && pending.tool === "MES_PRODUCTION_FORCE_CLOSE") {
    // Read back the durable confirmation; never retry a warehouse-related write blindly.
    try {
      const current = await findProductionForClosure(auth, pending.payload_summary.orderNumber);
      const work = current.items.find(row => row.productionId === pending.payload_summary.productionId);
      if (work?.status === "Terminato" && work.closureConfirmationKey === pending.idempotency_key) {
        result = { applied: true, productionId: work.productionId, verifiedAfterTimeout: true, mexalMovementsGenerated: false };
        failure = null;
      }
    } catch { /* Keep the uncertain outcome visible; no automatic write retry. */ }
    if (failure) failure = `Chiusura non confermata: ${failure} Verificare lo stato MES prima di ripetere l'operazione.`;
  }
  const { data, error } = await auth.admin.rpc("complete_workspace_external_ai_action", { p_proposal_id: pending.id, p_succeeded: !failure, p_result: result || {}, p_error: failure });
  if (error) throw error;
  const action = Array.isArray(data) ? data[0] : data;
  return { action, failure };
}

export async function decideControlledAction(auth, body) {
  const proposalId = String(body.proposalId || "").trim();
  if (!proposalId) throw Object.assign(new Error("Proposta operativa mancante."), { status: 400 });
  const { data: pending, error: pendingError } = await auth.scoped.from("ai_action_audit").select("*").eq("id", proposalId).eq("user_id", auth.profile.id).maybeSingle();
  if (pendingError || !pending || !CONTROLLED_AI_ACTIONS[pending.tool]) throw Object.assign(new Error("Proposta non trovata o non autorizzata."), { status: 404 });
  if (auth.manualPlanning && (!["MES_PLAN_APPLY", "MES_ODL_VERIFY"].includes(pending.tool) || pending.action !== "manual_planning")) throw Object.assign(new Error("Proposta non appartenente alla pianificazione manuale."), { status: 403 });
  const confirmed = body.decision === "confirm";
  if (confirmed && ["MES_PLAN_APPLY", "MES_ODL_VERIFY"].includes(pending.tool) && pending.status === "proposed")
    assertPlanningConfirmation(pending.payload_summary, await planningCall(auth, "get", { id: pending.payload_summary.targetId }), pending.tool === "MES_ODL_VERIFY");
  if (confirmed && pending.tool === "MES_PRIORITY_REVISE" && pending.status === "proposed") assertPriorityConfirmation(pending.payload_summary, await checkPriorityWorkspace(auth, await priorityCall(auth, "get", { id: pending.payload_summary.targetId })));
  if (confirmed && pending.tool === "MES_MATERIAL_REALLOCATE" && pending.status === "proposed") {
    assertMaterialReallocation(pending.payload_summary, await previewMaterialReallocation(auth, pending.payload_summary));
  }
  if (confirmed && pending.tool === "MES_PRODUCTION_FORCE_CLOSE" && pending.status === "proposed") {
    const current = await findProductionForClosure(auth, pending.payload_summary.orderNumber);
    assertClosureSnapshot(pending.payload_summary, current.items);
  }
  const { data: decided, error: decideError } = await auth.scoped.rpc(auth.manualPlanning ? "decide_workspace_manual_planning_action" : "decide_workspace_ai_action", { p_proposal_id: pending.id, p_confirm: confirmed });
  if (decideError) throw decideError;
  let action = Array.isArray(decided) ? decided[0] : decided;
  let failure = null;
  if (confirmed && action.status === "confirmed" && CONTROLLED_AI_ACTIONS[action.tool].system === "mes") ({ action, failure } = await executeExternalAction(auth, action));
  const answer = action.tool === "MES_PRIORITY_REVISE" ? (failure || action.error || action.result?.message || "Proposta rifiutata: nessun trasferimento eseguito.") : action.status === "executed" ? "Operazione applicata e registrata nell’audit."
    : action.status === "rejected" ? "Proposta rifiutata. Nessuna modifica è stata applicata."
      : `${action.tool === "MES_MATERIAL_REALLOCATE" ? "Operazione non confermata" : "Operazione non applicata"}. Audit registrato: ${failure || action.error || "connettore non disponibile"}.`;
  return { controlledAction: { id: action.id, tool: action.tool, risk: CONTROLLED_AI_ACTIONS[action.tool].risk, system: action.system, state: action.status, result: action.result, error: failure || action.error || null }, answer };
}
