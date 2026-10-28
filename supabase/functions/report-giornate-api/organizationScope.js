import { readAllRows } from './crmBeautyData.js';

async function forKeys(keys, makeQuery) {
  const rows = [];
  for (let offset = 0; offset < keys.length; offset += 100) {
    rows.push(...await readAllRows(() => makeQuery(keys.slice(offset, offset + 100))));
  }
  return rows;
}

export async function loadCustomerVisitScope(scopedPrimary, report, access, scope) {
  if (access.external_role !== 'agent') return scope;
  const pharmacies = await readAllRows(() => scopedPrimary.rpc('beauty_visible_legacy_pharmacy_ids').order('farmacia_id'));
  const visibleCustomerPharmacyIds = [...new Set(pharmacies.map(row => row.farmacia_id).filter(Boolean))];
  const days = await forKeys(visibleCustomerPharmacyIds, ids => report.from('giornate_promozionali')
    .select('id,consultant_id').in('farmacia_id', ids).order('id'));
  // CRM-only appointments have no legacy day. Read only planning information
  // through the caller's RLS so their consultant can also be named in the UI.
  const crmDetails = await readAllRows(() => scopedPrimary.from('crm_visit_details')
    .select('activity_id,planning:report_data->planning').order('activity_id'));
  return {
    ...scope,
    visibleCustomerPharmacyIds,
    visibleBeautyIds: [...new Set([
      ...scope.visibleBeautyIds,
      ...days.map(row => row.consultant_id),
      ...crmDetails.map(row => row.planning?.consultant_id),
    ].filter(Boolean))],
  };
}

export function applyOrganizationScope(query, table, scope, write = false) {
  const beautyIds = scope.visibleBeautyIds || [];
  const none = '00000000-0000-0000-0000-000000000000';
  if (table === 'giornate_promozionali' && !write && scope.visibleCustomerPharmacyIds) {
    const ids = scope.visibleCustomerPharmacyIds;
    return ids.length ? query.in('farmacia_id', ids) : query.eq('id', none);
  }
  // Customer-derived consultants must never expand write permissions.
  const allowedBeautyIds = write ? (scope.writableBeautyIds || beautyIds) : beautyIds;
  if (table === 'beauty_consultant') return allowedBeautyIds.length ? query.in('id', allowedBeautyIds) : query.eq('id', none);
  if (table === 'giornate_promozionali') return allowedBeautyIds.length ? query.in('consultant_id', allowedBeautyIds) : query.eq('consultant_id', none);
  if (table === 'aperture_contatti') {
    const ids = scope.writableBeautyIds || beautyIds;
    return ids.length ? query.in('beauty_id', ids) : query.eq('beauty_id', none);
  }
  return query;
}
