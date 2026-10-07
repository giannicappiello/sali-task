import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

// Recover only by reading the selected phase. Never repeat a write after an uncertain response.
export async function reconcileBatchClosure(client, input, { wait = setTimeout } = {}) {
  let phase;
  let readError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { result } = await client.batchSheet({ ...input, externalId: randomUUID(), operation: 'list' });
      phase = result.phases?.find(row => String(row.id).toLowerCase() === input.phaseId.toLowerCase());
      if (!phase) throw new Error('Il batch selezionato non Ã¨ presente nello stato restituito da MES.');
      if (phase.executionStatus === 'COMPLETED') {
        let message = 'Lavorazione chiusa correttamente. Stato del PDF sul NAS da verificare.';
        try {
          const archive = await client.batchSheet({ ...input, externalId: randomUUID(), operation: 'archive-status' });
          if (archive.result.message) message = archive.result.message;
        } catch { /* Closure is verified independently from the archive service. */ }
        return { closed: true, verifiedAfterTimeout: true, message };
      }
      if (!['RUNNING', 'SUSPENDED', 'CLOSING'].includes(phase.executionStatus)) break;
    } catch (error) { readError = error; }
    if (attempt < 2) await wait(3000);
  }
  if (phase && ['RUNNING', 'SUSPENDED', 'CLOSING'].includes(phase.executionStatus))
    return { closed: false, pending: true, verifiedAfterTimeout: true,
      message: `Chiusura non ancora completata. Stato MES: ${phase.executionStatus}. Il consuntivo non viene reinviato; verifica nuovamente lo stato della lavorazione.` };
  throw Object.assign(new Error(`Tempo di attesa della risposta terminato; esito della chiusura non verificato. ${readError?.message || 'Stato MES: ' + (phase?.executionStatus || 'non disponibile')}. Verifica lo stato prima di riprovare.`), { status: 504, code: 'CLOSURE_OUTCOME_UNVERIFIED' });
}