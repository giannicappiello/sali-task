import { useEffect, useRef, useState } from 'react';
import { supabase } from './client';

export default function useMediaUrls(media = []) {
  const key = [...new Set(media.map(item => item.id).filter(id => /^[a-f0-9-]{36}$/i.test(id)))].sort().join(',');
  const [state, setState] = useState({ urls: {}, loading: false, error: '' });
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const sequence = generation;
    const request = ++sequence.current;
    if (!key) return;
    const controller = new AbortController();
    async function load() {
      setState({ urls: {}, loading: true, error: '' });
      try {
        const { data } = await supabase.auth.getSession();
        const headers = { 'Content-Type': 'application/json' };
        if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;
        const ids = key.split(','), chunks = [];
        for (let i = 0; i < ids.length; i += 40) chunks.push(ids.slice(i, i + 40));
        const urls = {};
        for (const document_ids of chunks) {
          const response = await fetch('/api/club-media', { method: 'POST', headers, body: JSON.stringify({ document_ids }), signal: controller.signal });
          const body = await response.json();
          if (!response.ok) throw Error(body.error || 'Materiali Workspace non disponibili.');
          for (const [id, url] of Object.entries(body.urls || {})) if (url.startsWith('https://')) urls[id] = url;
        }
        if (generation.current === request) setState({ urls, loading: false, error: '' });
      } catch (error) { if (!controller.signal.aborted && generation.current === request) setState({ urls: {}, loading: false, error: error.message }); }
    }
    void load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 12 * 60 * 1000);
    return () => { sequence.current++; controller.abort(); clearInterval(timer); };
  }, [key, revision]);
  return { ...(key ? state : { urls: {}, loading: false, error: '' }), reload: () => setRevision(n => n + 1) };
}
