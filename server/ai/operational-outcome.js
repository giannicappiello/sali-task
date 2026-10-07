// Execution summaries are derived from persisted tool outcomes, never model claims.
export function verifiedOperationalAnswer(modelText, outputs) {
  const latest = new Map();
  for (const output of outputs) {
    const action = output?.controlledAction;
    if (action && ['MES_PRODUCTION_START', 'MES_PRODUCTION_RESUME_CLOSE'].includes(action.tool)) latest.set(action.id, output);
  }
  const reports = [];
  for (const output of latest.values()) {
    const action = output.controlledAction;
    if (action.state === 'proposed' || action.state === 'rejected') continue;
    if (action.tool === 'MES_PRODUCTION_RESUME_CLOSE') {
      if (action.result?.verified === true && action.result?.applied === true && action.state === 'executed') reports.push(action.result.message);
      else reports.push(action.error || action.result?.message || 'Chiusura non verificata: rileggere lo stato MES prima di riprendere.');
    } else if (action.state === 'executed' && action.result?.verified === true && action.result?.applied === true) {
      reports.push(action.result.phaseStatus === 'COMPLETED' ? 'Produzione avviata; lavorazione già conclusa.' : 'Produzione avviata: in lavorazione.');
    } else if (action.error) reports.push(`Avvio bloccato: ${action.error}`);
    else if (action.state === 'confirmed') reports.push(output.answer || 'Stampa e avvio in elaborazione; avvio non ancora verificato.');
    else reports.push('Avvio non verificato: controllare lo stato MES senza ristampare.');
  }
  return reports.length ? reports.filter(Boolean).join('\n') : modelText;
}
