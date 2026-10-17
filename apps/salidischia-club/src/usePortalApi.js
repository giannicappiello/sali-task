import { useContext } from 'react';
import { PortalApi } from './portalApiContext';
import { rpc, supabase } from './client';
export function usePortalRpc() { return useContext(PortalApi)?.rpc || rpc; }
export function usePortalAuth() { return useContext(PortalApi)?.auth || supabase.auth; }
