import { supabase } from "../../lib/supabaseClient.js";
import { postOrderJson } from "../../modules/orders/services/orderApiRequest.js";
export const preparationApi = (operation, input = {}) =>
  postOrderJson(
    "/api/mexal/automation?route=order-preparation",
    { operation, ...input },
    { supabase },
  );
