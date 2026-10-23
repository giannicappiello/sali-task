import { supabase } from '../../lib/supabaseClient';

export async function discardChanges(dirty) {
  if (!dirty) return true;
  const message = 'Sono presenti modifiche non salvate. Vuoi abbandonarle?';
  return window.workspaceConfirm ? Boolean(await window.workspaceConfirm(message, { title: 'Modifiche non salvate' })) : window.confirm(message);
}

async function result(query) { const { data, error } = await query; if (error) throw new Error(error.message); return data; }
export const getSheet = id => result(supabase.from('direct_product_sheets').select('*').eq('product_id', id).maybeSingle());
export const getTranslations = id => result(supabase.from('direct_product_sheet_translations').select('*').eq('product_id', id));
export const saveTranslation = (id, language, content, sourceRevision, revision, reviewed) => result(supabase.rpc('direct_save_sheet_translation', {
  target_id: id, target_language: language, payload: content, source_revision: sourceRevision, expected_revision: revision || 0, is_reviewed: reviewed,
}));
export const saveSheet = (id, content, revision) => result(supabase.rpc('direct_save_product_sheet', { target_id: id, payload: content, expected_revision: revision || 0 }));
export const publishClub = (id, revision) => result(supabase.rpc('direct_publish_product_sheet_club', { target_id: id, expected_revision: revision }));
export const listTemplates = () => result(supabase.from('direct_product_sheet_templates').select('id,name,is_default,revision,updated_at').order('is_default', { ascending: false }).order('name'));
export const getTemplate = id => result(supabase.from('direct_product_sheet_templates').select('*').eq('id', id).single().abortSignal(AbortSignal.timeout(30000)));
export const saveTemplate = (template, makeDefault) => result(supabase.rpc('direct_save_sheet_template', {
  target_id: template.id || null, template_name: template.name, template_layout: template.layout,
  make_default: makeDefault, expected_revision: template.revision || 0,
}));
export async function listSheetSummaries() {
  const rows = [];
  for (let from = 0; ; from += 500) {
    const page = await result(supabase.from('direct_product_sheet_summaries').select('*').order('product_id').range(from, from + 499));
    rows.push(...page); if (page.length < 500) return rows;
  }
}
export async function sheetChannelApi(action, input) {
  const { data: { session } } = await supabase.auth.getSession();
  const response = await fetch('/api/mexal/automation?route=direct-product-sheets', {
    signal: AbortSignal.timeout(action === 'translate' ? 110000 : 40000),
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
    body: JSON.stringify({ action, ...input }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Invio ai canali non disponibile.');
  return body;
}
