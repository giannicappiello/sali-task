import {packingWeights, tareWeightKg, productWeightGrams} from '../shared/preparationWeights.js';
import { productCodeInScan } from "../shared/productScan.js";
import { runDdtContractDiagnostics } from './mexal/ddt-contract-diagnostics.js';
import { MEXAL_BCF_PDF_SERVICE } from './preparation-dispatch.js';
import {
  preparationPackaging,
  saveMissingPreparationPackaging,
} from "./order-preparation-packaging.js";
import {
  readOrderIndex,
  synchronizeOrderIndex,
  orderIndexStatus,
} from "./order-preparation-sync.js";
import { randomUUID } from "node:crypto";
import { appendPreparationScan } from '../shared/preparationScanning.js';
import { shipmentPreview, finalizeShipment, shipmentReadback, validateDispatchSettings } from './preparation-dispatch.js';
import { createMesDdtPrinting } from './ddt-mes-print.js';
import {previewOrphanDdtDeletion,deleteOrphanDdt,isKnownRejectedDdt,resetRejectedDdt} from './preparation-ddt-deletion.js';
import {ensureDdtPdf,ensurePackingPdf} from './preparation-ddt-pdf.js';
import {preparationAuditPage} from '../shared/preparationAudit.js';
import {readEmittedDdt} from './preparation-ddt-readback.js';

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
  isPackingProductCode,
  packingSource,
  physicalPacking,
} from "../shared/orderPreparation.js";

