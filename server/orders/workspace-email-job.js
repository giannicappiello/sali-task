import { processNextActivityEmailJob } from '../email/activity-email-worker.js';
import { processNextOrderEmailJob } from './order-email-job.js';
import { processNextShipmentEmailJob } from '../shipment-email-worker.js';
import { isPermanentSmtpError } from '../email/smtp-client.js';

export async function processNextWorkspaceEmailJob(options) {
  const result = await processNextShipmentEmailJob({...options,isPermanentError:isPermanentSmtpError});
  if (result.status !== 'idle') return result;
  const order = await processNextOrderEmailJob(options);
  return order.status === 'idle' ? processNextActivityEmailJob(options) : order;
}
