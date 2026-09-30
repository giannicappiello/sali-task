// Reuse the same command ID until MES has returned a terminal result. Never invoke browser printing.
export function pendingCentralPrint(key, values, storage = globalThis.sessionStorage) {
  const saved = storage.getItem(key);
  if (saved) return JSON.parse(saved);
  const request = { ...values, id: crypto.randomUUID() };
  storage.setItem(key, JSON.stringify(request));
  return request;
}
export function finishCentralPrint(key, storage = globalThis.sessionStorage) { storage.removeItem(key); }

export async function observeCentralPrint(send, onJob) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = await send();
    const job = result.printJob;
    if (!job?.id || !job.printer || !['Queued', 'Printing', 'Completed', 'Failed'].includes(job.status))
      throw new Error('Aggiornare ProgreMES per utilizzare la stampa centralizzata su PRODUZIONE.');
    onJob(job, result.message);
    if (job.status === 'Failed' || (job.status === 'Completed' && (job.confirmedAt || job.confirmationError))) return job;
    if (attempt < 19) await new Promise(resolve => setTimeout(resolve, 1500));
  }
  return null; // Keep the ID: the next click checks this job, not a new copy.
}
