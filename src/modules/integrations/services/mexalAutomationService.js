function apiError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function messageForStatus(status) {
  if (status === 401) return "Sessione scaduta o non autorizzata. Accedi di nuovo per gestire le automazioni.";
  if (status === 403) return "Non disponi dei permessi amministrativi per gestire le automazioni.";
  if (status >= 500) return "Il servizio automazioni non è disponibile. Riprova tra qualche istante.";
  return "Impossibile completare la richiesta alle automazioni Mexal.";
}

export async function requestMexalAutomation({ supabase, action, ruleType, rule, fetchImpl = fetch }) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw apiError(401, "Impossibile recuperare la sessione corrente.");
  const accessToken = data?.session?.access_token;
  if (!accessToken) throw apiError(401, "Sessione non disponibile. Accedi di nuovo per gestire le automazioni.");

  const body = { action };
  if (ruleType) body.ruleType = ruleType;
  if (rule) body.rule = rule;

  let response;
  try {
    response = await fetchImpl("/api/mexal/automation", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw apiError(0, "Impossibile raggiungere il servizio automazioni Mexal. Controlla la connessione e riprova.");
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw apiError(response.status, "Il servizio automazioni ha restituito una risposta non valida.");
  }
  if (!response.ok) throw apiError(response.status, payload?.error || messageForStatus(response.status));
  return payload;
}

export async function loadMexalAutomationRules(options) {
  const payload = await requestMexalAutomation({ ...options, action: "rules_get" });
  if (!payload || !Array.isArray(payload.schedules) || !Array.isArray(payload.events)) {
    throw apiError(0, "Il servizio automazioni ha restituito dati non validi.");
  }
  return { schedules: payload.schedules, events: payload.events };
}

export async function saveMexalAutomationRule({ supabase, ruleType, rule, fetchImpl }) {
  const payload = await requestMexalAutomation({ supabase, action: "rules_save", ruleType, rule, fetchImpl });
  if (!payload || !payload.rule) throw apiError(0, "Il servizio automazioni non ha confermato il salvataggio della regola.");
  return payload.rule;
}
