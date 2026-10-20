import test from 'node:test';
import assert from 'node:assert/strict';
import { wooCustomer, wooOrder, mailchimpCustomer } from './commerce-import.js';
import { customerOrigin, customerDisplayName } from '../../src/modules/crm/customerIdentity.js';
import { fetchCustomerProfiles } from './customer-profiles.js';

test('Contact names use surname and first name, never reconstruct names from email', () => {
  const c = wooCustomer({ id: 1, email: 'mario.rossi@example.test', first_name: 'Mario', last_name: 'Rossi', billing: { phone: '123', address_1: 'Via Mare 1', city: 'Ischia', postcode: '80077' }, shipping: { address_1: 'Via Roma 2' }, meta_data: [{ key: 'billing_cf', value: 'CF-test' }, { key: 'secret', value: 'not-imported' }] });
  assert.equal(c.nome, 'Rossi Mario'); assert.equal(c.indirizzo, 'Via Mare 1'); assert.equal(c.codice_fiscale, 'CF-test');
  assert.equal(c.anagrafica.spedizione.address_1, 'Via Roma 2'); assert.ok(!JSON.stringify(c).includes('not-imported'));
  assert.equal(wooCustomer({ id: 2, email: 'unknown@example.test' }).nome, 'Nominativo non disponibile');
  assert.equal(customerDisplayName({ nome: 'old@example.test' }), 'Nominativo non disponibile');
  assert.equal(customerDisplayName({ nome: 'Azienda SRL', codice_cliente_mexal: '501', metadati: { anagrafica: { cognome: 'Other' } } }), 'Azienda SRL');
});

test('Registered and guest order billing profiles enrich the correct stable source identity', () => {
  const row = { id: 1, customer_id: 12, billing: { first_name: 'Mario', last_name: 'Rossi', email: 'm@example.test' } };
  assert.equal(wooOrder(row).customer.external_id, '12'); assert.equal(wooOrder(row).customer.nome, 'Rossi Mario');
  const guest = wooOrder({ ...row, customer_id: 0 });
  assert.ok(guest.customer.external_id.startsWith('guest:')); assert.equal(guest.customer_external_id, guest.customer.external_id);
});

test('Mailchimp imports standard and Italian contact fields and safe address fields only', () => {
  const c = mailchimpCustomer({ id: 'a', email_address: 'a@example.test', merge_fields: { NOME: 'Anna', COGNOME: 'Verdi', TELEFONO: '123', ADDRESS: { addr1: 'Via A', zip: '12345', country: 'IT' }, SECRET: 'private' } });
  assert.equal(c.nome, 'Verdi Anna'); assert.equal(c.cap, '12345'); assert.equal(c.telefono, '123'); assert.ok(!JSON.stringify(c).includes('private'));
  for (const [fonte, expected] of [['woocommerce','salidischia.it'],['mailchimp','Mailchimp'],['amazon_sp_api','Amazon'],['crm_only','Inserimento manuale']]) assert.equal(customerOrigin({ fonte }), expected);
  assert.equal(customerOrigin({ codice_cliente_mexal: '1', fonte: 'woocommerce' }), 'Mexal');
});

test('Profile refresh has its own bounded cursor and never changes the running order cursor', async () => {
  const connection = { provider_code: 'woocommerce', configurazione: { site_url: 'https://store.example' }, import_state: { token: 'historic', page: 12 } };
  const before = JSON.stringify(connection);
  const result = await fetchCustomerProfiles(connection, { consumer_key: 'secret' }, {}, async (url, options) => {
    assert.ok(url.endsWith('customers?per_page=50&page=1&orderby=id&order=asc')); assert.equal(options.method, undefined);
    return { ok: true, status: 200, data: [{ id: 1, first_name: 'A', last_name: 'B' }] };
  });
  assert.deepEqual(result.next, { phase: 'orders', page: 1 }); assert.equal(JSON.stringify(connection), before);
  assert.ok(!JSON.stringify(result).includes('secret'));
  await assert.rejects(fetchCustomerProfiles(connection, {}, { phase: '../secrets' }), /Fase/);
  await assert.rejects(fetchCustomerProfiles({ provider_code: 'amazon_sp_api' }, {}), /ruoli/);
});

test('Mailchimp resolves renamed merge tags by audience schema without guessing ambiguous fields', () => {
  const c = mailchimpCustomer({ id: '1', merge_fields: { MMERGE1: 'Anna', MMERGE2: 'Verdi', MMERGE3: { addr1: 'Via A' } } }, [{ tag: 'MMERGE1', name: 'Nome', type: 'text' }, { tag: 'MMERGE2', name: 'Cognome', type: 'text' }, { tag: 'MMERGE3', name: 'Sede', type: 'address' }]);
  assert.equal(c.nome, 'Verdi Anna'); assert.equal(c.indirizzo, 'Via A');
});
