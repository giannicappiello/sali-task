import { useEffect, useId, useRef, useState } from 'react';
import { activityEmailRequest } from '../services/activityEmail.js';
import './activity-email-panel.css';

const statuses = {
  proposed: 'Proposta, non inviata', queued: 'Confermata, in coda', sending: 'Invio in corso',
  accepted: 'Accettata dal server, consegna non verificata', failed: 'Invio non riuscito',
  uncertain: 'Esito incerto, verificare prima di un nuovo invio', rejected: 'Proposta rifiutata', cancelled: 'Annullata',
};
const errors = { provider_rejected: 'Il servizio email ha rifiutato il messaggio.', transport_uncertain: 'Il servizio non ha confermato l’esito: verifica prima di qualsiasi nuovo invio.', lease_expired: 'Verifica dell’invio scaduta: l’esito resta incerto.' };
const emptyDraft = { recipient: '', subject: '', body: '' };

function EmailContent({ email }) {
  const to = Array.isArray(email.to_recipients) ? email.to_recipients : email.recipient ? [email.recipient] : [];
  const cc = Array.isArray(email.cc_recipients) ? email.cc_recipients : [];
  return <dl className="activity-email-content">
    <dt>A (To)</dt><dd><ul aria-label="Destinatari A (To)">{to.map((address, index) => <li key={index}>{address}</li>)}</ul></dd>
    <dt>CC</dt><dd>{cc.length ? <ul aria-label="Destinatari CC">{cc.map((address, index) => <li key={index}>{address}</li>)}</ul> : 'Nessuno'}</dd>
    <dt>Oggetto</dt><dd>{email.subject}</dd>
    <dt>Testo completo</dt><dd className="activity-email-body">{email.body}</dd>
    <dt>Stato</dt><dd>{statuses[email.status] || 'Stato non riconosciuto: aggiorna lo storico'}</dd>
  </dl>;
}

// The keyed child isolates draft, receipts and in-flight requests on task navigation.
export default function ActivityEmailPanel({ taskId, request = activityEmailRequest }) {
  return taskId ? <ActivityEmailTask key={taskId} taskId={taskId} request={request} /> : null;
}

