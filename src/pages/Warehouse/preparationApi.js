import { supabase } from "../../lib/supabaseClient.js";
import { postOrderJson } from "../../modules/orders/services/orderApiRequest.js";
export const proposeDdtPrintProfile = () => postOrderJson(
  "/api/mexal/automation?route=second-brain",
  {action:"call",name:"DDT_PRINT_SETTINGS_UPDATE",arguments:{reason:"Attivazione richiesta: DDT e packing per bancale fronte/retro, bianco e nero, vassoio 1."}},
  {supabase},
);
export const preparationApi = (operation, input = {}) =>
  postOrderJson(
    "/api/mexal/automation?route=order-preparation",
    { operation, ...input },
    { supabase },
  );
