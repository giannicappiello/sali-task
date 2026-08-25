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
}

export interface WorkspaceProductionDemandItem {
  itemIndex: number;
  itemExternalKey: string;
  oct: {
    externalId: string;
    lineExternalId: string;
    mexalKey: string;
    position: number | null;
  };
  commercialArticleCode: string;
  productionArticleCode: string | null;
  mappingStatus: "TO_RESOLVE_IN_MES" | "RESOLVED";
  requested: { value: number; unitOfMeasure: string };
  requestedInProductionUnit: { value: number; unitOfMeasure: string };
  conversion: { from: string; to: string; factor: number; source: string } | null;
  requestedDeliveryDate: string | null;
}

export interface WorkspaceProductionRequestPayload {
  schemaVersion: 2;
  externalId: string;
  requestType: "MULTI_OCT_PRODUCTION_DEMAND";
  idempotencyKey: string;
  availabilityOwner: "PROGREMES";
  demandSnapshot: { id: number; hash: string; capturedAt: string };
  orders: WorkspaceOctReference[];
  items: WorkspaceProductionDemandItem[];
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
