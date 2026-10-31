import { preparationPackaging } from "./order-preparation-packaging.js";
import { createHash } from "node:crypto";

import {
  assert,
  cleanWarehouseHandoffNote,
  documentNotes,
  text,
  upper,
  matrix,
  scalar,
  eligibleOrder,
  orderIdentity,
  orderRows,
  integer,
} from "../shared/orderPreparation.js";

import { authoritativeArticleUnit } from "./mexal/unit-of-measure.js";

export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date())
    .replaceAll("-", "");

export function fingerprint(value) {
  const canonical = (v) =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, canonical(v[k])]),
          )
        : v;

  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

export function unwrap(value) {
  return value?.dati && !Array.isArray(value.dati) ? value.dati : value;
}

export async function pages(client, path, filters, maxPages = 30) {
  const rows = [],
    seen = new Set();
  let next;

  do {
    const query = new URLSearchParams({ max: "100" });
    if (next) query.set("next", next);

    const p = filters
      ? await client.postJson(`${path}/ricerca?${query}`, { filtri: filters })
      : await client.getJson(`${path}?${query}`);

    assert(Array.isArray(p.dati), "Risposta Mexal incompleta.");
    rows.push(...p.dati);
    next = p.next;

    assert(!next || !seen.has(next), "Paginazione Mexal ripetuta.");
    if (next) seen.add(next);
    assert(
      seen.size < maxPages,
      "Troppi risultati Mexal: restringere la ricerca.",
    );
  } while (next);
  return rows;
}

export async function eligibleOrders(client) {
  // Read all M headers, then normalize the phrase locally (case/whitespace independent).

  const docs = await pages(client, "/documenti/ordini-clienti", [
    { campo: "sigla", condizione: "=", valore: "OC" },
    { campo: "cod_modulo", condizione: "=", valore: "M" },
  ]);

  return docs.filter(eligibleOrder).map((d) => ({
    ...orderIdentity(d, client.anno),
    date: d.data_documento,
    note: documentNotes(d.nota),
    warehouse: Number(d.id_magazzino) || null,
  }));
}

