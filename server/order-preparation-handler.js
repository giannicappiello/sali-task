import { randomUUID } from "node:crypto";

import { buildMexalClient } from "./mexal/sync-products.js";

import { preparationSession, checked } from "./order-preparation-auth.js";

import {
  assert,
  text,
  upper,
  integer,
  initialPacking,
  validatePacking,
  comparePacking,
  allocateFifo,
  distributeLots,
  packingSummary,
} from "../shared/orderPreparation.js";

import {
  today,
  fingerprint,
  unwrap,
  pages,
  eligibleOrders,
  loadOrderContext,
  lotInventory,
  buildDdt,
  verifyDdt,
} from "./order-preparation-mexal.js";

const TABLE = "warehouse_order_preparations";

const uuid = (value) => {
  assert(
    /^[a-f0-9-]{36}$/i.test(String(value)),
    "Identificativo operazione non valido.",
  );
  return value;
};

const exposed = (r) => ({
  id: r.id,
  source: r.source,
  state: r.state,
  status: r.status,
  version: r.version,
  verification: r.verification,
  ddt: r.ddt,
  error: r.error,
  updatedAt: r.updated_at,
});

async function mutate(db, row, actor, action, data, event = randomUUID()) {
  const result = await db.rpc("warehouse_preparation_mutate", {
    p_id: row?.id || null,
    p_version: row?.version || 0,
    p_event: event,
    p_actor: actor,
    p_action: action,
    p_data: data,
  });

  if (result.error)
    throw Object.assign(new Error(result.error.message), {
      status: result.error.code === "40001" ? 409 : 400,
    });
  return result.data;
}

async function held(db, id) {
  return checked(
    await db
      .from("warehouse_preparation_lot_holds")
      .select("code,warehouse,lot_id,quantity")
      .neq("preparation_id", id),
  ).map((r) => ({
    ...r,
    lotId: Number(r.lot_id),
    quantity: Number(r.quantity),
  }));
}

async function plan(db, row, context, client) {
  const comparison = comparePacking(context.source.lines, row.state);
  if (!comparison.ok) return comparison;

  const inventory = await lotInventory(client, context.source.lines),
    other = await held(db, row.id);

  const allocations = allocateFifo(
    inventory.lines,
    inventory.lots,
    other,
    today(),
  );

  for (const line of inventory.lines) {
    const otherTotal = other
      .filter((o) => o.code === line.code && o.warehouse === line.warehouse)
      .reduce((s, o) => s + o.quantity, 0);

    const required = inventory.lines
      .filter((l) => l.code === line.code && l.warehouse === line.warehouse)
      .reduce((s, l) => s + l.quantity, 0);

    assert(
      required + otherTotal <= line.physical,
      `${line.code}: disponibilità fisica insufficiente per gli allestimenti attivi.`,
      409,
    );
  }

  const contents = distributeLots(row.state, allocations);

  return {
    ...comparison,
    allocations,
    contents,
    stock: [
      ...new Map(
        inventory.lines.map((l) => [
          l.code + ":" + l.warehouse,
          {
            code: l.code,
            warehouse: l.warehouse,
            capacity: l.physical,
            quantity: inventory.lines
              .filter((x) => x.code === l.code && x.warehouse === l.warehouse)
              .reduce((n, x) => n + x.quantity, 0),
          },
        ]),
      ).values(),
    ],
    summary: packingSummary(row.state, contents, context.source.lines),
    sourceHash: context.hash,
    checkedAt: new Date().toISOString(),
  };
}

function assertVersion(row, body) {
  assert(
    row.version === Number(body.version),
    "Preparazione aggiornata da un altro dispositivo: ricarica.",
    409,
  );
}

async function barcodeProduct(db, barcode, source) {
  const [configs, cache] = await Promise.all([
    db
      .from("warehouse_preparation_products")
      .select("code,barcode,pieces_per_carton")
      .eq("barcode", barcode)
      .limit(2),
    db
      .from("ordini_prodotti_cache")
      .select("codice_articolo,ean,descrizione")
      .eq("ean", barcode)
      .limit(3),
  ]);

  const matches = new Set([
    ...checked(configs).map((r) => r.code),
    ...checked(cache).map((r) => upper(r.codice_articolo)),
    ...source.lines.filter((l) => l.barcode === barcode).map((l) => l.code),
  ]);

  assert(
    matches.size === 1,
    matches.size
      ? "Barcode associato a più prodotti: correggi l’anagrafica."
      : "Barcode non riconosciuto. Configura il codice del prodotto.",
  );

  const code = [...matches][0];
  const product = source.lines.find((l) => l.code === code) || {
    code,
    description: cache.data[0]?.descrizione || code,
  };

  const config = checked(
    await db
      .from("warehouse_preparation_products")
      .select("pieces_per_carton")
      .eq("code", code)
      .maybeSingle(),
  );

  return { ...product, piecesPerCarton: config?.pieces_per_carton || null };
}

