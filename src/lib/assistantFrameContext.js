// Only the expected, authenticated frame may answer this single-use request.
export function requestAssistantFrameContext({ target, origin, browser = window, timeoutMs = 2500 }) {
  const requestId = browser.crypto.randomUUID();
  return new Promise(resolve => {
    let timer;
    const finish = value => { browser.clearTimeout(timer); browser.removeEventListener('message', receive); resolve(value); };
    const receive = event => {
      if (event.source !== target || event.origin !== origin || event.data?.type !== 'workspace-ai-context-response' || event.data.requestId !== requestId) return;
      const context = event.data.context;
      if (!context || context.system !== 'mes' || typeof context.visibleSummary !== 'string') return;
      finish(context);
    };
    browser.addEventListener('message', receive);
    timer = browser.setTimeout(() => finish(null), timeoutMs);
    try { target.postMessage({ type: 'workspace-ai-context-request', requestId }, origin); }
    catch { finish(null); }
  });
}

export async function captureWithMesFrame(context, doc = document, browser = window) {
  // A Workspace dialog above MES takes precedence over the underlying frame.
  if (context.surface === 'popup') return context;
  const frame = [...doc.querySelectorAll('iframe[data-assistant-mes-frame]')].find(el => el.getClientRects().length > 0);
  if (!frame?.contentWindow) return context;
  const result = await requestAssistantFrameContext({ target: frame.contentWindow, origin: new URL(frame.src).origin, browser });
  return result || { ...context, contextUnavailable: 'Il MES non ha risposto alla lettura del contesto. Verificare aggiornamento MES e collegamento; non dedurre che nessun popup sia aperto.' };
}

export async function captureFromMesParent(fallback, browser = window) {
  if (!fallback || browser.parent === browser) return fallback;
  // Supplied by the MES host; the expected Window and origin are both checked.
  const origin = new URLSearchParams(browser.location.search).get('mesOrigin');
  if (!origin || !/^https?:\/\//.test(origin)) return { ...fallback, contextUnavailable: 'Aggiornare MES per leggere il popup e la selezione.' };
  return await requestAssistantFrameContext({ target: browser.parent, origin: new URL(origin).origin, browser })
    || { ...fallback, contextUnavailable: 'Il MES non ha risposto alla lettura del popup.' };
}