export async function loadOrderContext(client, reference, db, settings) {
  assert(/^OC\+\d+\+\d+$/.test(reference), "Riferimento OCM non valido.");

  const raw = unwrap(
    await client.getJson(
      "/documenti/ordini-clienti/" + encodeURIComponent(reference),
    ),
  );

  assert(
    eligibleOrder(raw),
    "OCM non più presente, evadibile o privo della nota consegnato mgz.",
    409,
  );

  const identity = orderIdentity(raw, client.anno);
  assert(
    identity.reference === reference,
    "Documento Mexal diverso da quello richiesto.",
    502,
  );

  const allRows = orderRows(raw);
  assert(
    allRows.length > 0 && allRows.length <= 300,
    "OCM senza articoli o con troppe righe.",
  );

  const codes = [...new Set(allRows.map((r) => r.code))];

  const [packing, cache, packaging] = await Promise.all([
    db
      .from("warehouse_preparation_products")
      .select("code,barcode")
      .in("code", codes),

    db
      .from("ordini_prodotti_cache")
      .select("codice_articolo,descrizione,ean,unita_misura")
      .in("codice_articolo", codes),
    preparationPackaging(db, codes),
  ]);

  if (packing.error) throw packing.error;
  if (cache.error) throw cache.error;

  const catalog = [];

  // Bounded concurrency avoids opening an entire article/lot archive for an order.

  for (let offset = 0; offset < codes.length; offset += 5)
    catalog.push(
      ...(await Promise.all(
        codes.slice(offset, offset + 5).map(async (code) => {
          const a = unwrap(
            await client.getJson("/articoli/" + encodeURIComponent(code)),
          );

          assert(
            upper(a.codice || a.cod_articolo) === code,
            "Anagrafica articolo Mexal non verificata: " + code,
          );

          const config = packing.data.find((c) => c.code === code),
            cached = cache.data.find((c) => upper(c.codice_articolo) === code);

          return {
            code,
            description:
              text(a.descr_completa || a.descrizione || cached?.descrizione) ||
              code,

            unit: authoritativeArticleUnit(a) || upper(cached?.unita_misura),
            barcode: text(config?.barcode || a.cod_alternativo || cached?.ean),
            piecesPerCarton: packaging.get(code)?.piecesPerCarton || null,
            packagingSpecificationVersion:
              packaging.get(code)?.packagingSpecificationVersion || null,

            lotRequired: !!text(a.cod_tp_lotto),
            physical: Math.max(
              0,
              Number(a.qta_inventario || 0) +
                Number(a.qta_carico || 0) -
                Number(a.qta_scarico || 0),
            ),
          };
        }),
      )),
    );

  const lines = allRows.map((row) => {
    const a = catalog.find((a) => a.code === row.code);

    assert(
      row.type === "R" && row.status === "E",
      `${row.code}: riga OCM non evadibile (${row.status || "stato assente"}).`,
      409,
    );

    assert(
      ["PZ", "PZI", "PEZZI", "PCS", "PC"].includes(a.unit) &&
        row.unitType === "1",
      `${row.code}: la scansione richiede l'unità principale in pezzi.`,
    );

    integer(row.id, "ID riga OCM", 1, 2147483647);
    integer(row.quantity, "Quantità OCM");

    return {
      ...row,
      ...a,
      warehouse: integer(
        row.warehouse || settings.default_warehouse,
        "Magazzino",
      ),
    };
  });

  const customer = unwrap(
    await client.getJson(
      "/clienti/" + encodeURIComponent(identity.customerCode),
    ),
  );

  return {
    source: {
      ...identity,
      date: raw.data_documento,
      note: documentNotes(raw.nota),
      customerName: text(customer.ragione_sociale) || identity.customerCode,

      destination: text(scalar(raw.cod_anag_sped))
        ? {
            code: text(scalar(raw.cod_anag_sped)),
            address: "Destinazione Mexal " + text(scalar(raw.cod_anag_sped)),
            city: "",
            postalCode: "",
          }
        : {
            code: "",
            address: text(customer.indirizzo),
            city: text(customer.localita),
            postalCode: text(customer.cap),
          },
      lines,
    },
    raw,
    hash: fingerprint(raw),
  };
}

// This Mexal installation defaults to warehouse 1 when the coordinate is absent.
// Read each explicit source warehouse independently, including multi-warehouse OCMs.
export async function lotInventoryForWarehouses(clientFactory, lines) {
  const groups = new Map();
  for (const line of lines) {
    const warehouse = integer(line.warehouse, "Magazzino della riga");
    if (!groups.has(warehouse)) groups.set(warehouse, []);
    groups.get(warehouse).push(line);
  }
  const result = { lots: [], observations: [], lines: [] };
  const refreshed = new Map();
  for (const [warehouse, warehouseLines] of groups) {
    const inventory = await lotInventory(clientFactory({ warehouse }), warehouseLines);
    result.lots.push(...inventory.lots);
    result.observations.push(...inventory.observations);
    warehouseLines.forEach((line, index) => refreshed.set(line, inventory.lines[index]));
  }
  result.lines = lines.map(line => refreshed.get(line));
  return result;
}

