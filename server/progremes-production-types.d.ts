export type WorkspaceProductionStatus =
  | "PRONTA"
  | "RICEVUTA"
  | "IN_ANALISI"
  | "PRODUCIBILE"
  | "PARZIALMENTE_PRODUCIBILE"
  | "IN_ATTESA_MERCE"
  | "ODP_GENERATI"
  | "PIANIFICATO"
  | "IN_PRODUZIONE"
  | "COMPLETATO";

export interface WorkspaceOctReference {
  orderId: string;
  mexalKey: string;
  sigla: string;
  serie: number;
  numero: number;
  customerTechnicalReference: string | null;
  orderDate: string;
  requestedDeliveryDate: string | null;
  sourceTimestamp: string | null;
  commercialRevision: number;
  versionHash: string;
}

export interface WorkspaceProductionDemandItem {
  itemIndex: number;
  itemExternalKey: string;
  orderId: string;
  lineId: string;
  mexalOrderKey: string;
  mexalLinePosition: number | null;
  commercialArticleCode: string;
  productionArticleCode: string | null;
  mappingStatus: "TO_RESOLVE_IN_MES" | "RESOLVED";
  requestedQuantity: number;
  requestedUnitOfMeasure: string;
  requestedUnitSource: "OCT_EXPLICIT" | "MEXAL_PRIMARY_ARTICLE_UNIT";
  productionQuantity: number;
  productionUnitOfMeasure: string;
  conversion: { from: string; to: string; factor: number; source: string } | null;
  requestedDeliveryDate: string | null;
}

export interface WorkspaceProductionRequestPayload {
  contractVersion: 2;
  workspaceExternalId: string;
  idempotencyKey: string;
  timestamp: string;
  requestedBy: string;
  octs: Array<{
    workspaceOctId: string;
    mexalExternalId: string;
    sigla: string;
    serie: string;
    numero: string;
    customerReference: string;
    orderDate: string;
    requestedDeliveryDate: string | null;
    commercialRevision: number;
    versionHash: string;
    sourceTimestamp: string;
    lines: Array<{
      workspaceLineId: string;
      mexalPosition: string;
      isDescriptive: boolean;
      commercialArticleCode: string;
      quantity: number;
      octUom: string;
      articleUom: string;
      authoritativeConversionFactor: number | null;
      conversionSource: string | null;
      requestedDate: string | null;
      priority: number | null;
      idempotencyKey: string;
    }>;
  }>;
}

export interface WorkspaceProductionProposalDto {
  id: number;
  itemExternalKey: string;
  productionIndex: number;
  quantity: number;
  status: "DaVerificare" | "Producibile" | "InAttesaMerce" | "Confermata";
  materialStatus: "DA_VERIFICARE" | "PRODUCIBILE" | "IN_ATTESA_MERCE" | "ODP_GENERATO";
  expectedMaterialAvailability: string | null;
  productionOrderId: number | null;
  productionOrderNumber: string | null;
}

export interface WorkspaceProductionEvent {
  schemaVersion: 2;
  eventId: string;
  externalId: string;
  sequence: number;
  occurredAt: string;
  type: string;
  workspaceStatus: WorkspaceProductionStatus;
  proposals: WorkspaceProductionProposalDto[];
}
