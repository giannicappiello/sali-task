export function onlineRequestError(status, result = {}) {
 if (status === 409 && result.code === 'EMAIL_TRANSPORT_NOT_READY') return {
  message: 'Il servizio email non è ancora pronto. Riprova dopo il suo aggiornamento.', code: result.code,
 };
 if (status === 401) return { message: 'La sessione Workspace è scaduta. Accedi nuovamente con il tuo account personale e riapri questo link.' };
 if (status === 404) return { message: 'Proposta non disponibile per questo account Workspace. Accedi con lo stesso account personale collegato a Codex e riapri il link; se il problema resta, verifica la proposta con Progre AI.' };
 if (status === 403) return { message: 'L’account Workspace corrente non è autorizzato a questa operazione. Verifica di usare lo stesso account personale collegato a Codex.' };
 if (status === 409) return { message: 'La proposta o il suo stato sono cambiati. Riapri il riepilogo e verifica lo stato prima di ripetere la conferma.' };
 return { message: `Il riepilogo non è disponibile (HTTP ${status}). Riapri la pagina; se il problema resta, comunica questo codice a Progre AI.` };
}