export async function lotInventory(client, lines) {
  const warehouses = [...new Set(lines.map((l) => l.warehouse))];
  const lots = [],
    seen = new Set();
  let next;

  const balances = new Map();
  const codes = new Set(lines.map((l) => l.code));

  // Sparse progressives are indexed matrices; aggregate before considering positive balances.

  do {
    const query = new URLSearchParams({
      max: "1000",
      fields:
        "cod_articolo,id_magazzino,id_lotto,qta_inventario,qta_carico,qta_scarico",
    });
    if (next) query.set("next", next);

    const p = await client.getJson("/progressivi-articoli?" + query);

    assert(
      Array.isArray(p.cod_articolo) && Array.isArray(p.id_magazzino),
      "Giacenze lotto Mexal non verificabili.",
    );

    const fields = Object.fromEntries(
      [
        "id_magazzino",
        "id_lotto",
        "qta_inventario",
        "qta_carico",
        "qta_scarico",
      ].map((k) => [k, matrix(p[k])]),
    );

    for (const [i, c] of matrix(p.cod_articolo)) {
      const code = upper(c),
        warehouse = Number(fields.id_magazzino.get(i)),
        lotId = Number(fields.id_lotto.get(i) || 0);

      if (!codes.has(code) || !warehouses.includes(warehouse)) continue;

      const quantity = ["qta_inventario", "qta_carico", "qta_scarico"].map(
        (k) => Number(fields[k].get(i) || 0),
      );

      assert(
        quantity.every(Number.isFinite),
        "Progressivi lotto non numerici.",
      );

      const key = `${code}:${warehouse}:${lotId}`;
      balances.set(key, {
        code,
        warehouse,
        lotId,
        quantity:
          (balances.get(key)?.quantity || 0) +
          quantity[0] +
          quantity[1] -
          quantity[2],
      });
    }

    next = p.next;
    assert(!next || !seen.has(next), "Paginazione giacenze ripetuta.");
    if (next) seen.add(next);
    assert(seen.size < 80, "Archivio giacenze troppo esteso.");
  } while (next);

  const meta = new Map();
  const ids = [
    ...new Set(
      [...balances.values()]
        .filter((b) => b.quantity > 0 && b.lotId > 0)
        .map((b) => b.lotId),
    ),
  ];

  for (let offset = 0; offset < ids.length; offset += 5)
    await Promise.all(
      ids.slice(offset, offset + 5).map(async (id) => {
        meta.set(id, unwrap(await client.getJson("/lotti/" + id)));
      }),
    );

  const observations=[];
  for (const b of balances.values()) {
    if (b.lotId <= 0 || b.quantity <= 0) {if(b.quantity>0)observations.push({...b,state:"Senza lotto"});continue;}
    const m = meta.get(b.lotId);

    assert(
      m && Number(m.id) === b.lotId && upper(m.cod_articolo) === b.code,
      "Identità lotto Mexal non coerente.",
    );

    observations.push({...b,lotCode:text(m.cod_ute_lotto),entryDate:text(m.data_carico),expiry:text(m.data_validita),state:text(m.stato),loaded:text(m.caricato)});
    if (m.stato !== "C" || m.caricato !== "S") continue;

    lots.push({
      ...b,
      lotCode: text(m.cod_ute_lotto),
      entryDate: text(m.data_carico),
      expiry: text(m.data_validita),
    });
  }

  const totals = new Map();
  for (const b of balances.values()) {
    const key = b.code + ":" + b.warehouse;
    totals.set(key, (totals.get(key) || 0) + b.quantity);
  }

  return {
    lots,
    observations,
    lines: lines.map((l) => ({
      ...l,
      physical: Math.max(0, totals.get(l.code + ":" + l.warehouse) || 0),
    })),
  };
}

