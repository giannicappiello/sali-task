import { createHash } from "node:crypto";

export const WORKSPACEMES_V3_CONTRACT = 3;
export const WORKSPACEMES_V3_PREVIEW_IDEMPOTENCY_REVISION = 2;
export const COMPONENT_KIND = Object.freeze({ DIRECT: "DIRECT_COMPONENT", FORMULA: "FORMULA_COMPONENT" });

const clean = (value) => String(value ?? "").trim();
const upper = (value) => clean(value).toUpperCase();
const round = (value) => Math.round((Number(value) + Number.EPSILON) * 1_000_000) / 1_000_000;

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function payloadHash(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function deterministicUuid(value) {
  const digest = payloadHash(value);
  const variant = ((Number.parseInt(digest[16], 16) & 0x3) | 0x8).toString(16);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${variant}${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

export function previewCommandIdentity(identity) {
  const digest = payloadHash({ revision: WORKSPACEMES_V3_PREVIEW_IDEMPOTENCY_REVISION, ...identity });
  const idempotencyKey = `workspacemes:v3:preview:${digest}`;
  return {
    idempotencyKey,
    externalId: deterministicUuid({ purpose: "preview", idempotencyKey }),
    correlationId: deterministicUuid({ purpose: "preview-correlation", idempotencyKey }),
  };
}

export function classifyComponent(component, policy = {}) {
  const explicit = upper(component?.componentKind || component?.kind || component?.metadata?.componentKind);
  if (Object.values(COMPONENT_KIND).includes(explicit)) return { kind: explicit, source: "AUTHORITATIVE_METADATA" };
  if (component?.formulaId || component?.formulaExternalId || component?.metadata?.isFormula === true)
    return { kind: COMPONENT_KIND.FORMULA, source: "FORMULA_REFERENCE" };
  const code = upper(component?.articleCode || component?.code);
  const formulaPatterns = policy.formulaPatterns?.length ? policy.formulaPatterns : ["^FP"];
  if (formulaPatterns.some((pattern) => new RegExp(pattern, "i").test(code)))
    return { kind: COMPONENT_KIND.FORMULA, source: "CONFIGURED_PATTERN" };
  return { kind: COMPONENT_KIND.DIRECT, source: "DEFAULT_NON_FORMULA" };
}

function quantity(value, label, { allowZero = true, allowNegative = false } = {}) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || (!allowNegative && parsed < 0) || (!allowZero && parsed === 0)) {
    const error = new Error(`${label} non valida.`);
    error.code = "INVALID_QUANTITY";
    throw error;
  }
  return round(parsed);
}

export function netDirectComponent(input) {
  const required = quantity(input.requiredQuantity, "Quantità necessaria", { allowZero: false });
  // Una giacenza Mexal negativa è una situazione reale da conservare in audit,
  // ma non genera disponibilità utilizzabile per la nuova richiesta.
  const onHand = quantity(input.onHandQuantity, "Giacenza", { allowNegative: true });
  const committed = quantity(input.committedQuantity, "Impegnato");
  const usable = Math.max(0, round(onHand - committed));
  const needAt = input.requiredAt ? new Date(input.requiredAt) : null;
  const confirmedSupply = round((input.supplies || []).reduce((total, supply) => {
    if (supply.confirmed === false) return total;
    const arrival = supply.expectedAt ? new Date(supply.expectedAt) : null;
    if (needAt && (!arrival || Number.isNaN(arrival.getTime()) || arrival > needAt)) return total;
    return total + quantity(supply.remainingQuantity, "Fornitura residua");
  }, 0));
  const uncovered = Math.max(0, round(required - usable - confirmedSupply));
  return { required, onHand, committed, usable, confirmedSupply, uncovered, owner: "WORKSPACE", mutatesInventory: false };
}

export function explodeFinishedBom({ bomRevision, finishedQuantity, policy = {} }) {
  if (!bomRevision?.revision || !Array.isArray(bomRevision.lines) || !bomRevision.lines.length) {
    const error = new Error("Distinta prodotto finito revisionata non disponibile.");
    error.code = "FINISHED_BOM_MISSING";
    throw error;
  }
  const baseQuantity = quantity(bomRevision.baseQuantity || 1, "Quantità base distinta", { allowZero: false });
  const multiplier = quantity(finishedQuantity, "Quantità prodotto finito", { allowZero: false }) / baseQuantity;
  return bomRevision.lines.map((line, index) => {
    const classification = classifyComponent(line, policy);
    return {
      lineExternalId: clean(line.lineExternalId || line.id || `${bomRevision.revision}:${index + 1}`),
      articleCode: upper(line.articleCode || line.code),
      description: clean(line.description),
      unitOfMeasure: upper(line.unitOfMeasure || line.uom),
      quantityPerBase: quantity(line.quantity, "Quantità distinta", { allowZero: false }),
      requiredQuantity: round(quantity(line.quantity, "Quantità distinta", { allowZero: false }) * multiplier),
      componentKind: classification.kind,
      classificationSource: classification.source,
      formulaReference: clean(line.formulaExternalId || line.formulaId) || null,
    };
  });
}

export function buildV3Preview({ identity, bomRevision, finishedQuantity, directAvailability = {}, mesFormulaSnapshots = [], policy = {}, capturedAt }) {
  const components = explodeFinishedBom({ bomRevision, finishedQuantity, policy });
  const mesByCode = new Map(mesFormulaSnapshots.map((snapshot) => [upper(snapshot.fpCode), snapshot]));
  const rows = components.flatMap((component) => {
    if (component.componentKind === COMPONENT_KIND.DIRECT) {
      const source = directAvailability[component.articleCode] || {};
      return [{ ...component, ...netDirectComponent({ ...source, requiredQuantity: component.requiredQuantity, requiredAt: identity.requiredAt }), calculationOrigin: "WORKSPACE_DIRECT", previewOnly: true }];
    }
    const mes = mesByCode.get(component.articleCode);
    if (!mes) return [{ ...component, calculationOrigin: "PROGREMES_FP", previewOnly: true, blocker: "MES_FORMULA_PREVIEW_MISSING", materials: [] }];
    if (upper(mes.unitOfMeasure) !== component.unitOfMeasure)
      return [{ ...component, calculationOrigin: "PROGREMES_FP", previewOnly: true, blocker: "UOM_MISMATCH", materials: [] }];
    return [{ ...component, calculationOrigin: "PROGREMES_FP", previewOnly: true, formulaCode: mes.formulaCode, formulaRevision: mes.formulaRevision, formulaSnapshotHash: mes.snapshotHash, batch: mes.batch, station: mes.station, filling: mes.filling, availableAt: mes.availableAt, blocker: mes.blocker || null, materials: mes.materials || [] }];
  });
  const sources = {
    octRevision: identity.octRevision,
    octHash: identity.octHash,
    bomRevision: bomRevision.revision,
    bomHash: bomRevision.hash,
    availabilityVersion: identity.availabilityVersion,
    formulaHashes: rows.filter((row) => row.componentKind === COMPONENT_KIND.FORMULA).map((row) => row.formulaSnapshotHash || null),
  };
  const canonical = { contractVersion: 3, identity, finishedQuantity: quantity(finishedQuantity, "Quantità prodotto finito", { allowZero: false }), sources, rows };
  return { ...canonical, previewHash: payloadHash(canonical), capturedAt: capturedAt || new Date().toISOString(), status: rows.some((row) => row.blocker) ? "BLOCKED" : "READY", mutatesProduction: false };
}

export function assertPreviewCurrent(preview, currentSources) {
  const expected = payloadHash(preview.sources);
  const actual = payloadHash(currentSources);
  if (expected !== actual) {
    const error = new Error("La preview V3 non è più valida: OCT, distinta, formula o disponibilità sono cambiati.");
    error.code = "STALE_V3_PREVIEW";
    throw error;
  }
  if (preview.status !== "READY") {
    const error = new Error("La preview V3 contiene blocker e non può essere confermata.");
    error.code = "V3_PREVIEW_BLOCKED";
    throw error;
  }
  return true;
}

export function confirmationIdempotencyKey(preview) {
  return `workspacemes:v3:confirm:${preview.previewHash}`;
}
