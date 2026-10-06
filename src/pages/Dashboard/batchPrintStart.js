// Start only after MES confirms the exact sheet was delivered to the print spooler.
export async function batchPrintStart({ alreadyPrinted, print, onPrinted, start }) {
  if (!alreadyPrinted) {
    const job = await print();
    if (!job) return false;
    if (job.status !== 'Completed' || !job.confirmedAt || job.confirmationError)
      throw new Error(job.confirmationError || 'Stampa non confermata: lavorazione non avviata.');
    onPrinted();
    if (job.sheet?.startAfterPrint === true) return true; // Durable MES worker has confirmed startup too.
  }
  await start();
  return true;
}