export function buildDdt(
  preparation,
  context,
  allocations,
  settings,
  date = today(),
  notes,
) {
  const { source } = context,
    raw = context.raw;
  assert(
    source.lines.every((l) => l.id > 0),
    "ID righe origine mancanti.",
  );

  const allIds = [...matrix(raw.id_riga)];
  assert(
    allIds.length > 0 && allIds.every(([, id]) => Number(id) > 0),
    "Identità delle righe origine non verificata.",
  );

  assert(notes === undefined || typeof notes === "string", "Note BCS non valide.");
  const shippingNotes = cleanWarehouseHandoffNote(notes === undefined ? raw.nota : notes);
  assert(shippingNotes.length <= 1000, "Le note BCS possono contenere al massimo 1000 caratteri.");
  const reason = integer(scalar(raw.id_causale), "Causale dell'ordine");

  // Native document transformation: reference the original header and original row IDs.

  // Mexal retains the original economics, transport and textual rows, while lots are explicit.

  const payload = {
    sigla: "BC",
    cod_modulo: "S",
    id_causale: [[1, reason]],
    serie: integer(settings.ddt_series, "Serie DDT"),
    numero: 0,
    cod_conto: source.customerCode,
    data_documento: date,

    sigla_doc_orig: [[1, "OC"]],
    serie_doc_orig: [[1, source.series]],
    numero_doc_orig: [[1, source.number]],
    data_doc_orig: [[1, source.date]],

    dt_ult_mod_orig: text(raw.data_ult_mod),

    id_rif_testata: allIds.map(([pos]) => [pos, 1]),
    id_riga_orig: allIds.map(([pos, id]) => [pos, Number(id)]),

    nota: [
      [
        1,
        [shippingNotes, `ALL:${preparation.id}`]
          .filter(Boolean)
          .join(" | "),
      ],
    ],

    nr_colli_sped: [[1, preparation.state.packages.length]],

    pos_righe_lotto: [],
    nr_righe_lotto: [],
    id_lotto: [],
    qta_lotto: [],
    dec_qta_lotto: [],
  };

  // Explicit line content also allows the non-writing totals service to validate the request.

  for (const field of [
    "tp_riga",
    "codice_articolo",
    "descr_riga",
    "quantita",
    "prezzo",
    "sconto",
    "cod_iva",
    "tp_um_articolo",
  ])
    payload[field] = structuredClone(raw[field] || []);

  payload.id_riga = allIds.map(([position]) => [position, 0]);

  payload.id_magazzino = Number(raw.id_magazzino) || source.lines[0].warehouse;

  payload.id_mag_da_riga = structuredClone(
    raw.id_mag_riga || raw.id_mag_da_riga || [],
  );

  for (const line of source.lines) {
    const rows = allocations.filter(
      (a) => a.position === line.position && a.lotId > 0,
    );
    if (!line.lotRequired) continue;

    assert(
      rows.length > 0 &&
        rows.reduce((n, a) => n + a.quantity, 0) === line.quantity,
      "Assegnazione lotto incompleta per " + line.code,
    );

    payload.pos_righe_lotto.push([line.position, payload.id_lotto.length + 1]);
    payload.nr_righe_lotto.push([line.position, rows.length]);

    for (const a of rows) {
      const i = payload.id_lotto.length + 1;
      payload.id_lotto.push([i, a.lotId]);
      payload.qta_lotto.push([i, a.quantity]);
      payload.dec_qta_lotto.push([i, 6]);
    }
  }

  return payload;
}

