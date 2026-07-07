import { useEffect, useMemo, useState } from 'react'
import { Bell, CheckCircle2, Clock, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'

const demo = [
  { id: 'n1', titolo: 'Task in scadenza oggi', descrizione: 'Controllare lo stato delle fasi assegnate al reparto.', tipo: 'scadenza', letto: false, created_at: new Date().toISOString() },
  { id: 'n2', titolo: 'Nuovo documento caricato', descrizione: 'Artwork da verificare nella sezione Documentazione.', tipo: 'documento', letto: false, created_at: new Date().toISOString() }
]

const iconByType = {
  scadenza: Clock,
  errore: AlertTriangle,
  completato: CheckCircle2,
  documento: Bell
}

export default function Notifications() {
  const [items, setItems] = useState([])
  const [filter, setFilter] = useState('tutte')
  const [error, setError] = useState('')

  const visible = useMemo(() => {
    if (filter === 'non_lette') return items.filter((n) => !n.letto)
    return items
  }, [items, filter])

  async function load() {
    const { data, error } = await supabase.from('notifiche').select('*').order('created_at', { ascending: false }).limit(100)
    if (error) {
      setError('Tabella notifiche non disponibile o policy RLS da verificare: mostro dati demo.')
      setItems(demo)
    } else {
      setItems(data?.length ? data : demo)
    }
  }

  useEffect(() => {
    load()
    const channel = supabase
      .channel('notifiche-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifiche' }, load)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  async function markRead(id) {
    setItems((prev) => prev.map((n) => n.id === id ? { ...n, letto: true } : n))
    await supabase.from('notifiche').update({ letto: true }).eq('id', id)
  }

  return (
    <div className="workspace-page">
      <div className="page-title-row">
        <div>
          <h1>Notifiche</h1>
          <p>Avvisi personali, scadenze, aggiornamenti progetto e documenti.</p>
        </div>
        <div className="segmented-actions">
          <button className={filter === 'tutte' ? 'active' : ''} onClick={() => setFilter('tutte')}>Tutte</button>
          <button className={filter === 'non_lette' ? 'active' : ''} onClick={() => setFilter('non_lette')}>Non lette</button>
        </div>
      </div>

      {error && <div className="soft-alert">{error}</div>}

      <section className="panel notification-list">
        {visible.map((item) => {
          const Icon = iconByType[item.tipo] || Bell
          return (
            <article className={`notification-card ${item.letto ? 'read' : ''}`} key={item.id}>
              <div className="notification-icon"><Icon size={20} /></div>
              <div>
                <strong>{item.titolo}</strong>
                <p>{item.descrizione || item.messaggio}</p>
                <span>{item.created_at ? new Date(item.created_at).toLocaleString('it-IT') : ''}</span>
              </div>
              {!item.letto && <button onClick={() => markRead(item.id)}>Segna letta</button>}
            </article>
          )
        })}
      </section>
    </div>
  )
}
