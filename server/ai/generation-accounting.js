function usageNumbers(usage) {
  return {
    input: Number(usage?.inputTokens || 0),
    output: Number(usage?.outputTokens || 0),
  };
}

function gatewayCost(result) {
  const stepCosts = (Array.isArray(result?.steps) ? result.steps : [])
    .map((step) => Number(step?.providerMetadata?.gateway?.cost))
    .filter(Number.isFinite);
  if (stepCosts.length) return stepCosts.reduce((total, cost) => total + cost, 0);
  const cost = Number(result?.providerMetadata?.gateway?.cost);
  return Number.isFinite(cost) ? cost : 0;
}

export async function startAIGeneration(admin, { profileId, conversationId, type, model }) {
  const { data, error } = await admin.from("ai_generazioni").insert({
    utente_id: profileId,
    conversazione_id: conversationId,
    tipo: type,
    modello: model,
  }).select("id").single();
  if (error) throw error;
  return data.id;
}

export async function failAIGeneration(admin, generationId, error) {
  await admin.from("ai_generazioni").update({
    stato: "errore",
    errore: String(error?.message || "Generazione non riuscita").slice(0, 1000),
    completata_il: new Date().toISOString(),
  }).eq("id", generationId);
}

export async function completeAIGeneration(admin, { generationId, profileId, result }) {
  const usage = result.totalUsage || result.usage;
  const tokens = usageNumbers(usage);
  const cost = gatewayCost(result);
  const { error } = await admin.from("ai_generazioni").update({
    stato: "completata",
    token_input: tokens.input,
    token_output: tokens.output,
    costo_usd: cost,
    provider_request_id: result?.response?.id || null,
    metadati: { finishReason: result?.finishReason || null, costSource: cost > 0 ? "gateway" : "not_reported" },
    completata_il: new Date().toISOString(),
  }).eq("id", generationId);
  if (error) throw error;
  const usageResult = await admin.rpc("workspace_record_ai_usage", {
    p_utente_id: profileId,
    p_token_input: tokens.input,
    p_token_output: tokens.output,
    p_costo_usd: cost,
  });
  if (usageResult.error) throw usageResult.error;
  return { ...tokens, cost };
}

// Compatibilità con i controlli e le integrazioni introdotti con la prima
// rendicontazione AI.
export const startGeneration = startAIGeneration;
export const failGeneration = failAIGeneration;
export const completeGeneration = completeAIGeneration;

