import { supplyOrder } from './supplyClient';
import { useContext } from 'react';
import { PortalApi } from './portalApiContext';
import { rpc, supabase } from './client';
export function usePortalRpc() { return useContext(PortalApi)?.rpc || rpc; }
export function usePortalAuth() { return useContext(PortalApi)?.auth || supabase.auth; }


const previewSupply = async () => { throw Error('Genera ordine richiede l’accesso di un negozio reale per usare le sue condizioni commerciali. La modalità di prova non invia ordini a PROGRE\'.'); };
export function useSupplyOrderApi() { const context = useContext(PortalApi);return context ? context.supplyOrder || previewSupply : supplyOrder; }
