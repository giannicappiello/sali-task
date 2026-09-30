const fail = (message, status) => Object.assign(new Error(message), { status });
export function operationalPrintId(body) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.printRequestId || ''))
    throw fail('Ricarica Workspace prima di stampare: manca l’identificativo della richiesta centralizzata.', 400);
  return body.printRequestId.toLowerCase();
}
export function requireCentralPrint(result, operation) {
  if (operation === 'print' && (!result?.printJob?.id || !result.printJob.printer ||
      !['Queued', 'Printing', 'Completed', 'Failed'].includes(result.printJob.status)))
    throw fail('Aggiornare ProgreMES per la stampa centralizzata su PRODUZIONE. Nessuna stampa locale eseguita.', 503);
  return result;
}
