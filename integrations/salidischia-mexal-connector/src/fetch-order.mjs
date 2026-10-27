import { mkdir, writeFile } from 'node:fs/promises';
import { wooClient } from './clients.mjs';
try {
  const id = process.argv[2];
  const order = await wooClient().order(id);
  await mkdir('data', { recursive: true });
  const path = `data/ordine-${order.id}.json`;
  await writeFile(path, JSON.stringify(order, null, 2), { mode: 0o600 });
  console.log(`Ordine acquisito in ${path}. Nessun documento creato in Mexal.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
