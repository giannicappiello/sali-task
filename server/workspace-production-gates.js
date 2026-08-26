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
  const endpointConfigured = Boolean(String(env.PROGREMES_URL ?? "").trim());
  const authenticationConfigured = Boolean(String(env.PROGREMES_INTEGRATION_SECRET ?? "").trim());
  const allOn = requests && callbacks && confirmations && endpointConfigured && authenticationConfigured;
  return { requests, callbacks, confirmations, endpointConfigured, authenticationConfigured, allOn };
}

export function productionGoLiveGates(health, env = globalThis.process.env) {
  const workspace = workspaceProductionGates(env);
  const progremes = {
    receiveRdp: health?.receiveRdp === true,
    receiveDecisions: health?.receiveDecisions === true,
    executeProduction: health?.executeProduction === true,
    createLots: health?.createLots === true,
  };
  progremes.allOn = Object.values(progremes).every((value) => value === true);
  return { workspace, progremes, allOn: workspace.allOn && progremes.allOn };
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
