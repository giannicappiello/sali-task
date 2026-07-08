import { supabase } from './supabaseClient'

export async function safeSelect(table, query = '*', options = {}) {
  try {
    let req = supabase.from(table).select(query)
    if (options.eq) options.eq.forEach(([k, v]) => { req = req.eq(k, v) })
    if (options.neq) options.neq.forEach(([k, v]) => { req = req.neq(k, v) })
    if (options.order) req = req.order(options.order.column, { ascending: options.order.ascending ?? true })
    if (options.limit) req = req.limit(options.limit)
    const { data, error } = await req
    if (error) return { data: [], error }
    return { data: data || [], error: null }
  } catch (error) {
    return { data: [], error }
  }
}

export async function safeInsert(table, payload) {
  try {
    const { data, error } = await supabase.from(table).insert(payload).select().single()
    return { data, error }
  } catch (error) {
    return { data: null, error }
  }
}

export async function safeUpdate(table, id, payload) {
  try {
    const { data, error } = await supabase.from(table).update(payload).eq('id', id).select().single()
    return { data, error }
  } catch (error) {
    return { data: null, error }
  }
}

export async function safeDelete(table, id) {
  try {
    const { error } = await supabase.from(table).delete().eq('id', id)
    return { error }
  } catch (error) {
    return { error }
  }
}

export function niceDate(value) {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return value
  }
}

export function getName(row, fallback = '—') {
  return row?.nome || row?.titolo || row?.name || row?.email || fallback
}
