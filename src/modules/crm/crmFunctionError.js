export async function crmFunctionError(error) {
  // FunctionsHttpError contains the endpoint response; its generic message
  // alone hides the actual failure from the operator.
  try {
    const response = error?.context;
    const body = await (response?.clone ? response.clone() : response)?.json();
    if (typeof body?.error === "string" && body.error.trim()) return new Error(body.error);
  } catch { /* Keep network/non-JSON errors readable too. */ }
  return error instanceof Error ? error : new Error(error?.message || "Impossibile caricare i dati CRM. Riprova.");
}
