import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class Journal {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS imports (
        source_key TEXT PRIMARY KEY, plan_hash TEXT NOT NULL, status TEXT NOT NULL,
        customer_code TEXT, document_ref TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );`);
    const columns=new Set(this.db.prepare('PRAGMA table_info(imports)').all().map(x=>x.name));
    for(const name of ['last_phase','last_error','verification_json'])if(!columns.has(name))this.db.exec(`ALTER TABLE imports ADD COLUMN ${name} TEXT`);
  }
  reserve(plan) {
    const existing = this.get(plan.key);
    if (existing) {
      if (existing.plan_hash !== plan.hash) throw new Error('Ordine già acquisito ma modificato: riconciliazione manuale necessaria.');
      if (existing.status === 'verified') return existing;
      throw new Error('Invio precedente incompleto o incerto: riconciliare prima di ritentare.');
    }
    this.db.prepare('INSERT INTO imports(source_key, plan_hash, status) VALUES (?, ?, ?)').run(plan.key, plan.hash, 'reserved');
    return null;
  }
  set(key, status, customerCode = null, documentRef = null) {
    this.db.prepare('UPDATE imports SET status=?, customer_code=COALESCE(?,customer_code), document_ref=COALESCE(?,document_ref), updated_at=CURRENT_TIMESTAMP WHERE source_key=?').run(status, customerCode, documentRef, key);
    if(status==='verified')this.db.prepare('UPDATE imports SET last_phase=NULL,last_error=NULL WHERE source_key=?').run(key);
  }
  get(key) { return this.db.prepare('SELECT * FROM imports WHERE source_key=?').get(key); }
  setVerification(key,value){this.db.prepare("UPDATE imports SET verification_json=? WHERE source_key=? AND status='verified'").run(JSON.stringify(value),key);}
  fail(key,error) {
    this.db.prepare("UPDATE imports SET last_phase=status,last_error=?,status='reconciliation_required',updated_at=CURRENT_TIMESTAMP WHERE source_key=?").run(error.message,key);
  }
  close() { this.db.close(); }
}
