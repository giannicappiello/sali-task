import { useCallback, useEffect, useMemo, useState } from 'react'
import { safeDelete, safeInsert, safeSelect, safeUpdate } from '../lib/safeSupabase'

export function useSupabaseTable(table, fallback = [], options = {}) {
  const [rows, setRows] = useState(fallback)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const result = await safeSelect(table, options.query || '*', {
      order: options.order,
      limit: options.limit,
      eq: options.eq,
      neq: options.neq,
    })
    setError(result.error)
    setRows(result.data.length ? result.data : fallback)
    setLoading(false)
  }, [table])

  useEffect(() => { load() }, [load])

  const api = useMemo(() => ({
    rows,
    loading,
    error,
    reload: load,
    async create(payload) {
      const result = await safeInsert(table, payload)
      if (!result.error) await load()
      return result
    },
    async update(id, payload) {
      const result = await safeUpdate(table, id, payload)
      if (!result.error) await load()
      return result
    },
    async remove(id) {
      const result = await safeDelete(table, id)
      if (!result.error) await load()
      return result
    }
  }), [rows, loading, error, load, table])

  return api
}
