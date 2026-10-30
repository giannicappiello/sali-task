import { assert, integer } from "../shared/orderPreparation.js";
import { articleType } from "./private-documents-store.js";
import { checked } from "./order-preparation-auth.js";
import { specificationPiecesPerBox } from "./mes-packaging-specification.js";

// Read only the packaging quantity, never expose other private specification fields.
export async function preparationPackaging(db, codes) {
  const unique = [...new Set(codes)];
  if (!unique.length) return new Map();
  const specs = checked(
    await db
      .from("workspace_product_specifications")
      .select("article_code,version,pieces_per_carton:data->>piecesPerBox")
      .in("article_code", unique),
  );
  return new Map(
    specs.map((spec) => {
      const pieces = specificationPiecesPerBox(spec.pieces_per_carton);
      return [
        spec.article_code,
        {
          piecesPerCarton: pieces && pieces <= 1000000 ? pieces : null,
          packagingSpecificationVersion: spec.version,
          packagingSpecificationEmpty:
            String(spec.pieces_per_carton ?? "").trim() === "",
        },
      ];
    }),
  );
}

// Only fill an empty packaging field. The canonical save RPC preserves revision history
// and rejects concurrent edits; no specification details are returned to the browser.
export async function saveMissingPreparationPackaging(db, code, input, actor) {
  const pieces = integer(input, "Pezzi per cartone");
  const catalog = checked(
    await db
      .from("ordini_prodotti_cache")
      .select("codice_articolo,dati_mexal")
      .eq("codice_articolo", code)
      .maybeSingle(),
  );
  assert(
    catalog &&
      articleType(code, catalog.dati_mexal?.gest_dbp) === "ProdottoFinito",
    "Il capitolato può essere compilato solo per un prodotto finito esistente.",
  );
  const saved = checked(
    await db
      .from("workspace_product_specifications")
      .select("*")
      .eq("article_code", code)
      .maybeSingle(),
  );
  const current = specificationPiecesPerBox(saved?.data?.piecesPerBox);
  if (current && current <= 1000000)
    return {
      piecesPerCarton: current,
      packagingSpecificationVersion: saved.version,
    };
  assert(
    String(saved?.data?.piecesPerBox ?? "").trim() === "",
    "Il capitolato contiene un valore non valido: correggilo in Documenti Private, sezione Imballo.",
  );
  const data = { ...(saved?.data || {}), piecesPerBox: String(pieces) };
  delete data.approvedBy;
  delete data.approvedAt;
  delete data.approvedUserId;
  const result = await db.rpc("save_workspace_product_specification", {
    p_article_code: code,
    p_expected_version: saved?.version || 0,
    p_data: data,
    p_attachments: saved?.attachments || [],
    p_user_id: actor,
    p_user_label: "Logistica - Allestisci Ordini",
  });
  if (["PT409", "40001"].includes(result.error?.code))
    throw Object.assign(
      new Error(
        "Capitolato aggiornato da un altro utente. Riprova la lettura per utilizzare il valore corrente.",
      ),
      { status: 409 },
    );
  const updated = checked(result);
  return {
    piecesPerCarton: pieces,
    packagingSpecificationVersion: updated.version,
  };
}
