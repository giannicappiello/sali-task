import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyPinnedCertificate,pinnedFetch } from '../src/pinned-fetch.mjs';
const fingerprint='55:93:DE:B3:F1:43:24:B7:9C:7A:B9:0E:95:C2:B5:A5:1E:7D:3D:00:F0:FC:38:C5:8A:6D:D1:EA:12:DC:62:1C';
const cert={fingerprint256:fingerprint,valid_from:'Jun 9 09:11:58 2026 GMT',valid_to:'Jun 6 09:11:58 2036 GMT'};
test('pin accetta soltanto il certificato esatto e valido',()=>{
 assert.doesNotThrow(()=>verifyPinnedCertificate(cert,fingerprint,Date.parse('2026-10-21')));
 assert.throws(()=>verifyPinnedCertificate({...cert,fingerprint256:'00'.repeat(32)},fingerprint),/diverso/);
 assert.throws(()=>verifyPinnedCertificate(cert,fingerprint,Date.parse('2037-01-01')),/data corrente/);
 assert.throws(()=>verifyPinnedCertificate(cert,'invalid'),/diverso/);
});
test('pin non utilizzabile per altri host o porte',async()=>{
 const request=pinnedFetch('https://mexal.example.invalid:9000',fingerprint);
 await assert.rejects(request('https://altro.example.invalid'),/solo endpoint/);
 await assert.rejects(request('https://mexal.example.invalid:9001'),/solo endpoint/);
});
