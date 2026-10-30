import { createProgremesReadonlyAdmin } from "./progremes-readonly-auth.js";
import { assert } from "../shared/orderPreparation.js";
export const SCREEN = "magazzino.allestisci_ordini";
export const checked = (result) => {
  if (result.error) throw result.error;
  return result.data;
};
export async function preparationSession(
  req,
  { admin = createProgremesReadonlyAdmin() } = {},
) {
  const token = /^Bearer (.+)$/i.exec(
    String(req.headers?.authorization || ""),
  )?.[1];
  assert(token, "Sessione mancante.", 401);
  const auth = await admin.auth.getUser(token);
  assert(!auth.error && auth.data?.user, "Sessione non valida.", 401);
  const profile = checked(
    await admin
      .from("utenti")
      .select("id,attivo,ruoli(nome,amministratore_workspace)")
      .eq("auth_user_id", auth.data.user.id)
      .maybeSingle(),
  );
  assert(profile && profile.attivo !== false, "Utente non abilitato.", 403);
  const [customer, legacy] = await Promise.all([
    admin
      .from("workspace_customer_user_links")
      .select("customer_code")
      .eq("user_id", profile.id)
      .limit(1),
    admin
      .from("workspace_private_document_customer_access")
      .select("codice_cliente")
      .eq("utente_id", profile.id)
      .limit(1),
  ]);
  assert(
    !checked(customer)?.length &&
      !checked(legacy)?.length &&
      !/client|portal/i.test(profile.ruoli?.nome || ""),
    "Funzione riservata alla logistica interna.",
    403,
  );
  const level = checked(
    await admin.rpc("workspace_screen_level_for_user", {
      target_user_id: profile.id,
      target_screen: SCREEN,
    }),
  );
  assert(
    ["lettura", "scrittura", "amministrazione"].includes(level),
    "Accesso ad Allestisci Ordini non autorizzato.",
    403,
  );
  const permission = async (code) =>
    checked(
      await admin.rpc("workspace_screen_permission_for_user", {
        target_user_id: profile.id,
        permission_code: code,
        target_screen: SCREEN,
      }),
    ) === true;
  return {
    db: admin,
    profile,
    canWrite: await permission("warehouse.fulfillment.write"),
    canConfigure: await permission("warehouse.fulfillment.configure"),
  };
}
