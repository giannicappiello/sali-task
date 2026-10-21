// Amazon SP-API marketplace identifiers: https://developer-docs.amazon/sp-api/docs/marketplace-ids
const AMAZON_COUNTRIES = Object.freeze({
  A2EUQ1WTGCTBG2: 'CA', ATVPDKIKX0DER: 'US', A1AM78C64UM0Y8: 'MX', A2Q3Y263D00KWC: 'BR',
  A28R8C7NBKEWEA: 'IE', A1RKKUPIHCS9HS: 'ES', A1F83G8C2ARO7P: 'UK', A13V1IB3VIYZZH: 'FR',
  AMEN7PMS3EDWL: 'BE', A1805IZSGTT6HS: 'NL', A1PA6795UKMFR9: 'DE', APJ6JRA9NG5V4: 'IT',
  A2NODRKZP88ZB9: 'SE', AE08WJ6YKNBMC: 'ZA', A1C3SOZRARQ6R3: 'PL', ARBP9OOSHTCHU: 'EG',
  A33AVAJ2PDY3EV: 'TR', A17E79C6D8DWNP: 'SA', A2VIGQ35RCS4UG: 'AE', A21TJRUUN4KGV: 'IN',
  A19VAU5U5O7RUS: 'SG', A39IBJ37TRP1C6: 'AU', A1VC38T7YXB528: 'JP',
});

export function marketplaceLabel(value, fallback = '—') {
  const raw = String(value || '').trim();
  const id = raw.toUpperCase();
  return Object.hasOwn(AMAZON_COUNTRIES, id) ? `Amazon_${AMAZON_COUNTRIES[id]}` : raw || fallback;
}