function editPacking(row, operation, body) {
  const state = structuredClone(row.state);
  state.confirmedLots = false;

  if (operation === "add_package") {
    state.packages.push({
      id: uuid(body.packageId),
      number: Math.max(0, ...state.packages.map((p) => p.number)) + 1,
      palletId: body.palletId ? uuid(body.palletId) : null,
    });
  } else if (operation === "add_pallet") {
    state.pallets.push({
      id: uuid(body.palletId),
      number: Math.max(0, ...state.pallets.map((p) => p.number)) + 1,
    });
  } else if (operation === "assign") {
    const p = state.packages.find((p) => p.id === body.packageId);
    assert(p, "Collo non trovato.");
    p.palletId = body.palletId ? uuid(body.palletId) : null;
  } else if (operation === "remove_package") {
    assert(
      !state.scans.some((s) => s.packageId === body.packageId),
      "Svuota il collo prima di rimuoverlo.",
    );
    state.packages = state.packages.filter((p) => p.id !== body.packageId);
  } else if (operation === "remove_pallet") {
    assert(
      !state.packages.some((p) => p.palletId === body.palletId),
      "Sposta prima i cartoni dal bancale.",
    );
    state.pallets = state.pallets.filter((p) => p.id !== body.palletId);
  } else if (operation === "undo") {
    const index = state.scans.findIndex((s) => s.id === body.scanId);
    assert(index >= 0, "Lettura non trovata.");
    state.scans.splice(index, 1);
  } else throw new Error("Modifica imballi non valida.");

  return validatePacking(state);
}

async function existingDdt(client, row) {
  const docs = await pages(client, "/documenti/movimenti-magazzino", [
    { campo: "sigla", condizione: "=", valore: "BC" },
    { campo: "cod_conto", condizione: "=", valore: row.source.customerCode },

    { campo: "nota", condizione: "contiene", valore: `ALL:${row.id}` },
  ]);

  assert(
    docs.length <= 1,
    "Più DDT corrispondono all’allestimento: verifica Mexal.",
  );

  if (!docs.length) return null;
  const d = docs[0];

  return unwrap(
    await client.getJson(
      "/documenti/movimenti-magazzino/" +
        encodeURIComponent(`BC+${d.serie}+${d.numero}+${d.cod_conto}`),
    ),
  );
}

