export default function PageStub({ title, description, actions = true }) {
  return (
    <div>
      <div className="page-title-row"><div><h1>{title}</h1><p>{description}</p></div>{actions && <button className="primary-action">+ Nuovo</button>}</div>
      <section className="panel"><div className="panel-header"><h3>{title}</h3><button>Esporta</button></div><p className="muted-text">Modulo pronto per collegamento a Supabase, permessi, allegati e notifiche.</p></section>
    </div>
  )
}
