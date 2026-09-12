import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./AuthContext.jsx', import.meta.url), 'utf8');
const effect = source.slice(source.indexOf('    let mounted = true;'), source.indexOf('\n  }, []);'));
function harness({ fail = false } = {}) {
  let callback, locked = false, cleanup, loading = true, error = '', calls = 0;
  const timers = new Map(); let next = 0;
  const window = { setTimeout(fn, delay) { timers.set(++next, {fn,delay}); return next; }, clearTimeout(id) { timers.delete(id); } };
  const names = [...new Set([...effect.matchAll(/\b(set[A-Z]\w*)\(/g)].map(m => m[1]))];
  const setters = names.map(name => name === 'setLoading' ? value => { loading = value; } : name === 'setAuthError' ? value => { error = value; } : () => {});
  const supabase = { auth: { onAuthStateChange(fn) { callback = fn; return {data:{subscription:{unsubscribe(){}}}}; } } };
  const loadProfile = async () => { assert.equal(locked, false, 'profile query executed under auth lock'); calls++; if(fail) throw Error('offline'); };
  cleanup = new Function('supabase','window','loadProfile','EMPTY_DATA_SCOPE','console',...names,effect)(supabase,window,loadProfile,{}, {error(){}},...setters);
  return { emit(session) { locked = true; const result = callback('INITIAL_SESSION',session); locked = false; assert.equal(result,undefined); }, async flush(delay) { for(const [id,t] of [...timers]) if(t.delay === delay){ timers.delete(id); t.fn(); } await new Promise(resolve => setImmediate(resolve)); }, cleanup, get loading(){return loading;}, get error(){return error;}, get calls(){return calls;} };
}
test('auth callback releases the lock before fetching the profile', async () => { const h=harness(); h.emit({user:{id:'one'}}); assert.equal(h.calls,0); await h.flush(0); assert.equal(h.calls,1); assert.equal(h.loading,false); });
test('anonymous initial session finishes loading', async () => { const h=harness(); h.emit(null); await h.flush(0); assert.equal(h.calls,0); assert.equal(h.loading,false); });
test('unmount cancels queued profile fetches', async () => { const h=harness(); h.emit({user:{id:'one'}}); h.cleanup(); await h.flush(0); assert.equal(h.calls,0); });
test('profile rejection exposes retry error without opening protected route', async () => { const h=harness({fail:true}); h.emit({user:{id:'one'}}); await h.flush(0); assert.ok(h.error); assert.equal(h.loading,true); });
test('missing auth response exposes timeout', async () => { const h=harness(); await h.flush(30000); assert.ok(h.error); assert.equal(h.loading,true); });
