import { processNextOrderEmailJob } from './order-email-job.js';
import { processNextShipmentEmailJob } from '../shipment-email-worker.js';
import { isPermanentSmtpError } from '../email/smtp-client.js';

export async function processNextWorkspaceEmailJob(options) {
  const result = await processNextShipmentEmailJob({...options,isPermanentError:isPermanentSmtpError});
  return result.status === 'idle' ? processNextOrderEmailJob(options) : result;
}
