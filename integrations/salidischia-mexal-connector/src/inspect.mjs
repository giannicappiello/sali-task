import { mkdir, writeFile } from 'node:fs/promises';
import { mexalReader } from './clients.mjs';
try {
  const reader = mexalReader();
  const result = {};
  for (const name of ['clienti', 'documenti/ordini-clienti', 'documenti/ordini-clienti/righe']) result[name] = await reader.help(name);
  await mkdir('output', { recursive: true });
  await writeFile('output/mexal-api-help.json', JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log('Contratti API letti: output/mexal-api-help.json. Nessuna scrittura in Mexal.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
