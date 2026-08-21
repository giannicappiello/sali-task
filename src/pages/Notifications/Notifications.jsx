import { useEffect, useMemo, useState } from 'react'
import { Bell, CheckCircle2, Clock, AlertTriangle, Settings } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'

const iconByType = {
  scadenza: Clock,
  errore: AlertTriangle,
  completato: CheckCircle2,
  documento: Bell
}

export default function Notifications() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [items, setItems] = useState([])
  const [filter, setFilter] = useState('tutte')
  const [error, setError] = useState('')

  const visible = useMemo(() => {
    if (filter === 'non_lette') return items.filter((n) => !n.letta)
    return items
  }, [items, filter])

  async function load() {
    const { data, error } = await supabase.from('notifiche').select('*').eq('utente_id', profile.id).order('created_at', { ascending: false }).limit(100)
    if (error) {
      setError(error.message)
      setItems([])
    } else {
      setItems(data || [])
    }
  }

  useEffect(() => {
    load()
    const channel = supabase
      .channel('notifiche-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifiche' }, load)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [profile?.id])

  async function markRead(id) {
    setItems((prev) => prev.map((n) => n.id === id ? { ...n, letta: true } : n))
    await supabase.from('notifiche').update({ letta: true, letta_il: new Date().toISOString() }).eq('id', id)
    window.dispatchEvent(new CustomEvent('workspace:notifications-changed'))
  }

  async function openNotification(item) {
    if (!item.letta) await markRead(item.id)
    if (item.tipo === 'chat' && item.chat_conversazione_id) navigate(`/messages?conversation=${item.chat_conversazione_id}`)
    else if (item.url) navigate(item.url)
    else if (item.progetto_id) navigate('/projects')
    else if (item.prodotto_id) navigate('/products')
    else navigate(item.task_id ? `/tasks?task=${item.task_id}` : '/notifications')
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
          <button onClick={() => navigate('/settings/notifications')}><Settings size={16}/> Impostazioni</button>
        </div>
      </div>

      {error && <div className="soft-alert">{error}</div>}

      <section className="panel notification-list">
        {visible.map((item) => {
          const Icon = iconByType[item.tipo] || Bell
          return (
            <article className={`notification-card ${item.letta ? 'read' : ''}`} key={item.id} onClick={() => openNotification(item)}>
              <div className="notification-icon"><Icon size={20} /></div>
              <div>
                <strong>{item.titolo}</strong>
                <p>{item.descrizione || item.messaggio}</p>
                <span>{item.created_at ? new Date(item.created_at).toLocaleString('it-IT') : ''}</span>
              </div>
              {!item.letta && <button onClick={(event) => { event.stopPropagation(); openNotification(item); }}>Apri</button>}
            </article>
          )
        })}
        {visible.length === 0 && <div className="topbar-popover-empty">Nessuna notifica da mostrare.</div>}
      </section>
    </div>
  )
}
