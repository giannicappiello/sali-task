import { retailerRegistration } from './retailerClient';
import { supplyOrder } from './supplyClient';
import { useContext } from 'react';
import { PortalApi } from './portalApiContext';
import { rpc, supabase } from './client';
export function usePortalRpc() { return useContext(PortalApi)?.rpc || rpc; }
export function usePortalAuth() { return useContext(PortalApi)?.auth || supabase.auth; }


export function useSupplyOrderApi() { const context = useContext(PortalApi);return context ? context.supplyOrder || supplyOrder : supplyOrder; }

export function useRetailerRegistration() { return useContext(PortalApi)?.retailerRegistration || retailerRegistration; }