function ActivityEmailTask({ taskId, request }) {
  const uid = useId();
  const [draft, setDraft] = useState(emptyDraft);
  const [permissions, setPermissions] = useState(null);
  const [emails, setEmails] = useState([]);
  const [nextOffset, setNextOffset] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [review, setReview] = useState(null);
  const [proposalUncertain, setProposalUncertain] = useState(false);
  const [uncertainIds, setUncertainIds] = useState([]);
  const lock = useRef(false);
  const generation = useRef(0);
  const abort = useRef(null);
  const proposal = useRef(null);
  const reviewHeading = useRef(null);
  const recipientInput = useRef(null);
  const reviewLauncher = useRef(null);

  useEffect(() => {
    const version = ++generation.current;
    const controller = new AbortController();
    abort.current = controller;
    lock.current = true;
    request({ action: 'context', taskId }, { signal: controller.signal }).then(data => {
      if (version !== generation.current) return;
      setPermissions(data.permissions || {});
      setEmails(data.emails || []);
      setNextOffset(data.nextOffset ?? null);
    }).catch(err => {
      if (version === generation.current) setError(err.message || 'Impossibile caricare le email.');
    }).finally(() => {
      if (version === generation.current) { lock.current = false; setBusy(false); }
    });
    return () => { generation.current = version + 1; controller.abort(); };
  }, [request, taskId]);

  useEffect(() => { if (review) reviewHeading.current?.focus(); }, [review]);

  function mergeEmail(email) {
    if (email?.id) setEmails(current => [email, ...current.filter(item => item.id !== email.id)]);
  }

  async function run(operation) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const version = generation.current;
    const active = () => version === generation.current;
    const call = input => request(input, { signal: abort.current?.signal });
    try { await operation(call, active); }
    catch (err) { if (active()) setError(err.message || 'Operazione non completata.'); }
    finally { if (active()) { lock.current = false; setBusy(false); } }
  }

  function refresh() {
    return run(async (call, active) => {
      const data = await call({ action: 'context', taskId });
      if (!active()) return;
      setPermissions(data.permissions || {});
      setEmails(data.emails || []);
      setNextOffset(data.nextOffset ?? null);
      setReview(null);
      setNotice('Storico aggiornato. Nessuna email è stata reinviata.');
    });
  }

  async function reloadAfterUncertain(call, active) {
    try {
      const data = await call({ action: 'history', taskId, offset: 0 });
      if (active()) { setEmails(data.emails || []); setNextOffset(data.nextOffset ?? null); }
    } catch { /* Preserve the original outcome and draft; only the user can refresh. */ }
  }

  function prepare() {
    if (!permissions?.canPropose || proposalUncertain) return;
    const input = { recipient: draft.recipient.trim(), subject: draft.subject.trim(), body: draft.body.trim() };
    if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(input.recipient) || /[\r\n]/.test(input.recipient)) {
      setError('Inserisci un solo indirizzo email valido.'); recipientInput.current?.focus(); return;
    }
    if (!input.subject || input.subject.length > 200 || /[\r\n]/.test(input.subject) || !input.body || input.body.length > 12000) {
      setError('Inserisci un oggetto (massimo 200 caratteri) e un testo (massimo 12000 caratteri).'); return;
    }
    return run(async (call, active) => {
      const fingerprint = JSON.stringify(input);
      if (proposal.current?.fingerprint !== fingerprint) proposal.current = { fingerprint, key: crypto.randomUUID() };
      let result;
      try {
        result = await call({ action: 'propose', taskId, ...input, idempotencyKey: proposal.current.key });
      } catch (err) {
        if (!active()) return;
        setProposalUncertain(true);
        setNotice('La proposta potrebbe essere stata salvata. Controlla lo storico: nessun invio o nuovo tentativo automatico.');
        await reloadAfterUncertain(call, active);
        throw err;
      }
      if (!active()) return;
      mergeEmail(result.email);
      setNotice('Proposta preparata, non inviata. Apri il riepilogo per verificarla e confermare.');
      // Keep the same key for repeated submissions of the same draft.
    });
  }

  function openReview(email, launcher) {
    reviewLauncher.current = launcher;
    if (!permissions?.canConfirm || email.via_ai || uncertainIds.includes(email.id)) return;
    return run(async (call, active) => {
      const result = await call({ action: 'confirmation', id: email.id });
      if (!active()) return;
      mergeEmail(result.email);
      if (!result.receipt || result.email?.status !== 'proposed' || result.email.id !== email.id) {
        setReview(null); setNotice('La proposta non è più confermabile. Controlla lo stato aggiornato.'); return;
      }
      setReview({ receipt: result.receipt, email: result.email });
    });
  }

  function decide(decision) {
    if (!review || !permissions?.canConfirm) return;
    const selected = review;
    return run(async (call, active) => {
      try {
        const result = await call({ action: 'decide', receipt: selected.receipt, decision });
        if (!active()) return;
        mergeEmail(result.email);
        setReview(null);
        setNotice(decision === 'confirm' ? 'Conferma registrata. Lo stato nello storico indica l’esito disponibile, non la consegna.' : 'Proposta rifiutata. Nessuna email inviata.');
      } catch (err) {
        if (!active()) return;
        setReview(null);
        setUncertainIds(current => [...current, selected.email.id]);
        setNotice('Esito della richiesta non verificato. Non ripetere l’invio: aggiorna lo storico e verifica con un amministratore se resta incerto.');
        await reloadAfterUncertain(call, active);
        throw err;
      }
    });
  }

  function loadMore() {
    return run(async (call, active) => {
      const data = await call({ action: 'history', taskId, offset: nextOffset });
      if (!active()) return;
      setEmails(current => [...current, ...(data.emails || []).filter(item => !current.some(existing => existing.id === item.id))]);
      setNextOffset(data.nextOffset ?? null);
    });
  }

  return <section className="activity-email-panel" aria-labelledby={`${uid}-title`} aria-busy={busy}
    onKeyDown={event => { if (event.key === 'Enter' && event.target.tagName === 'INPUT') event.preventDefault(); }}>
    <h3 id={`${uid}-title`}>Email dell’attività</h3>
    <p>Prepara un messaggio collegato a questa task. La preparazione non invia email: serve una conferma esplicita. Nessun allegato.</p>
    {error && <p className="activity-email-error" role="alert">{error}</p>}
    <p role="status" aria-live="polite">{busy ? 'Operazione in corso…' : notice}</p>
    {permissions?.canPropose && <fieldset disabled={busy || proposalUncertain} className="activity-email-compose">
      <legend>Nuova proposta</legend>
      <label htmlFor={`${uid}-recipient`}>Destinatario (uno solo)</label>
      <input ref={recipientInput} id={`${uid}-recipient`} type="text" inputMode="email" autoComplete="off" value={draft.recipient} onChange={e => setDraft({ ...draft, recipient: e.target.value })} />
      <label htmlFor={`${uid}-subject`}>Oggetto</label>
      <input id={`${uid}-subject`} maxLength={200} value={draft.subject} onChange={e => setDraft({ ...draft, subject: e.target.value })} />
      <label htmlFor={`${uid}-body`}>Testo</label>
      <textarea id={`${uid}-body`} maxLength={12000} rows={6} value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} />
      <small>{draft.body.length}/12000 caratteri</small>
      <button type="button" className="secondary-action" onClick={prepare}>Prepara proposta (non invia)</button>
    </fieldset>}
    {permissions && !permissions.canPropose && <p>Non hai il permesso di preparare email per questa attività.</p>}
    {review && <section className="activity-email-review" aria-labelledby={`${uid}-review`}>
      <h4 id={`${uid}-review`} ref={reviewHeading} tabIndex={-1}>Verifica prima dell’invio</h4>
      <EmailContent email={review.email} />
      <p>Confermando, autorizzi l’invio di questo testo a tutti i destinatari elencati in A (To) e CC.</p>
      <div className="activity-email-actions">
        <button type="button" className="primary-action" disabled={busy} onClick={() => decide('confirm')}>Conferma e invia</button>
        <button type="button" className="secondary-action" disabled={busy} onClick={() => decide('reject')}>Rifiuta proposta</button>
        <button type="button" className="secondary-action" disabled={busy} onClick={() => { setReview(null); reviewLauncher.current?.focus(); }}>Chiudi riepilogo</button>
      </div>
    </section>}
    <div className="activity-email-actions"><h4>Storico email</h4><button type="button" className="secondary-action" disabled={busy} onClick={refresh}>Aggiorna storico</button></div>
    {!busy && !emails.length && <p>Nessuna email nello storico disponibile.</p>}
    <ul className="activity-email-history">{emails.map(email => <li key={email.id}>
      <details><summary>{email.subject || '(Senza oggetto)'} · {statuses[email.status] || 'Stato sconosciuto'}</summary>
        <EmailContent email={email} />
        {email.created_at && <p>Preparata il {new Date(email.created_at).toLocaleString('it-IT')}</p>}
        {email.error_code && <p className="activity-email-error">{errors[email.error_code] || "Si è verificato un problema durante l’invio. Chiedi una verifica prima di riprovare."}</p>}
        {email.accepted_at && <p>Accettata dal server il {new Date(email.accepted_at).toLocaleString("it-IT")}. Consegna non verificata.</p>}
      </details>
      {email.status === 'proposed' && email.via_ai && <a href={"/assistente-ai?view=review&kind=email&proposalId=" + encodeURIComponent(email.id)}>Verifica proposta in Progre AI</a>}
      {email.status === 'proposed' && !email.via_ai && permissions?.canConfirm && <button type="button" className="secondary-action" disabled={busy || uncertainIds.includes(email.id)} onClick={event => openReview(email, event.currentTarget)}>Verifica proposta</button>}
    </li>)}</ul>
    {nextOffset != null && <button type="button" className="secondary-action" disabled={busy} onClick={loadMore}>Carica altre email</button>}
  </section>;
}