import {
  today,
  fingerprint,
  unwrap,
  pages,
  loadOrderContext,
  packingListDescriptions,
  deliveryDestination,
  lotInventoryForWarehouses as lotInventory,
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

const currentPacking = (r) => {
  const source = packingSource(r.source, r.source_raw);
  let state = ['draft','verified'].includes(r.status) ? physicalPacking(r.state) : r.state;
  if (['draft','verified'].includes(r.status) && !source.lines.length && !state.scans.length)
    state = {...state,packages:[],pallets:[]};
  return {...r,source,state};
};
const exposed = (record) => {
  const r=currentPacking(record);
  return {
    id: r.id,
    source: r.verification?.ok ? {
      ...r.source, destination:r.verification.destination || r.source.destination, fifoIssue: undefined, fifoDiagnostics: undefined,
      fifoProposal: r.verification.allocations,
    } : r.source,
    state: r.state,
    status: r.status,
    version: r.version,
    verification: r.verification,
    ddt: r.ddt,
    error: r.error,
    updatedAt: r.updated_at,
    recipientWarnings: r.dispatch_snapshot?.recipientWarnings || [],
  };
};

export async function mutate(db, row, actor, action, data, event = randomUUID()) {
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
  return currentPacking(result.data);
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

async function refreshFifoAdvisory(row, db, inventoryFactory, force = false) {
  if ((!force && !row.source.fifoIssue) || !["draft", "verified"].includes(row.status) || row.verification?.ok) return row;
  const refreshed = structuredClone(row);
  try {
    const inventory = await lotInventory(inventoryFactory, refreshed.source.lines);
    refreshed.source.fifoDiagnostics = {
      lines: inventory.lines.map(({code,warehouse,physical,lotRequired}) => ({code,warehouse,physical,lotRequired})),
      lots: inventory.observations,
    };
    refreshed.source.fifoProposal = allocateFifo(inventory.lines,inventory.lots,await held(db,row.id),today());
    delete refreshed.source.fifoIssue;
  } catch(error) { refreshed.source.fifoIssue=error.message; }
  return refreshed;
}

async function plan(db, row, context, inventoryFactory, settings) {
  const comparison = comparePacking(context.source.lines, row.state);
  if (!comparison.ok) return comparison;

  const inventory = await lotInventory(inventoryFactory, context.source.lines),
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
    summary: packingWeights(packingSummary(row.state, contents, context.source.lines),context.source.lines,settings),
    destination: context.source.destination,
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
  let qrCode;
  try {
    qrCode = productCodeInScan(barcode);
  } catch (error) {
    throw Object.assign(error, { status: 400 });
  }
  const [configs, cache, byCode] = await Promise.all([
    db
      .from("warehouse_preparation_products")
      .select("code,barcode")
      .eq("barcode", barcode)
      .limit(2),
    db
      .from("ordini_prodotti_cache")
      .select("codice_articolo,ean,descrizione")
      .eq("ean", barcode)
      .limit(3),
    qrCode
      ? db
          .from("ordini_prodotti_cache")
          .select("codice_articolo,descrizione")
          .eq("codice_articolo", qrCode)
          .limit(2)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const matches = new Set([
    ...checked(configs).map((r) => r.code),
    ...checked(cache).map((r) => upper(r.codice_articolo)),
    ...checked(byCode).map((r) => upper(r.codice_articolo)),
    ...source.lines
      .filter((l) => qrCode && l.code === qrCode)
      .map((l) => l.code),
    ...source.lines.filter((l) => l.barcode === barcode).map((l) => l.code),
    ...(source.excludedLines || []).filter(l => l.code === upper(barcode) || l.barcode === barcode).map(l => l.code),
  ]);

  assert(
    matches.size === 1,
    matches.size
      ? "Barcode associato a più prodotti: correggi l’anagrafica."
      : "Barcode o codice IT/MKT non riconosciuto. Verifica il prodotto e la sua anagrafica.",
  );

  const code = [...matches][0];
  if (!isPackingProductCode(code)) return {code, description:source.excludedLines?.find(line=>line.code===code)?.description || cache.data[0]?.descrizione || code, excluded:true};
  const product = source.lines.find((l) => l.code === code) || {
    code,
    description:
      byCode.data[0]?.descrizione || cache.data[0]?.descrizione || code,
  };

  const packaging = await preparationPackaging(db, [code]);
  return {
    ...product,
    scannedValue: qrCode ? code : barcode,
    piecesPerCarton: null,
    boxesPerPallet: null,
    packagingSpecificationVersion: null,
    packagingSpecificationEmpty: true,
    palletSpecificationEmpty: true,
    unitWeightGrams: null,
    weightSpecificationEmpty: true,
    ...packaging.get(code),
  };
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
    const palletId = uuid(body.palletId);
    state.pallets.push({
      id: palletId,
      number: Math.max(0, ...state.pallets.map((p) => p.number)) + 1,
    });
    if (body.assignUnassigned === true) {
      for (const item of state.packages)
        if (!item.palletId) item.palletId = palletId;
    }
  } else if (operation === "assign") {
    const p = state.packages.find((p) => p.id === body.packageId);
    assert(p, "Collo non trovato.");
    assert(!p.closed, 'Riapri il collo prima di cambiarne il bancale.');
    p.palletId = body.palletId ? uuid(body.palletId) : null;
  } else if (operation === "remove_package") {
    assert(state.packages.some(p=>p.id===body.packageId), 'Collo non trovato.');
    if (state.scans.some(s=>s.packageId===body.packageId)) {
      assert(body.confirmed === true, 'Conferma l’eliminazione del collo e del suo contenuto.');
      assert(text(body.reason).length>=3 && text(body.reason).length<=1000, 'Indica il motivo dell’eliminazione.');
    }
    state.scans = state.scans.filter(s=>s.packageId!==body.packageId);
    state.packages = state.packages.filter((p) => p.id !== body.packageId);
  } else if (operation === "remove_pallet") {
    assert(
      !state.packages.some((p) => p.palletId === body.palletId),
      "Sposta prima i cartoni dal bancale.",
    );
    state.pallets = state.pallets.filter((p) => p.id !== body.palletId);
  } else if (operation === "reopen_package") {
    const pack = state.packages.find(item => item.id === body.packageId);
    assert(pack, 'Collo non trovato.');
    assert(text(body.reason).length >= 3 && text(body.reason).length <= 1000, 'Indica il motivo della riapertura.');
    pack.closed = false;
  } else if (operation === "undo" || operation === "remove_quantity") {
    const index = state.scans.findIndex((s) => s.id === body.scanId);
    assert(index >= 0, "Lettura non trovata.");
    const scan = state.scans[index];
    assert(!state.packages.find(item => item.id === scan.packageId)?.closed, 'Riapri il collo prima di correggere il contenuto.');
    assert(text(body.reason).length >= 3 && text(body.reason).length <= 1000, 'Indica il motivo della correzione.');
    const quantity = operation === 'undo' ? scan.quantity : integer(body.quantity, 'Pezzi da rimuovere', 1, scan.quantity);
    if (quantity === scan.quantity) state.scans.splice(index, 1);
    else {
      state.scans[index] = {...scan, quantity: scan.quantity - quantity, corrected: true};
    }
  } else throw new Error("Modifica imballi non valida.");

  return validatePacking(state);
}

export async function existingDdt(client, row) {
  const docs = await pages(client, "/documenti/movimenti-magazzino", [
    { campo: "sigla", condizione: "=", valore: "BC" },
    ...(row.export_payload?.cod_modulo
      ? [
          {
            campo: "cod_modulo",
            condizione: "=",
            valore: row.export_payload.cod_modulo,
          },
        ]
      : []),
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

      const configuration = ['ddt_settings','ddt_configure','ddt_verify','ddt_queue','ddt_recover_email','ddt_reprint'].includes(body.operation);
      const session = await authorize(req, configuration ? {screen:'integrazioni.ddt',configuration:true} : {}),
        { db, profile } = session;
      const op = body.operation;

      const canRead = ["list", "get", "completion_status", "settings", "reconcile", "resolve_product", "preview_packing_list", "audit", "audit_export", "preview_dispatch", "shipment", "document", "ddt_settings", "ddt_queue"].includes(op);

      assert(
        canRead ||
          session.canWrite ||
          (["configure", "configure_product", "ddt_configure", "ddt_verify", "ddt_recover_email", "ddt_reprint"].includes(op) &&
            session.canConfigure),
        "Permesso di scrittura richiesto.",
        403,
      );

      if (["configure", "configure_product", "ddt_configure", "ddt_verify", "ddt_recover_email", "ddt_reprint"].includes(op))
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

      const mesPrinting = createMesDdtPrinting();
      if (op === 'ddt_verify') {
        const report = await runDdtContractDiagnostics(clientFactory({warehouse:null}));
        assert(report.modules?.payload?.elenco_moduli_stampa_disponibili?.some(module=>module.codice==='BCF'), 'Modulo BCF non disponibile in Mexal.',409);
        assert(report.modules?.payload?.elenco_moduli_stampa_disponibili?.some(module=>module.codice==='BCS' && /bolla/i.test(module.descrizione)), 'Modulo DDT senza prezzi non disponibile in Mexal.',409);
        assert(report.services?.ok, report.services?.error || 'Recupero PDF Mexal non verificato.',409);
        const result = await db.rpc('warehouse_configure_preparation',{p_actor:profile.id,p_expected:body.settingsVersion,p_settings:{
          ddt_pdf_path:MEXAL_BCF_PDF_SERVICE,bcf_contract_verified:true,
          contract_evidence:`${report.checkedAt}: Documento BCF; PDF con modulo BC1 (Bolla x Ft Elettronica), con prezzi, sconti e totali; ${report.services.command}; ${report.services.reference}; PDF ${report.services.bytes} byte; SHA256 ${report.services.sha256}`,
        }});
        if (result.error) throw Object.assign(new Error(result.error.message),{status:result.error.code === '40001'?409:400});
        return res.status(200).json({verified:true,checkedAt:report.checkedAt,bytes:report.services.bytes});
      }
      if (op === 'ddt_settings') {
        let printerError=null,printerConfiguration=null;
        try {printerConfiguration=(await mesPrinting.inventory(db)).configuration;}catch(error){printerError=error.message;}
        return res.status(200).json({settings,canConfigure:session.canConfigure,printerError,printerConfiguration,
          printers:checked(await db.from('warehouse_printers').select('id,station,name,last_seen').eq('station','MES').order('name'))});
      }
      if (op === 'ddt_queue') {
        const pending=checked(await db.from('warehouse_print_jobs').select('id').eq('station','MES').in('status',['printing','uncertain']).order('created_at').limit(10));
        await Promise.allSettled(pending.map(job=>mesPrinting.sync(db,job.id)));
        const offset = integer(body.offset || 0, 'Pagina invii', 0, 1000000);
        let query = db.from('warehouse_shipment_emails').select('id,preparation_id,recipient,roles,status,attempts,last_error,sent_at,provider_message_id,created_at').order('created_at',{ascending:false}).order('id').range(offset,offset+49);
        if (body.status) { assert(['queued','leased','sending','retry','uncertain','sent','failed'].includes(body.status),'Stato non valido.'); query = query.eq('status',body.status); }
        const emails = checked(await query);
        const prints = checked(await db.from('warehouse_print_jobs').select('id,preparation_id,document_kind,printer_id,status,error,created_at').order('created_at',{ascending:false}).limit(50));
        return res.status(200).json({emails,prints,nextOffset:emails.length === 50 ? offset+50 : null});
      }
      if (op === 'ddt_recover_email') {
        assert(body.confirmed === true && ['sent','retry'].includes(body.outcome) && text(body.reason).length >= 3, 'Conferma esito e motivo richiesti.');
        const result = checked(await db.rpc('warehouse_resolve_shipment_email',{p_id:uuid(body.emailId),p_actor:profile.id,p_outcome:body.outcome,p_reason:text(body.reason)}));
        return res.status(200).json({email:result});
      }
      if (op === 'ddt_reprint') {
        assert(body.confirmed === true && text(body.reason).length>=3,'Conferma ristampa e motivo richiesti.');
        const result=checked(await db.rpc('warehouse_reprint',{p_id:uuid(body.printId),p_request:uuid(body.eventId),p_actor:profile.id,p_reason:text(body.reason)}));
        return res.status(200).json({printJob:result.printer_id.startsWith('MES:')?await mesPrinting.sync(db,result.id):result});
      }
      if (op === 'ddt_configure') {
        const value = validateDispatchSettings(body);
        for (const key of ['ddt_printer_id','packing_printer_id']) if (value[key]) assert(checked(await db.from('warehouse_printers').select('id').eq('id',value[key]).maybeSingle()),'Stampante non presente nell’inventario.');
        const merged = {...settings,...value};
        if (merged.bcf_contract_verified) assert(merged.ddt_pdf_path && text(merged.contract_evidence),'Indica percorso PDF verificato ed evidenza del contratto BCF.');
        const result = await db.rpc('warehouse_configure_preparation',{p_actor:profile.id,p_expected:body.settingsVersion,p_settings:value});
        if (result.error) throw Object.assign(new Error(result.error.message),{status:result.error.code === '40001' ? 409 : 400});
        return res.status(200).json({saved:true});
      }
      const client = clientFactory({ warehouse: null, timeoutMs: 300000 });
      const inventoryFactory = ({ warehouse }) => clientFactory({
        warehouse, year: client.anno, timeoutMs: 300000,
      });

      if (op === "list") {
        const preparations = checked(
          await db
            .from(TABLE)
            .select("id,source,status,version,ddt,updated_at")
            .order("updated_at", { ascending: false })
            .limit(500),
        );

        let index = await readOrderIndex(db);
        if (body.refresh === true || !index.last_synced_at) {
          try {
            index = await synchronizeOrderIndex(
              db,
              client,
              body.refresh ? "manual" : "bootstrap",
            );
          } catch (error) {
            index = await readOrderIndex(db);
            if (!index.last_synced_at) throw error;
          }
        }

        return res.status(200).json({
          orders: index.orders,
          sync: orderIndexStatus(index),
          // This query deliberately omits packing state: list summaries must
          // never pass through the detailed scan/box normalization pipeline.
          preparations: preparations.map(r => ({
            id:r.id, source:packingSource(r.source), status:r.status,
            version:r.version, ddt:r.ddt, updatedAt:r.updated_at,
          })),
          canWrite: session.canWrite,
          canConfigure: session.canConfigure,
        });
      }

      if (op === "settings") {
        const products = checked(
          await db
            .from("warehouse_preparation_products")
            .select("code,barcode")
            .order("code")
            .limit(2000),
        );
        const packaging = await preparationPackaging(
          db,
          products.map((p) => p.code),
        );
        return res.status(200).json({
          settings,
          products: products.map((p) => ({
            ...p,
            pieces_per_carton: packaging.get(p.code)?.piecesPerCarton || null,
            specification_version:
              packaging.get(p.code)?.packagingSpecificationVersion || null,
          })),
          canConfigure: session.canConfigure,
        });
      }

      if (op === "configure") {
        const value = {
          ddt_series:
            body.ddtSeries == null
              ? null
              : integer(body.ddtSeries, "Serie DDT"),
          default_warehouse: integer(body.warehouse, "Magazzino"),
          ...(Object.hasOwn(body,"boxTareKg") ? {box_tare_kg:tareWeightKg(body.boxTareKg,"Peso cartone")} : {}),
          ...(Object.hasOwn(body,"palletTareKg") ? {pallet_tare_kg:tareWeightKg(body.palletTareKg,"Peso pallet")} : {}),
          updated_at: new Date().toISOString(),
        };

        if (value.ddt_series) {
          const series = await client.getJson("/dati-generali/serie-documenti");
          const { prepareDocumentSeries } = await import(
            "./mexal/sync-document-series.js"
          );

          assert(
            prepareDocumentSeries(series).rows.some(
              (s) =>
                s.sigla_documento === "BC" &&
                Number(s.serie) === value.ddt_series,
            ),
            "Serie DDT non presente in Mexal.",
          );
        }

        const result = await db.rpc('warehouse_configure_preparation',{p_actor:profile.id,p_expected:body.settingsVersion,p_settings:value});
        if (result.error) throw Object.assign(new Error(result.error.message),{status:result.error.code === '40001' ? 409 : 400});
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

        assert(
          body.piecesPerCarton == null || body.piecesPerCarton === "",
          "I pezzi per cartone si modificano nel capitolato prodotto, sezione Imballo.",
        );

        checked(
          await db.from("warehouse_preparation_products").upsert({
            code,
            barcode: barcode || null,
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
          const inventory = await lotInventory(inventoryFactory, context.source.lines);
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
          state: context.source.lines.length ? initialPacking() : {pallets:[],packages:[],scans:[],confirmedLots:false},
        });

        return res.status(200).json({ preparation: exposed(row) });
      }

      const id = uuid(body.id);
      let row = currentPacking(checked(await db.from(TABLE).select("*").eq("id", id).single()));
      if (['preview_ddt_delete','delete_orphan_ddt'].includes(op)) {
        assert(session.canConfigure && session.canWrite,'Recupero riservato agli amministratori con scrittura.',403);
        assert(row.version===Number(body.version) && row.status==='uncertain','Preparazione cambiata: aggiorna la schermata.',409);
        const recoveryClient=clientFactory({warehouse:null,year:row.source.year,timeoutMs:60000});
        const actual=await existingDdt(recoveryClient,row);
        if(op==='preview_ddt_delete') return res.status(200).json({deletionPreview:await previewOrphanDdtDeletion({db,client:recoveryClient,row,actual})});
        assert(body.confirmed===true,'Conferma esplicita della cancellazione richiesta.',400);
        row=await deleteOrphanDdt({db,client:recoveryClient,row,actor:profile.id,actual,hash:body.deletionHash,reference:body.reference,findExisting:()=>existingDdt(recoveryClient,row)});
        return res.status(200).json({preparation:exposed(row),deletedReference:body.reference});
      }
      if (op === 'completion_status') return res.status(200).json({preparation:exposed(row),completion:checked(await db.from('warehouse_completion_jobs').select('status,last_error,updated_at').eq('preparation_id',id).maybeSingle())});
      if(row.status==='completed' && ((op==='preview_packing_list') || (['document','print_document'].includes(op) && body.kind!=='bcf' && body.kind!=='bcf_print')))await ensurePackingPdf(db,row,profile.id,session.canWrite);
      if (op === 'print_document') {
        assert(session.canWrite,'Permesso di stampa richiesto.',403);
        if(body.kind==='bcf_print')await ensureDdtPdf(db,clientFactory({warehouse:null,year:row.source.year,timeoutMs:60000}),row,profile.id);
        if ((body.kind==='bcf_print'?settings.ddt_printer_id:settings.packing_printer_id)?.startsWith('MES:')) await mesPrinting.inventory(db);
        const copies=body.copies == null ? null : integer(body.copies,'Numero copie',1,50);
        const job = checked(await db.rpc(copies == null ? 'warehouse_enqueue_print' : 'warehouse_enqueue_print_copies',{p_id:id,p_request:uuid(body.eventId),p_kind:body.kind,p_actor:profile.id,...(copies == null ? {} : {p_copies:copies})}));
        return res.status(200).json({printJob:job.printer_id.startsWith('MES:')?await mesPrinting.sync(db,job.id):job});
      }
      if (op === 'preview_packing_list' && row.status === 'completed' && row.ddt?.signature === 'BCF') return res.status(200).json(await shipmentReadback(db,row,'packing_list'));

      if (op === 'preview_dispatch') return res.status(200).json(await shipmentPreview(db, client, row, settings));
      if(op==='document' && ['bcf','bcf_print'].includes(body.kind))await ensureDdtPdf(db,clientFactory({warehouse:null,year:row.source.year,timeoutMs:60000}),row,profile.id,session.canWrite);
      if (op === 'shipment' || op === 'document') return res.status(200).json(await shipmentReadback(db, row, op === 'document' ? body.kind : null));
      if(op==='audit_export') {
        const after=integer(body.after||0,'Cursore registro',0,Number.MAX_SAFE_INTEGER);
        const latest=body.maxId==null?checked(await db.from('warehouse_preparation_events').select('id').eq('preparation_id',id).order('id',{ascending:false}).limit(1)):null;
        const maxId=body.maxId==null?(latest[0]?.id||0):integer(body.maxId,'Fine registro',0,Number.MAX_SAFE_INTEGER);
        const events=checked(await db.from('warehouse_preparation_events').select('id,event_id,event_type,actor,payload,created_at').eq('preparation_id',id).gt('id',after).lte('id',maxId).order('id').limit(100));
        const prior=after?checked(await db.from('warehouse_preparation_events').select('payload').eq('preparation_id',id).lte('id',after).not('payload->state','is',null).order('id',{ascending:false}).limit(1)):[];
        const actorIds=[...new Set(events.flatMap(event=>[event.actor,...(event.payload?.state?.scans||[]).map(scan=>scan.actor)]).filter(Boolean))];
        const operators=actorIds.length?checked(await db.from('utenti').select('id,nome,cognome').in('id',actorIds)):[];
        return res.status(200).json({preparation:exposed(row),records:preparationAuditPage(events,{previousState:prior[0]?.payload.state,operators}),maxId,nextAfter:events.length===100?events.at(-1).id:null,generatedAt:new Date().toISOString()});
      }
      if (op === 'audit') {
        const after = Math.max(0, Number(body.after) || 0);
        const events = checked(await db.from('warehouse_preparation_events').select('id,event_id,event_type,actor,payload,created_at')
          .eq('preparation_id', id).gt('id', after).order('id').limit(100));
        return res.status(200).json({events, nextAfter: events.length === 100 ? events.at(-1).id : null});
      }
      if (op === 'finalize_documents') {
        assert(session.canWrite, 'Permesso di scrittura richiesto.', 403);
        assert(row.status === 'completed', 'DDT non confermato.', 409);
        const historicalClient = clientFactory({warehouse:null,year:row.source.year,timeoutMs:300000});
        return res.status(200).json(await finalizeShipment(db, historicalClient, row));
      }
      if (op === "resolve_product") {
        const barcode = text(body.barcode);
        assert(barcode && barcode.length<=100 && !/^https?:\/\//i.test(barcode), "Inserisci un barcode o un codice articolo IT/MKT valido.");
        const product = await barcodeProduct(db,barcode,row.source);
        return res.status(200).json({product:{code:product.code,description:product.description,piecesPerCarton:product.piecesPerCarton,boxesPerPallet:product.boxesPerPallet,excluded:!!product.excluded,wrong:!product.excluded && !row.source.lines.some(item=>item.code===product.code)}});
      }
      if (op === "get") {
        if (row.status === 'completed') return res.status(200).json({preparation:exposed(row),canWrite:session.canWrite,canConfigure:session.canConfigure});
        row = {...row,source:{...row.source,destination:await deliveryDestination(client,row.source_raw,row.source.customerCode)}};
        row = await refreshFifoAdvisory(row, db, inventoryFactory);
        return res.status(200).json({preparation:exposed(row),canWrite:session.canWrite,canConfigure:session.canConfigure});
      }

      assert(
        row.source.year === Number(client.anno),
        "Seleziona l’anno Mexal dell’ordine prima di operare.",
        409,
      );

      if(op === "complete_weight") {
        assert(productWeightGrams(body.unitWeightGrams),"Peso Totale in grammi non valido.");
        assert(row.source.lines.some(line=>line.code===upper(body.productCode)),"Prodotto non previsto nell'ordine.");
        await saveMissingPreparationPackaging(db,upper(body.productCode),{unitWeightGrams:body.unitWeightGrams},profile.id);
        return res.status(200).json({saved:true});
      }
      if(op === "preview_packing_list") {
        assert(row.verification?.summary,"Esegui il riscontro prima di visualizzare la packing list.");
        let summary=row.verification.summary;
        if(!summary.weightTotals) {
          const metadata=await preparationPackaging(db,row.source.lines.map(line=>line.code));
          const lines=row.source.lines.map(line=>({...line,unitWeightGrams:metadata.get(line.code)?.unitWeightGrams}));
          const missing=lines.find(line=>!line.unitWeightGrams);
          if(missing) {
            assert(session.canWrite,`Peso mancante nel capitolato di ${missing.code}: richiedi il completamento del capitolato.`);
            return res.status(200).json({requiresProductWeight:true,product:{code:missing.code}});
          }
          summary=packingWeights(summary,lines,settings);
        }
        summary=await packingListDescriptions(client,summary);
        const destination=await deliveryDestination(client,row.source_raw,row.source.customerCode);
        return res.status(200).json({preparation:exposed({...row,source:{...row.source,destination},verification:{...row.verification,summary,destination}})});
      }

      const event = uuid(body.eventId);

      const replay = checked(
        await db
          .from("warehouse_preparation_events")
          .select("event_id")
          .eq("preparation_id", id)
          .eq("event_id", event)
          .maybeSingle(),
      );

      if (replay) {
        if (op === "reopen") row = await refreshFifoAdvisory(row, db, inventoryFactory, true);
        return res.status(200).json({ preparation: exposed(row) });
      }

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
          "remove_quantity",
          "reopen_package",
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
        assert(
          barcode && barcode.length <= 4096,
          "Barcode, codice IT o URL QR non valido.",
        );
        assert(["piece", "carton", "pallet"].includes(body.mode), "Modalità non valida.");

        uuid(body.packageId);
        const product = await barcodeProduct(db, barcode, row.source);
        if (product.excluded) return res.status(200).json({ignored:true,message:`${product.code}: riga informativa, non richiede imballo.`,preparation:exposed(row)});
        const ordered = row.source.lines.some(line => line.code === product.code);
        const needsPieces = body.mode !== "piece" && !product.piecesPerCarton;
        const needsWeight = ordered && !product.unitWeightGrams;
        const needsBoxes = body.mode === 'pallet' && !product.boxesPerPallet;
        if(needsPieces || needsWeight || needsBoxes) {
          assert(ordered,"Prodotto non previsto nell'ordine: non è possibile compilare il capitolato da questa lettura.");
          assert(!needsPieces || product.packagingSpecificationEmpty, `Pezzi per cartone di ${product.code} non validi: correggi il capitolato prodotto.`);
          assert(!needsWeight || product.weightSpecificationEmpty, `Peso Totale in grammi di ${product.code} non valido: correggi il capitolato prodotto.`);
          assert(!needsBoxes || product.palletSpecificationEmpty, `Colli per bancale di ${product.code} non validi: correggi il capitolato prodotto.`);
          if((needsPieces && (body.piecesPerCarton == null || body.piecesPerCarton === "")) || (needsWeight && (body.unitWeightGrams == null || body.unitWeightGrams === "")) || (needsBoxes && (body.boxesPerPallet == null || body.boxesPerPallet === ""))) return res.status(200).json({
            requiresCartonPieces:needsPieces,requiresProductWeight:needsWeight,requiresPalletBoxes:needsBoxes,product:{code:product.code},
          });
          Object.assign(product,await saveMissingPreparationPackaging(db,product.code,{
            ...(needsPieces?{piecesPerCarton:body.piecesPerCarton}:{}),
            ...(needsWeight?{unitWeightGrams:body.unitWeightGrams}:{}),
            ...(needsBoxes?{boxesPerPallet:body.boxesPerPallet}:{}),
          },profile.id));
        }

        const state = appendPreparationScan(row.state, product, body, event, profile.id, randomUUID, new Date().toISOString());
        row = await mutate(db, row, profile.id, "save", { state, operation: "scan", scanMode: body.mode }, event);

        return res.status(200).json({
          preparation: exposed(row),
          scan: {
            code: product.code,
            quantity: body.mode === "piece" ? 1 : product.piecesPerCarton * (body.mode === "pallet" ? product.boxesPerPallet : 1),
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
          "remove_quantity",
          "reopen_package",
        ].includes(op)
      ) {
        row = await mutate(
          db,
          row,
          profile.id,
          "save",
          { state: editPacking(row, op, body), operation: op, reason: text(body.reason), scanId: body.scanId || null, packageId: body.packageId || null, quantity: body.quantity || null,
            ...(op === 'remove_package' ? {removedPackage:row.state.packages.find(p=>p.id===body.packageId),removedScans:row.state.scans.filter(s=>s.packageId===body.packageId)} : {}) },
          event,
        );
        return res.status(200).json({ preparation: exposed(row) });
      }

      if (op === "reopen") {
        row = await mutate(db, row, profile.id, "reopen", {}, event);
        row = await refreshFifoAdvisory(row, db, inventoryFactory, true);
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

          return res.status(409).json({
            error:
              "L’OCM è cambiato in Mexal. Quantità aggiornate; ripeti il riscontro.",
            preparation: exposed(row),
          });
        }

        const packingComparison = comparePacking(context.source.lines,row.state);
        if(op === "verify" && !packingComparison.ok) return res.status(200).json({preparation:exposed(row),verification:packingComparison});
        for(const line of context.source.lines) {
          if(line.unitWeightGrams) continue;
          if(op === "verify" && body.productCode === line.code && body.unitWeightGrams != null) {
            const packaging=await saveMissingPreparationPackaging(db,line.code,{unitWeightGrams:body.unitWeightGrams},profile.id);
            for(const same of context.source.lines.filter(item=>item.code===line.code)) Object.assign(same,packaging);
          } else if(op === "verify") return res.status(200).json({requiresProductWeight:true,product:{code:line.code}});
          else assert(false,`Peso mancante per ${line.code}: ripeti il riscontro per completarlo.`);
        }
        const verification = await plan(db, row, context, inventoryFactory, settings);

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
          fingerprint(verification.allocations) ===
            fingerprint(row.verification.allocations),
          "Disponibilità FIFO cambiata: ripeti il riscontro.",
          409,
        );

        assert(fingerprint(verification.summary.weightTotals) === fingerprint(row.verification.summary.weightTotals) && fingerprint(verification.summary.productWeights) === fingerprint(row.verification.summary.productWeights),"Pesi prodotto o tare aggiornati: ripeti il riscontro prima dell'emissione.",409);
        assert(fingerprint(verification.destination) === fingerprint(row.verification.destination), 'Destinazione aggiornata: ripeti il riscontro prima dell’emissione.',409);
        assert(
          settings.ddt_series,
          "Configura la serie DDT prima dell’emissione.",
        );

        const dispatch = await shipmentPreview(db, client, row, settings);
        assert(body.dispatchHash === dispatch.hash, "Destinatari o configurazione aggiornati: riapri il riepilogo emissione.", 409);

        const payload = buildDdt(
          row,
          context,
          verification.allocations,
          settings,
          undefined,
          body.ddtNotes,
        );

        // Calculation checks totals only. Native conversion is enabled on the POST URL below.

        await client.calculateDocument(payload);

        row = await mutate(
          db,
          row,
          profile.id,
          "claim_export",
          { confirmedLots: true, source_hash: context.hash, payload, dispatch },
          event,
        );

        try {
          // One POST only. A timeout leaves an uncertain journal and may only be reconciled by reads.

          const creation = await client.postJson("/documenti/movimenti-magazzino?sigla_trasformazione=BC", payload);
          const actual=await readEmittedDdt({client,creation,payload,findExisting:()=>existingDdt(client,row)});

          assert(
            actual,
            "DDT inviato ma numero non confermato. Usa Verifica esito DDT.",
          );

          const ddt = verifyDdt(actual, row, payload);

          row = await mutate(db, row, profile.id, "finish", {
            token: event,
            ddt,
            confirmedDocument: actual,
          });

          const shipment = await finalizeShipment(db, client, row);
          return res.status(200).json({ preparation: exposed(row), ...shipment });
        } catch (error) {
          row = await mutate(db, row, profile.id, "uncertain", {
            token: event,
            error: error.message,
          });

          return res.status(202).json({
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
        if (!actual && isKnownRejectedDdt(row)) {
          row=await resetRejectedDdt({db,client,row,actor:profile.id,eventId:event,findExisting:()=>existingDdt(client,row)});
          return res.status(200).json({preparation:exposed(row),warning:'Mexal aveva rifiutato la richiesta senza creare documenti. Tentativo archiviato: ripeti il riscontro prima della nuova emissione.'});
        }
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
            confirmedDocument: actual,
          },
          event,
        );

        const shipment = await finalizeShipment(db, client, row);
        return res.status(200).json({ preparation: exposed(row), ...shipment });
      }

      throw Object.assign(new Error("Operazione non valida."), { status: 400 });
    } catch (error) {
      return res.status(error.status || 500).json({
        error: error.message || "Operazione di allestimento non riuscita.",
      });
    }
  };
}

export default createOrderPreparationHandler();
