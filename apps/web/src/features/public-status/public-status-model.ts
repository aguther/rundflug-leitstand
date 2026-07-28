import type { PublicTicketStatus } from "@rundflug/contracts";

export type PublicStatus = PublicTicketStatus["status"];
export type PublicStatusIconName =
  | "Clock3"
  | "CircleArrowRight"
  | "TicketsPlane"
  | "PlaneTakeoff"
  | "PlaneLanding"
  | "CircleCheck";

export interface PublicStatusPresentation {
  label: string;
  iconName: PublicStatusIconName;
}

export const PUBLIC_STATUS_PRESENTATIONS: Record<PublicStatus, PublicStatusPresentation> = {
  WAITING: {
    label: "WARTEN",
    iconName: "Clock3",
  },
  PREPARE: {
    label: "BEREITHALTEN",
    iconName: "Clock3",
  },
  COME_TO_FLIGHT_LINE: {
    label: "BITTE ZUM GATE",
    iconName: "CircleArrowRight",
  },
  BOARDING: {
    label: "BOARDING",
    iconName: "TicketsPlane",
  },
  IN_FLIGHT: {
    label: "IM FLUG",
    iconName: "PlaneTakeoff",
  },
  LANDED: {
    label: "GELANDET",
    iconName: "PlaneLanding",
  },
  COMPLETED: {
    label: "ABGESCHLOSSEN",
    iconName: "CircleCheck",
  },
  SERVICE_PAUSED: {
    label: "VERZÖGERT",
    iconName: "Clock3",
  },
};

export function publicStatusMessage(
  status: PublicStatus,
  serverMessage: string,
  pauseReason?: string,
): string {
  return status === "SERVICE_PAUSED" ? pauseReason?.trim() || serverMessage : serverMessage;
}
