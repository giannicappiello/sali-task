// Device detection selects the UI flow only: the server always validates the company IP.
export function usesMobileLocation(device = globalThis.navigator) {
  return Boolean(device?.userAgentData?.mobile || /Android|iPhone|iPad|iPod/i.test(device?.userAgent || '') ||
    (/Macintosh/i.test(device?.userAgent || '') && device?.maxTouchPoints > 1));
}
