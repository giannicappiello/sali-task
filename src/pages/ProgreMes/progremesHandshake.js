import { isProgremesFrameMessage } from './progremesWindow.js';

export function observeProgremesFrame({ browser = window, origin, getFrameWindow, onMessage, onTimeout }) {
  let interval, timeout;
  const stopTimers = () => { browser.clearInterval(interval); browser.clearTimeout(timeout); };
  const connect = () => getFrameWindow()?.postMessage({ type: 'workspace-mes-connect', unifiedChrome: true }, origin);
  const receive = event => {
    if (!isProgremesFrameMessage(event, getFrameWindow(), origin)) return;
    if (['progremes-embedded-ready', 'progremes-embedded-auth-error', 'progremes-workspace-return'].includes(event.data.type)) stopTimers();
    onMessage(event);
  };
  browser.addEventListener('message', receive);
  interval = browser.setInterval(connect, 1000);
  timeout = browser.setTimeout(() => { stopTimers(); onTimeout(); }, 30000);
  connect();
  return () => { stopTimers(); browser.removeEventListener('message', receive); };
}
