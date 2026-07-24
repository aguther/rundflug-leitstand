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
  defaultMessage: string | null;
}

export const PUBLIC_STATUS_PRESENTATIONS: Record<PublicStatus, PublicStatusPresentation> = {
  WAITING: {
    label: "WARTEN",
    iconName: "Clock3",
    defaultMessage: "Bitte Status regelmäßig prüfen.",
  },
  PREPARE: {
    label: "WARTEN",
    iconName: "Clock3",
    defaultMessage: "Ihr Aufruf steht bevor. Bitte bereithalten.",
  },
  COME_TO_FLIGHT_LINE: {
    label: "GO TO GATE",
    iconName: "CircleArrowRight",
    defaultMessage: "Bitte jetzt zum Gate kommen.",
  },
  BOARDING: {
    label: "BOARDING",
    iconName: "TicketsPlane",
    defaultMessage: "Bitte am Gate zum Einstieg bereithalten.",
  },
  IN_FLIGHT: {
    label: "OFF-BLOCK",
    iconName: "PlaneTakeoff",
    defaultMessage: "Ihr Rundflug ist gestartet.",
  },
  LANDED: {
    label: "ON-BLOCK",
    iconName: "PlaneLanding",
    defaultMessage: "Ihr Rundflug ist gelandet.",
  },
  COMPLETED: {
    label: "ABGESCHLOSSEN",
    iconName: "CircleCheck",
    defaultMessage: "Ihr Rundflug ist abgeschlossen.",
  },
  SERVICE_PAUSED: {
    label: "VERZÖGERT",
    iconName: "Clock3",
    defaultMessage: null,
  },
};

export function publicStatusMessage(
  status: PublicStatus,
  serverMessage: string,
  pauseReason?: string,
): string {
  return status === "SERVICE_PAUSED"
    ? pauseReason?.trim() || serverMessage
    : (PUBLIC_STATUS_PRESENTATIONS[status].defaultMessage ?? serverMessage);
}
