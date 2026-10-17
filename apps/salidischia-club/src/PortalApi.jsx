import { PortalApi } from './portalApiContext';
export function PortalApiProvider({ api, children }) {
 return <PortalApi.Provider value={api}>{children}</PortalApi.Provider>;
}
