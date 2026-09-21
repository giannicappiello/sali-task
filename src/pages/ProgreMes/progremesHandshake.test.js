import test from 'node:test';
import assert from 'node:assert/strict';
import { observeProgremesFrame } from './progremesHandshake.js';

function fixture() {
  const sent = [], received = [];
  const frame = { postMessage: (...args) => sent.push(args) };
  const timers = new Map();
  let listener, expired = false;
  const browser = {
    addEventListener(_event, callback) { listener = callback; },
    removeEventListener() { listener = null; },
    setInterval(callback) { timers.set('interval', callback); return 'interval'; },
    setTimeout(callback) { timers.set('timeout', callback); return 'timeout'; },
    clearInterval(id) { timers.delete(id); }, clearTimeout(id) { timers.delete(id); },
  };
  const dispose = observeProgremesFrame({ browser, origin: 'https://mes.example', getFrameWindow: () => frame,
    onMessage: e => received.push(e.data.type), onTimeout: () => { expired = true; } });
  return { sent, received, timers, frame, dispose, expired: () => expired,
    message: (source = frame, origin = 'https://mes.example', type = 'progremes-embedded-ready') => listener({ source, origin, data: { type } }) };
}

test('late MES listener recovers through handshake only and stops after verified ready', () => {
  const f = fixture();
  f.timers.get('interval')();
  assert.equal(f.sent.length, 2);
  assert(f.sent.every(([data, origin]) => data.type === 'workspace-mes-connect' && origin === 'https://mes.example'));
  f.message({}, 'https://mes.example'); f.message(f.frame, 'https://other.example');
  assert.equal(f.received.length, 0); assert.equal(f.timers.size, 2);
  f.message();
  assert.deepEqual(f.received, ['progremes-embedded-ready']); assert.equal(f.timers.size, 0);
});

test('timeout and disposal stop retries; an auth error never signals ready', () => {
  const f = fixture(); f.timers.get('timeout')(); assert(f.expired()); assert.equal(f.timers.size, 0);
  const auth = fixture(); auth.message(auth.frame, 'https://mes.example', 'progremes-embedded-auth-error');
  assert.deepEqual(auth.received, ['progremes-embedded-auth-error']); assert.equal(auth.timers.size, 0);
  const closed = fixture(); closed.dispose(); assert.equal(closed.timers.size, 0);
});
