import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function boot(storage = new Map(), blocked = false) {
  let present = true, timer, changed, reloads = 0, cleared = false;
  const status = { textContent: '', setAttribute() {}, appendChild(button) { this.button = button; } };
  runInNewContext(code, {
    document: { getElementById: id => id === 'root' ? {} : present ? status : null, createElement: () => ({}) },
    location: { pathname: '/produzione/progremes.Planning', search: '?odpId=42&workspaceMesWindow=1', reload() { reloads++; } },
    sessionStorage: { getItem: k => { if(blocked) throw Error(); return storage.get(k); }, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) },
    setTimeout: fn => { timer = fn; return 1; }, clearTimeout: () => { cleared = true; },
    MutationObserver: class { constructor(fn) { changed = fn; } observe() {} disconnect() {} },
  });
  return { expire: () => timer(), rendered: () => { present = false; changed(); }, status, reloads: () => reloads, cleared: () => cleared };
}
test('blocked startup retries once, then shows manual recovery', () => {
  const storage = new Map(); const first = boot(storage); first.expire(); assert.equal(first.reloads(),1);
  const second = boot(storage); second.expire(); assert.equal(second.reloads(),0); assert.equal(second.status.button.textContent,'Riprova');
});
test('successful startup cancels recovery and clears retry marker', () => {
  const storage = new Map(); const first = boot(storage); first.expire();
  const second = boot(storage); second.rendered(); second.expire(); assert.equal(second.reloads(),0); assert.equal(second.cleared(),true); assert.equal(storage.size,0);
});
test('unavailable session storage cannot cause reload loops', () => {
  const page = boot(new Map(),true); page.expire(); assert.equal(page.reloads(),0); assert.ok(page.status.button);
});
