export const text = (value) => String(value ?? "").trim();
export const upper = (value) => text(value).toUpperCase();
export function assert(condition, message, status = 400) {
  if (!condition) throw Object.assign(new Error(message), { status });
}
export function integer(value, label, min = 1, max = 1000000) {
  const n = Number(value);
  assert(
    Number.isSafeInteger(n) && n >= min && n <= max,
    `${label} non valido.`,
  );
  return n;
}
export function matrix(value) {
  return new Map(
    Array.isArray(value)
      ? value
          .filter((x) => Array.isArray(x) && x.length > 1)
          .map((x) => [Number(x[0]), x.at(-1)])
      : [],
  );
}
export function scalar(value) {
  return Array.isArray(value) ? value[0]?.at(-1) : value;
}
export function eligibleOrder(document) {
  return (
    upper(document.sigla) === "OC" &&
    upper(document.cod_modulo) === "M" &&
    /\bconsegnato\s+(?:al\s+)?mgz\b/i.test(documentNotes(document.nota))
  );
}
export function orderIdentity(document, year) {
  const series = integer(document.serie, "Serie OCM"),
    number = integer(document.numero, "Numero OCM", 1, 2147483647);
  assert(/^\d{4}$/.test(String(year)), "Anno OCM non valido.");
  return {
    year: Number(year),
    series,
    number,
    reference: `OC+${series}+${number}`,
    customerCode: text(document.cod_conto),
  };
}
export function orderRows(document) {
  const fields = [
    "id_riga",
    "tp_riga",
    "codice_articolo",
    "descr_riga",
    "quantita",
    "tp_um_articolo",
    "id_mag_da_riga",
    "id_mag_riga",
    "tipo_stato_riga",
  ];
  const maps = Object.fromEntries(fields.map((k) => [k, matrix(document[k])]));
  return [...maps.codice_articolo]
    .map(([position, code]) => ({
      position,
      id: Number(maps.id_riga.get(position)),
      code: upper(code),
      description: text(maps.descr_riga.get(position)),
      quantity: Number(maps.quantita.get(position)),
      type: upper(maps.tp_riga.get(position)),
      status: upper(maps.tipo_stato_riga.get(position)),
      unitType: text(maps.tp_um_articolo.get(position) || ""),
      warehouse: Number(
        maps.id_mag_riga.get(position) ||
          maps.id_mag_da_riga.get(position) ||
          scalar(document.id_magazzino) ||
          0,
      ),
    }))
    .filter(
      (r) =>
        r.code && !["D", "T", "V"].includes(r.type) && !/^[.,]/.test(r.code),
    );
}
export function initialPacking() {
  return {
    pallets: [],
    packages: [{ id: crypto.randomUUID(), number: 1, palletId: null }],
    scans: [],
    confirmedLots: false,
  };
}
export function validatePacking(state) {
  assert(
    state &&
      Array.isArray(state.pallets) &&
      Array.isArray(state.packages) &&
      Array.isArray(state.scans),
    "Preparazione non valida.",
  );
  assert(
    state.packages.length <= 2000 &&
      state.pallets.length <= 200 &&
      state.scans.length <= 10000,
    "Preparazione troppo estesa.",
  );
  const validId = (id) => typeof id === "string" && /^[a-f0-9-]{36}$/i.test(id);
  const unique = (rows) => new Set(rows.map((r) => r.id)).size === rows.length;
  assert(
    unique(state.pallets) && unique(state.packages) && unique(state.scans),
    "Identificativi duplicati nella preparazione.",
  );
  for (const rows of [state.pallets, state.packages]) {
    assert(
      new Set(rows.map((r) => r.number)).size === rows.length,
      "Numeri dei colli o bancali duplicati.",
    );
    for (const r of rows) {
      assert(validId(r.id), "Identificativo collo/bancale non valido.");
      integer(r.number, "Numero collo/bancale", 1, 100000);
    }
  }
  for (const p of state.packages)
    assert(
      !p.palletId || state.pallets.some((b) => b.id === p.palletId),
      "Bancale del collo inesistente.",
    );
  for (const s of state.scans) {
    assert(
      validId(s.id) && state.packages.some((p) => p.id === s.packageId),
      "Lettura priva di un collo valido.",
    );
    assert(
      text(s.barcode).length > 0 &&
        text(s.barcode).length <= 100 &&
        text(s.code).length > 0 &&
        text(s.code).length <= 80,
      "Barcode o articolo non valido.",
    );
    integer(s.quantity, "Pezzi letti");
    assert(
      ["piece", "carton"].includes(s.mode),
      "Modalità di scansione non valida.",
    );
    assert(
      s.mode !== "piece" || s.quantity === 1,
      "Una lettura singolo pezzo vale un pezzo.",
    );
  }
  return state;
}
export function comparePacking(lines, state) {
  validatePacking(state);
  const required = new Map(),
    scanned = new Map();
  for (const l of lines)
    required.set(l.code, (required.get(l.code) || 0) + l.quantity);
  for (const s of state.scans)
    scanned.set(s.code, (scanned.get(s.code) || 0) + s.quantity);
  const discrepancies = [
    ...new Set([...required.keys(), ...scanned.keys()]),
  ].flatMap((code) => {
    const expected = required.get(code) || 0,
      actual = scanned.get(code) || 0;
    return expected === actual
      ? []
      : [
          {
            code,
            expected,
            actual,
            missing: Math.max(0, expected - actual),
            extra: Math.max(0, actual - expected),
            kind:
              expected === 0
                ? "wrong"
                : actual < expected
                  ? "missing"
                  : "extra",
          },
        ];
  });
  const empty = state.packages.filter(
    (p) => !state.scans.some((s) => s.packageId === p.id),
  );
  const unassigned = state.pallets.length
    ? state.packages.filter((p) => !p.palletId)
    : [];
  const emptyPallets = state.pallets.filter(
    (b) => !state.packages.some((p) => p.palletId === b.id),
  );
  return {
    ok:
      discrepancies.length === 0 &&
      required.size > 0 &&
      !empty.length &&
      !unassigned.length &&
      !emptyPallets.length,
    discrepancies,
    packagingErrors: [
      ...empty.map((p) => `Collo ${p.number} vuoto.`),
      ...unassigned.map((p) => `Assegna il collo ${p.number} a un bancale.`),
      ...emptyPallets.map((b) => `Bancale ${b.number} vuoto.`),
    ],
  };
}
export function allocateFifo(lines, lots, heldByOthers = [], today) {
  const held = new Map();
  for (const r of heldByOthers) {
    const key = `${r.code}:${r.warehouse}:${r.lotId}`;
    held.set(key, (held.get(key) || 0) + Number(r.quantity));
  }
  const available = new Map(),
    result = [];
  const candidates = lots
    .filter(
      (l) =>
        l.quantity > 0 &&
        /^\d{8}$/.test(l.entryDate) &&
        l.entryDate <= today &&
        (!l.expiry || (/^\d{8}$/.test(l.expiry) && l.expiry >= today)),
    )
    .sort(
      (a, b) => a.entryDate.localeCompare(b.entryDate) || a.lotId - b.lotId,
    );
  for (const l of candidates) {
    const k = `${l.code}:${l.warehouse}:${l.lotId}`;
    assert(!available.has(k), "Giacenze lotto duplicate.");
    available.set(k, Math.max(0, l.quantity - (held.get(k) || 0)));
  }
  for (const line of lines) {
    let remaining = line.quantity;
    if (!line.lotRequired) {
      result.push({
        position: line.position,
        code: line.code,
        warehouse: line.warehouse,
        lotId: 0,
        lotCode: "",
        quantity: remaining,
        capacity: line.physical,
      });
      continue;
    }
    for (const lot of candidates.filter(
      (l) => l.code === line.code && l.warehouse === line.warehouse,
    )) {
      const key = `${lot.code}:${lot.warehouse}:${lot.lotId}`,
        take = Math.min(remaining, Math.floor(available.get(key) || 0));
      if (take <= 0) continue;
      result.push({
        position: line.position,
        code: line.code,
        warehouse: lot.warehouse,
        lotId: lot.lotId,
        lotCode: lot.lotCode,
        quantity: take,
        capacity: lot.quantity,
        entryDate: lot.entryDate,
      });
      available.set(key, available.get(key) - take);
      remaining -= take;
      if (!remaining) break;
    }
    assert(
      remaining === 0,
      `Lotti FIFO insufficienti per ${line.code}: mancano ${remaining} pezzi.`,
      409,
    );
  }
  return result;
}
export function distributeLots(state, allocations) {
  const left = allocations.map((a) => ({ ...a })),
    contents = [];
  for (const scan of state.scans) {
    let quantity = scan.quantity;
    for (const a of left.filter(
      (a) => a.code === scan.code && a.quantity > 0,
    )) {
      const take = Math.min(quantity, a.quantity);
      contents.push({
        packageId: scan.packageId,
        code: scan.code,
        lotId: a.lotId,
        lotCode: a.lotCode,
        warehouse: a.warehouse,
        quantity: take,
      });
      a.quantity -= take;
      quantity -= take;
      if (!quantity) break;
    }
    assert(quantity === 0, `Quantità FIFO non coerente per ${scan.code}.`);
  }
  const grouped = new Map();
  for (const row of contents) {
    const key = JSON.stringify([
      row.packageId,
      row.code,
      row.lotId,
      row.warehouse,
    ]);
    const old = grouped.get(key);
    grouped.set(key, { ...row, quantity: (old?.quantity || 0) + row.quantity });
  }
  return [...grouped.values()];
}
export function packingSummary(state, contents, lines) {
  const descriptions = new Map(lines.map((l) => [l.code, l.description]));
  return {
    totalPackages: state.packages.length,
    totalPallets: state.pallets.length,
    totalPieces: state.scans.reduce((s, r) => s + r.quantity, 0),
    pallets: state.pallets.map((b) => ({
      ...b,
      cartons: state.packages.filter((p) => p.palletId === b.id).length,
    })),
    packages: state.packages.map((p) => ({
      ...p,
      palletNumber:
        state.pallets.find((b) => b.id === p.palletId)?.number || null,
      pieces: state.scans
        .filter((s) => s.packageId === p.id)
        .reduce((n, s) => n + s.quantity, 0),
      contents: contents
        .filter((c) => c.packageId === p.id)
        .map((c) => ({
          ...c,
          description: descriptions.get(c.code) || c.code,
        })),
    })),
  };
}

export function documentNotes(value) {
  return Array.isArray(value) ? value.map(row => Array.isArray(row) ? row.at(-1) : row).join("\n") : text(value);
}
export function cleanWarehouseHandoffNote(value) {
  return documentNotes(value).replace(/\bconsegnato\s+(?:al\s+)?mgz\b/gi, "")
    .replace(/[ \t]{2,}/g, " ").replace(/\|[ \t]*\|/g, "|")
    .replace(/(^|\n)[ \t]*[|;,][ \t]*/g, "$1").replace(/[ \t]*[|;,][ \t]*(?=$|\n)/g, "").trim();
}
