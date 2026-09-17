import { authorizeAIRequest } from "./ai/assistant.js";
import { planningCall, reconcilePlanning } from "./ai/planning-lifecycle.js";
import { proposeControlledAction, decideControlledAction } from "./ai/controlled-actions.js";
import { planningVersionWithAudit } from "./planning-audit.js";

// Manual operations use MES permissions, not an AI subscription/role. Never accept arbitrary tools.
export async function handlePlanningWorkspace(req) {
  if (req.method !== "POST") throw Object.assign(new Error("Metodo non consentito."), { status: 405 });
  const auth = { ...await authorizeAIRequest(req, { bypassAIEntitlements: true }), manualPlanning: true };
  const { data, error } = await auth.scoped.rpc("company_mes_ai_can_write");
  if (error || data !== true) throw Object.assign(new Error("Permesso operativo MES richiesto."), { status: 403 });
  const body = req.body || {};
  switch (body.action) {
    case "planning_state": return planningCall(auth, "state");
    case "planning_get": return planningVersionWithAudit(auth, await planningCall(auth, "get", { id: body.id }));
    case "planning_simulate": return planningCall(auth, "simulate", { input: body.input });
    case "planning_reconcile": return reconcilePlanning(auth);
    case "planning_propose": return proposeControlledAction(auth, "MES_PLAN_APPLY", body.input || {});
    case "planning_verify": return proposeControlledAction(auth, "MES_ODL_VERIFY", body.input || {});
    case "controlled_decide": return decideControlledAction(auth, body);
    default: throw Object.assign(new Error("Operazione manuale non consentita."), { status: 400 });
  }
}
