import { supabase } from "../../lib/supabaseClient";

const FETCH_PAGE_SIZE = 200;

export async function loadAllRpcRows(name, parameters) {
  const rows = [];
  for (let offset = 0; ; offset += FETCH_PAGE_SIZE) {
    const { data, error } = await supabase.rpc(name, {
      ...parameters,
      p_limit: FETCH_PAGE_SIZE,
      p_offset: offset,
    });
    if (error) return { data: null, error };
    const page = data || [];
    rows.push(...page);
    if (page.length < FETCH_PAGE_SIZE) return { data: rows, error: null };
  }
}

export async function loadAllQueryRows(buildQuery, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery(from, from + pageSize - 1);
    if (error) return { data: null, error };
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) return { data: rows, error: null };
  }
}
