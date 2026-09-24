import test from 'node:test';
import assert from 'node:assert/strict';
import { searchConversationMemory } from './conversation-memory.js';

test('memory always filters by current user and escapes wildcard searches', async () => {
  const calls = [];
  const query = { then(resolve) { resolve({ data: Array.from({ length: 21 }, (_, i) => ({ id: i, contenuto: 'test' })) }); } };
  for (const key of ['select', 'eq', 'ilike', 'order', 'range']) query[key] = (...args) => { calls.push([key, ...args]); return query; };
  const result = await searchConversationMemory({ profile: { id: 'current' }, admin: { from: () => query } }, { query: '10%_test', ownerId: 'other' });
  assert.deepEqual(calls.find(row => row[0] === 'eq'), ['eq', 'ai_conversazioni.utente_id', 'current']);
  assert.deepEqual(calls.find(row => row[0] === 'ilike'), ['ilike', 'contenuto', '%10\\%\\_test%']);
  assert.equal(result.messages.length, 20);
  assert.equal(result.nextOffset, 20);
});

test('invalid memory request does not query the database', async () => {
  for (const input of [{ query: '' }, { query: 'valid', offset: -1 }, { query: 'valid', offset: '20' }]) {
    await assert.rejects(searchConversationMemory({}, input), { status: 400 });
  }
});
