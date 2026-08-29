import { useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabaseClient";
import { installOrderDataFetchCache } from "../modules/orders/services/orderDataFetchCache";
import { ORDER_CUSTOMER_COLUMNS } from "../modules/orders/services/orderDataSelections";

const PAGE_SIZE = 1000;

async function loadPaged(createQuery, signal) {
  let from = 0;
  while (!signal.aborted) {
    const { data, error } = await createQuery(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if ((data || []).length < PAGE_SIZE) return;
    from += PAGE_SIZE;
  }
}

async function resolveOrdersAccess(profileId, isAdminUser) {
  if (isAdminUser) return { enabled: true, canSeeAll: true };
  const { data, error } = await supabase.from("integrazioni_utenti")
    .select("modulo,enabled,ruolo_ordini")
    .eq("utente_id", profileId)
    .in("modulo", ["gestione_ordini_pr", "gestione_ordini_ph", "gestione_ordini_private"]);
  if (error) throw error;
  const enabledRows = (data || []).filter((row) => row.enabled === true);
  return {
    enabled: enabledRows.length > 0,
    canSeeAll: enabledRows.some((row) => row.ruolo_ordini === "backoffice"),
  };
}

export default function OrdersDataPreloader() {
  const { profile, isAdminUser, hasModuleAccess } = useAuth();
  const canPreloadOrders = hasModuleAccess("ordini_pr") || hasModuleAccess("ordini_ph") || hasModuleAccess("ordini_private");

  useEffect(() => {
    if (!profile?.id || !canPreloadOrders) return undefined;

    const controller = new AbortController();
    const run = async () => {
      try {
        await installOrderDataFetchCache();
        const access = await resolveOrdersAccess(profile.id, isAdminUser);
        if (!access.enabled || controller.signal.aborted) return;

        await Promise.all([
          loadPaged((from, to) => {
            const query = access.canSeeAll
              ? supabase.from("ordini_clienti_cache").select(ORDER_CUSTOMER_COLUMNS).range(from, to).eq("attivo_mexal", true)
              : supabase.rpc("visible_mexal_clients_for_me").select(ORDER_CUSTOMER_COLUMNS).range(from, to);
            return query.order("ragione_sociale", { ascending: true }).order("codice_cliente", { ascending: true });
          }, controller.signal),
          loadPaged((from, to) => supabase.from("ordini_prodotti_cache").select("*").range(from, to)
            .eq("mostra_in_app", true).order("descrizione", { ascending: true }).order("codice_articolo", { ascending: true }), controller.signal),
          loadPaged((from, to) => supabase.from("ordini_sconti_listini").select("*").range(from, to).eq("is_active", true), controller.signal),
          loadPaged((from, to) => supabase.from("ordini_particolarita").select("*").range(from, to).eq("is_active", true), controller.signal),
          loadPaged((from, to) => supabase.from("ordini_regole_pagamento").select("*").range(from, to).eq("is_active", true), controller.signal),
        ]);
      } catch (error) {
        if (!controller.signal.aborted) console.warn("Precaricamento leggero dati Ordini non riuscito:", error);
      }
    };
    const timer = window.setTimeout(run, 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [profile?.id, isAdminUser, canPreloadOrders]);

  return null;
}