export function createOrderPreparationHandler({
  authorize = preparationSession,
  clientFactory = buildMexalClient,
} = {}) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");

    if (req.method !== "POST")
      return res.status(405).json({ error: "Metodo non consentito." });

    try {
      const body = req.body || {};
      assert(JSON.stringify(body).length < 200000, "Richiesta troppo estesa.");

      const session = await authorize(req),
        { db, profile } = session;
      const op = body.operation;

      const canRead = ["list", "get", "settings", "reconcile"].includes(op);

      assert(
        canRead ||
          session.canWrite ||
          (["configure", "configure_product"].includes(op) &&
            session.canConfigure),
        "Permesso di scrittura richiesto.",
        403,
      );

      if (["configure", "configure_product"].includes(op))
        assert(
          session.canConfigure,
          "Configurazione riservata agli amministratori della schermata.",
          403,
        );

      if (op === "reconcile")
        assert(session.canWrite, "Permesso di scrittura richiesto.", 403);

      const settings = checked(
        await db
          .from("warehouse_preparation_settings")
          .select("*")
          .eq("id", true)
          .single(),
      );

      const client = clientFactory({ warehouse: null, timeoutMs: 20000 });

      if (op === "list") {
        const preparations = checked(
          await db
            .from(TABLE)
            .select("id,source,status,version,ddt,updated_at")
            .order("updated_at", { ascending: false })
            .limit(500),
        );

        const orders = await eligibleOrders(client);

        const codes = [...new Set(orders.map((o) => o.customerCode))];

        const names = codes.length
          ? checked(
              await db
                .from("ordini_clienti_cache")
                .select("codice_cliente,ragione_sociale")
                .in("codice_cliente", codes),
            )
          : [];

        return res
          .status(200)
          .json({
            orders: orders.map((o) => ({
              ...o,
              customerName:
                names.find((n) => n.codice_cliente === o.customerCode)
                  ?.ragione_sociale || o.customerCode,
            })),
            preparations: preparations.map(exposed),
            canWrite: session.canWrite,
            canConfigure: session.canConfigure,
          });
      }

      if (op === "settings")
        return res
          .status(200)
          .json({
            settings,
            products: checked(
              await db
                .from("warehouse_preparation_products")
                .select("*")
                .order("code")
                .limit(2000),
            ),
            canConfigure: session.canConfigure,
          });

      if (op === "configure") {
        const value = {
          ddt_series:
            body.ddtSeries == null
              ? null
              : integer(body.ddtSeries, "Serie DDT"),
          default_warehouse: integer(body.warehouse, "Magazzino"),
          updated_at: new Date().toISOString(),
        };

        if (value.ddt_series) {
          const series = await client.getJson("/dati-generali/serie-documenti");
          const { prepareDocumentSeries } =
            await import("./mexal/sync-document-series.js");

          assert(
            prepareDocumentSeries(series).rows.some(
              (s) =>
                s.sigla_documento === "BC" &&
                Number(s.serie) === value.ddt_series,
            ),
            "Serie DDT non presente in Mexal.",
          );
        }

        checked(
          await db
            .from("warehouse_preparation_settings")
            .update(value)
            .eq("id", true),
        );
        return res.status(200).json({ saved: true });
      }

      if (op === "configure_product") {
        const code = upper(body.code);
        assert(
          /^[A-Z0-9][A-Z0-9._/&+ -]{0,79}$/.test(code),
          "Codice articolo non valido.",
        );

        const article = unwrap(
          await client.getJson("/articoli/" + encodeURIComponent(code)),
        );
        assert(
          upper(article.codice || article.cod_articolo) === code,
          "Articolo Mexal non verificato.",
        );

        const barcode = text(body.barcode);
        assert(barcode.length <= 100, "Barcode troppo lungo.");

        const pieces =
          body.piecesPerCarton == null || body.piecesPerCarton === ""
            ? null
            : integer(body.piecesPerCarton, "Pezzi per cartone");

        checked(
          await db
            .from("warehouse_preparation_products")
            .upsert({
              code,
              barcode: barcode || null,
              pieces_per_carton: pieces,
              updated_at: new Date().toISOString(),
            }),
        );

        return res.status(200).json({ saved: true });
      }

      if (op === "begin") {
        const context = await loadOrderContext(
          client,
          text(body.reference),
          db,
          settings,
        );

        try {
          const inventory = await lotInventory(client, context.source.lines);
          context.source.fifoProposal = allocateFifo(
            inventory.lines,
            inventory.lots,
            await held(db, "00000000-0000-0000-0000-000000000000"),
            today(),
          );
        } catch (error) {
          context.source.fifoIssue = error.message;
        }

        const row = await mutate(db, null, profile.id, "create", {
          source_key: `${client.anno}:${context.source.reference}`,
          source: context.source,
          source_raw: context.raw,
          source_hash: context.hash,
          state: initialPacking(),
        });

        return res.status(200).json({ preparation: exposed(row) });
      }

      const id = uuid(body.id);
      let row = checked(await db.from(TABLE).select("*").eq("id", id).single());

      if (op === "get")
        return res
          .status(200)
          .json({
            preparation: exposed(row),
            canWrite: session.canWrite,
            canConfigure: session.canConfigure,
          });

      assert(
        row.source.year === Number(client.anno),
        "Seleziona l’anno Mexal dell’ordine prima di operare.",
        409,
      );

      const event = uuid(body.eventId);

      const replay = checked(
        await db
          .from("warehouse_preparation_events")
          .select("event_id")
          .eq("preparation_id", id)
          .eq("event_id", event)
          .maybeSingle(),
      );

      if (replay) return res.status(200).json({ preparation: exposed(row) });

      assertVersion(row, body);

      if (
        [
          "scan",
          "add_package",
          "add_pallet",
          "assign",
          "remove_package",
          "remove_pallet",
          "undo",
          "verify",
          "export",
        ].includes(op)
      )
        assert(
          ["draft", "verified"].includes(row.status),
          "Preparazione non modificabile: verifica lo stato corrente.",
          409,
        );
      if (op === "scan") {
        const barcode = text(body.barcode);
        assert(barcode && barcode.length <= 100, "Barcode non valido.");
        assert(["piece", "carton"].includes(body.mode), "Modalità non valida.");

        const product = await barcodeProduct(db, barcode, row.source);

        assert(
          body.mode !== "carton" || product.piecesPerCarton,
          `Configura i pezzi per cartone di ${product.code}.`,
        );

        const state = structuredClone(row.state);
        state.confirmedLots = false;

        state.scans.push({
          id: event,
          packageId: uuid(body.packageId),
          barcode,
          code: product.code,
          mode: body.mode,
          quantity: body.mode === "piece" ? 1 : product.piecesPerCarton,
          at: new Date().toISOString(),
          actor: profile.id,
        });

        validatePacking(state);
        row = await mutate(db, row, profile.id, "save", { state }, event);

        return res
          .status(200)
          .json({
            preparation: exposed(row),
            scan: {
              code: product.code,
              quantity: body.mode === "piece" ? 1 : product.piecesPerCarton,
              wrong: !row.source.lines.some((l) => l.code === product.code),
            },
          });
      }

      if (
        [
          "add_package",
          "add_pallet",
          "assign",
          "remove_package",
          "remove_pallet",
          "undo",
        ].includes(op)
      ) {
        row = await mutate(
          db,
          row,
          profile.id,
          "save",
          { state: editPacking(row, op, body) },
          event,
        );
        return res.status(200).json({ preparation: exposed(row) });
      }

      if (op === "reopen") {
        row = await mutate(db, row, profile.id, "reopen", {}, event);
        return res.status(200).json({ preparation: exposed(row) });
      }

      if (op === "cancel") {
        row = await mutate(db, row, profile.id, "cancel", {}, event);
        return res.status(200).json({ preparation: exposed(row) });
      }

      if (op === "verify" || op === "export") {
        const context = await loadOrderContext(
          client,
          row.source.reference,
          db,
          settings,
        );

        if (context.hash !== row.source_hash) {
          row = await mutate(db, row, profile.id, "refresh", {
            source: context.source,
            source_raw: context.raw,
            source_hash: context.hash,
          });

          return res
            .status(409)
            .json({
              error:
                "L’OCM è cambiato in Mexal. Quantità aggiornate; ripeti il riscontro.",
              preparation: exposed(row),
            });
        }

        const verification = await plan(db, row, context, client);

        if (op === "verify") {
          if (!verification.ok)
            return res
              .status(200)
              .json({ preparation: exposed(row), verification });

          row = await mutate(
            db,
            row,
            profile.id,
            "verify",
            {
              verification,
              stock: verification.stock,
              holds: verification.allocations.map((a) => ({
                code: a.code,
                warehouse: a.warehouse,
                lot_id: a.lotId,
                quantity: a.quantity,
                capacity: a.capacity,
              })),
            },
            event,
          );

          return res
            .status(200)
            .json({ preparation: exposed(row), verification });
        }

        assert(
          row.status === "verified" && verification.ok,
          "Riscontro positivo richiesto prima del DDT.",
        );

        assert(
          body.confirmedLots === true,
          "Conferma il prelievo dei lotti FIFO indicati.",
        );

        assert(
          fingerprint(verification.allocations) ===
            fingerprint(row.verification.allocations),
          "Disponibilità FIFO cambiata: ripeti il riscontro.",
          409,
        );

        assert(
          settings.ddt_series,
          "Configura la serie DDT prima dell’emissione.",
        );

        const payload = buildDdt(
          row,
          context,
          verification.allocations,
          settings,
        );

        // Calculation is read-only and checks the native transformation before the durable send marker.

        await client.calculateDocument(payload);

        row = await mutate(
          db,
          row,
          profile.id,
          "claim_export",
          { confirmedLots: true, source_hash: context.hash, payload },
          event,
        );

        try {
          // One POST only. A timeout leaves an uncertain journal and may only be reconciled by reads.

          const result = unwrap(
            await client.postJson("/documenti/movimenti-magazzino", payload),
          );

          let actual = result;

          if (!Number(actual.numero)) actual = await existingDdt(client, row);
          else
            actual = unwrap(
              await client.getJson(
                "/documenti/movimenti-magazzino/" +
                  encodeURIComponent(
                    `BC+${payload.serie}+${actual.numero}+${payload.cod_conto}`,
                  ),
              ),
            );

          assert(
            actual,
            "DDT inviato ma numero non confermato. Usa Verifica esito DDT.",
          );

          const ddt = verifyDdt(actual, row, payload);

          row = await mutate(db, row, profile.id, "finish", {
            token: event,
            ddt,
          });

          return res.status(200).json({ preparation: exposed(row) });
        } catch (error) {
          row = await mutate(db, row, profile.id, "uncertain", {
            token: event,
            error: error.message,
          });

          return res
            .status(202)
            .json({
              preparation: exposed(row),
              warning:
                "Esito DDT da verificare. Non viene ripetuto l’invio a Mexal.",
            });
        }
      }

      if (op === "reconcile") {
        assert(
          ["exporting", "uncertain"].includes(row.status),
          "Nessun invio DDT da verificare.",
        );

        const actual = await existingDdt(client, row);
        assert(
          actual,
          "DDT non ancora rintracciabile. Nessun nuovo invio eseguito: verifica Mexal prima di procedere.",
          409,
        );

        row = await mutate(
          db,
          row,
          profile.id,
          "finish",
          {
            token: row.export_token,
            ddt: verifyDdt(actual, row, row.export_payload),
          },
          event,
        );

        return res.status(200).json({ preparation: exposed(row) });
      }

      throw Object.assign(new Error("Operazione non valida."), { status: 400 });
    } catch (error) {
      return res
        .status(error.status || 500)
        .json({
          error: error.message || "Operazione di allestimento non riuscita.",
        });
    }
  };
}

export default createOrderPreparationHandler();
