import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";

export const CRM_CUSTOMER_STATUS_OPTIONS = [
  ["active", "Attivi"],
  ["inactive", "Non attivi"],
  ["all", "Tutti"],
];

export function useCrmCustomerStatus(defaultStatus = "active") {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("customerStatus");
  const value = CRM_CUSTOMER_STATUS_OPTIONS.some(([status]) => status === requested)
    ? requested
    : defaultStatus;
  const setValue = useCallback((next) => {
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      params.set("customerStatus", next);
      params.delete("page");
      params.delete("customerPage");
      params.delete("dashboardPage");
      params.delete("classification_page");
      return params;
    }, { replace: true });
  }, [setSearchParams]);
  return [value, setValue];
}

export async function setCrmCustomerActive({ customerKey, crmType, active, reason }) {
  const { data, error } = await supabase.rpc("crm_set_customer_active", {
    p_customer_key: customerKey,
    p_crm_type: crmType,
    p_active: active,
    p_reason: reason?.trim() || null,
  });
  if (error) throw error;
  return data;
}
