// Read-only report endpoints: never subscribe a contact or send a campaign.
export async function fetchMailingReports(state, get) {
  if (state.phase === 'reports') {
    const page = state.reportPage || 1;
    const data = await get(`reports?count=20&offset=${(page - 1) * 20}`);
    if (!Array.isArray(data.reports) || !Number.isFinite(Number(data.total_items))) throw new Error('Report Mailchimp non validi.');
    const reports = data.reports.map(row => ({ id: row.id, list_id: row.list_id, title: row.campaign_title || row.subject_line, sent_at: row.send_time }));
    return { rows: [], next: { reportQueue: reports, reportPage: page, reportTotal: Number(data.total_items), report: reports.shift() || null, recipientPage: 1,
      phase: reports.length || data.reports.length ? 'recipients' : 'reports', completed: !data.reports.length, mailing_complete: !data.reports.length } };
  }
  const report = state.report;
  if (!report?.id) throw new Error('Campagna Mailchimp non valida.');
  const page = state.recipientPage || 1;
  const data = await get(`reports/${encodeURIComponent(report.id)}/sent-to?count=100&offset=${(page - 1) * 100}`);
  if (!Array.isArray(data.sent_to) || !Number.isFinite(Number(data.total_items))) throw new Error('Destinatari Mailchimp non validi.');
  const rows = data.sent_to.map(row => {
    if (!row.email_id || !(row.list_id || report.list_id) || !row.status) throw new Error('Destinatario Mailchimp incompleto.');
    return { member_hash: row.email_id, list_id: row.list_id || report.list_id, campaign_id: report.id, title: report.title, sent_at: report.sent_at, status: row.status };
  });
  const next = { recipientPage: page + 1 };
  if ((page - 1) * 100 + rows.length >= Number(data.total_items)) {
    const queue = [...(state.reportQueue || [])]; next.report = queue.shift() || null; next.reportQueue = queue; next.recipientPage = 1;
    if (!next.report) { next.reportPage = (state.reportPage || 1) + 1; next.phase = 'reports'; next.completed = (state.reportPage || 1) * 20 >= state.reportTotal; next.mailing_complete = next.completed; }
  }
  return { rows, next };
}
