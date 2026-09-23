import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers';
import { accessSnapshotSignature, retainEqualAccessValue, retainAccessProfile } from '../config/workspaceAccessSnapshot.js';

const source = readFileSync(new URL('./AuthContext.jsx', import.meta.url), 'utf8');
const effect = source.slice(source.indexOf('    let mounted = true;'), source.indexOf('\n  }, []);'));
function harness({ fail = false } = {}) {
  let callback, locked = false, cleanup, loading = true, error = '', calls = 0;
  const timers = new Map(); let next = 0;
  const window = { setTimeout(fn, delay) { timers.set(++next, {fn,delay}); return next; }, clearTimeout(id) { timers.delete(id); } };
  const names = [...new Set([...effect.matchAll(/\b(set[A-Z]\w*)\(/g)].map(m => m[1]))];
  const setters = names.map(name => name === 'setLoading' ? value => { loading = value; } : name === 'setAuthError' ? value => { error = value; } : () => {});
  const supabase = { auth: { onAuthStateChange(fn) { callback = fn; return {data:{subscription:{unsubscribe(){}}}}; } } };
  const sessionReady = { current: false };
  const loadProfile = async () => { assert.equal(locked, false, 'profile query executed under auth lock'); calls++; if(fail) throw Error('offline'); sessionReady.current = true; loading = false; };
  cleanup = new Function('supabase','window','loadProfile','EMPTY_DATA_SCOPE','console','currentAuthId','loadGeneration','sessionReady',...names,effect)(supabase,window,loadProfile,{}, {error(){}},{current:null},{current:0},sessionReady,...setters);
  return { emit(session) { locked = true; const result = callback('INITIAL_SESSION',session); locked = false; assert.equal(result,undefined); }, async flush(delay) { for(const [id,t] of [...timers]) if(t.delay === delay){ timers.delete(id); t.fn(); } await new Promise(resolve => setImmediate(resolve)); }, cleanup, get loading(){return loading;}, get error(){return error;}, get calls(){return calls;} };
}
test('auth callback releases the lock before fetching the profile', async () => { const h=harness(); h.emit({user:{id:'one'}}); assert.equal(h.calls,0); await h.flush(0); assert.equal(h.calls,1); assert.equal(h.loading,false); });
test('anonymous initial session finishes loading', async () => { const h=harness(); h.emit(null); await h.flush(0); assert.equal(h.calls,0); assert.equal(h.loading,false); });
test('unmount cancels queued profile fetches', async () => { const h=harness(); h.emit({user:{id:'one'}}); h.cleanup(); await h.flush(0); assert.equal(h.calls,0); });
test('profile rejection exposes retry error without opening protected route', async () => { const h=harness({fail:true}); h.emit({user:{id:'one'}}); await h.flush(0); assert.ok(h.error); assert.equal(h.loading,true); });
test('missing auth response exposes timeout', async () => { const h=harness(); await h.flush(30000); assert.ok(h.error); assert.equal(h.loading,true); });

function sessionHarness() {
  const loadCode = source.slice(source.indexOf('  async function loadProfile('), source.indexOf('  async function signIn('));
  const requests = [], timers = new Map(), state = { setLoading: true };
  let callback, next = 0;
  const window = { setTimeout(fn, delay) { timers.set(++next, { fn, delay }); return next; }, clearTimeout(id) { timers.delete(id); } };
  const supabase = {
    auth: { onAuthStateChange(fn) { callback = fn; return { data: { subscription: { unsubscribe() {} } } }; } },
    rpc() { return new Promise((resolve, reject) => requests.push({ resolve, reject })); },
    from() { return { update() { return { eq: async () => ({}) }; } }; },
  };
  const deps = { supabase, window, console: { error() {} }, ensureProfile: async () => {}, EMPTY_DATA_SCOPE: {},
    currentAuthId: { current: null }, loadGeneration: { current: 0 }, sessionReady: { current: false },
    accessRevision: { current: null }, lastAccessSignature: { current: '' },
    accessSnapshotSignature, retainEqualAccessValue, retainAccessProfile };
  for (const [, name] of (effect + loadCode).matchAll(/\b(set[A-Z]\w*)\(/g)) {
    deps[name] = value => { state[name] = typeof value === 'function' ? value(state[name]) : value; };
  }
  const api = new Function(...Object.keys(deps), `${loadCode}\nconst cleanup = (() => {${effect}})(); return {loadProfile, cleanup};`)(...Object.values(deps));
  const settle = () => new Promise(resolve => setImmediate(resolve));
  return { ...api, requests, state, async emit(session) { callback('INITIAL_SESSION', session); await this.flush(0); },
    async flush(delay) { for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.fn(); } await settle(); }, settle };
}
const planningSnapshot = () => ({ data: { profile: { id: 'maria', attivo: true }, access: { modules: ['progremes'] },
  screen_levels: { 'progremes.Planning': 'amministrazione' } } });

test('catalogue revisions retain the MES session while real permission changes invalidate it', async () => {
  const h = sessionHarness();
  const first = h.loadProfile({ id: 'maria' });
  await h.settle();
  h.requests[0].resolve({ data: { ...planningSnapshot().data, revision: 10 } }); await first;
  const revision = h.state.setAuthorizationRevision;
  const second = h.loadProfile({ id: 'maria' }, { refresh: true });
  h.requests[1].resolve({ data: { ...planningSnapshot().data, revision: 11 } }); await second;
  assert.equal(h.state.setAuthorizationRevision, revision);
  const third = h.loadProfile({ id: 'maria' }, { refresh: true });
  h.requests[2].resolve({ data: { ...planningSnapshot().data, revision: 12, screen_levels: {} } }); await third;
  assert.notEqual(h.state.setAuthorizationRevision, revision);
});

test('Planning popup waits for the newest access snapshot when realtime overlaps initial login', async () => {
  const h = sessionHarness();
  await h.emit({ user: { id: 'maria' } });
  const refresh = h.loadProfile({ id: 'maria' }, { refresh: true });
  h.requests[0].resolve(planningSnapshot()); await h.settle();
  assert.equal(h.state.setLoading, true, 'discarded initial response must not expose route guards');
  assert.equal(h.state.setProfile, undefined);
  h.requests[1].resolve(planningSnapshot()); await refresh;
  assert.equal(h.state.setLoading, false);
  assert.equal(h.state.setScreenCatalog.levels['progremes.Planning'], 'amministrazione');
  await h.flush(30000);
  assert.equal(h.state.setAuthError, '');
});

test('stale network failures cannot block a newer successful session', async () => {
  const h = sessionHarness();
  await h.emit({ user: { id: 'maria' } });
  const refresh = h.loadProfile({ id: 'maria' }, { refresh: true });
  h.requests[1].resolve(planningSnapshot()); await refresh;
  h.requests[0].reject(Error('late network failure')); await h.settle();
  assert.equal(h.state.setAuthError, '');
  assert.equal(h.state.setLoading, false);
  assert.equal(h.state.setProfile.id, 'maria');
});

test('failed newest refresh stays behind retry UI and a successful retry restores readiness', async () => {
  const h = sessionHarness();
  await h.emit({ user: { id: 'maria' } });
  const refresh = h.loadProfile({ id: 'maria' }, { refresh: true });
  h.requests[0].resolve(planningSnapshot()); await h.settle();
  h.requests[1].reject(Error('offline')); await assert.rejects(refresh, /offline/);
  assert.equal(h.state.setLoading, true);
  assert.ok(h.state.setAuthError);
  assert.deepEqual(h.state.setModuleAccess, []);
  const retry = h.loadProfile({ id: 'maria' }, { refresh: true });
  h.requests[2].resolve(planningSnapshot()); await retry;
  assert.equal(h.state.setLoading, false);
  assert.equal(h.state.setAuthError, '');
});

test('discarded initial load leaves the timeout active while the latest refresh is pending', async () => {
  const h = sessionHarness();
  await h.emit({ user: { id: 'maria' } });
  const refresh = h.loadProfile({ id: 'maria' }, { refresh: true });
  h.requests[0].resolve(planningSnapshot()); await h.settle();
  await h.flush(30000);
  assert.ok(h.state.setAuthError);
  assert.equal(h.state.setLoading, true);
  h.requests[1].resolve(planningSnapshot()); await refresh;
  assert.equal(h.state.setAuthError, '');
});

test('logout during initial access load never restores the previous profile', async () => {
  const h = sessionHarness();
  await h.emit({ user: { id: 'maria' } });
  await h.emit(null);
  h.requests[0].resolve(planningSnapshot()); await h.settle();
  assert.equal(h.state.setProfile, null);
  assert.equal(h.state.setSession, null);
  assert.deepEqual(h.state.setModuleAccess, []);
  assert.equal(h.state.setLoading, false);
});

test('unmount invalidates an in-flight access snapshot', async () => {
  const h = sessionHarness();
  await h.emit({ user: { id: 'maria' } });
  h.cleanup();
  h.requests[0].resolve(planningSnapshot()); await h.settle();
  assert.equal(h.state.setProfile, undefined);
  assert.equal(h.state.setLoading, true);
});

test('switching users blocks routes until the new identity has its own permissions', async () => {
  const h = sessionHarness();
  await h.emit({ user: { id: 'maria' } });
  h.requests[0].resolve(planningSnapshot()); await h.settle();
  await h.emit({ user: { id: 'other' } });
  assert.equal(h.state.setLoading, true);
  const denied = planningSnapshot();
  denied.data.profile.id = 'other';
  denied.data.access.modules = [];
  denied.data.screen_levels = { 'progremes.Planning': 'nessuno' };
  h.requests[1].resolve(denied); await h.settle();
  assert.equal(h.state.setLoading, false);
  assert.equal(h.state.setProfile.id, 'other');
  assert.equal(h.state.setScreenCatalog.levels['progremes.Planning'], 'nessuno');
});
