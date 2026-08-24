export type WorkspaceProductionStatus =
  | "PRONTA"
  | "COPERTA_DA_SCORTA"
  | "IN_ATTESA_DI_FORMULA"
  | "OP_GENERATI"
  | "PRODUCIBILE"
  | "PARZIALMENTE_PRODUCIBILE"
  | "IN_ATTESA_MERCE"
  | "ODP_GENERATI"
  | "PIANIFICATO"
  | "IN_PRODUZIONE"
  | "COMPLETATO";

export interface WorkspaceProductionRequestPayload {
  schemaVersion: 1;
  externalId: string;
  oct: { externalId: string; lineExternalId: string; mexalKey: string };
  commercialArticleCode: string;
  quantity: number;
  unitOfMeasure: string;
  quantityContext: {
    requested: { value: number; unitOfMeasure: string };
    requestedInProductionUnit: { value: number; unitOfMeasure: string };
    availableFinishedProduct: { value: number; unitOfMeasure: string };
    coveredFromStock: { value: number; unitOfMeasure: string };
    toProduce: { value: number; unitOfMeasure: string };
    conversion: { from: string; to: string; factor: number; source: string } | null;
  };
  availabilitySnapshot: {
    id: number;
    hash: string;
    capturedAt: string;
    warehouseRule: { code: string; warehouses: number[] | null; description: string };
  };
  orderDate: string;
  requestedDeliveryDate: string | null;
  customerMexalCode: string;
}

export interface WorkspaceProductionProposalDto {
  id: number;
  productionIndex: number;
  quantity: number;
  status: "DaVerificare" | "Producibile" | "InAttesaMerce" | "Confermata";
  materialStatus: "DA_VERIFICARE" | "PRODUCIBILE" | "IN_ATTESA_MERCE" | "ODP_GENERATO";
  expectedMaterialAvailability: string | null;
  productionOrderId: number | null;
  productionOrderNumber: string | null;
}

export interface WorkspaceProductionEvent {
  schemaVersion: 1;
  eventId: string;
  externalId: string;
  sequence: number;
  occurredAt: string;
  type: string;
  workspaceStatus: WorkspaceProductionStatus;
  proposals: WorkspaceProductionProposalDto[];
}