export function verifyDdt(actual, preparation, payload) {
  const raw = unwrap(actual);
  assert(
    raw.sigla === "BC" &&
      text(raw.cod_modulo) === text(payload.cod_modulo) &&
      Number(raw.serie) === payload.serie &&
      Number(raw.numero) > 0 &&
      raw.cod_conto === payload.cod_conto,
    "DDT Mexal non corrispondente.",
  );

  assert(
    text(scalar(raw.nota)).includes(`ALL:${preparation.id}`),
    "Riferimento allestimento assente nel DDT.",
  );

  if (payload.id_causale) assert(Number(scalar(raw.id_causale)) === Number(scalar(payload.id_causale)),
    "Causale del DDT diversa dall'ordine originale.");
  assert(documentNotes(raw.nota).replace(/\r\n/g, "\n").trim() === documentNotes(payload.nota).replace(/\r\n/g, "\n").trim(),
    "Note del DDT diverse dalle note confermate.");

  const origins = matrix(raw.sigla_doc_orig),
    series = matrix(raw.serie_doc_orig),
    numbers = matrix(raw.numero_doc_orig);

  assert(
    [...origins].some(
      ([i, s]) =>
        s === "OC" &&
        Number(series.get(i)) === preparation.source.series &&
        Number(numbers.get(i)) === preparation.source.number,
    ),
    "DDT senza collegamento nativo all’OCM origine.",
  );

  const expected = new Map();
  for (const l of preparation.source.lines)
    expected.set(l.code, (expected.get(l.code) || 0) + l.quantity);

  const totals = new Map();
  for (const r of orderRows(raw))
    totals.set(r.code, (totals.get(r.code) || 0) + r.quantity);

  assert(
    expected.size === totals.size &&
      [...expected].every(([c, q]) => totals.get(c) === q),
    "Quantità DDT diverse dal riscontro.",
  );

  const originGroups = matrix(raw.id_rif_testata),
    originRows = matrix(raw.id_riga_orig);
  const usedOrigins = new Set();
  for (const row of orderRows(raw)) {
    const group = Number(originGroups.get(row.position)),
      originalId = Number(originRows.get(row.position));
    const original = preparation.source.lines.find(
      (line) => line.id === originalId,
    );
    assert(
      origins.get(group) === "OC" &&
        Number(series.get(group)) === preparation.source.series &&
        Number(numbers.get(group)) === preparation.source.number &&
        original &&
        !usedOrigins.has(originalId) &&
        original.code === row.code &&
        original.warehouse === row.warehouse &&
        original.quantity === row.quantity,
      "Riga DDT non collegata alla corretta riga e magazzino OCM.",
    );
    usedOrigins.add(originalId);
  }
  assert(
    usedOrigins.size === preparation.source.lines.length,
    "Righe OCM mancanti nel DDT.",
  );
  function lotTotals(document) {
    const ids = matrix(document.id_lotto),
      quantities = matrix(document.qta_lotto),
      starts = matrix(document.pos_righe_lotto),
      counts = matrix(document.nr_righe_lotto);
    const totals = new Map(),
      used = new Set();
    for (const row of orderRows(document)) {
      const count = Number(counts.get(row.position) || 0),
        start = Number(starts.get(row.position) || 0);
      assert(
        Number.isSafeInteger(count) && count >= 0 && count <= 1000,
        "Numero righe lotto DDT non valido.",
      );
      let assigned = 0;
      for (let offset = 0; offset < count; offset++) {
        const i = start + offset,
          id = Number(ids.get(i)),
          quantity = Number(quantities.get(i));
        assert(
          !used.has(i) &&
            Number.isSafeInteger(id) &&
            id > 0 &&
            Number.isSafeInteger(quantity) &&
            quantity > 0,
          "Lotti DDT non verificabili sulla riga articolo.",
        );
        used.add(i);
        assigned += quantity;
        const key = JSON.stringify([row.code, row.warehouse, id]);
        totals.set(key, (totals.get(key) || 0) + quantity);
      }
      const requiresLot = preparation.source.lines.some(
        (line) => line.code === row.code && line.lotRequired,
      );
      assert(
        requiresLot ? assigned === row.quantity : count === 0,
        "Quantita lotto DDT non coerente con la riga articolo.",
      );
    }
    assert(
      used.size === ids.size && used.size === quantities.size,
      "Lotti DDT senza riga articolo.",
    );
    return totals;
  }
  const actualLots = lotTotals(raw),
    expectedLots = lotTotals(payload);
  assert(
    expectedLots.size === actualLots.size &&
      [...expectedLots].every(
        ([key, quantity]) => actualLots.get(key) === quantity,
      ),
    "Lotti del DDT diversi dal FIFO confermato.",
  );

  return {
    signature: "BC" + text(raw.cod_modulo),
    notes: cleanWarehouseHandoffNote(documentNotes(raw.nota).replace(`ALL:${preparation.id}`, "")),
    series: Number(raw.serie),
    number: Number(raw.numero),
    date: raw.data_documento,
    customerCode: raw.cod_conto,
    reference: `BC+${raw.serie}+${raw.numero}+${raw.cod_conto}`,
  };
}
