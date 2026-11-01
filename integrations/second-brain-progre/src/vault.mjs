import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rename, unlink, open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export const defaultSessionPath = () => join(homedir(), '.progre-second-brain', 'session.dpapi');
export async function dpapi(value, decrypt = false) {
  if (process.platform !== 'win32') throw new Error('Questa versione del connettore richiede Windows per proteggere la sessione con DPAPI.');
  const code = decrypt
    ? '$s=ConvertTo-SecureString ([Console]::In.ReadToEnd()); $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try {[Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p))} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}'
    : '$s=ConvertTo-SecureString ([Console]::In.ReadToEnd()) -AsPlainText -Force; [Console]::Out.Write((ConvertFrom-SecureString $s))';
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive','-Command',code], { windowsHide: true, stdio: ['pipe','pipe','pipe'] });
    let output = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('Protezione sessione scaduta.')); }, 15000);
    child.stdout.on('data', part => { output += part; });
    child.stderr.on('data', () => {}); // PowerShell error details must not reveal credential input.
    child.on('error', () => { clearTimeout(timer); reject(new Error('Protezione Windows non disponibile.')); });
    child.on('close', code => { clearTimeout(timer); code === 0 && output ? resolve(output) : reject(new Error('Sessione non leggibile per questo utente Windows. Ripetere il login.')); });
    child.stdin.end(value);
  });
}
export function createVault(path = defaultSessionPath(), protect = dpapi) {
  const read = async () => { try { return JSON.parse(await protect(await readFile(path, 'utf8'), true)); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
  const save = async value => {
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, await protect(JSON.stringify(value)), { mode: 0o600 });
    await rename(temp, path);
  };
  const remove = async () => { await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; }); };
  const withLock = async callback => {
    await mkdir(dirname(path), { recursive: true });
    let handle;
    for (let i = 0; i < 100; i++) {
      try { handle = await open(path + '.lock', 'wx', 0o600); break; }
      catch (error) { if (error.code !== 'EEXIST') throw error; await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    if (!handle) throw new Error('Sessione in uso da un’altra chat. Riprovare; non cancellare il blocco mentre una chat sta operando.');
    try { return await callback(); } finally { await handle.close(); await unlink(path + '.lock'); }
  };
  return { read, save, remove, withLock };
}
