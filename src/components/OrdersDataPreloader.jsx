import { useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabaseClient";
import { installOrderDataFetchCache } from "../modules/orders/services/orderDataFetchCache";

const PAGE_SIZE = 1000;

function normalizeAgentCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeAgentCodes(values) {
  const source = Array.isArray(values)
    ? values
    : String(values || "").split(/[\n,;]+/);

  return [...new Set(source.map(normalizeAgentCode).filter(Boolean))];
}

async function loadPaged(table, buildQuery, signal) {
  let from = 0;
  let total = 0;

  while (!signal.aborted) {
    const query = buildQuery(
      supabase.from(table).select("*").range(from, from + PAGE_SIZE - 1)
    );
    const { data, error } = await query;
    if (error) throw error;
    const pageSize = (data || []).length;
    total += pageSize;
    if (pageSize < PAGE_SIZE) return total;
    from += PAGE_SIZE;
  }

  return total;
}

async function resolveOrdersAccess(profileId, isAdminUser) {
  if (isAdminUser) {
    return { enabled: true, canSeeAll: true, visibleAgents: null };
  }

  const { data, error } = await supabase
    .from("integrazioni_utenti")
    .select("enabled,codice_agente_mexal,ruolo_ordini,agenti_gestiti")
    .eq("utente_id", profileId)
    .eq("modulo", "gestione_ordini")
    .maybeSingle();

  if (error) throw error;
  if (data?.enabled !== true) return { enabled: false, canSeeAll: false, visibleAgents: [] };

  const role = data?.ruolo_ordini || "agente";
  if (role === "backoffice") {
    return { enabled: true, canSeeAll: true, visibleAgents: null };
  }

  if (role === "area_manager") {
    return {
      enabled: true,
      canSeeAll: false,
      visibleAgents: normalizeAgentCodes(data?.agenti_gestiti),
    };
  }

  const code = normalizeAgentCode(data?.codice_agente_mexal);
  return {
    enabled: true,
    canSeeAll: false,
    visibleAgents: code ? [code] : [],
  };
}

export default function OrdersDataPreloader() {
  const { profile, isAdminUser } = useAuth();

  useEffect(() => {
    if (!profile?.id) return undefined;

    const controller = new AbortController();

    const run = async () => {
      try {
        await installOrderDataFetchCache();
        const access = await resolveOrdersAccess(profile.id, isAdminUser);
        if (!access.enabled || controller.signal.aborted) return;

        let cachedProductCount = 0;
        try {
          cachedProductCount = await loadPaged(
            "ordini_prodotti_cache",
            (query) => query
              .eq("mostra_in_app", true)
              .order("descrizione", { ascending: true })
              .order("codice_articolo", { ascending: true }),
            controller.signal
          );
        } catch (error) {
          console.warn("Precaricamento cache prodotti Ordini non disponibile:", error);
        }

        if (cachedProductCount === 0 && !controller.signal.aborted) {
          await loadPaged(
            "prodotti",
            (query) => query
              .eq("mostra_in_app", true)
              .eq("attivo", true)
              .order("nome", { ascending: true }),
            controller.signal
          );
        }

        if (controller.signal.aborted) return;

        await loadPaged(
          "ordini_clienti_cache",
          (query) => {
            let result = query
              .eq("attivo_mexal", true)
              .order("ragione_sociale", { ascending: true })
              .order("codice_cliente", { ascending: true });
            if (!access.canSeeAll) result = result.in("codice_agente_mexal", access.visibleAgents);
            return result;
          },
          controller.signal
        );

        if (controller.signal.aborted) return;

        await Promise.all([
          loadPaged(
            "ordini_sconti_listini",
            (query) => query.eq("is_active", true),
            controller.signal
          ),
          loadPaged(
            "ordini_particolarita",
            (query) => query.eq("is_active", true),
            controller.signal
          ),
          loadPaged(
            "ordini_regole_pagamento",
            (query) => query.eq("is_active", true),
            controller.signal
          ),
        ]);
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn("Precaricamento silenzioso dati Ordini non riuscito:", error);
        }
      }
    };

    const timer = window.setTimeout(run, 0);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [profile?.id, isAdminUser]);

  return null;
}
