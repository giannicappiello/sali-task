export interface PagedResponse<T> {
  page: number;
  pageSize: number;
  total: number;
  items: T[];
}

export interface WorkspaceStatus {
  source: string;
  apiVersion: number;
  readOnly: true;
  generatedAt: string;
  modules: {
    clients: boolean;
    suppliers: boolean;
    articles: boolean;
    orders: boolean;
    productionSummary: boolean;
    inventory: boolean;
    planning: boolean;
  };
}

export interface Client {
  id: number;
  codiceMexal: string;
  ragioneSociale: string;
  attivo: boolean;
}

export interface Article {
  id: number;
  codice: string;
  descrizione: string;
  nomeCommerciale: string;
  tipo: string;
  categoria: string;
  categoriaStatisticaMexal: string;
  descrizioneCategoriaStatisticaMexal: string;
  unitaMisura: string;
  attivo: boolean;
  gestioneLotti: boolean;
  codiceBarre: string;
  codiceMexal: string;
  peso: number;
  volume: number;
}

export interface ProductionOrder {
  id: number;
  numeroOrdine: string;
  articoloId: number;
  codiceArticolo: string;
  descrizioneArticolo: string;
  nomeCliente: string;
  quantita: number;
  dataOrdine: string;
  dataConsegna: string;
  dataPrevistaConsegna: string | null;
  priorita: string;
  stato: string;
  dataPianificataCorrente: string | null;
  giorniRitardoPianificazione: number;
}

export interface ProductionProgress {
  productionOrderId: number;
  orderNumber: string;
  phase: string;
  status: string;
  start: string;
  end: string | null;
  plannedQuantity: number;
  producedQuantity: number;
  progressPercent: number;
}

export interface InventoryItem {
  articoloId: number;
  codiceArticolo: string;
  descrizioneArticolo: string;
  numeroMagazzino: number;
  quantita: number;
  quantitaImpegnata: number;
  quantitaDisponibile: number;
  stato: string;
  dataAggiornamento: string;
}

export interface PlanningItem {
  productionOrderId: number;
  orderNumber: string;
  articleCode: string;
  articleDescription: string;
  operationType: string;
  start: string;
  end: string;
  status: string;
}

export type ProgremesResource =
  | "status"
  | "clients"
  | "articles"
  | "production-orders"
  | "production-progress"
  | "inventory"
  | "planning";
