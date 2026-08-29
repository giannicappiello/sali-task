const FLAG_NAMES = Object.freeze({
  requests: "PROGREMES_PRODUCTION_REQUESTS_ENABLED",
  callbacks: "PROGREMES_PRODUCTION_CALLBACKS_ENABLED",
  confirmations: "PROGREMES_PRODUCTION_CONFIRMATIONS_ENABLED",
});

function enabled(value) {
  return String(value ?? "").trim().toLowerCase() === "true";
}

export function workspaceProductionGates(env = globalThis.process.env) {
  const requests = enabled(env[FLAG_NAMES.requests]);
  const callbacks = enabled(env[FLAG_NAMES.callbacks]);
  const confirmations = enabled(env[FLAG_NAMES.confirmations]);
  const v4Preview = enabled(env.WORKSPACEMES_V4_PREVIEW_ENABLED);
  const v4Confirm = enabled(env.WORKSPACEMES_V4_CONFIRM_ENABLED);
  const endpointConfigured = Boolean(String(env.PROGREMES_URL ?? "").trim());
  const authenticationConfigured = Boolean(String(env.PROGREMES_INTEGRATION_SECRET ?? "").trim());
  const allOn = requests && callbacks && confirmations && v4Preview && v4Confirm && endpointConfigured && authenticationConfigured;
  return { requests, callbacks, confirmations, v4Preview, v4Confirm, endpointConfigured, authenticationConfigured, allOn };
}

export function productionGoLiveGates(health, env = globalThis.process.env) {
  const workspace = workspaceProductionGates(env);
  const progremes = {
    receiveRdp: health?.receiveRdp === true,
    receiveDecisions: health?.receiveDecisions === true,
    executeProduction: health?.executeProduction === true,
    createLots: health?.createLots === true,
    receiveV4Previews: health?.receiveV4Previews === true,
    confirmV4Production: health?.confirmV4Production === true,
  };
  progremes.allOn = progremes.receiveV4Previews && progremes.confirmV4Production && progremes.executeProduction && progremes.createLots;
  const previewOn = workspace.requests && workspace.v4Preview && workspace.endpointConfigured && workspace.authenticationConfigured && progremes.receiveV4Previews;
  return { workspace, progremes, previewOn, allOn: workspace.allOn && progremes.allOn };
}

export function decorateProductionHealth(health, env = globalThis.process.env) {
  const productionGates = productionGoLiveGates(health, env);
  if (productionGates.allOn) return { ...health, productionGates };
  return {
    ...health,
    globalStatus: "RED",
    blocking: Number(health?.blocking ?? 0) + 1,
    productionGates,
  };
}

export { FLAG_NAMES };
