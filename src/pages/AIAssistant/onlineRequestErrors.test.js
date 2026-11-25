import assert from 'node:assert/strict';
import test from 'node:test';
import { onlineRequestError } from './onlineRequestErrors.js';

test('a missing or inaccessible proposal explains the personal account boundary', () => {
 assert.match(onlineRequestError(404).message, /stesso account personale collegato a Codex/);
 assert.match(onlineRequestError(403).message, /non è autorizzato/);
 assert.match(onlineRequestError(401).message, /sessione Workspace è scaduta/);
});
test('provider payloads are never shown and email readiness retains its recovery code', () => {
 assert.ok(!onlineRequestError(500, {error:'SECRET provider trace'}).message.includes('SECRET'));
 assert.match(onlineRequestError(500).message, /HTTP 500/);
 assert.equal(onlineRequestError(409,{code:'EMAIL_TRANSPORT_NOT_READY'}).code,'EMAIL_TRANSPORT_NOT_READY');
 assert.match(onlineRequestError(409).message,/verifica lo stato/);
});
