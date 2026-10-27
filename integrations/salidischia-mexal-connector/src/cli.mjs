import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { prepareOrder, documentPayload } from './order.mjs';

async function main() {
  const [command, filename] = process.argv.slice(2);
  if (command !== 'preview' || !filename) throw new Error('Uso: npm run preview -- percorso-ordine.json [config.json]');
  const configFile = process.argv[4];
  const config = configFile ? JSON.parse(await readFile(configFile, 'utf8')) : {};
  const order = JSON.parse(await readFile(filename, 'utf8'));
  const plan = prepareOrder(order, {
    site: config.site || process.env.WOO_URL || 'https://salidischia.it',
    company: config.company || process.env.MEXAL_AZIENDA,
    year: config.year || process.env.MEXAL_ANNO,
  });
  const document = config.customerCode ? documentPayload(plan, config.customerCode, config) : null;
  const directory = resolve('output');
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, `ordine-${plan.orderId}-anteprima.json`);
  await writeFile(path, JSON.stringify({ mode: 'preview', plan, document }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ mode: 'preview', orderId: plan.orderId, products: plan.lines.length, causale: plan.causale,
    lineStatus: 'E', total: plan.totalCents / 100, shipping: plan.shippingCents / 100, path }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
