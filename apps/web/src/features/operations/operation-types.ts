import type { WeightClass } from "./operation-labels";

export type GateDisplayStatus = "DRAFT" | "CALLED" | "IN_FLIGHT" | "LANDED" | "COMPLETED";

export interface TicketDetail {
  clientId: string;
  weightClass: WeightClass;
  individualWeightKg: number | null;
}

export interface TicketReceipt {
  code: string;
  statusUrl: string;
  qrDataUrl: string;
  eventName: string;
  productName: string;
  gateLabel: string;
  communicationLabel: string;
  groupSize: number;
}

export interface MasterDataDeleteTarget {
  entityType: "GATE" | "RESOURCE_GROUP" | "AIRCRAFT" | "ASSIGNMENT" | "PILOT" | "PRODUCT";
  entityId: string;
  label: string;
  blockers: string[];
}
